/* Real-mail provider, backed by the public mail.tm API.
   Addresses created here accept genuine SMTP mail from anywhere.

   Every provider exposes the same surface so the app never has to care which
   one is active — see js/providers/demo.js for the offline twin. */
window.TM = window.TM || {};
TM.providers = TM.providers || {};

TM.providers.mailtm = (function () {
  'use strict';

  var BASE = 'https://api.mail.tm';
  var MIN_GAP_MS = 160;      // the API allows ~8 req/s; stay well under it
  var MAX_RETRIES = 3;

  var lastCall = 0;
  var chain = Promise.resolve();
  var domainCache = null;

  function apiError(message, status, code) {
    var e = new Error(message);
    e.status = status || 0;
    e.code = code || 'api_error';
    return e;
  }

  /* Serialise every call through one promise chain and space them out, so a
     burst of tab-focus refreshes can never trip the rate limiter. */
  function schedule(fn) {
    var run = chain.then(function () {
      var wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
      return TM.util.sleep(wait).then(function () {
        lastCall = Date.now();
        return fn();
      });
    });
    chain = run.then(function () {}, function () {});
    return run;
  }

  function request(path, opts, attempt) {
    opts = opts || {};
    attempt = attempt || 0;

    var headers = { 'Accept': 'application/json' };
    if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
    if (opts.body !== undefined) headers['Content-Type'] = opts.contentType || 'application/json';

    return schedule(function () {
      return fetch(BASE + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit'
      });
    }).then(function (res) {
      if (res.status === 429 && attempt < MAX_RETRIES) {
        var retryAfter = parseFloat(res.headers.get('retry-after') || '0');
        var delay = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 700;
        return TM.util.sleep(delay).then(function () {
          return request(path, opts, attempt + 1);
        });
      }
      if (res.status === 204) return null;

      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }

        if (!res.ok) {
          var msg = (data && (data['hydra:description'] || data.detail || data.message)) ||
            ('Request failed (' + res.status + ')');
          var code = res.status === 401 ? 'unauthorized'
            : res.status === 404 ? 'not_found'
              : res.status === 422 ? 'invalid'
                : res.status === 429 ? 'rate_limited' : 'api_error';
          throw apiError(msg, res.status, code);
        }
        return data;
      });
    }, function (err) {
      if (err && err.status) throw err;
      throw apiError('Cannot reach the mail service', 0, 'offline');
    });
  }

  function members(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    return payload['hydra:member'] || [];
  }

  /* ── public surface ────────────────────────────────────────────── */

  function domains(force) {
    if (domainCache && !force) return Promise.resolve(domainCache);
    return request('/domains?page=1').then(function (data) {
      var list = members(data)
        .filter(function (d) { return d.isActive && !d.isPrivate; })
        .map(function (d) { return d.domain; });
      if (!list.length) throw apiError('No mail domains are available right now', 0, 'no_domains');
      domainCache = list;
      return list;
    });
  }

  function login(address, password) {
    return request('/token', { method: 'POST', body: { address: address, password: password } })
      .then(function (data) {
        if (!data || !data.token) throw apiError('Login failed', 0, 'no_token');
        return { token: data.token, accountId: data.id };
      });
  }

  /* The API normalises the local part on its way in (dots, for one, are
     dropped) so the address it hands back is the only one that will
     authenticate. Always take the server's version, never the requested one. */
  function createAccount(localPart, domain) {
    return (domain ? Promise.resolve(domain) : domains().then(function (d) { return d[0]; }))
      .then(function (dom) {
        var local = sanitizeLocalPart(localPart || TM.util.randomLocalPart());
        var requested = local + '@' + dom;
        var password = TM.util.randomPassword();

        return request('/accounts', { method: 'POST', body: { address: requested, password: password } })
          .then(function (acct) {
            var address = (acct && acct.address) || requested;
            return login(address, password).then(function (auth) {
              return {
                provider: 'mailtm',
                address: address,
                password: password,
                accountId: (acct && acct.id) || auth.accountId,
                token: auth.token,
                createdAt: new Date().toISOString()
              };
            });
          });
      });
  }

  function sanitizeLocalPart(local) {
    var clean = String(local).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!clean) clean = TM.util.randomLocalPart();
    return clean.slice(0, 40);
  }

  /* Bring a stored session back to life: try the saved token, fall back to a
     fresh login with the saved password. */
  function resume(session) {
    if (!session || !session.address || !session.password) {
      return Promise.reject(apiError('No session to resume', 0, 'no_session'));
    }
    var tryToken = session.token
      ? request('/me', { token: session.token }).then(function (me) {
        return Object.assign({}, session, { accountId: (me && me.id) || session.accountId });
      })
      : Promise.reject(apiError('No token', 401, 'unauthorized'));

    return tryToken.catch(function (err) {
      if (err.code === 'offline') throw err;
      return login(session.address, session.password).then(function (auth) {
        return Object.assign({}, session, { token: auth.token, accountId: auth.accountId });
      });
    });
  }

  function normalizeAddr(a) {
    if (!a) return { name: '', address: '' };
    return { name: a.name || '', address: a.address || '' };
  }

  function normalizeList(m) {
    return {
      id: m.id,
      from: normalizeAddr(m.from),
      to: (m.to || []).map(normalizeAddr),
      subject: m.subject || '',
      intro: m.intro || '',
      seen: !!m.seen,
      hasAttachments: !!m.hasAttachments,
      size: m.size || 0,
      createdAt: m.createdAt || new Date().toISOString()
    };
  }

  function listMessages(session) {
    return request('/messages?page=1', { token: session.token }).then(function (data) {
      return members(data).map(normalizeList);
    });
  }

  function getMessage(session, id) {
    return request('/messages/' + encodeURIComponent(id), { token: session.token }).then(function (m) {
      var full = normalizeList(m);
      full.cc = (m.cc || []).map(normalizeAddr);
      full.text = m.text || '';
      full.html = Array.isArray(m.html) ? m.html.join('\n') : (m.html || '');
      full.attachments = (m.attachments || []).map(function (a) {
        return {
          id: a.id,
          filename: a.filename || 'attachment',
          contentType: a.contentType || 'application/octet-stream',
          size: a.size || 0,
          downloadUrl: a.downloadUrl || ('/messages/' + m.id + '/attachment/' + a.id)
        };
      });
      return full;
    });
  }

  function markSeen(session, id) {
    return request('/messages/' + encodeURIComponent(id), {
      method: 'PATCH',
      token: session.token,
      contentType: 'application/merge-patch+json',
      body: { seen: true }
    }).catch(function () { /* cosmetic only — never surface this */ });
  }

  function deleteMessage(session, id) {
    return request('/messages/' + encodeURIComponent(id), { method: 'DELETE', token: session.token });
  }

  function deleteAccount(session) {
    if (!session.accountId) return Promise.resolve();
    return request('/accounts/' + encodeURIComponent(session.accountId), {
      method: 'DELETE',
      token: session.token
    });
  }

  /* Attachments need the bearer token, so a plain <a download> won't do. */
  function fetchAttachment(session, downloadUrl) {
    var url = /^https?:/i.test(downloadUrl) ? downloadUrl : BASE + downloadUrl;
    return schedule(function () {
      return fetch(url, {
        headers: { Authorization: 'Bearer ' + session.token },
        mode: 'cors',
        credentials: 'omit'
      });
    }).then(function (res) {
      if (!res.ok) throw apiError('Could not download the attachment', res.status, 'api_error');
      return res.blob();
    }, function (err) {
      if (err && err.status) throw err;
      throw apiError('Could not download the attachment', 0, 'offline');
    });
  }

  return {
    id: 'mailtm',
    label: 'mail.tm',
    isDemo: false,
    domains: domains,
    createAccount: createAccount,
    resume: resume,
    listMessages: listMessages,
    getMessage: getMessage,
    markSeen: markSeen,
    deleteMessage: deleteMessage,
    deleteAccount: deleteAccount,
    fetchAttachment: fetchAttachment
  };
})();

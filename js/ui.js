/* All DOM rendering lives here. It knows nothing about mail providers —
   app.js hands it plain data and receives callbacks. */
window.TM = window.TM || {};

TM.ui = (function () {
  'use strict';

  var u = TM.util;
  var $ = u.$;
  var el = {};
  var handlers = {};
  var currentMessage = null;
  var allowRemote = false;

  /* ── setup ─────────────────────────────────────────────────────── */
  function init(h) {
    handlers = h || {};

    [
      'addrText', 'addrCopy', 'addrMeta', 'btnCopy', 'btnRefresh', 'btnChange', 'btnDelete',
      'connBadge', 'connText', 'themeToggle', 'msgList', 'emptyState', 'inboxCount',
      'btnRefreshList', 'paneReader', 'reader', 'readerEmpty', 'readerLoading', 'readerSubject',
      'readerAvatar', 'readerName', 'readerAddr', 'readerDate', 'readerTo', 'readerBody',
      'attachments', 'btnBack', 'btnDeleteMsg', 'btnImages', 'toasts', 'customDialog',
      'customForm', 'customLocal', 'customDomain', 'customError', 'historyWrap', 'historyList',
      'confirmDialog', 'confirmTitle', 'confirmText', 'confirmOk', 'pollNote'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    el.btnCopy.addEventListener('click', function () { fire('copy'); });
    el.addrCopy.addEventListener('click', function () { fire('copy'); });
    el.btnRefresh.addEventListener('click', function () { fire('refresh'); });
    el.btnRefreshList.addEventListener('click', function () { fire('refresh'); });
    el.btnChange.addEventListener('click', function () { fire('change'); });
    el.btnDelete.addEventListener('click', function () { fire('deleteInbox'); });
    el.btnBack.addEventListener('click', closeReader);
    el.btnDeleteMsg.addEventListener('click', function () {
      if (currentMessage) fire('deleteMessage', currentMessage.id);
    });
    el.btnImages.addEventListener('click', function () {
      allowRemote = true;
      el.btnImages.hidden = true;
      if (currentMessage) renderBody(currentMessage);
    });

    el.msgList.addEventListener('click', function (ev) {
      var li = ev.target.closest('.msg-item');
      if (li && li.dataset.id) fire('open', li.dataset.id);
    });
    el.msgList.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var li = ev.target.closest('.msg-item');
      if (li && li.dataset.id) { ev.preventDefault(); fire('open', li.dataset.id); }
    });

    el.themeToggle.addEventListener('click', toggleTheme);

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && document.body.classList.contains('reading')) closeReader();
    });

    initTheme();
  }

  function fire(name, arg) {
    if (typeof handlers[name] === 'function') handlers[name](arg);
  }

  /* ── theme ─────────────────────────────────────────────────────── */
  function initTheme() {
    var saved = TM.store.getTheme();
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    TM.store.setTheme(next);
  }

  /* ── header bits ───────────────────────────────────────────────── */
  function setAddress(address) {
    if (address) {
      el.addrText.textContent = address;
      el.addrText.classList.remove('is-loading');
      el.addrCopy.title = 'Click to copy ' + address;
    } else {
      el.addrText.textContent = 'generating address';
      el.addrText.classList.add('is-loading');
    }
  }

  function setAddressMeta(text) {
    el.addrMeta.textContent = text;
  }

  var CONN_CLASS = { live: 'badge-live', warn: 'badge-warn', error: 'badge-err', idle: '' };
  function setConnection(state, text) {
    el.connBadge.className = 'badge ' + (CONN_CLASS[state] || '');
    el.connText.textContent = text;
  }

  function setBusy(busy) {
    el.btnRefresh.disabled = !!busy;
    el.btnRefreshList.classList.toggle('is-spinning', !!busy);
  }

  function setPollNote(text) {
    el.pollNote.textContent = text || '';
  }

  /* ── message list ──────────────────────────────────────────────── */
  var CLIP_SVG = '<svg class="flag-clip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.3-7.3"></path></svg>';

  function renderList(messages, activeId, newIds) {
    el.inboxCount.textContent = String(messages.length);
    el.emptyState.hidden = messages.length > 0;

    var html = messages.map(function (m) {
      var who = m.from.name || m.from.address || 'Unknown sender';
      var isNew = newIds && newIds.indexOf(m.id) !== -1;
      var cls = 'msg-item'
        + (m.id === activeId ? ' is-active' : '')
        + (m.seen ? '' : ' is-unread')
        + (isNew ? ' is-new' : '');

      return '<li class="' + cls + '" data-id="' + u.escapeHtml(m.id) + '" tabindex="0" role="button">'
        + '<span class="avatar" style="' + u.avatarStyle(m.from.address || who) + '">'
        + u.escapeHtml(u.initials(m.from.name, m.from.address)) + '</span>'
        + '<div class="msg-main">'
        + '<div class="msg-top">'
        + '<span class="msg-from">' + u.escapeHtml(who) + '</span>'
        + '<span class="msg-time" data-time="' + u.escapeHtml(m.createdAt) + '">' + u.escapeHtml(u.relTime(m.createdAt)) + '</span>'
        + '</div>'
        + '<div class="msg-subject">' + u.escapeHtml(m.subject || '(no subject)')
        + '<span class="msg-flags">'
        + (m.seen ? '' : '<span class="flag-unread" title="Unread"></span>')
        + (m.hasAttachments ? CLIP_SVG : '')
        + '</span></div>'
        + (m.intro ? '<div class="msg-intro">' + u.escapeHtml(m.intro) + '</div>' : '')
        + '</div></li>';
    }).join('');

    el.msgList.innerHTML = html;
  }

  /* Refresh the "3m ago" labels without re-rendering the list. */
  function refreshTimes() {
    u.$$('.msg-time', el.msgList).forEach(function (node) {
      node.textContent = u.relTime(node.dataset.time);
    });
  }

  function setActive(id) {
    u.$$('.msg-item', el.msgList).forEach(function (node) {
      node.classList.toggle('is-active', node.dataset.id === id);
    });
  }

  function markRead(id) {
    var node = el.msgList.querySelector('.msg-item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!node) return;
    node.classList.remove('is-unread');
    var dot = node.querySelector('.flag-unread');
    if (dot) dot.remove();
  }

  /* ── reader ────────────────────────────────────────────────────── */
  function showReaderLoading() {
    el.readerEmpty.hidden = true;
    el.reader.hidden = true;
    el.readerLoading.hidden = false;
    document.body.classList.add('reading');
  }

  function clearReader() {
    currentMessage = null;
    el.reader.hidden = true;
    el.readerLoading.hidden = true;
    el.readerEmpty.hidden = false;
    el.readerBody.innerHTML = '';
    setActive(null);
  }

  function closeReader() {
    document.body.classList.remove('reading');
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) clearReader();
  }

  var REMOTE_RE = /(?:src|background)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i;

  function frameDoc(html, remoteOk) {
    var csp = "default-src 'none'; script-src 'none'; frame-src 'none'; object-src 'none'; "
      + "form-action 'none'; base-uri 'none'; style-src 'unsafe-inline'; font-src data:; "
      + 'img-src data:' + (remoteOk ? ' https: http:' : '') + ';';

    return '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
      + '<meta name="referrer" content="no-referrer">'
      + '<base target="_blank">'
      + '<style>html,body{margin:0;background:#fff;color:#15181f;'
      + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.6}'
      + 'body{padding:20px}img{max-width:100%;height:auto}'
      + 'table{max-width:100%}a{color:#4634e8}'
      + '*{overflow-wrap:anywhere}</style></head><body>' + html + '</body></html>';
  }

  function renderBody(msg) {
    el.readerBody.innerHTML = '';

    if (msg.html && msg.html.trim()) {
      var frame = document.createElement('iframe');
      frame.className = 'msg-frame';
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('title', 'Message body');
      frame.srcdoc = frameDoc(msg.html, allowRemote);
      el.readerBody.appendChild(frame);
      el.btnImages.hidden = allowRemote || !REMOTE_RE.test(msg.html);
      return;
    }

    el.btnImages.hidden = true;

    if (msg.text && msg.text.trim()) {
      var pre = document.createElement('pre');
      pre.className = 'msg-text';
      pre.innerHTML = u.linkify(msg.text);
      u.$$('a', pre).forEach(function (a) { a.rel = 'noopener noreferrer nofollow'; a.target = '_blank'; });
      el.readerBody.appendChild(pre);
      return;
    }

    var p = document.createElement('p');
    p.className = 'msg-nobody';
    p.textContent = 'This message has no readable body.';
    el.readerBody.appendChild(p);
  }

  var FILE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"></path><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"></path></svg>';

  function renderAttachments(msg) {
    var list = msg.attachments || [];
    el.attachments.innerHTML = '';
    el.attachments.hidden = list.length === 0;
    if (!list.length) return;

    list.forEach(function (att) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'att';
      b.title = att.filename + ' · ' + (att.contentType || '');
      b.innerHTML = FILE_SVG
        + '<span class="att-name">' + u.escapeHtml(att.filename) + '</span>'
        + '<span class="att-size">' + u.escapeHtml(u.formatBytes(att.size)) + '</span>';
      b.addEventListener('click', function () { fire('downloadAttachment', att); });
      el.attachments.appendChild(b);
    });
  }

  function renderMessage(msg) {
    currentMessage = msg;
    allowRemote = false;

    el.readerLoading.hidden = true;
    el.readerEmpty.hidden = true;
    el.reader.hidden = false;
    document.body.classList.add('reading');

    var who = msg.from.name || msg.from.address || 'Unknown sender';
    el.readerSubject.textContent = msg.subject || '(no subject)';
    el.readerAvatar.textContent = u.initials(msg.from.name, msg.from.address);
    el.readerAvatar.setAttribute('style', u.avatarStyle(msg.from.address || who));
    el.readerName.textContent = who;
    el.readerAddr.textContent = msg.from.address || '';
    el.readerDate.textContent = u.fullDate(msg.createdAt);
    el.readerDate.title = new Date(msg.createdAt).toString();

    var to = (msg.to || []).map(function (a) { return a.address; }).filter(Boolean).join(', ');
    var cc = (msg.cc || []).map(function (a) { return a.address; }).filter(Boolean).join(', ');
    el.readerTo.textContent = 'To ' + (to || '—') + (cc ? '  ·  Cc ' + cc : '')
      + (msg.size ? '  ·  ' + u.formatBytes(msg.size) : '');

    renderAttachments(msg);
    renderBody(msg);
    setActive(msg.id);

    /* On phones the reader replaces the list, so start at the top of it. */
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
      window.scrollTo(0, 0);
    }
  }

  /* ── toasts ────────────────────────────────────────────────────── */
  var TOAST_ICON = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"></path></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 7v6M12 16.5v.5"></path><circle cx="12" cy="12" r="9"></circle></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="3"></rect><path d="m3.5 7.5 7.06 5.3a2.4 2.4 0 0 0 2.88 0L20.5 7.5"></path></svg>'
  };

  function toast(text, kind, ms) {
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' toast-' + kind : '');
    node.innerHTML = (TOAST_ICON[kind] || '') + '<span></span>';
    node.lastChild.textContent = text;
    el.toasts.appendChild(node);

    setTimeout(function () {
      node.classList.add('is-out');
      setTimeout(function () { node.remove(); }, 240);
    }, ms || 2600);
  }

  /* ── dialogs ───────────────────────────────────────────────────── */
  function supportsDialog(d) { return d && typeof d.showModal === 'function'; }

  function confirmAction(title, text, okLabel) {
    if (!supportsDialog(el.confirmDialog)) {
      return Promise.resolve(window.confirm(title + '\n\n' + text));
    }
    el.confirmTitle.textContent = title;
    el.confirmText.textContent = text;
    el.confirmOk.textContent = okLabel || 'Delete';

    return new Promise(function (resolve) {
      function onClose() {
        el.confirmDialog.removeEventListener('close', onClose);
        resolve(el.confirmDialog.returnValue === 'ok');
      }
      el.confirmDialog.addEventListener('close', onClose);
      el.confirmDialog.returnValue = '';
      el.confirmDialog.showModal();
    });
  }

  /* Resolves with {action:'create', localPart, domain} | {action:'restore', entry} | null */
  function openAddressDialog(domains, history, currentAddress) {
    if (!supportsDialog(el.customDialog)) {
      var typed = window.prompt('New address name (blank for random):', '');
      if (typed === null) return Promise.resolve(null);
      return Promise.resolve({ action: 'create', localPart: typed.trim(), domain: domains[0] });
    }

    el.customLocal.value = '';
    el.customError.hidden = true;
    el.customDomain.innerHTML = domains.map(function (d) {
      return '<option value="' + u.escapeHtml(d) + '">' + u.escapeHtml(d) + '</option>';
    }).join('');

    var entries = (history || []).filter(function (e) { return e.address !== currentAddress; });
    el.historyWrap.hidden = entries.length === 0;
    el.historyList.innerHTML = '';

    var restored = null;

    entries.forEach(function (entry) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'history-item';
      b.innerHTML = '<span class="h-addr"></span><span class="h-when"></span>';
      b.querySelector('.h-addr').textContent = entry.address;
      b.querySelector('.h-when').textContent = u.relTime(entry.createdAt);
      b.addEventListener('click', function () {
        restored = entry;
        el.customDialog.close('restore');
      });
      li.appendChild(b);
      el.historyList.appendChild(li);
    });

    return new Promise(function (resolve) {
      function onClose() {
        el.customDialog.removeEventListener('close', onClose);
        var v = el.customDialog.returnValue;
        if (v === 'restore' && restored) return resolve({ action: 'restore', entry: restored });
        if (v !== 'create') return resolve(null);

        var local = el.customLocal.value.trim().toLowerCase();
        resolve({
          action: 'create',
          localPart: local || null,
          domain: el.customDomain.value
        });
      }
      el.customDialog.addEventListener('close', onClose);
      el.customDialog.returnValue = '';
      el.customDialog.showModal();
      setTimeout(function () { el.customLocal.focus(); }, 30);
    });
  }

  function dialogError(msg) {
    el.customError.textContent = msg;
    el.customError.hidden = !msg;
  }

  return {
    init: init,
    setAddress: setAddress,
    setAddressMeta: setAddressMeta,
    setConnection: setConnection,
    setBusy: setBusy,
    setPollNote: setPollNote,
    renderList: renderList,
    refreshTimes: refreshTimes,
    setActive: setActive,
    markRead: markRead,
    showReaderLoading: showReaderLoading,
    renderMessage: renderMessage,
    clearReader: clearReader,
    closeReader: closeReader,
    toast: toast,
    confirmAction: confirmAction,
    openAddressDialog: openAddressDialog,
    dialogError: dialogError,
    toggleTheme: toggleTheme
  };
})();

/* Offline twin of the mail.tm provider.

   Used when the live API can't be reached (no network, blocked, service down)
   and when the page is opened with ?demo=1. Same method surface, fake mail —
   so the UI is never a dead screen. */
window.TM = window.TM || {};
TM.providers = TM.providers || {};

TM.providers.demo = (function () {
  'use strict';

  var DOMAINS = ['demo.tempbox.local', 'sandbox.tempbox.local'];
  var boxes = {};   // address -> { messages: [], nextAt: timestamp, queue: [] }
  var seq = 0;

  function nextId() { return 'demo-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8); }

  function welcome(address) {
    return {
      id: nextId(),
      from: { name: 'Tempbox', address: 'hello@tempbox.local' },
      to: [{ name: '', address: address }],
      subject: 'Demo mode — this inbox is simulated',
      intro: 'The live mail service could not be reached, so Tempbox switched to demo mode.',
      seen: false,
      hasAttachments: false,
      size: 2480,
      createdAt: new Date().toISOString(),
      text: '',
      html: '<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.6;color:#1c1f27">'
        + '<h2 style="margin:0 0 12px;font-size:20px">You are in demo mode</h2>'
        + '<p>Tempbox could not reach the live mail backend, so it is showing a simulated inbox '
        + 'instead of a dead screen. Everything you see here is generated locally in your browser.</p>'
        + '<p><strong>' + address.replace(/[<&>]/g, '') + '</strong> will not receive real mail while this banner is showing.</p>'
        + '<p style="margin-top:18px">Reload the page once you are back online and a real, receivable '
        + 'address will be issued automatically.</p>'
        + '<p style="margin-top:22px;font-size:13px;color:#6b7385">Tempbox · demo provider</p></div>',
      attachments: []
    };
  }

  function scripted(address) {
    return [
      {
        delay: 14000,
        from: { name: 'Northwind Store', address: 'no-reply@northwind.example' },
        subject: 'Confirm your email address',
        intro: 'Your confirmation code is 481-902. It expires in 15 minutes.',
        html: '<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.6;color:#1c1f27">'
          + '<h2 style="font-size:19px;margin:0 0 10px">Confirm your email</h2>'
          + '<p>Use this code to finish signing up:</p>'
          + '<p style="font-size:30px;letter-spacing:5px;font-weight:700;margin:18px 0">481902</p>'
          + '<p style="font-size:13px;color:#6b7385">The code expires in 15 minutes. If you did not request it, ignore this message.</p></div>'
      },
      {
        delay: 38000,
        from: { name: 'Lumen Weekly', address: 'digest@lumen.example' },
        subject: 'Your weekly digest is ready',
        intro: 'Five things worth reading this week, plus the usual links.',
        html: '<div style="font-family:Georgia,serif;max-width:540px;line-height:1.65;color:#22262f">'
          + '<h2 style="font-size:21px;margin:0 0 14px">Lumen Weekly</h2>'
          + '<p>This week: why nobody reads changelogs, a small case for boring infrastructure, '
          + 'and a rather long argument about tabs.</p>'
          + '<ul><li>The quiet cost of clever code</li><li>Boring infrastructure, happy weekends</li>'
          + '<li>Reading email in 2026</li></ul>'
          + '<p style="font-size:13px;color:#6b7385;margin-top:20px">You are receiving this because someone typed a disposable address into a form.</p></div>'
      }
    ].map(function (s) {
      return {
        at: Date.now() + s.delay,
        msg: {
          id: nextId(),
          from: s.from,
          to: [{ name: '', address: address }],
          subject: s.subject,
          intro: s.intro,
          seen: false,
          hasAttachments: false,
          size: 3200 + Math.floor(Math.random() * 4000),
          createdAt: null,          // stamped at delivery time
          text: '',
          html: s.html,
          attachments: []
        }
      };
    });
  }

  function box(address) {
    if (!boxes[address]) {
      boxes[address] = { messages: [welcome(address)], queue: scripted(address) };
    }
    return boxes[address];
  }

  /* Deliver anything whose scheduled time has passed. */
  function tick(address) {
    var b = box(address);
    var now = Date.now();
    b.queue = b.queue.filter(function (item) {
      if (item.at <= now) {
        item.msg.createdAt = new Date().toISOString();
        b.messages.unshift(item.msg);
        return false;
      }
      return true;
    });
    return b;
  }

  function strip(m) {
    return {
      id: m.id, from: m.from, to: m.to, subject: m.subject, intro: m.intro,
      seen: m.seen, hasAttachments: m.hasAttachments, size: m.size, createdAt: m.createdAt
    };
  }

  function later(value) {
    return TM.util.sleep(120).then(function () { return value; });
  }

  function find(address, id) {
    var b = box(address);
    for (var i = 0; i < b.messages.length; i++) if (b.messages[i].id === id) return b.messages[i];
    return null;
  }

  return {
    id: 'demo',
    label: 'demo',
    isDemo: true,

    domains: function () { return later(DOMAINS.slice()); },

    createAccount: function (localPart, domain) {
      var address = (localPart || TM.util.randomLocalPart()).toLowerCase() + '@' + (domain || DOMAINS[0]);
      box(address);
      return later({
        provider: 'demo',
        address: address,
        password: 'demo',
        accountId: 'demo-' + address,
        token: 'demo',
        createdAt: new Date().toISOString()
      });
    },

    resume: function (session) {
      box(session.address);
      return later(Object.assign({}, session, { provider: 'demo', token: 'demo' }));
    },

    listMessages: function (session) {
      return later(tick(session.address).messages.map(strip));
    },

    getMessage: function (session, id) {
      var m = find(session.address, id);
      if (!m) return Promise.reject(new Error('Message not found'));
      return later(Object.assign({}, m));
    },

    markSeen: function (session, id) {
      var m = find(session.address, id);
      if (m) m.seen = true;
      return Promise.resolve();
    },

    deleteMessage: function (session, id) {
      var b = box(session.address);
      b.messages = b.messages.filter(function (m) { return m.id !== id; });
      return later(null);
    },

    deleteAccount: function (session) {
      delete boxes[session.address];
      return later(null);
    },

    fetchAttachment: function () {
      return Promise.reject(new Error('Attachments are not available in demo mode'));
    }
  };
})();

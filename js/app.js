/* Controller: owns the session, drives polling, and wires UI events to the
   active mail provider. */
(function () {
  'use strict';

  var u = TM.util;
  var ui = TM.ui;
  var store = TM.store;

  var POLL_MS = 5000;
  var POLL_MAX_MS = 60000;
  var TIME_TICK_MS = 30000;

  var state = {
    provider: null,
    session: null,
    messages: [],
    activeId: null,
    pollTimer: null,
    pollDelay: POLL_MS,
    busy: false,
    failures: 0,
    loadedOnce: false
  };

  var wantsDemo = /[?&]demo=1\b/.test(location.search);

  /* ── provider selection ────────────────────────────────────────── */
  function liveProvider() { return TM.providers.mailtm; }
  function demoProvider() { return TM.providers.demo; }

  function useProvider(p) {
    state.provider = p;
    if (p.isDemo) {
      ui.setConnection('warn', 'Demo mode');
      ui.setAddressMeta('Demo mode: the live mail service is unreachable, so this inbox is simulated locally.');
    } else {
      ui.setConnection('live', 'Live');
      ui.setAddressMeta('Mail sent to this address appears below within seconds. Receive-only — you cannot send from it.');
    }
  }

  /* ── boot ──────────────────────────────────────────────────────── */
  function start() {
    ui.init({
      copy: onCopy,
      refresh: function () { refresh(true); },
      change: onChange,
      deleteInbox: onDeleteInbox,
      open: openMessage,
      deleteMessage: onDeleteMessage,
      downloadAttachment: onDownloadAttachment
    });

    ui.setAddress(null);
    ui.setConnection('idle', 'Connecting…');

    setInterval(ui.refreshTimes, TIME_TICK_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopPolling();
        ui.setPollNote('paused');
      } else if (state.session) {
        state.pollDelay = POLL_MS;
        refresh(false);
        schedulePoll();
      }
    });

    window.addEventListener('online', function () {
      if (state.session && !document.hidden) { state.pollDelay = POLL_MS; refresh(false); }
    });

    bootSession();
  }

  function bootSession() {
    var saved = store.getSession();

    if (wantsDemo) {
      useProvider(demoProvider());
      return createFresh(null, null);
    }

    if (saved && saved.provider === 'demo') saved = null;   // never resume a fake box as if real

    useProvider(liveProvider());

    var attempt = saved
      ? liveProvider().resume(saved).then(function (session) {
        setSession(session);
        return refresh(false);
      })
      : createFresh(null, null);

    return attempt.catch(function (err) {
      /* A dead saved session is worth one clean retry before giving up. */
      if (saved && err.code !== 'offline') {
        return createFresh(null, null).catch(function (e2) { return fallbackToDemo(e2); });
      }
      return fallbackToDemo(err);
    });
  }

  function fallbackToDemo(err) {
    console.warn('[tempbox] live provider unavailable:', err && err.message);
    useProvider(demoProvider());
    ui.toast('Live mail service unreachable — switched to demo mode', 'err', 4200);
    return createFresh(null, null);
  }

  function createFresh(localPart, domain) {
    return state.provider.createAccount(localPart, domain).then(function (session) {
      setSession(session);
      return refresh(false);
    });
  }

  function setSession(session) {
    state.session = session;
    state.messages = [];
    state.activeId = null;
    state.loadedOnce = false;   // a new mailbox's first listing is not "new mail"
    store.setSession(session);
    ui.setAddress(session.address);
    ui.renderList([], null, null);
    ui.clearReader();
    schedulePoll();

    /* Warm the domain list so the "Change" dialog opens instantly. A restored
       session never calls createAccount(), so nothing else would fetch it. */
    state.provider.domains().catch(function () {});
  }

  /* ── polling ───────────────────────────────────────────────────── */
  function schedulePoll() {
    stopPolling();
    if (!state.session) return;
    /* Background tabs don't poll — the label has to say so, including when the
       page was loaded hidden and no visibilitychange ever fired. */
    if (document.hidden) { ui.setPollNote('paused'); return; }
    ui.setPollNote('checking every ' + Math.round(state.pollDelay / 1000) + 's');
    state.pollTimer = setTimeout(function () {
      refresh(false).then(schedulePoll, schedulePoll);
    }, state.pollDelay);
  }

  function stopPolling() {
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
  }

  function refresh(manual) {
    if (!state.session || state.busy) return Promise.resolve();
    state.busy = true;
    if (manual) ui.setBusy(true);

    return state.provider.listMessages(state.session).then(function (messages) {
      var known = {};
      state.messages.forEach(function (m) { known[m.id] = true; });
      var fresh = messages.filter(function (m) { return !known[m.id]; }).map(function (m) { return m.id; });
      var isFirstLoad = state.messages.length === 0 && !state.loadedOnce;

      state.messages = messages;
      state.loadedOnce = true;
      ui.renderList(messages, state.activeId, isFirstLoad ? null : fresh);

      if (fresh.length && !isFirstLoad) {
        var newest = messages[0];
        var who = newest.from.name || newest.from.address;
        ui.toast(fresh.length === 1 ? 'New mail from ' + who : fresh.length + ' new messages', 'mail', 3200);
      }
      if (manual && !fresh.length) ui.toast('No new mail', 'ok', 1600);

      /* healthy again → back to the fast cadence */
      state.failures = 0;
      state.pollDelay = POLL_MS;
      if (!state.provider.isDemo) ui.setConnection('live', 'Live');
    }).catch(function (err) {
      state.failures++;
      state.pollDelay = Math.min(POLL_MAX_MS, POLL_MS * Math.pow(2, Math.min(state.failures, 4)));

      if (err.code === 'unauthorized') return recoverSession();

      ui.setConnection('error', state.failures > 2 ? 'Offline' : 'Retrying…');
      if (manual) ui.toast(err.message || 'Could not reach the mail service', 'err');
    }).then(function () {
      state.busy = false;
      if (manual) ui.setBusy(false);
    });
  }

  /* Token expired mid-session: log back in with the stored password. */
  function recoverSession() {
    if (!state.session || state.provider.isDemo) return;
    return state.provider.resume(state.session).then(function (session) {
      state.session = session;
      store.setSession(session);
      ui.setConnection('live', 'Live');
    }).catch(function () {
      ui.setConnection('error', 'Session expired');
    });
  }

  /* ── actions ───────────────────────────────────────────────────── */
  function onCopy() {
    if (!state.session) return;
    u.copyText(state.session.address).then(function () {
      ui.toast('Address copied', 'ok');
    }).catch(function () {
      ui.toast('Copy blocked — select the address and copy manually', 'err', 3600);
    });
  }

  function onChange() {
    if (!state.provider) return;
    /* If the domain list can't be fetched, offer the one we're already on. */
    var current = state.session ? state.session.address.split('@')[1] : null;
    state.provider.domains().catch(function () {
      return current ? [current] : [];
    }).then(function (domains) {
      return ui.openAddressDialog(domains, store.getHistory(), state.session && state.session.address);
    }).then(function (result) {
      if (!result) return;
      if (result.action === 'restore') return restoreAddress(result.entry);
      return changeAddress(result.localPart, result.domain);
    });
  }

  function changeAddress(localPart, domain) {
    if (localPart) {
      var cleaned = localPart.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!cleaned) {
        ui.toast('Use letters, numbers, dashes or underscores', 'err', 3600);
        return;
      }
      if (cleaned !== localPart.toLowerCase()) {
        ui.toast('Adjusted to "' + cleaned + '" — only letters, numbers, - and _ are accepted', null, 4200);
      }
      localPart = cleaned;
    }
    ui.setAddress(null);
    stopPolling();

    return createFresh(localPart, domain).then(function () {
      ui.toast('New address ready', 'ok');
    }).catch(function (err) {
      if (err.code === 'invalid') {
        ui.toast('That name is taken — try another', 'err', 3600);
      } else {
        ui.toast(err.message || 'Could not create the address', 'err', 3600);
      }
      /* keep the old address usable */
      if (state.session) { ui.setAddress(state.session.address); schedulePoll(); }
    });
  }

  function restoreAddress(entry) {
    ui.setAddress(null);
    stopPolling();

    var provider = entry.provider === 'demo' ? demoProvider() : liveProvider();
    useProvider(provider);

    return provider.resume(entry).then(function (session) {
      setSession(session);
      return refresh(false);
    }).then(function () {
      ui.toast('Switched to ' + entry.address, 'ok');
    }).catch(function (err) {
      store.removeHistory(entry.address);
      ui.toast(err.message || 'That address is no longer available', 'err', 3600);
      if (state.session) { ui.setAddress(state.session.address); schedulePoll(); }
    });
  }

  function onDeleteInbox() {
    if (!state.session) return;
    var address = state.session.address;

    ui.confirmAction(
      'Delete this inbox?',
      address + ' and every message in it will be destroyed, and a new address issued. This cannot be undone.',
      'Delete inbox'
    ).then(function (ok) {
      if (!ok) return;
      var old = state.session;
      stopPolling();
      ui.setAddress(null);

      return state.provider.deleteAccount(old).catch(function () { /* gone is gone */ })
        .then(function () {
          store.removeHistory(old.address);
          store.clearSession();
          return createFresh(null, null);
        })
        .then(function () { ui.toast('Inbox deleted — new address ready', 'ok'); })
        .catch(function (err) { ui.toast(err.message || 'Could not create a new address', 'err', 3600); });
    });
  }

  function openMessage(id) {
    if (!state.session) return;
    state.activeId = id;
    ui.setActive(id);
    ui.showReaderLoading();

    state.provider.getMessage(state.session, id).then(function (msg) {
      if (state.activeId !== id) return;      // user moved on while it loaded
      ui.renderMessage(msg);

      var local = findMessage(id);
      if (local && !local.seen) {
        local.seen = true;
        ui.markRead(id);
        state.provider.markSeen(state.session, id);
      }
    }).catch(function (err) {
      ui.clearReader();
      ui.toast(err.message || 'Could not open that message', 'err');
    });
  }

  function findMessage(id) {
    for (var i = 0; i < state.messages.length; i++) if (state.messages[i].id === id) return state.messages[i];
    return null;
  }

  function onDeleteMessage(id) {
    if (!state.session) return;
    state.provider.deleteMessage(state.session, id).then(function () {
      state.messages = state.messages.filter(function (m) { return m.id !== id; });
      if (state.activeId === id) { state.activeId = null; ui.clearReader(); ui.closeReader(); }
      ui.renderList(state.messages, state.activeId, null);
      ui.toast('Message deleted', 'ok');
    }).catch(function (err) {
      ui.toast(err.message || 'Could not delete that message', 'err');
    });
  }

  function onDownloadAttachment(att) {
    if (!state.session) return;
    ui.toast('Downloading ' + att.filename + '…', null, 1600);

    state.provider.fetchAttachment(state.session, att.downloadUrl).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = att.filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }).catch(function (err) {
      ui.toast(err.message || 'Download failed', 'err');
    });
  }

  /* ── go ────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

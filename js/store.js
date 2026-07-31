/* localStorage persistence: the active mailbox session, address history and
   the theme choice. Everything degrades to in-memory if storage is blocked
   (private mode, file:// on some browsers). */
window.TM = window.TM || {};

TM.store = (function () {
  'use strict';

  var PREFIX = 'tempbox.';
  var K_SESSION = PREFIX + 'session';
  var K_HISTORY = PREFIX + 'history';
  var K_THEME = PREFIX + 'theme';
  var MAX_HISTORY = 8;

  var memory = {};
  var available = (function () {
    try {
      var k = PREFIX + 'probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function readRaw(key) {
    if (!available) return memory[key] || null;
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeRaw(key, value) {
    if (!available) { memory[key] = value; return; }
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { memory[key] = value; }
  }

  function readJSON(key, fallback) {
    var raw = readRaw(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    writeRaw(key, value === null ? null : JSON.stringify(value));
  }

  /* ── session ── */
  function getSession() {
    var s = readJSON(K_SESSION, null);
    if (!s || !s.address || !s.password) return null;
    return s;
  }

  function setSession(session) {
    writeJSON(K_SESSION, session || null);
    if (session) pushHistory(session);
  }

  function clearSession() {
    writeJSON(K_SESSION, null);
  }

  /* ── history ── */
  function getHistory() {
    var h = readJSON(K_HISTORY, []);
    return Array.isArray(h) ? h : [];
  }

  function pushHistory(session) {
    var list = getHistory().filter(function (e) { return e.address !== session.address; });
    list.unshift({
      address: session.address,
      password: session.password,
      accountId: session.accountId || null,
      provider: session.provider || 'mailtm',
      createdAt: session.createdAt || new Date().toISOString()
    });
    writeJSON(K_HISTORY, list.slice(0, MAX_HISTORY));
  }

  function removeHistory(address) {
    writeJSON(K_HISTORY, getHistory().filter(function (e) { return e.address !== address; }));
  }

  /* ── theme ── */
  function getTheme() {
    var t = readRaw(K_THEME);
    return (t === 'light' || t === 'dark') ? t : null;
  }
  function setTheme(t) { writeRaw(K_THEME, t); }

  return {
    available: available,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    getHistory: getHistory,
    pushHistory: pushHistory,
    removeHistory: removeHistory,
    getTheme: getTheme,
    setTheme: setTheme
  };
})();

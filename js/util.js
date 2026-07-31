/* Small helpers shared across the app. Classic script — no build step. */
window.TM = window.TM || {};

TM.util = (function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Escape text, then turn bare URLs into safe links. Splitting on the raw
     text (not the escaped text) keeps "&" inside query strings intact. */
  var URL_RE = /\b(https?:\/\/[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?])/gi;
  function linkify(text) {
    var out = '';
    var last = 0;
    var m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      out += escapeHtml(text.slice(last, m.index));
      var href = escapeHtml(m[0]);
      out += '<a href="' + href + '" target="_blank" rel="noopener noreferrer nofollow">' + href + '</a>';
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }

  function relTime(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.round(h / 24);
    if (d < 7) return d + 'd ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fullDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function formatBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function initials(name, address) {
    var src = (name || '').trim() || (address || '').trim();
    if (!src) return '?';
    var parts = src.replace(/[<>"]/g, '').split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 1);
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1));
  }

  /* Deterministic pleasant colour from a string. */
  function hueOf(str) {
    var h = 0;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function avatarStyle(str) {
    var h = hueOf(str);
    return 'background: linear-gradient(140deg, hsl(' + h + ' 62% 52%), hsl(' + ((h + 34) % 360) + ' 66% 44%));';
  }

  var WORDS_A = ['amber', 'brisk', 'clever', 'dusty', 'eager', 'fuzzy', 'glassy', 'hidden', 'ivory', 'jolly',
    'keen', 'lucky', 'mellow', 'noble', 'olive', 'plucky', 'quiet', 'rapid', 'silver', 'tidy',
    'urban', 'vivid', 'witty', 'zesty', 'brave', 'copper', 'dapper', 'swift'];
  var WORDS_B = ['otter', 'falcon', 'maple', 'harbor', 'cedar', 'lantern', 'meadow', 'pebble', 'quartz', 'raven',
    'summit', 'thistle', 'willow', 'anchor', 'beacon', 'canyon', 'delta', 'ember', 'fern', 'glacier',
    'hollow', 'juniper', 'kestrel', 'lagoon'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* Dashes only: some mail backends strip dots from the local part, and an
     address that renders differently from the one you asked for is confusing. */
  function randomLocalPart() {
    return pick(WORDS_A) + '-' + pick(WORDS_B) + Math.floor(100 + Math.random() * 900);
  }

  function randomPassword() {
    var chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    var buf = new Uint32Array(20);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) out += chars[buf[i] % chars.length];
    } else {
      for (var j = 0; j < 20; j++) out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out + '!7Aa';
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    /* file:// and plain http fall back to the old path */
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy blocked'));
    });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  return {
    $: $, $$: $$,
    escapeHtml: escapeHtml,
    linkify: linkify,
    relTime: relTime,
    fullDate: fullDate,
    formatBytes: formatBytes,
    initials: initials,
    avatarStyle: avatarStyle,
    randomLocalPart: randomLocalPart,
    randomPassword: randomPassword,
    copyText: copyText,
    sleep: sleep
  };
})();

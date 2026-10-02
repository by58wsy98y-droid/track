/* Harbor — app.js: screens, flows, storage, backup. Uses window.Engine + window.Visuals.
 * Contract: docs/SPEC.md §6 (screens), §7 (look), §8 (storage + data safety).
 * No personal numbers live here: everything the user types is saved on their device only. */
(function () {
  'use strict';

  const E = window.Engine;
  const V = window.Visuals;
  const $ = (id) => document.getElementById(id);
  const $app = $('app');
  const $tabs = $('tabs');
  const $layers = $('layers');
  const $toast = $('toast');
  const $banner = $('banner');
  const $file = $('restore-file');

  if (!E || !V) {
    $app.innerHTML = '<div class="boot"><p class="boot-title">HARBOR TERMINAL</p>' +
      '<p class="muted">Harbor couldn\'t start. Close it and open it again.</p></div>';
    return;
  }

  const D = E.dates;
  const KEY = 'harbor.v1';
  const STEP_KEY = 'harbor.v1.setupStep';

  // ------------------------------------------------------------------ "today" (+ ?today= testing hook)

  const OVERRIDE = (function () {
    try {
      const v = new URLSearchParams(window.location.search).get('today');
      return D.isValid(v) ? v : null;
    } catch (e) { return null; }
  })();
  function today() { return OVERRIDE || D.todayLocal(); }
  function now() { return { d: today(), t: Date.now() }; }

  // ------------------------------------------------------------------ device facts

  const UA = navigator.userAgent || '';
  const IS_IPAD = /iPad/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_APPLE = IS_IPAD || /iPhone|iPod/.test(UA);
  function isStandalone() {
    try {
      return navigator.standalone === true ||
        (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ storage

  let loadProblem = null;
  let state = load();
  let version = 0;   // bumps on every change; summary() is cached per version

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { loadProblem = 'storage'; }
    if (raw) {
      let r = null;
      try { r = E.normalizeState(JSON.parse(raw), today()); } catch (e) { r = null; }
      if (r && r.ok) return r.state;
      loadProblem = 'damaged';
      try { localStorage.setItem(KEY + '.damaged', raw); } catch (e) { /* keep going */ }
    }
    return E.newState(today());
  }

  function save() {
    version++;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      ui.saveError = false;
    } catch (e) {
      ui.saveError = true;
    }
    renderBanner();
  }

  let persistAsked = false;
  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(function () {});
      }
    } catch (e) { /* not available */ }
  }

  function getStep() {
    try { const n = parseInt(localStorage.getItem(STEP_KEY), 10); return n >= 0 && n < STEPS.length ? n : 0; } catch (e) { return 0; }
  }
  function putStep(n) { try { localStorage.setItem(STEP_KEY, String(n)); } catch (e) { /* fine */ } }
  function dropStep() { try { localStorage.removeItem(STEP_KEY); } catch (e) { /* fine */ } }

  // ------------------------------------------------------------------ small helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ord(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "Oct 12", plus the year when it isn't this year.
  function fdate(iso) {
    if (!D.isValid(iso)) return '';
    return D.fmtShort(iso) + (iso.slice(0, 4) !== today().slice(0, 4) ? ', ' + iso.slice(0, 4) : '');
  }

  let domSeq = 0;
  function domId(p) { domSeq++; return (p || 'h') + domSeq; }

  // Terminal figures: 1,152.00 (no symbol), for tables and amount columns.
  function fig(n) {
    return Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // A big quote like a share price: "$740" with ".00" smaller and dimmer.
  function quoteHTML(n) {
    n = E.round2(Number(n) || 0);
    const whole = Math.trunc(Math.abs(n));
    const cents = Math.round((Math.abs(n) - whole) * 100);
    return '<span class="q-whole">' + esc((n < 0 ? '-' : '') + money(whole)) + '</span>' +
      '<span class="q-cents">.' + (cents < 10 ? '0' : '') + cents + '</span>';
  }
  const CAT_CODE = { eat: 'EAT', delivery: 'DLVR', groceries: 'GROC', gas: 'GAS', fun: 'FUN', shopping: 'SHOP', travel: 'TRVL', other: 'OTHR' };

  // Screen header: title (or the wordmark) and a LIVE/OFFLINE status with the date.
  function headHTML(title) {
    const online = navigator.onLine !== false;
    const d = today();
    const date = MONTHS[+d.slice(5, 7) - 1].toUpperCase() + ' ' + d.slice(8, 10);
    return '<header class="term-head">' +
      (title ? '<h1 class="term-title page-title">' + esc(title) + '</h1>'
        : '<h1 class="brand">Harbor <span>Terminal</span><span class="sr-only"> — Today</span></h1>') +
      '<span class="term-status' + (online ? '' : ' is-off') + '"><i aria-hidden="true"></i>' +
      (online ? 'Live' : 'Offline') + ' · ' + date + '</span></header>';
  }

  // ------------------------------------------------------------------ money

  const CURRENCIES = [
    { code: 'USD', name: 'US', sym: '$' },
    { code: 'CAD', name: 'Canada', sym: '$' },
    { code: 'AUD', name: 'Australia', sym: '$' },
    { code: 'NZD', name: 'New Zealand', sym: '$' },
    { code: 'GBP', name: 'UK', sym: '£' },
    { code: 'EUR', name: 'Euro', sym: '€' },
    { code: 'NOK', name: 'Norway', sym: 'kr' },
    { code: 'XXX', name: 'Other', sym: '…' },
  ];
  const fmtCache = {};

  function money(n) {
    n = E.round2(Number(n) || 0);
    const cents = Math.abs(n - Math.round(n)) >= 0.005;
    const s = state.settings;
    const digits = { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 };
    if (s.currency === 'XXX') {
      const sym = s.currencySymbol || '$';
      const body = Math.abs(n).toLocaleString('en-US', digits);
      return (n < 0 ? '-' : '') + sym + (/[A-Za-z]$/.test(sym) ? ' ' : '') + body;
    }
    const key = s.currency + (cents ? ':c' : ':w');
    let f = fmtCache[key];
    if (f === undefined) {
      const o = Object.assign({ style: 'currency', currency: s.currency }, digits);
      try { f = new Intl.NumberFormat('en-US', Object.assign({ currencyDisplay: 'narrowSymbol' }, o)); } catch (e) {
        try { f = new Intl.NumberFormat('en-US', o); } catch (e2) { f = null; }
      }
      fmtCache[key] = f;
    }
    return f ? f.format(n) : E.money(n);
  }

  function curSymbol() {
    const s = state.settings;
    if (s.currency === 'XXX') return s.currencySymbol || '$';
    const c = CURRENCIES.find(function (x) { return x.code === s.currency; });
    if (c) return c.sym;
    try {
      const p = new Intl.NumberFormat('en-US', { style: 'currency', currency: s.currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0).find(function (x) { return x.type === 'currency'; });
      return p ? p.value : '$';
    } catch (e) { return '$'; }
  }

  function currencyName() {
    const s = state.settings;
    if (s.currency === 'XXX') return 'Other (' + (s.currencySymbol || '$') + ')';
    const c = CURRENCIES.find(function (x) { return x.code === s.currency; });
    return c ? c.name + ' ' + c.sym : s.currency;
  }

  // Robust money parsing: strips symbols, spaces and letters; handles 2,000 / 2.000,50 / 12,50.
  // Returns null for empty, NaN for nonsense, else a number rounded to cents.
  function parseMoney(v) {
    let s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (/-\s*\d/.test(s)) return NaN;
    s = s.replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return NaN;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',';
      const grp = dec === '.' ? ',' : '.';
      s = s.split(grp).join('');
      const i = s.lastIndexOf(dec);
      s = s.slice(0, i).split(dec).join('') + '.' + s.slice(i + 1);
    } else if (lastComma >= 0) {
      const parts = s.split(',');
      s = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2 ? parts[0] + '.' + parts[1] : parts.join('');
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length > 0)) s = parts.join('');
    }
    const n = Number(s);
    return Number.isFinite(n) ? E.round2(n) : NaN;
  }
  // Like parseMoney, but a leading minus is allowed when `allowNeg` (an overdrawn checking account).
  function parseSigned(v, allowNeg) {
    const str = String(v == null ? '' : v).trim();
    const neg = allowNeg && /^[-−–]/.test(str);
    const n = parseMoney(neg ? str.replace(/^[-−–]\s*/, '') : str);
    return neg && Number.isFinite(n) ? -n : n;
  }
  function numStr(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    n = E.round2(Number(n));
    return Math.abs(n - Math.round(n)) >= 0.005 ? n.toFixed(2) : String(Math.round(n));
  }

  // ------------------------------------------------------------------ summary (cached per change + day)

  let sumCache = null, sumVer = -1, sumDay = '';
  function summary() {
    const d = today();
    if (!sumCache || sumVer !== version || sumDay !== d) {
      sumCache = E.summary(state, d, { money: money });
      sumVer = version; sumDay = d;
    }
    return sumCache;
  }

  // ------------------------------------------------------------------ UI state (not saved)

  const ui = {
    screen: 'today',
    setupStep: 0,
    otherCur: false,
    hintOpen: false,
    why: {},
    flow: null,
    saveError: false,
    safariLater: false,   // "Later" on the Safari-tab reminder: this launch only
    allBuys: false,       // Money: show all recent purchases, not just the latest few
  };

  // ------------------------------------------------------------------ icons

  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5L12 3.8l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z"/></svg>',
    voyage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/></svg>',
    money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5.2 7.2l9.6-3.1a1.6 1.6 0 0 1 2.1 1.5v1.6"/><rect x="3.5" y="7.2" width="17" height="12.6" rx="2.6"/><path d="M20.5 11.2h-3.6a2.3 2.3 0 0 0 0 4.6h3.6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.6"/><circle cx="10" cy="17" r="2.6"/></svg>',
  };

  // ------------------------------------------------------------------ shared bits of markup

  function moneyField(id, val, o) {
    o = o || {};
    const sym = curSymbol();
    return '<span class="money' + (o.big ? ' big' : '') + '" style="--cur-n:' + Math.max(1, Array.from(sym).length) + '">' +
      '<span class="cur" aria-hidden="true">' + esc(sym) + '</span>' +
      '<input class="input" id="' + id + '" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false"' +
      ' enterkeyhint="' + (o.enter || 'done') + '"' +
      (o.autofocus ? ' data-autofocus' : '') +
      ' placeholder="' + esc(o.placeholder == null ? '0' : o.placeholder) + '"' +
      ' value="' + esc(val == null ? '' : numStr(val)) + '"></span>';
  }

  function sheetHead(title, tid) {
    return '<div class="sheet-head"><h2 class="sheet-title" id="' + tid + '">' + esc(title) + '</h2>' +
      '<button type="button" class="close-btn" data-la="close" aria-label="Close">' + ICON.x + '</button></div>';
  }

  function setError(inputId, msg) {
    const input = $(inputId);
    if (!input) { toast(msg); return; }
    const field = input.closest('.field') || input.parentElement;
    let el = field.querySelector('.field-error');
    if (!el) {
      el = document.createElement('span');
      el.className = 'field-error';
      el.setAttribute('role', 'alert');
      field.appendChild(el);
    }
    el.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    try { input.focus(); } catch (e) { /* ignore */ }
  }
  function clearErrors(root) {
    (root || document).querySelectorAll('.field-error').forEach(function (el) { el.remove(); });
    (root || document).querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
  }

  function dayOptions(selected, withNotSure) {
    let h = withNotSure ? '<option value=""' + (selected == null ? ' selected' : '') + '>Not sure</option>' : '';
    for (let d = 1; d <= 31; d++) h += '<option value="' + d + '"' + (selected === d ? ' selected' : '') + '>' + ord(d) + '</option>';
    return h;
  }
  function monthOptions(selected) {
    return MONTHS_LONG.map(function (m, i) {
      return '<option value="' + (i + 1) + '"' + (selected === i + 1 ? ' selected' : '') + '>' + m + '</option>';
    }).join('');
  }

  function billWhen(b) {
    if (b.freq === 'yearly') return 'due ' + MONTHS[(b.dueMonth || 1) - 1] + ' ' + (b.dueDay || 1) + ' each year';
    return 'due the ' + ord(b.dueDay || 1) + ' each month';
  }

  const FREQS = [
    { v: 'weekly', label: 'Every week' },
    { v: 'biweekly', label: 'Every 2 weeks' },
    { v: 'semimonthly', label: 'Twice a month' },
    { v: 'monthly', label: 'Once a month' },
    { v: 'rotation', label: 'Once per rotation' },
    { v: 'varies', label: 'It varies' },
  ];
  function freqLabel(v) { const f = FREQS.find(function (x) { return x.v === v; }); return f ? f.label : 'Not set'; }

  // ------------------------------------------------------------------ rotation words

  function rotationPreview(iso) {
    if (!D.isValid(iso)) return '';
    const st = E.rotation.status(Object.assign({}, state.settings, { boatDate: iso }), today());
    if (!st) return '';
    const when = st.daysLeft === 1 ? 'tomorrow' : D.fmtShort(st.changeDate);
    if (st.where === 'boat') return 'So today is day ' + st.day + ' of ' + st.of + ' on the boat — home ' + when + '.';
    if (st.day) return 'So today is day ' + st.day + ' of ' + st.of + ' at home — back out ' + when + '.';
    return 'So you\'re home for now — back out ' + when + '.';
  }

  // Plain words (for screen readers): "On the boat, day 23 of 28, home in 6 days".
  function bannerText(st) {
    if (!st) return 'Add your boat date';
    if (st.where === 'boat') {
      const left = st.daysLeft <= 0 ? 'home today' : st.daysLeft === 1 ? 'home tomorrow' : 'home in ' + st.daysLeft + ' days';
      return 'On the boat, day ' + st.day + ' of ' + st.of + ', ' + left;
    }
    const back = 'back out ' + (st.daysLeft === 1 ? 'tomorrow' : D.fmtShort(st.changeDate));
    if (st.day) return 'Home, day ' + st.day + ' of ' + st.of + ', ' + back;
    return 'Home, ' + back;
  }
  // Terminal line: "AT SEA · DAY 23/28 · HOME IN 6D" / "HOME · DAY 2/14 · OUT OCT 20".
  function rotLine(st) {
    if (!st) return 'Add your boat date';
    if (st.where === 'boat') {
      const left = st.daysLeft <= 0 ? 'Home today' : st.daysLeft === 1 ? 'Home tomorrow' : 'Home in ' + st.daysLeft + 'd';
      return 'At sea · Day ' + st.day + '/' + st.of + ' · ' + left;
    }
    const back = st.daysLeft === 1 ? 'Out tomorrow' : 'Out ' + D.fmtShort(st.changeDate);
    return st.day ? 'Home · Day ' + st.day + '/' + st.of + ' · ' + back : 'Home · ' + back;
  }

  function stretchesHTML(iso) {
    if (!D.isValid(iso)) return '';
    const s = Object.assign({}, state.settings, { boatDate: iso });
    const list = E.rotation.upcoming(s, today(), 4);
    return list.map(function (x, i) {
      const days = D.diffDays(x.start, x.end) + 1;
      return '<li class="' + (i === 0 ? 'is-now' : '') + '"><span class="st-tag' + (x.where === 'boat' ? ' is-sea' : '') + '">' + (x.where === 'boat' ? 'At sea' : 'Home') + '</span>' +
        '<span>' + esc(D.fmtRange(x.start, x.end)) + (i === 0 ? '<span class="sr-only"> (now)</span>' : '') + '</span>' +
        '<span class="len">' + plural(days, 'day') + (x.where === 'boat' ? ' on' : ' home') + '</span></li>';
    }).join('');
  }

  // ------------------------------------------------------------------ checklist (Today, payday flow, logbook)

  function checklistHTML(pd) {
    const items = (pd.plan.items || []).filter(function (it) { return it.amount > 0; });
    if (!items.length) return '<p class="muted">Nothing to do for this one.</p>';
    const isLatest = pd === state.paydays[state.paydays.length - 1];
    return '<ul class="checklist">' + items.map(function (it) {
      const on = !!(pd.ticks && pd.ticks[it.key]);
      const wk = pd.id + '|' + it.key;
      const open = !!ui.why[wk];
      const whyId = 'why-' + pd.id + '-' + it.key.replace(/[^\w-]/g, '_');
      // An older payday's undone debt/savings step: the next plan already re-planned that money.
      const moved = !isLatest && !on && (it.kind === 'debt' || it.kind === 'save');
      const main = moved
        ? '<div class="tick is-moved"><span class="box" aria-hidden="true">–</span>' +
          '<span class="item-text"><span class="item-label">' + esc(it.label) + '</span>' +
          '<span class="item-sub">Moved to your next payday</span></span></div>'
        : '<button type="button" class="tick" role="checkbox" aria-checked="' + on + '" data-action="tick" data-pd="' + esc(pd.id) +
          '" data-key="' + esc(it.key) + '" data-fk="t:' + esc(wk) + '">' +
          '<span class="box">' + ICON.check + '</span>' +
          '<span class="item-text"><span class="item-label">' + esc(it.label) + '</span>' +
          (it.sub ? '<span class="item-sub">' + esc(it.sub) + '</span>' : '') + '</span></button>';
      const tag = moved ? '<span class="tag">Moved</span>' : on ? '<span class="tag is-good">Done</span>' : '<span class="tag is-todo">To do</span>';
      return '<li class="item' + (moved ? ' is-moved' : '') + '"><div class="item-row">' + main +
        '<span class="item-amt" aria-hidden="true"><b class="' + (it.clears ? 'is-good' : '') + '">' + fig(it.amount) + '</b>' + tag + '</span>' +
        '<button type="button" class="why-btn" aria-expanded="' + open + '" aria-controls="' + whyId + '" data-action="why" data-wk="' + esc(wk) +
        '" data-fk="w:' + esc(wk) + '">Why? ›</button></div>' +
        (open ? '<div class="why" id="' + whyId + '">' + esc(it.why || '') + (it.kind === 'bills' ? billsListHTML(pd.plan) : '') + '</div>' : '') +
        '</li>';
    }).join('') + '</ul>';
  }

  function billsListHTML(plan) {
    const rows = [];
    (plan.bills || []).forEach(function (b) {
      const what = b.kind === 'min' ? b.name + ' (minimum)' : b.name;
      const when = b.past ? 'was due ' + D.fmtShort(b.due) : D.fmtShort(b.due);
      rows.push({ due: b.due, html: '<li><span>' + esc(what) + ' <span class="when">· ' + esc(when) + '</span></span><b>' + esc(money(b.amount)) + '</b></li>' });
    });
    (plan.yearlyAside || []).forEach(function (y) {
      rows.push({ due: '9999', html: '<li><span>' + esc(y.name) + ' <span class="when">· set aside for ' + esc(fdate(y.dueDate)) + '</span></span><b>' + esc(money(y.amount)) + '</b></li>' });
    });
    if (!rows.length) return '';
    rows.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
    return '<ul class="why-list">' + rows.map(function (r) { return r.html; }).join('') + '</ul>';
  }

  function doneCount(pd) {
    const items = (pd.plan.items || []).filter(function (it) { return it.amount > 0; });
    const done = items.filter(function (it) { return pd.ticks && pd.ticks[it.key]; }).length;
    return { done: done, total: items.length };
  }

  function streakText(n) {
    return n === 1 ? 'Streak · 1 payday all done' : 'Streak · ' + n + ' paydays in a row, all done';
  }

  // ================================================================== SETUP (§6.1)

  const STEPS = ['welcome', 'boat', 'currency', 'pay', 'freq', 'bills', 'debts', 'savings', 'accounts', 'spending', 'done'];
  const DOT_STEPS = 9;   // steps 1..9 show progress dots

  function setupFrame(o) {
    const i = ui.setupStep;
    let dots = '';
    if (i > 0) {
      const n = Math.min(i, DOT_STEPS);
      dots = '<div class="steps" role="img" aria-label="Step ' + n + ' of ' + DOT_STEPS + '"><span class="steps-n">Step ' + n + '/' + DOT_STEPS + '</span><span class="steps-bar">';
      for (let k = 1; k <= DOT_STEPS; k++) dots += '<span class="dot' + (k < i ? ' is-done' : k === i ? ' is-now' : '') + '"></span>';
      dots += '</span></div>';
    } else dots = '<span class="brand brand-sm">Harbor <span>Terminal</span></span>';
    return '<form class="setup" data-submit="setupNext" novalidate autocomplete="off">' +
      '<div class="topbar">' +
      (i > 0 ? '<button type="button" class="icon-btn" data-action="setupBack" aria-label="Back">' + ICON.back + '</button>' : '<span></span>') +
      dots + '<span></span></div>' +
      '<div class="setup-body">' +

      '<h1 class="q-title" id="q-title" tabindex="-1">' + esc(o.title) + '</h1>' +
      (o.lead ? '<p class="q-lead">' + esc(o.lead) + '</p>' : '') +
      '<div class="q-body">' + (o.body || '') + '</div></div>' +
      (o.foot === false ? '' : '<div class="setup-foot">' +
        (o.onlySkip ? '' : '<button type="submit" class="btn btn-primary">' + esc(o.next || 'Next') + '</button>') +
        (o.skip === false ? '' : '<button type="button" class="btn btn-text" data-action="setupSkip">Skip for now</button>') +
        '</div>') +
      '</form>';
  }

  const SETUP = {
    welcome: function () {
      const showHome = IS_APPLE && !isStandalone() && !state.meta.tips.addToHome;
      const device = IS_IPAD ? 'iPad' : 'iPhone';
      let body = '';
      if (showHome) {
        body += '<div class="hint-card">' +
          '<p class="hint-title">Add Harbor to your Home Screen first, then set up there.</p>' +
          '<p>Your ' + device + ' keeps the Home Screen app\'s data separate from Safari.</p>' +
          (ui.hintOpen ? '<ol class="hint-steps">' +
            '<li>Tap <b>Share</b> ↑ (on iPhone you may need to tap ••• first).</li>' +
            '<li>Tap <b>Add to Home Screen</b>, keep <b>Open as Web App</b> on, then tap <b>Add</b>.</li>' +
            '<li>Open Harbor from its new icon and set up there.</li></ol>' : '') +
          '<div class="btn-row">' +
          '<button type="button" class="btn btn-soft" data-action="hintToggle" aria-expanded="' + ui.hintOpen + '">' + (ui.hintOpen ? 'Got it' : 'How?') + '</button>' +
          '<button type="button" class="btn btn-ghost" data-action="setupAnyway">Set up anyway</button></div></div>';
      }
      body += '<div class="links" style="margin-top:22px"><button type="button" class="link" data-action="restore">Have a backup file? Restore it</button></div>';
      return setupFrame({
        title: 'Hi! Let\'s set up your money plan.',
        lead: 'About 5 minutes. Skip anything you\'re not sure of.',
        body: body, next: 'Let\'s go', skip: false, foot: !showHome,
      });
    },

    boat: function () {
      const v = state.settings.boatDate || '';
      return setupFrame({
        title: 'When do you next get on the boat?', lead: 'Already on it? Pick the day you got on.',
        body: '<label class="field"><span class="field-label">Boat date</span>' +
          '<input class="input" type="date" id="f-boat" value="' + esc(v) + '" data-live="boatPreview" data-preview="boat-preview"></label>' +
          '<div class="preview" id="boat-preview" aria-live="polite">' + esc(rotationPreview(v)) + '</div>',
      });
    },

    currency: function () {
      const s = state.settings;
      const other = ui.otherCur || s.currency === 'XXX';
      return setupFrame({
        title: 'What money do you use?',
        body: currencyChoicesHTML('pickCurrency') + (other ? symbolFieldHTML() : ''),
        onlySkip: !other,
      });
    },

    pay: function () {
      return setupFrame({
        title: 'When payday comes, how much usually lands in your bank?',
        body: '<label class="field"><span class="field-label">A normal paycheck</span>' +
          moneyField('f-pay', state.settings.payAmount, { big: true, autofocus: true }) +
          '<span class="field-help">Just a normal one — it\'s fine if it changes.</span></label>',
      });
    },

    freq: function () {
      return setupFrame({
        title: 'How often do you get paid?',
        body: freqChoicesHTML('pickFreq'),
        onlySkip: true,
      });
    },

    bills: function () {
      const list = state.bills.length
        ? '<ul class="list">' + state.bills.map(function (b) {
          return '<li><button type="button" class="list-row" data-action="editBill" data-id="' + esc(b.id) + '">' +
            '<span class="list-main"><span class="list-name">' + esc(b.name) + '</span><span class="list-sub">' + esc(billWhen(b)) + '</span></span>' +
            '<span class="list-amt">' + esc(money(b.amount)) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
        }).join('') + '</ul>'
        : '<p class="empty-note">No bills added yet.</p>';
      return setupFrame({
        title: 'What bills do you pay?', lead: 'Phone, insurance, rent, subscriptions… Debts come next.',
        body: list + '<button type="button" class="btn btn-soft" data-action="addBill">+ Add a bill</button>',
      });
    },

    debts: function () {
      const list = state.debts.length
        ? '<ul class="list">' + state.debts.map(function (d) {
          return '<li><button type="button" class="list-row" data-action="editDebt" data-id="' + esc(d.id) + '">' +
            '<span class="list-main"><span class="list-name">' + esc(d.name) + '</span><span class="list-sub">' +
            esc(money(d.minPayment) + ' a month' + (d.rate != null ? ' · ' + d.rate + '%' : '')) + '</span></span>' +
            '<span class="list-amt">' + esc(money(d.balance)) + '</span><span class="chev" aria-hidden="true">›</span></button></li>';
        }).join('') + '</ul>'
        : '<p class="empty-note">No debts added yet. None? Lucky you — tap Next.</p>';
      return setupFrame({
        title: 'Anything you owe?', lead: 'Credit cards, loans, Afterpay, money you promised someone.',
        body: list + '<button type="button" class="btn btn-soft" data-action="addDebt">+ Add a debt</button>',
      });
    },

    savings: function () {
      const a = state.savings.amount;
      return setupFrame({
        title: 'How much do you have saved right now?', lead: money(0) + ' is totally fine.',
        body: '<label class="field"><span class="field-label">Saved right now</span>' +
          moneyField('f-sav', a > 0 ? a : null, { big: true, autofocus: true }) + '</label>',
      });
    },

    accounts: function () {
      const acc = E.accounts(state, today());
      const typed = function (id) { const a = acc.find(function (x) { return x.id === id; }); return a && a.asOf ? a.balance : null; };
      return setupFrame({
        title: 'What\'s in checking and on your spending card right now?',
        lead: 'Open your bank app and copy what it says. Not sure? Skip it — you can add these any time under Money.',
        body: '<label class="field"><span class="field-label">Checking</span>' +
          moneyField('f-chk', typed('checking'), { enter: 'next' }) + '</label>' +
          '<label class="field"><span class="field-label">Spending card — what\'s on it</span>' +
          moneyField('f-spc', typed('spending')) +
          '<span class="field-help">The card you use for everyday things. What\'s on it becomes your “left to spend”.</span></label>',
      });
    },

    spending: function () {
      const s = state.settings;
      const sug = E.suggestSpending(state, { today: today() });
      const hasPay = s.payAmount > 0;
      const home = s.homeSpend != null ? s.homeSpend : (sug.ok ? sug.home : null);
      const boat = s.boatSpend != null ? s.boatSpend : (sug.ok ? sug.boat : null);
      const body =
        stepperHTML('f-home', s.offDays + ' days at home', home, 50, s.offDays) +
        stepperHTML('f-boatspend', s.onDays + ' days on the boat', boat, 10, s.onDays) +
        '<div id="spend-note" aria-live="polite">' + spendNoteHTML(home, boat) + '</div>' +
        (hasPay ? '' : '');
      return setupFrame({
        title: 'Spending money',
        lead: 'For everything that isn\'t a bill: groceries, gas, going out, shopping.',
        body: body,
      });
    },

    done: function () {
      const hasDebts = state.debts.length > 0;
      const steps = [
        'Build a ' + money(state.settings.cushion) + ' starter cushion.',
        hasDebts ? 'Crush your debts one at a time.' : 'No debts to crush — you get to skip this one!',
        'Grow your savings to cover ' + plural(state.settings.safetyMonths || 3, 'month') + ' of bills and spending.',
      ];
      return setupFrame({
        title: 'You\'re all set', lead: 'Here\'s your plan, in 3 steps:',
        body: '<ol class="plan-steps">' + steps.map(function (t, i) {
          return '<li><span class="num">' + (i + 1) + '</span><span>' + esc(t) + '</span></li>';
        }).join('') + '</ol><p class="field-help" style="margin-top:18px">You can change anything later in Settings.</p>',
        next: 'Take me to my plan', skip: false,
      });
    },
  };

  function currencyChoicesHTML(action) {
    const s = state.settings;
    return '<div class="choices">' + CURRENCIES.map(function (c) {
      const on = c.code === s.currency || (c.code === 'XXX' && ui.otherCur && s.currency !== 'XXX');
      return '<button type="button" class="choice' + (on ? ' is-on' : '') + '" data-action="' + action + '" data-la="' + action + '" data-v="' + c.code +
        '" aria-pressed="' + on + '"><span class="sym" aria-hidden="true">' + esc(c.code === 'XXX' && s.currencySymbol ? s.currencySymbol : c.sym) + '</span>' + esc(c.name) + '</button>';
    }).join('') + '</div>';
  }
  function symbolFieldHTML() {
    return '<label class="field" style="margin-top:20px"><span class="field-label">Your money symbol</span>' +
      '<input class="input" id="f-sym" maxlength="4" autocomplete="off" placeholder="e.g. R" value="' + esc(state.settings.currencySymbol || '') + '"></label>';
  }
  function freqChoicesHTML(action) {
    const cur = state.settings.payFreq;
    return '<div class="choices one-col">' + FREQS.map(function (f) {
      const on = cur === f.v;
      return '<button type="button" class="choice' + (on ? ' is-on' : '') + '" data-action="' + action + '" data-la="' + action + '" data-v="' + f.v +
        '" aria-pressed="' + on + '">' + esc(f.label) + '</button>';
    }).join('') + '</div>';
  }

  function stepperHTML(id, title, val, step, days) {
    return '<div class="stepper-card"><label for="' + id + '" class="stepper-title">' + esc(title) + '</label>' +
      '<div class="stepper-sub" id="' + id + '-sub">' + esc(perDayText(val, days)) + '</div>' +
      '<div class="stepper">' +
      '<button type="button" class="step-btn" data-action="step" data-target="' + id + '" data-delta="' + (-step) + '" aria-label="Less">−</button>' +
      moneyField(id, val, { placeholder: '0' }).replace('<input ', '<input data-live="spendLive" data-days="' + days + '" ') +
      '<button type="button" class="step-btn" data-action="step" data-target="' + id + '" data-delta="' + step + '" aria-label="More">+</button>' +
      '</div></div>';
  }
  function perDayText(val, days) {
    const n = Number(val);
    if (!(n > 0)) return 'Type an amount, or use − and +';
    const d = n / days;
    return 'about ' + money(d >= 1 ? Math.round(d) : E.round2(d)) + ' a day';
  }
  function spendNoteHTML(home, boat) {
    const s = state.settings;
    if (!(s.payAmount > 0)) {
      return '<p class="goal-note is-kind">No paycheck amount yet, so we can\'t suggest amounts. Skip this and we\'ll work it out on your first payday.</p>';
    }
    const sug = E.suggestSpending(state, { today: today() });
    const h = Number(home) || 0, b = Number(boat) || 0;
    const spend = E.monthlySpend({ homeSpend: h, boatSpend: b, onDays: s.onDays, offDays: s.offDays });
    const left = sug.perMonthIncome - sug.perMonthBills - spend;
    let html = '';
    if (!sug.ok) {
      html += '<p class="goal-note is-kind">On paper your bills use up your paycheck. Set what you really need — we\'ll work with it.</p>';
    } else if (left >= 10) {
      html += '<p class="goal-note">That leaves about ' + esc(money(E.roundTo(left, 10))) + ' a month for your goals.</p>';
    } else {
      html += '<p class="goal-note is-kind">That uses up about everything after bills. Try a little less so there\'s some left for your goals.</p>';
    }
    return html;
  }

  function renderSetup() {
    ui.setupStep = Math.max(0, Math.min(STEPS.length - 1, ui.setupStep));
    return SETUP[STEPS[ui.setupStep]]();
  }

  function setStep(n) {
    ui.setupStep = Math.max(0, Math.min(STEPS.length - 1, n));
    ui.otherCur = false;
    putStep(ui.setupStep);
    render();
    window.scrollTo(0, 0);
    const input = $app.querySelector('[data-autofocus]');
    const h = $('q-title');
    if (input) { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } else if (h) h.focus({ preventScroll: true });
  }

  // Saves the answer on the current step. Returns false to stay (after showing a kind error).
  const COMMIT = {
    boat: function (quiet) {
      const el = $('f-boat');
      if (el && D.isValid(el.value)) E.act.setBoatDate(state, el.value);
      return true;
    },
    currency: function (quiet) {
      const el = $('f-sym');
      if (el) {
        const v = el.value.trim();
        if (v) { state.settings.currency = 'XXX'; state.settings.currencySymbol = v; }
        else if (state.settings.currency === 'XXX' && !quiet) { setError('f-sym', 'Type your money symbol, like R or ₱.'); return false; }
      }
      return true;
    },
    pay: function (quiet) {
      const n = parseMoney($('f-pay') && $('f-pay').value);
      if (n === null) return true;
      if (!(n > 0)) { if (!quiet) setError('f-pay', 'That doesn\'t look like an amount. Try something like 2000.'); return quiet; }
      state.settings.payAmount = n;
      return true;
    },
    savings: function (quiet) {
      const n = parseMoney($('f-sav') && $('f-sav').value);
      if (n === null) return true;
      if (!(n >= 0) || Number.isNaN(n)) { if (!quiet) setError('f-sav', 'That doesn\'t look like an amount. Try something like 500.'); return quiet; }
      state.savings = { amount: n, asOf: today() };
      return true;
    },
    accounts: function (quiet) {
      const vals = { checking: parseMoney($('f-chk') && $('f-chk').value), spending: parseMoney($('f-spc') && $('f-spc').value) };
      if (Number.isNaN(vals.checking)) { if (!quiet) setError('f-chk', 'That doesn\'t look like an amount. Try something like 1500.'); return quiet; }
      if (Number.isNaN(vals.spending)) { if (!quiet) setError('f-spc', 'That doesn\'t look like an amount. Try something like 200.'); return quiet; }
      const acc = E.accounts(state, today());
      Object.keys(vals).forEach(function (id) {
        const n = vals[id];
        const a = acc.find(function (x) { return x.id === id; });
        if (n === null || (a && a.asOf && Math.abs(a.balance - n) < 0.005)) return;   // blank, or the same as before
        E.act.setAccountBalance(state, id, n, now());
      });
      return true;
    },
    spending: function (quiet) {
      const h = parseMoney($('f-home') && $('f-home').value);
      const b = parseMoney($('f-boatspend') && $('f-boatspend').value);
      if (Number.isNaN(h)) { if (!quiet) setError('f-home', 'That doesn\'t look like an amount.'); return quiet; }
      if (Number.isNaN(b)) { if (!quiet) setError('f-boatspend', 'That doesn\'t look like an amount.'); return quiet; }
      if (h !== null) state.settings.homeSpend = h;
      if (b !== null) state.settings.boatSpend = b;
      return true;
    },
  };

  function setupNext() {
    const name = STEPS[ui.setupStep];
    clearErrors($app);
    if (COMMIT[name] && COMMIT[name](false) === false) return;
    save();
    if (name === 'done') { finishSetup(); return; }
    setStep(ui.setupStep + 1);
  }

  function finishSetup() {
    E.act.markAllCelebrated(state, today());
    state.setupDone = true;
    state.meta.tips.addToHome = true;
    save();
    dropStep();
    askPersist();
    go('today');
  }

  // ================================================================== TODAY (§6.2)

  function renderToday() {
    const s = summary();
    return headHTML(null) + V.ticker(s.ticker) + bannerHTML(s) +
      '<div class="today-grid"><div class="today-main">' + spendCardHTML(s, false) + nextCardHTML(s) + '</div>' +
      '<div class="today-side">' + progressCardHTML(s) + '</div></div>';
  }

  function bannerHTML(s) {
    const st = s.rotation;
    const parts = rotLine(st).split(' · ');
    const last = parts.pop();
    const frac = st && st.day && st.of ? Math.max(0.03, Math.min(1, st.day / st.of)) : 0;
    return '<button type="button" class="banner" data-action="rotation" aria-label="' + esc(bannerText(st) + '. Tap to change your boat date.') + '">' +
      '<span class="banner-main"><span class="lbl">Rotation</span><span class="banner-text">' +
      parts.map(function (x) { return '<span class="nowrap">' + esc(x) + '</span>'; }).join(' · ') + (parts.length ? ' · ' : '') +
      '<em class="nowrap">' + esc(last) + '</em></span></span>' +
      '<span class="banner-go" aria-hidden="true">' + (st ? 'Edit' : 'Add') + '</span>' +
      (frac ? '<span class="banner-bar' + (st.where === 'boat' ? ' is-sea' : '') + '" aria-hidden="true"><i style="width:' + Math.round(frac * 100) + '%"></i></span>' : '') +
      '</button>';
  }

  // At most one reminder, in priority order: Safari tab, backup, check-in.
  function remindersHTML(s) {
    let h = '';
    if (IS_APPLE && !isStandalone() && state.setupDone && !ui.safariLater) {
      h = '<div class="remind remind-safari"><span class="remind-text">Harbor is open in Safari<small>Safari can erase it if you don\'t open it for a week.</small></span>' +
        '<span class="remind-actions"><button type="button" class="btn btn-soft btn-small" data-action="safariHow">How?</button>' +
        '<button type="button" class="btn btn-text btn-small" data-action="safariLater">Later</button></span></div>';
    } else if (s.backupDue) {
      const w = backupWords(s.backup);
      h = '<div class="remind"><span class="remind-text">' + esc(w.title) + '<small>' + esc(w.small) + '</small></span>' +
        '<span class="remind-actions"><button type="button" class="btn btn-soft btn-small" data-action="backup">Back up</button>' +
        '<button type="button" class="btn btn-text btn-small" data-action="snoozeBackup">Later</button></span></div>';
    } else if (s.checkinDue) {
      h = '<div class="remind"><span class="remind-text">Monthly check-in<small>30 seconds</small></span>' +
        '<span class="remind-actions"><button type="button" class="btn btn-soft btn-small" data-action="checkin">Start</button>' +
        '<button type="button" class="btn btn-text btn-small" data-action="snoozeCheckin">Not now</button></span></div>';
    }
    return h ? '<div class="reminders">' + h + '</div>' : '';
  }

  // Why we're asking for a backup now, in plain words.
  function backupWords(b) {
    const last = b.lastAt ? fdate(b.lastAt) : null;
    if (b.reason === 'never' || !last) return { title: 'Back up your data', small: 'You haven\'t saved a backup yet' };
    if (b.reason === 'payday') return { title: 'Back up your payday', small: 'Last backup: ' + last };
    if (b.reason === 'changes') return { title: 'Back up your data', small: plural(b.changes, 'change') + ' since ' + last };
    return { title: 'Back up your data', small: plural(b.daysSince, 'day') + ' since your last one' };
  }

  function openSafariSheet() {
    const html = sheetHead('Keep Harbor safe', domId('saf')) +
      '<ol class="safe-steps">' +
      '<li><span class="num">1</span><div><b>Make a backup</b>' +
      '<button type="button" class="btn btn-soft btn-small" data-la="backup">Back up</button></div></li>' +
      '<li><span class="num">2</span><div>Tap <b>Share</b> ↑ (on iPhone you may need to tap ••• first), then <b>Add to Home Screen</b>. Keep <b>Open as Web App</b> on, then tap <b>Add</b>.</div></li>' +
      '<li><span class="num">3</span><div>Open Harbor from the new icon and tap <b>“Have a backup file? Restore it”</b>.</div></li>' +
      '</ol>' +
      '<div class="sheet-actions"><button type="button" class="btn btn-primary" data-la="close">Got it</button></div>';
    openLayer(html, { focus: 'box', actions: { backup: function () { backup(); } } });
  }

  function nextCardHTML(s) {
    const latest = s.latest;
    if (latest && s.openItems.length) {
      const c = doneCount(latest);
      return '<section class="card next-card" aria-labelledby="next-title">' +
        '<div class="card-head"><h2 class="card-title" id="next-title">Payday to-do · ' + esc(D.fmtShort(latest.date)) + '</h2><span class="card-count">' + c.done + '/' + c.total + ' done</span></div>' +
        '<p class="next-sub">' + esc(money(latest.amount) + ' on ' + fdate(latest.date)) + '</p>' +
        checklistHTML(latest) +
        '<div class="links"><button type="button" class="link" data-action="fixPayday" data-id="' + esc(latest.id) + '">Fix amount</button>' +
        '<button type="button" class="link link-muted" data-action="undoPayday" data-id="' + esc(latest.id) + '">Undo payday</button></div>' +
        '<button type="button" class="btn btn-soft btn-again" data-action="startPayday">I got paid again</button>' +
        '</section>';
    }
    let title, sub;
    if (!s.nextPayday) {
      title = 'No paydays yet';
      sub = 'When your pay lands, tap the button below.';
    } else {
      const diff = D.diffDays(today(), s.nextPayday);
      if (diff >= 2) { title = 'Around ' + fdate(s.nextPayday); sub = 'in ' + diff + ' days'; }
      else if (diff === 1) { title = 'Around ' + fdate(s.nextPayday); sub = 'tomorrow'; }
      else if (diff === 0) { title = 'Around today'; sub = 'Tap the button when it lands.'; }
      else { title = 'Was due around ' + fdate(s.nextPayday); sub = 'Tap the button when it lands.'; }
    }
    return '<section class="card next-card" aria-labelledby="next-title">' +
      '<div class="card-head"><h2 class="card-title" id="next-title">Next payday</h2>' +
      (latest ? '<span class="card-count is-good">✓ All done</span>' : '') + '</div>' +
      '<p class="next-when">' + esc(title).replace(/(Around|around) (\w{3} \d+(, \d{4})?)$/, '$1 <span class="nowrap">$2</span>') + ' <span class="next-sub">· ' + esc(sub) + '</span></p>' +
      (latest ? '<p class="next-done">Everything from your ' + esc(fdate(latest.date)) + ' payday is done.</p>' : '') +
      '<button type="button" class="btn btn-paid" data-action="startPayday">I got paid</button>' +
      remindersHTML(s) + '</section>';
  }

  function stageLabel(s) { return s.stage === 4 ? 'All stages done' : 'Stage ' + s.stage + '/3'; }
  // The headline target as a label/value pair: "Debt-free target · November 2026".
  function targetKV(s) {
    const p = s.projection || {};
    if (s.stage === 4) return { label: 'Safety net', value: 'Full ✓', cls: 'is-good' };
    if (p.alreadyDebtFree) {
      if (p.safeHarbor) return { label: 'Safe Harbor target', value: D.fmtMonthYear(p.safeHarbor), cls: 'is-amber' };
      return s.debts.length ? { label: 'Debt', value: 'Paid off ✓', cls: 'is-good' } : { label: 'Debts', value: 'None added', cls: 'is-soft' };
    }
    if (p.debtFree) return { label: 'Debt-free target', value: D.fmtMonthYear(p.debtFree), cls: 'is-amber' };
    if (p.reason === 'no-pay') return { label: 'Debt-free target', value: 'Add your paycheck in Settings', cls: 'is-soft' };
    return { label: 'Debt-free target', value: 'Every payday moves you closer', cls: 'is-soft' };
  }
  function kvHTML(label, value, cls) {
    return '<div class="kv"><span>' + esc(label) + '</span><b class="' + (cls || '') + '">' + esc(value) + '</b></div>';
  }

  function progressCardHTML(s) {
    const t = targetKV(s);
    const saved = s.stage === 4 ? money(s.savings) : money(s.jar.amount) + ' / ' + money(s.jar.target);
    return '<section class="card progress-card" role="button" tabindex="0" data-action="go" data-to="voyage" aria-label="Your progress. Open Progress.">' +
      '<div class="card-head"><h2 class="card-title">Progress · ' + esc(stageLabel(s)) + '</h2><span class="card-count">' + esc(s.stageName) + '</span></div>' +
      V.stageBar(s.stageInfo) +
      '<div class="mini-chart">' + V.chart(s.series, { compact: true }) + '</div>' +
      '<div class="legend" aria-hidden="true"><span class="lg-debt">━ Debt</span><span class="lg-sav">━ Savings</span></div>' +
      kvHTML(t.label, t.value, t.cls) + kvHTML(s.stage === 1 ? 'Starter cushion' : 'Saved', saved, 'is-green') +
      '<div class="more" aria-hidden="true">Open progress ›</div></section>';
  }

  // ================================================================== PAYDAY FLOW (§6.3)

  function startPayday() {
    const s = summary();
    const latest = s.latest;
    let date = today();
    if (latest && latest.date > date) date = latest.date;
    ui.flow = {
      step: s.openItems.length ? 'A' : 'B', fromA: false, editId: null, pdId: null,
      amount: '', date: date, nextDate: E.pay.guessNext(state.settings, date), nextTouched: false,
    };
    go('payday');
  }

  function renderPayday() {
    const f = ui.flow;
    if (!f) { ui.screen = 'today'; return renderToday(); }
    if (f.step === 'A') return paydayA();
    if (f.step === 'B') return paydayB();
    return paydayC();
  }

  function flowTop(title, back, right) {
    return '<div class="flow-top">' +
      (back ? '<button type="button" class="icon-btn" data-action="flowBack" aria-label="Back">' + ICON.back + '</button>'
        : '<button type="button" class="icon-btn" data-action="flowClose" aria-label="Close">' + ICON.x + '</button>') +
      '<span class="flow-title">' + esc(title) + '</span>' + (right ? '<span class="flow-right">' + esc(right) + '</span>' : '') + '</div>';
  }

  function paydayA() {
    const latest = summary().latest;
    return flowTop('Payday', false) +
      '<h1 class="flow-q" tabindex="-1" id="flow-q">Before we start — did you do these from last payday?</h1>' +
      '<p class="flow-lead">Tick the ones you did. It\'s fine if you didn\'t get to some.</p>' +
      '<section class="card">' + checklistHTML(latest) + '</section>' +
      '<button type="button" class="btn btn-primary" data-action="flowContinue">Continue</button>';
  }

  function paydayB() {
    const f = ui.flow;
    const pds = state.paydays;
    let minDate = null;
    if (f.editId) {
      const i = pds.findIndex(function (p) { return p.id === f.editId; });
      if (i > 0) minDate = pds[i - 1].date;
    } else if (pds.length) minDate = pds[pds.length - 1].date;
    const maxDate = minDate && minDate > today() ? minDate : today();
    const usual = state.settings.payAmount;
    return flowTop(f.editId ? 'Fix this payday' : 'Payday', f.fromA) +
      '<form data-submit="paydayGo" novalidate autocomplete="off">' +
      '<h1 class="flow-q"><label for="p-amt">How much hit your bank?</label></h1>' +
      '<div class="field">' + moneyField('p-amt', f.amount === '' ? null : f.amount, { big: true, autofocus: true, enter: 'go' }) +
      (usual > 0 && !f.editId ? '<div class="chips"><button type="button" class="chip" data-action="fillUsual">Same as usual: ' + esc(money(usual)) + '</button></div>' : '') +
      '</div>' +
      '<div class="two two-dates">' +
      '<label class="field"><span class="field-label">Paid on</span><input class="input" type="date" id="p-date" value="' + esc(f.date) + '"' +
      (minDate ? ' min="' + minDate + '"' : '') + ' max="' + maxDate + '" data-live="payDate"></label>' +
      '<label class="field"><span class="field-label">Next payday (our guess)</span><input class="input" type="date" id="p-next" value="' + esc(f.nextDate) + '"' +
      ' min="' + D.addDays(f.date, 1) + '" data-live="payNext"></label>' +
      '</div>' +
      '<button type="submit" class="btn btn-primary">' + (f.editId ? 'Update my plan' : 'Show me what to do') + '</button>' +
      '</form>';
  }

  function paydayC() {
    const f = ui.flow;
    const pd = state.paydays.find(function (p) { return p.id === f.pdId; });
    if (!pd) { ui.flow = null; ui.screen = 'today'; return renderToday(); }
    const plan = pd.plan;
    const status = plan.status === 'short' ? 'short' : plan.status === 'tight' ? 'tight' : 'ok';
    const isLatest = state.paydays[state.paydays.length - 1] === pd;
    const complete = E.isComplete(pd);
    const hasSpend = (plan.items || []).some(function (it) { return it.kind === 'spend' && it.amount > 0; });
    const c = doneCount(pd);
    let h = flowTop('Payday', false, D.fmtShort(pd.date) + ' → next ~' + D.fmtShort(pd.nextDate)) +
      '<section class="card quote" aria-label="' + esc(money(pd.amount) + ' on ' + fdate(pd.date) + ', next payday around ' + fdate(pd.nextDate)) + '">' +
      '<h2 class="lbl">Hit your bank</h2><p class="q-big">' + quoteHTML(pd.amount) + '</p>' + V.splitBar(plan, money) + '</section>' +
      '<div class="callout callout-' + status + '" role="status"><p>' + esc(plan.headline) + '</p>' +
      (plan.note ? '<p class="note">' + esc(plan.note) + '</p>' : '') + '</div>' +
      '<section class="card">' +
      '<div class="card-head"><h2 class="card-title">Your to-do list</h2><span class="card-count">' + c.done + '/' + c.total + ' done</span></div>' +
      checklistHTML(pd) +
      '<div class="links">' + (isLatest ? '<button type="button" class="link" data-action="fixPayday" data-id="' + esc(pd.id) + '">Fix amount</button>' : '') +
      '<button type="button" class="link link-muted" data-action="undoPayday" data-id="' + esc(pd.id) + '">Undo payday</button></div></section>';
    if (hasSpend && !state.meta.tips.spendingCard) {
      h += '<div class="tip"><span class="lbl">Tip</span><div class="tip-body">' +
        'Keep your spending money on its own card or account, so your bank app shows exactly what\'s left.' +
        '<br><button type="button" class="btn btn-soft btn-small" data-action="tipDone">Got it</button></div></div>';
    }
    if (complete && c.total > 0) {
      h += '<div class="cheer" role="status"><p class="cheer-big">All done. Nice work.</p><p class="cheer-small">' + esc(streakText(E.streak(state))) + '</p>' +
        (summary().backupDue ? '<p class="cheer-backup">Save a backup of this payday? It takes 10 seconds.</p>' +
          '<button type="button" class="btn btn-soft btn-small" data-action="backup">Back up now</button>' : '') + '</div>';
    }
    h += '<button type="button" class="btn btn-primary" data-action="flowClose">' + (complete ? 'Done' : 'Done for now') + '</button>';
    return h;
  }

  // ================================================================== VOYAGE (§6.4)

  function renderVoyage() {
    const s = summary();
    const p = s.projection || {};
    const rows = [];
    if (s.stage === 4) rows.push(['Safety net', 'Full ✓', 'is-good']);
    else {
      if (p.alreadyDebtFree && s.debts.length) rows.push(['Debt', 'Paid off ✓', 'is-good']);
      else if (p.debtFree && !p.alreadyDebtFree) rows.push(['Debt-free target', D.fmtMonthYear(p.debtFree), 'is-amber']);
      if (p.safeHarbor) rows.push(['Safe Harbor target', D.fmtMonthYear(p.safeHarbor), 'is-amber']);
      if (!rows.length) rows.push(['Targets', p.reason === 'no-pay' ? 'Add your normal paycheck in Settings' : 'Every payday moves you closer', 'is-soft']);
    }
    const jarSub = s.stage === 1 ? 'For surprises'
      : s.stage === 2 ? 'Keeps growing while you crush debt'
        : plural(state.settings.safetyMonths, 'month') + ' of bills and spending';

    let h = headHTML('Progress') +
      '<section class="card targets" aria-label="Your targets">' + rows.map(function (r) { return kvHTML(r[0], r[1], r[2]); }).join('') + '</section>' +
      '<section class="card chart-card" aria-labelledby="ch-t"><div class="card-head"><h2 class="card-title" id="ch-t">Debt vs savings</h2>' +
      '<span class="card-count legend" aria-hidden="true"><span class="lg-debt">━ Debt</span><span class="lg-sav">━ Savings</span></span></div>' +
      '<div id="chart-slot"></div><p class="small-note">Solid = so far · dotted = where you\'re headed</p></section>' +
      '<section class="card" aria-label="Your plan"><div class="card-head"><h2 class="card-title">The plan · ' + esc(stageLabel(s)) + '</h2>' +
      '<span class="card-count">' + esc(s.stageName) + '</span></div>' + V.stageBar(s.stageInfo) + '</section>' +
      '<section class="card" aria-label="Your savings"><div class="card-head"><h2 class="card-title">' + (s.stage === 1 ? 'Starter cushion' : 'Safety net') + '</h2>' +
      '<span class="card-count">' + esc(jarSub) + '</span></div>' + V.meter(s.jar, money, { cushion: s.stage === 1 ? 0 : s.cushion }) + '</section>';

    if (s.debts.length) {
      h += '<section class="card" aria-label="Your debts"><div class="card-head"><h2 class="card-title">Your debts</h2>' +
        '<span class="card-count">Total ' + esc(money(s.totalDebtNow)) + '</span></div>' + V.debtTable(s.debts, money) + '</section>';
    }
    if (s.streak > 0) {
      h += '<section class="card streak"><span class="lbl">Streak</span><b>' +
        esc(s.streak === 1 ? '1 payday all done' : s.streak + ' paydays in a row, all done') + '</b></section>';
    }
    h += '<h2 class="section-title">Logbook</h2>';
    if (!state.paydays.length) {
      h += '<p class="empty-note">Your paydays will show up here.</p>';
    } else {
      h += '<section class="card card-flush"><ul class="log">' + state.paydays.slice().reverse().map(function (pd) {
        const c = doneCount(pd);
        const all = c.done === c.total;
        return '<li><button type="button" class="log-row" data-action="logOpen" data-id="' + esc(pd.id) + '">' +
          '<span class="log-date">' + esc(D.fmtShort(pd.date) + (pd.date.slice(0, 4) !== today().slice(0, 4) ? ' ' + pd.date.slice(0, 4) : '')) + '</span>' +
          '<span class="log-amt">' + esc(fig(pd.amount)) + '</span>' +
          '<span class="log-sub' + (all ? ' is-done' : '') + '">' + (all ? '✓ ' : '') + c.done + '/' + c.total + '</span>' +
          '<span class="chev" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ul></section>';
    }
    return h;
  }

  function fillChart() {
    const slot = $('chart-slot');
    if (!slot) return;
    const w = Math.round(slot.clientWidth) || 340;
    slot.innerHTML = V.chart(summary().series, { width: Math.max(280, w), height: w > 520 ? 240 : 200 });
  }

  // ================================================================== MONEY (§10.9)

  const CATS = E.CATEGORIES;
  function catOf(key) { return CATS.find(function (c) { return c.key === key; }) || CATS[CATS.length - 1]; }
  function placeKey(w) { return String(w || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function isDebtPay(pw) { return typeof pw === 'string' && pw.indexOf('debt:') === 0; }

  // "about $66 a day" (the engine's sub without "until Oct 15"), or '' when there's no daily figure.
  function perDayShort(sp) {
    if (!sp.sub || !/^(about|less than) /.test(sp.sub)) return '';
    return sp.sub.replace(/ until .*$/, '');
  }
  function perText(per, sp) {
    if (per.perDay == null) return '';
    const r = function (x) { return money(x >= 1 ? Math.round(x) : E.round2(x)); };
    if (sp.homeDays > 0 && sp.boatDays > 0 && per.perHome > 0) return r(per.perHome) + ' a day at home';
    return r(per.perDay) + ' a day';
  }
  function leftWords(n) { return n < 0 ? money(-n) + ' over' : money(n) + ' left'; }

  // Today and Money: what's left to spend until payday, shown like a stock quote.
  function spendCardHTML(s, big) {
    const sp = s.spending;
    const buttons = '<div class="btn-row spend-actions"><button type="button" class="btn btn-primary" data-action="logPurchase">+ Log purchase</button>' +
      '<button type="button" class="btn btn-soft" data-action="afford">Can I afford it?</button></div>';
    if (!sp.started) {
      if (big) {
        return '<section class="card spend-card quote" aria-labelledby="spend-t">' +
          '<h2 class="lbl spend-label" id="spend-t">Left to spend</h2>' +
          '<p class="spend-intro">Log what you buy, and Harbor shows what\'s left to spend until payday.</p>' + buttons + '</section>';
      }
      return '<section class="card spend-invite" aria-label="Left to spend">' +
        '<p class="invite-text"><span class="lbl">Left to spend</span>See what\'s left until payday. <span class="invite-sub">Log what you buy.</span></p>' +
        '<button type="button" class="btn btn-soft btn-small" data-action="logPurchase">+ Log purchase</button></section>';
    }
    // Spent before the first payday was logged: it comes out of that payday's spending money.
    const early = !sp.until && sp.left < 0;
    const label = early ? 'Spent so far' : 'Left to spend';
    const amount = early ? -sp.left : Math.max(0, sp.left);
    const todayTxt = sp.spentToday > 0
      ? '<span class="dn">▼ ' + esc(money(sp.spentToday)) + ' today</span>'
      : '<span class="mut">No spending today</span>';
    let per = '';
    if (sp.until && sp.daysLeft > 0 && sp.left > 0 && sp.perDay != null) {
      const r = function (x) { return money(x >= 1 ? Math.round(x) : E.round2(x)); };
      per = sp.homeDays > 0 && sp.boatDays > 0 && sp.perHome > 0
        ? r(sp.perHome) + ' home · ' + r(sp.perBoat) + ' boat / day'
        : r(sp.perDay) + ' / day · ' + plural(sp.daysLeft, 'day');
    }
    let sub = '';
    if (!sp.until) sub = early ? 'It comes out of your first payday\'s spending money.' : 'When your pay lands, your spending money is added.';
    else if (!per) sub = sp.sub || '';
    else if (big) sub = 'Until payday around ' + fdate(sp.until);
    let h = '<section class="card spend-card quote' + (big ? ' is-big' : '') + '" aria-labelledby="spend-t">' +
      '<h2 class="lbl spend-label" id="spend-t">' + label + '</h2>' +
      '<p class="spend-amt q-big">' + quoteHTML(amount) + '</p>' +
      '<div class="q-row">' + todayTxt + (per ? '<span>' + esc(per) + '</span>' : '') + '</div>' +
      (sub ? '<p class="spend-sub">' + esc(sub) + '</p>' : '');
    if (sp.status === 'over' && sp.until) h += '<p class="spend-over">' + esc(sp.overText) + '</p>';
    if (big && sp.carried != null && Math.abs(sp.carried) >= 0.5 && sp.until) {
      h += '<p class="spend-carried">' + (sp.carried > 0
        ? 'Includes ' + esc(money(sp.carried)) + ' left over from last time'
        : 'After ' + esc(money(-sp.carried)) + ' you went over last time') + '</p>';
    }
    return h + buttons + '</section>';
  }

  function dayLabel(iso) {
    const t = today();
    if (iso === t) return 'Today';
    if (iso === D.addDays(t, -1)) return 'Yesterday';
    return D.fmtDay(iso) + (iso.slice(0, 4) !== t.slice(0, 4) ? ', ' + iso.slice(0, 4) : '');
  }

  const BUYS_SHORT = 8;
  function purchasesHTML(sp) {
    if (!sp.recent.length) {
      return '<p class="empty-note">Nothing logged yet. After you buy something, tap + Log purchase — it takes about 10 seconds.</p>';
    }
    const groups = [];
    const list = ui.allBuys ? sp.recent : sp.recent.slice(0, BUYS_SHORT);
    list.forEach(function (p) {
      let g = groups[groups.length - 1];
      if (!g || g.date !== p.date) { g = { date: p.date, total: 0, list: [] }; groups.push(g); }
      g.total = E.round2(g.total + p.amount);
      g.list.push(p);
    });
    let h = '<section class="card card-flush buys" aria-label="Recent purchases">' + groups.map(function (g) {
      return '<h3 class="buy-day"><span>' + esc(dayLabel(g.date)) + '</span><span>−' + esc(fig(g.total)) + '</span></h3>' +
        '<ul class="buy-list">' + g.list.map(function (p) {
          const via = p.paidWith !== 'spending' ? (isDebtPay(p.paidWith) ? 'On ' : 'From ') + p.paidWithName : '';
          return '<li><button type="button" class="buy-row" data-action="editPurchase" data-id="' + esc(p.id) + '">' +
            '<span class="list-main"><span class="buy-name">' + esc(p.where || p.label) + (p.what ? '<span class="buy-what"> — ' + esc(p.what) + '</span>' : '') + '</span>' +
            (via ? '<span class="buy-sub">' + esc(via) + '</span>' : '') + '</span>' +
            '<span class="buy-code" title="' + esc(p.label) + '">' + esc(CAT_CODE[p.category] || 'OTHR') + '</span>' +
            '<span class="buy-amt">−' + esc(fig(p.amount)) + '</span></button></li>';
        }).join('') + '</ul>';
    }).join('') + '</section>';
    if (list.length < sp.recent.length) {
      h += '<button type="button" class="btn btn-text" data-action="allBuys" aria-expanded="false">Show more (' + sp.recent.length + ' in all)</button>';
    } else if ((state.purchases || []).length > sp.recent.length) {
      h += '<p class="small-note center">Showing your ' + sp.recent.length + ' most recent.</p>';
    }
    return h;
  }

  function barsHTML(rows, cls, label) {
    const max = rows.reduce(function (a, r) { return Math.max(a, r.total); }, 0) || 1;
    return '<ul class="bars ' + cls + '" aria-label="' + esc(label) + '">' + rows.map(function (r) {
      const w = Math.max(3, Math.round(r.total / max * 100));
      return '<li class="bar-row"><span class="bar-name">' + r.name + (r.count > 1 ? ' <small>' + r.count + '×</small>' : '') + '</span>' +
        '<span class="bar-amt">' + esc(money(r.total)) + '</span>' +
        '<span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:' + w + '%"></span></span></li>';
    }).join('') + '</ul>';
  }

  function whereHTML(s) {
    if (!(state.purchases || []).length) return '';
    const cur = s.stretch.current, prev = s.stretch.previous;
    const kind = cur.where === 'boat' ? 'boat stretch' : cur.where === 'home' ? 'home stretch' : 'pay period';
    let h = '<h2 class="section-title">Where it went</h2><section class="card where-card">' +
      '<div class="tiles' + (prev ? '' : ' one') + '">' +
      '<div class="tile"><span>This ' + kind + ' so far</span><b>' + esc(money(cur.summary.total)) + '</b></div>' +
      (prev ? '<div class="tile"><span>Last ' + kind + '</span><b>' + esc(money(prev.summary.total)) + '</b></div>' : '') + '</div>';
    if (!cur.summary.count) {
      h += '<p class="small-note">Nothing logged yet this ' + kind + '.</p>';
    } else {
      h += '<h3 class="mini-title">Top places</h3>' + barsHTML(cur.summary.byPlace.slice(0, 5).map(function (x) {
        return { name: esc(x.where), total: x.total, count: x.count };
      }), 'is-places', 'Top places') +
        '<h3 class="mini-title">By kind</h3>' + barsHTML(cur.summary.byCategory.map(function (x) {
        return { name: esc(x.label), total: x.total, count: 0 };
      }), 'is-cats', 'By kind');
    }
    return h + '</section>';
  }

  function accountRowsHTML(s) {
    let h = '<h2 class="section-title">Accounts</h2><div class="card group">' + s.accounts.map(function (a) {
      let value, small, cls = '';
      if (a.balance == null) {
        value = 'Add balance'; cls = 'is-add';
        small = a.kind === 'spending' ? 'Or just log a purchase' : null;
      } else {
        value = a.kind === 'spending' && a.balance < 0 ? money(-a.balance) + ' over' : money(a.balance);
        if (!a.asOf) small = a.kind === 'spending' ? 'From what you\'ve logged' : 'Estimated';
        else small = a.estimated ? 'Estimated · set ' + fdate(a.asOf) : 'As of ' + fdate(a.asOf);
        cls = 'is-amt';
      }
      return row('account', a.name, value, { id: a.id, small: small, valueCls: cls });
    }).join('') + row('addAccount', '+ Add an account', null, { cls: 'add', noChev: true }) + '</div>';
    if (s.debts.length) {
      h += '<h2 class="section-title">What you owe</h2><div class="card group">' + s.debts.map(function (d) {
        return row('owe', d.name, d.open ? money(d.balance) + ' left' : 'Paid off ✓', { id: d.id, valueCls: d.open ? 'is-amt' : 'is-good' });
      }).join('') + '</div>';
    }
    return h;
  }

  function renderMoney() {
    const s = summary();
    return headHTML('Money') + spendCardHTML(s, true) +
      '<h2 class="section-title">Recent purchases</h2>' + purchasesHTML(s.spending) +
      whereHTML(s) + accountRowsHTML(s);
  }

  // --- log / edit a purchase
  function paidWithOptions(keep) {
    const s = summary();
    // Spending card first (the usual one), then checking and the user's own accounts.
    const opts = s.accounts.filter(function (a) { return a.kind !== 'savings'; })
      .sort(function (a, b) { return (a.kind === 'spending' ? 0 : 1) - (b.kind === 'spending' ? 0 : 1); })
      .map(function (a) { return { v: a.id, label: a.name }; });
    s.debts.forEach(function (d) {
      if (d.open || (keep && keep.paidWith === 'debt:' + d.id)) opts.push({ v: 'debt:' + d.id, label: d.name, debt: true });
    });
    if (keep && !opts.some(function (o) { return o.v === keep.paidWith; })) {
      opts.push({ v: keep.paidWith, label: isDebtPay(keep.paidWith) ? 'A card you removed' : 'An account you removed' });
    }
    return opts;
  }

  function openPurchaseSheet(o) {
    o = o || {};
    const p = o.id ? (state.purchases || []).find(function (x) { return x.id === o.id; }) : null;
    if (o.id && !p) return;
    const t = today();
    const cur = p ? { amount: p.amount, where: p.where, what: p.what, category: p.category, paidWith: p.paidWith, date: p.date }
      : { amount: o.amount == null ? null : o.amount, where: '', what: '', category: null, paidWith: 'spending', date: t };
    const opts = paidWithOptions(p);
    const places = summary().spending.places;
    let cat = cur.category, pw = cur.paidWith;
    const debtName = function (v) { const d = state.debts.find(function (x) { return 'debt:' + x.id === v; }); return d ? d.name : ''; };
    const pwHelp = function (v) {
      return isDebtPay(v) ? 'Adds to what you owe on ' + debtName(v) + '. Your next payday plan pays it back.' : '';
    };
    const yest = D.addDays(t, -1);
    const html = sheetHead(p ? 'Edit purchase' : 'Log a purchase', domId('pu')) +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">How much?</span>' + moneyField('pu-amt', cur.amount, { big: true, enter: 'next' }) + '</label>' +
      '<label class="field"><span class="field-label">Where?</span><input class="input" id="pu-where" list="pu-places" maxlength="60" autocapitalize="words" autocomplete="off" enterkeyhint="next" placeholder="e.g. Shell" value="' + esc(cur.where) + '">' +
      '<datalist id="pu-places">' + places.map(function (x) { return '<option value="' + esc(x.where) + '"></option>'; }).join('') + '</datalist></label>' +
      '<label class="field"><span class="field-label">What? <span class="opt">(optional)</span></span><input class="input" id="pu-what" maxlength="80" autocomplete="off" enterkeyhint="done" placeholder="e.g. lunch" value="' + esc(cur.what) + '"></label>' +
      '<div class="field"><span class="field-label" id="pu-cat-l">Kind</span><div class="cat-grid" role="group" aria-labelledby="pu-cat-l">' + CATS.map(function (c) {
        return '<button type="button" class="cat' + (cat === c.key ? ' is-on' : '') + '" data-la="cat" data-v="' + c.key + '" aria-pressed="' + (cat === c.key) + '">' +
          '<span class="cat-code" aria-hidden="true">' + esc(CAT_CODE[c.key] || '') + '</span><span class="cat-label">' + esc(c.label) + '</span></button>';
      }).join('') + '</div></div>' +
      '<div class="field"><span class="field-label" id="pu-pw-l">Paid with</span><div class="chips pw-chips" role="group" aria-labelledby="pu-pw-l">' + opts.map(function (x) {
        return '<button type="button" class="chip' + (pw === x.v ? ' is-on' : '') + '" data-la="pw" data-v="' + esc(x.v) + '" aria-pressed="' + (pw === x.v) + '">' +
          esc(x.label) + (x.debt ? ' <small>— adds to what you owe</small>' : '') + '</button>';
      }).join('') + '</div><span class="field-help" id="pu-pw-help">' + esc(pwHelp(pw)) + '</span></div>' +
      '<div class="field"><span class="field-label" id="pu-date-l">When</span><div class="when-row">' +
      '<button type="button" class="chip' + (cur.date === t ? ' is-on' : '') + '" data-la="day" data-v="' + t + '" aria-pressed="' + (cur.date === t) + '">Today</button>' +
      '<button type="button" class="chip' + (cur.date === yest ? ' is-on' : '') + '" data-la="day" data-v="' + yest + '" aria-pressed="' + (cur.date === yest) + '">Yesterday</button>' +
      '<input class="input input-date" type="date" id="pu-date" aria-labelledby="pu-date-l" value="' + esc(cur.date) + '" max="' + (p && p.date > t ? p.date : t) + '"></div></div>' +
      '<div class="sheet-actions' + (p ? ' has-del' : '') + '"><button type="submit" class="btn btn-primary">' + (p ? 'Save' : 'Log it') + '</button>' +
      (p ? '<button type="button" class="btn btn-danger btn-del" data-la="del" aria-label="Delete this purchase">Delete</button>' : '') + '</div></form>';

    const press = function (box, la, v) {
      box.querySelectorAll('[data-la="' + la + '"]').forEach(function (x) {
        const on = x.dataset.v === v;
        x.setAttribute('aria-pressed', String(on));
        x.classList.toggle('is-on', on);
      });
    };
    const setPw = function (box, v) {
      if (!opts.some(function (x) { return x.v === v; })) return;
      pw = v; press(box, 'pw', v);
      const help = $('pu-pw-help'); if (help) help.textContent = pwHelp(v);
    };
    const entry = openLayer(html, {
      actions: {
        cat: function (el, en) { cat = el.dataset.v; press(en.box, 'cat', cat); },
        pw: function (el, en) { setPw(en.box, el.dataset.v); },
        day: function (el, en) { $('pu-date').value = el.dataset.v; press(en.box, 'day', el.dataset.v); },
        del: function (el, en) {
          confirmBox('Delete this purchase?', money(p.amount) + ' at ' + p.where + ' on ' + fdate(p.date) + '.', 'Delete it', 'Keep it', true).then(function (yes) {
            if (!yes) return;
            E.act.deletePurchase(state, p.id);
            save(); closeLayer(en); render(); toast('Purchase deleted.');
          });
        },
      },
      onSubmit: function (form, en) {
        clearErrors(en.box);
        const amount = parseMoney($('pu-amt').value);
        if (amount === null) { setError('pu-amt', 'Type how much it cost.'); return; }
        if (!(amount > 0)) { setError('pu-amt', 'That doesn\'t look like an amount. Try something like 12.50.'); return; }
        const date = $('pu-date').value || t;
        const input = { date: date, amount: amount, where: $('pu-where').value, what: $('pu-what').value, category: cat || 'other', paidWith: pw };
        let added = null;
        const wasStarted = !p && summary().spending.started;
        try {
          if (p) E.act.editPurchase(state, p.id, input, now());
          else added = E.act.addPurchase(state, input, now());
        } catch (err) {
          const msg = (err && err.message) || 'Something didn\'t work. Try again.';
          setError(/day/i.test(msg) ? 'pu-date' : 'pu-amt', msg);
          return;
        }
        save(); closeLayer(en); render();
        if (p) { toast('Saved.'); return; }
        const sp = summary().spending;
        let msg = 'Logged ✓';
        if (sp.started && sp.until) {
          msg += sp.left < 0 ? ' ' + money(-sp.left) + ' over — no stress.' : ' ' + money(sp.left) + ' left';
        }
        if (isDebtPay(added.paidWith)) msg += ' · added to ' + debtName(added.paidWith);
        // First log mid-pay-period: the pot would assume nothing was spent since payday, so ask once (§10.2).
        if (!wasStarted && sp.started && sp.potStart && sp.potStart < added.date) {
          openMoneySheet({ title: 'Logged ✓ One quick question', label: 'What\'s on your spending card right now?',
            lead: 'You\'ve probably spent some since payday. Open your bank app and type what it says, so we start from the real number.',
            value: null, example: '250', skip: 'Skip — use my plan',
            save: function (n) { E.act.setAccountBalance(state, 'spending', n, now()); } });
          return;
        }
        toast(msg, 2600);
      },
    });
    // Picking a place you've used before fills in its usual kind and card.
    const where = $('pu-where');
    const onWhere = function () {
      const k = placeKey(where.value);
      const hit = k && places.find(function (x) { return placeKey(x.where) === k; });
      if (!hit) return;
      cat = hit.category; press(entry.box, 'cat', cat);
      setPw(entry.box, hit.paidWith);
    };
    where.addEventListener('input', onWhere);
    where.addEventListener('change', onWhere);
    $('pu-date').addEventListener('change', function () { press(entry.box, 'day', $('pu-date').value); });
  }

  // --- can I afford it?
  function affordResultHTML(price) {
    const sp = summary().spending;
    if (!(price > 0)) {
      const line = sp.started && sp.until
        ? 'Right now: ' + leftWords(sp.left) + (perDayShort(sp) ? ' · ' + perDayShort(sp) : '') + '.'
        : 'Type a price to see how it fits before payday.';
      return '<div class="verdict verdict-idle"><p class="verdict-sub">' + esc(line) + '</p></div>';
    }
    const a = E.afford(state, today(), price, { money: money });
    const tagTxt = { ok: 'Fits', tight: 'Tight', wait: 'Wait' }[a.verdict] || 'Tight';
    const tile = function (label, per) {
      const pd = perText(per, sp);
      const amt = per.left < 0 ? money(-per.left) + ' over' : money(per.left);
      return '<div class="tile"><span>' + label + '</span><b>' + esc(amt) + '</b>' + (pd ? '<small>' + esc(pd) + '</small>' : '') + '</div>';
    };
    return '<div class="verdict verdict-' + a.verdict + '">' +
      '<div class="verdict-head"><span class="verdict-tag">' + tagTxt + '</span><p class="verdict-text">' + esc(a.headline) + '</p></div>' +
      (a.sub && !a.started ? '<p class="verdict-sub">' + esc(a.sub) + '</p>' : '') +
      '<div class="tiles verdict-tiles">' + tile('Left now', a.before) + '<span class="arrow" aria-hidden="true">→</span>' + tile('Left after', a.after) + '</div></div>';
  }

  function openAffordSheet() {
    const html = sheetHead('Can I afford it?', domId('af')) +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">How much is it?</span>' + moneyField('af-amt', null, { big: true }) + '</label>' +
      '<div id="af-result" aria-live="polite">' + affordResultHTML(null) + '</div>' +
      '<div class="sheet-actions"><button type="button" class="btn btn-primary" data-la="buy">I bought it — log it</button>' +
      '<button type="button" class="btn btn-text" data-la="close">Close</button></div></form>';
    const entry = openLayer(html, {
      actions: {
        buy: function (el, en) {
          clearErrors(en.box);
          const price = parseMoney($('af-amt').value);
          if (!(price > 0)) { setError('af-amt', 'Type the price first.'); return; }
          closeLayer(en);
          openPurchaseSheet({ amount: price });
        },
      },
      onSubmit: function () { const a = $('af-amt'); if (a) a.blur(); },
    });
    $('af-amt').addEventListener('input', function () {
      const n = parseMoney($('af-amt').value);
      $('af-result').innerHTML = affordResultHTML(Number.isFinite(n) ? n : null);
    });
    return entry;
  }

  // --- accounts
  function openAccountSheet(id) {
    const a = summary().accounts.find(function (x) { return x.id === id; });
    if (!a) return;
    const neg = a.kind !== 'spending' && a.kind !== 'savings';
    const guess = a.balance == null ? '' : 'We think it\'s ' + money(a.kind === 'spending' ? Math.max(0, a.balance) : a.balance) +
      (a.asOf ? ' — you last set it ' + fdate(a.asOf) + '.' : '.');
    const lead = a.kind === 'spending' ? 'Open your bank app and type what\'s on this card. That becomes your “left to spend”.'
      : 'Open your bank app and type what it says.';
    const html = sheetHead(a.name, domId('ac')) + '<p class="sheet-lead">' + esc(lead) + '</p>' +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">' + (a.kind === 'spending' ? 'What\'s on it now' : 'What\'s in it now') + '</span>' +
      moneyField('ac-bal', null, { big: true }) +
      (guess ? '<span class="field-help">' + esc(guess) + '</span>' : '') + '</label>' +
      '<label class="field"><span class="field-label">Name</span><input class="input" id="ac-name" maxlength="40" autocapitalize="words" value="' + esc(a.name) + '"></label>' +
      '<div class="sheet-actions' + (!a.builtIn ? ' has-del' : '') + '"><button type="submit" class="btn btn-primary">' + 'Save' + '</button>' +
      (!a.builtIn ? '<button type="button" class="btn btn-danger btn-del" data-la="del" aria-label="Remove this account">Remove</button>' : '') + '</div></form>';
    openLayer(html, {
      actions: {
        del: function (el, entry) {
          confirmBox('Remove ' + a.name + '?', 'Purchases you paid with it stay in your list.', 'Remove it', 'Keep it', true).then(function (yes) {
            if (!yes) return;
            E.act.deleteAccount(state, a.id);
            save(); closeLayer(entry); render(); toast('Account removed.');
          });
        },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const name = $('ac-name').value.trim();
        const n = parseSigned($('ac-bal').value, neg);
        if (!name) { setError('ac-name', 'Give it a name.'); return; }
        if (Number.isNaN(n)) { setError('ac-bal', 'That doesn\'t look like an amount. Try something like 1500.'); return; }
        try {
          if (name !== a.name) E.act.renameAccount(state, a.id, name);
          if (n !== null) {
            if (a.id === 'savings' && !state.paydays.length && !state.checkins.length) state.savings = { amount: n, asOf: today() };
            else E.act.setAccountBalance(state, a.id, n, now());
          }
        } catch (err) { setError('ac-bal', (err && err.message) || 'Something didn\'t work. Try again.'); return; }
        save(); closeLayer(entry); render(); toast('Saved.');
      },
    });
  }

  const ACCOUNT_CHIPS = ['Cash', 'Second savings', 'Joint account', 'Wallet app'];
  function openAddAccountSheet() {
    let kind = 'cash';
    const html = sheetHead('Add an account', domId('na')) +
      '<p class="sheet-lead">Cash, another bank account, a second savings — anything you want to keep an eye on.</p>' +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">Name</span><input class="input" id="na-name" data-chip-target maxlength="40" autocapitalize="words" enterkeyhint="next" placeholder="e.g. Cash"></label>' +
      chipsHTML(ACCOUNT_CHIPS, '') +
      '<div class="field"><span class="field-label">What kind?</span><div class="seg" role="group" aria-label="What kind">' +
      '<button type="button" data-la="kind" data-v="cash" aria-pressed="true">Cash</button>' +
      '<button type="button" data-la="kind" data-v="other" aria-pressed="false">Other</button></div></div>' +
      '<label class="field"><span class="field-label">What\'s in it now <span class="opt">(optional)</span></span>' + moneyField('na-bal', null, {}) + '</label>' +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Add account</button></div></form>';
    const setKind = function (box, v) {
      kind = v === 'cash' ? 'cash' : 'other';
      box.querySelectorAll('[data-la="kind"]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.v === kind)); });
    };
    openLayer(html, {
      actions: {
        chip: function (el, entry) { chipAction(el, entry); setKind(entry.box, el.dataset.v === 'Cash' ? 'cash' : 'other'); },
        kind: function (el, entry) { setKind(entry.box, el.dataset.v); },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const name = $('na-name').value.trim();
        const n = parseSigned($('na-bal').value, true);
        if (!name) { setError('na-name', 'Give it a name, like "Cash".'); return; }
        if (Number.isNaN(n)) { setError('na-bal', 'That doesn\'t look like an amount — or leave it empty.'); return; }
        const acct = E.act.addAccount(state, { name: name, kind: kind });
        if (n !== null) E.act.setAccountBalance(state, acct.id, n, now());
        save(); closeLayer(entry); render(); toast(acct.name + ' added.');
      },
    });
  }

  function openOweSheet(id) {
    const d = summary().debts.find(function (x) { return x.id === id; });
    if (!d) return;
    openMoneySheet({ title: d.name, label: 'How much is left on it now?', lead: 'Open your bank app and type what it says.',
      value: null, help: 'We think it\'s ' + money(d.balance) + '.', example: '1200',
      more: { label: 'Edit or delete this debt', fn: function () { openDebtSheet(d.id); } },
      save: function (n) { E.act.setDebtBalance(state, d.id, n, now()); } });
  }

  // ================================================================== SETTINGS (§6.5)

  function row(action, label, value, o) {
    o = o || {};
    return '<button type="button" class="row' + (o.cls ? ' ' + o.cls : '') + '" data-action="' + action + '"' + (o.id ? ' data-id="' + esc(o.id) + '"' : '') + '>' +
      '<span class="row-label">' + esc(label) + (o.small ? '<small>' + esc(o.small) + '</small>' : '') + '</span>' +
      (value != null ? '<span class="row-value' + (o.valueCls ? ' ' + o.valueCls : '') + '">' + esc(value) + '</span>' : '') +
      (o.noChev ? '' : '<span class="chev" aria-hidden="true">›</span>') + '</button>';
  }

  function renderSettings() {
    const s = state.settings;
    const sum = summary();
    const share = Math.round(s.debtShare * 10) / 10;
    const byId = {};
    sum.debts.forEach(function (d) { byId[d.id] = d; });

    let h = headHTML('Settings');

    h += '<h2 class="section-title">Rotation</h2><div class="card group">' +
      row('rotation', 'Boat date', s.boatDate ? fdate(s.boatDate) : 'Not set', { small: 'A day you get on (or got on) the boat' }) +
      row('rotLen', 'Days on the boat', String(s.onDays)) +
      row('rotLen', 'Days at home', String(s.offDays)) + '</div>';

    h += '<h2 class="section-title">Pay</h2><div class="card group">' +
      row('editPay', 'Normal paycheck', s.payAmount > 0 ? money(s.payAmount) : 'Not set') +
      row('editFreq', 'How often', freqLabel(s.payFreq)) + '</div>';

    h += '<h2 class="section-title">Bills</h2><div class="card group">' +
      state.bills.map(function (b) {
        return row('editBill', b.name, money(b.amount), { id: b.id, small: billWhen(b) });
      }).join('') +
      row('addBill', '+ Add a bill', null, { cls: 'add', noChev: true }) + '</div>';

    h += '<h2 class="section-title">Debts</h2><div class="card group">' +
      state.debts.map(function (d) {
        const r = byId[d.id];
        const open = r ? r.open : d.balance > 0;
        return row('editDebt', d.name, open ? money(r ? r.balance : d.balance) + ' left' : 'Paid off ✓', {
          id: d.id, small: money(d.minPayment) + ' a month' + (d.rate != null ? ' · ' + d.rate + '% interest' : ''),
        });
      }).join('') +
      row('addDebt', '+ Add a debt', null, { cls: 'add', noChev: true }) + '</div>';

    h += '<h2 class="section-title">Savings</h2><div class="card group">' +
      row('editSavings', 'What\'s in savings now', money(sum.savings)) + '</div>';

    h += '<h2 class="section-title">Spending money</h2><div class="card group">' +
      row('editSpending', 'Home stretch (' + s.offDays + ' days)', s.homeSpend != null ? money(s.homeSpend) : 'Suggested') +
      row('editSpending', 'Boat stretch (' + s.onDays + ' days)', s.boatSpend != null ? money(s.boatSpend) : 'Suggested') + '</div>';

    h += '<h2 class="section-title">Your plan</h2><div class="card group">' +
      '<div class="group-pad"><label for="f-share" class="field-label">Extra money while you crush debt</label>' +
      '<p class="slider-value" id="share-value">' + esc(shareText(share)) + '</p>' +
      '<input type="range" id="f-share" min="0" max="8" step="1" value="' + Math.round((1 - share) * 10) + '" data-live="share" data-change="shareSave"' +
      ' aria-valuetext="' + esc(shareText(share)) + '">' +
      '<div class="slider-labels" aria-hidden="true"><span>More to debt</span><span>More to savings</span></div></div>' +
      '<div class="group-pad"><span class="field-label">Which debt first?</span><div class="seg tall" role="group" aria-label="Which debt first">' +
      '<button type="button" data-action="method" data-v="quick" aria-pressed="' + (s.method !== 'interest') + '">Quick wins<small>smallest debt first</small></button>' +
      '<button type="button" data-action="method" data-v="interest" aria-pressed="' + (s.method === 'interest') + '">Least interest<small>highest rate first</small></button>' +
      '</div></div>' +
      row('editCushion', 'Starter cushion', money(s.cushion)) +
      row('editMonths', 'Full safety net', plural(s.safetyMonths, 'month'), { small: 'Months of bills and spending' }) + '</div>';

    h += '<h2 class="section-title">Money</h2><div class="card group">' +
      row('editCurrency', 'Currency', currencyName()) + '</div>';

    h += '<h2 class="section-title">Monthly check-in</h2><div class="card group">' +
      row('checkin', 'Check in now', null, { small: 'Type in your real balances — 30 seconds' }) + '</div>';

    const last = state.meta.lastBackupAt ? fdate(state.meta.lastBackupAt) : 'never';
    h += '<h2 class="section-title">Your data</h2><div class="card group">' +
      row('backup', 'Back up now', 'Last: ' + last, { small: sum.backup.lastAt && sum.backup.changes > 0 ? plural(sum.backup.changes, 'change') + ' since then' : null }) +
      row('restore', 'Restore from a backup', null) +
      '<div class="group-pad"><ul class="warn-list">' +
      warn('■', 'Your money info lives only on this device — nothing is sent anywhere.') +
      warn('■', 'Open Harbor from its Home Screen icon. In a Safari tab, Safari can erase it after about a week of not opening it.') +
      warn('■', 'Deleting the Harbor icon from your Home Screen deletes its data.') +
      warn('■', 'Clearing Safari\'s history and website data can wipe it.') +
      warn('■', 'Your iPad and iPhone don\'t sync. Pick one, or move your data with a backup file.') +
      warn('■', 'Keep a backup in iCloud Drive or Files — Harbor reminds you after paydays and busy weeks.') +
      '</ul></div>' +
      row('startOver', 'Start over', null, { cls: 'danger', noChev: true }) + '</div>';

    h += '<p class="footer">Harbor Terminal · works offline · your data stays on this device<br>Version ' + esc(E.version) + '</p>';
    return h;
  }

  function warn(icon, text) {
    return '<li><span aria-hidden="true">' + icon + '</span><span>' + esc(text) + '</span></li>';
  }
  function shareText(share) {
    const d = Math.round(share * 100);
    return d + '% to debt · ' + (100 - d) + '% to savings';
  }

  // ================================================================== RENDER + ROUTER

  const SCREENS = { setup: renderSetup, today: renderToday, payday: renderPayday, money: renderMoney, voyage: renderVoyage, settings: renderSettings };

  function render() {
    if (!state.setupDone) ui.screen = 'setup';
    else if (ui.screen === 'setup') ui.screen = 'today';
    const fk = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-fk');
    const inLayer = document.activeElement && document.activeElement.closest && document.activeElement.closest('.layer');
    $app.innerHTML = (SCREENS[ui.screen] || renderToday)();
    renderTabs();
    document.body.classList.toggle('no-tabs', ui.screen === 'setup' || ui.screen === 'payday');
    document.body.dataset.screen = ui.screen;
    if (ui.screen === 'voyage') fillChart();
    refreshLayers();
    if (fk) {
      const scope = inLayer && inLayer.isConnected ? inLayer : (inLayer ? null : $app);
      const el = scope && scope.querySelector('[data-fk="' + cssEsc(fk) + '"]');
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function renderTabs() {
    const show = state.setupDone && (ui.screen === 'today' || ui.screen === 'money' || ui.screen === 'voyage' || ui.screen === 'settings');
    $tabs.hidden = !show;
    if (!show) { $tabs.innerHTML = ''; return; }
    const tabs = [['today', 'Today'], ['money', 'Money'], ['voyage', 'Progress'], ['settings', 'Settings']];
    $tabs.innerHTML = '<div class="tabs-inner">' + tabs.map(function (t, i) {
      const on = ui.screen === t[0];
      return '<button type="button" class="tab" data-action="go" data-to="' + t[0] + '"' + (on ? ' aria-current="page"' : '') + '>' +
        '<small aria-hidden="true">F' + (i + 1) + '</small><span>' + t[1] + '</span></button>';
    }).join('') + '</div>';
  }

  function renderBanner() {
    let h = '';
    if (loadProblem === 'storage' || (ui.saveError && !state.setupDone)) {
      h = '<div class="errbar" role="alert"><span>Harbor can\'t save on this device right now. In Settings › Apps › Safari, turn off Block All Cookies, then open Harbor again.</span></div>';
    } else if (ui.saveError) {
      h = '<div class="errbar" role="alert"><span>Couldn\'t save on this device. Make a backup now.</span>' +
        '<button type="button" class="btn btn-soft btn-small" data-action="backup">Back up</button></div>';
    } else if (loadProblem === 'damaged') {
      h = '<div class="errbar" role="alert"><span>Your saved data couldn\'t be read. If you have a backup, restore it.</span>' +
        '<button type="button" class="btn btn-soft btn-small" data-action="restore">Restore</button>' +
        '<button type="button" class="btn btn-text btn-small" data-action="dismissLoad">OK</button></div>';
    }
    $banner.innerHTML = h;
    document.body.classList.toggle('has-errbar', !!h);
  }

  function go(screen) {
    if (screen !== 'payday') ui.flow = null;
    if (screen !== ui.screen) ui.allBuys = false;
    ui.screen = screen;
    render();
    window.scrollTo(0, 0);
    if (screen === 'payday') {
      const a = $app.querySelector('[data-autofocus]');
      if (a) { try { a.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    } else {
      try { $app.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    later(maybeCelebrate, 250);
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    if (!state.setupDone && ui.screen === 'setup') return;
    $toast.textContent = msg;
    $toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.classList.remove('is-on'); }, ms || 3200);
  }

  function later(fn, ms) { setTimeout(fn, ms || 0); }

  // ================================================================== LAYERS: sheets, dialogs, celebrations

  const layers = [];

  // html: inner markup. o: { center, actions: {name: fn(el, entry)}, onSubmit(form, entry), onClose(result), render(), label, dismiss }
  function openLayer(html, o) {
    o = o || {};
    const el = document.createElement('div');
    el.className = 'layer' + (o.center ? ' is-center' : '');
    const box = document.createElement('div');
    box.className = 'sheet' + (o.cls ? ' ' + o.cls : '');
    box.setAttribute('role', o.alert ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.tabIndex = -1;
    box.innerHTML = html;
    const title = box.querySelector('h2, h1');
    if (title) { if (!title.id) title.id = domId('lt'); box.setAttribute('aria-labelledby', title.id); }
    el.appendChild(box);
    $layers.appendChild(el);
    const entry = { el: el, box: box, o: o, prevFocus: document.activeElement, closed: false };
    layers.push(entry);
    document.body.classList.add('has-layer');
    $app.setAttribute('aria-hidden', 'true');
    $tabs.setAttribute('aria-hidden', 'true');
    focusFirst(entry);
    return entry;
  }

  function focusFirst(entry) {
    const target = entry.o.focus === 'box' ? null
      : entry.box.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    try { (target || entry.box).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function closeLayer(entry, result) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    const i = layers.indexOf(entry);
    if (i >= 0) layers.splice(i, 1);
    entry.el.remove();
    if (!layers.length) {
      document.body.classList.remove('has-layer');
      $app.removeAttribute('aria-hidden');
      $tabs.removeAttribute('aria-hidden');
    }
    if (entry.prevFocus && entry.prevFocus.isConnected) { try { entry.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (entry.o.onClose) entry.o.onClose(result);
    if (!layers.length) later(maybeCelebrate, 200);
  }
  function topLayer() { return layers[layers.length - 1] || null; }

  function refreshLayers() {
    layers.forEach(function (entry) {
      if (!entry.o.render) return;
      const html = entry.o.render();
      if (html === null) { closeLayer(entry); return; }
      const fk = document.activeElement && entry.box.contains(document.activeElement) && document.activeElement.getAttribute('data-fk');
      const scroll = entry.box.scrollTop;
      entry.box.innerHTML = html;
      entry.box.scrollTop = scroll;
      if (fk) {
        const el = entry.box.querySelector('[data-fk="' + cssEsc(fk) + '"]');
        if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }
    });
  }

  // In-app choice dialog (never window.confirm). buttons: [{v, label, cls}] → Promise<v|null>
  function choose(o) {
    return new Promise(function (resolve) {
      const tid = domId('dlg');
      const html = '<h2 class="sheet-title" id="' + tid + '" style="padding-top:0">' + esc(o.title) + '</h2>' +
        (o.body ? '<p class="sheet-lead" style="margin:10px 0 20px">' + esc(o.body) + '</p>' : '<div style="height:16px"></div>') +
        '<div class="sheet-actions">' + o.buttons.map(function (b, i) {
          return '<button type="button" class="btn ' + (b.cls || 'btn-soft') + '" data-la="pick" data-i="' + i + '">' + esc(b.label) + '</button>';
        }).join('') + '</div>';
      openLayer(html, {
        center: true, alert: true, focus: 'box',
        actions: { pick: function (el, entry) { closeLayer(entry, o.buttons[+el.dataset.i].v); } },
        onClose: function (r) { resolve(r === undefined ? null : r); },
      });
    });
  }
  function confirmBox(title, body, yesLabel, noLabel, danger) {
    return choose({
      title: title, body: body,
      buttons: [{ v: true, label: yesLabel, cls: danger ? 'btn-danger' : 'btn-primary' }, { v: null, label: noLabel || 'Cancel', cls: 'btn-text' }],
    }).then(function (v) { return v === true; });
  }
  function notice(title, body) {
    return choose({ title: title, body: body, buttons: [{ v: true, label: 'OK', cls: 'btn-primary' }] });
  }

  // ------------------------------------------------------------------ celebrations + welcome-home recap

  function maybeCelebrate() {
    if (!state.setupDone || ui.screen === 'setup' || layers.length) return;
    const s = summary();
    if (ui.screen === 'today' && s.recap) {
      E.act.markRecapShown(state, s.recap.key);
      save();
      if (!s.recap.empty) { showRecap(s.recap); return; }
    }
    const m = s.newMilestones && s.newMilestones[0];
    if (!m) return;
    E.act.markCelebrated(state, [m.key], today());
    save();
    openLayer('<div class="celebrate flashcard"><span class="lbl">Milestone</span>' +
      '<h2>' + esc(m.title) + '</h2><p>' + esc(m.message) + '</p>' +
      '<button type="button" class="btn btn-primary" data-la="close">Keep going</button></div>',
    { center: true, focus: 'box', cls: 'is-flash', onClose: function () { render(); } });
    V.flash();
  }

  function recapStats(r) {
    const stats = [];
    if (r.debtPaid > 0) stats.push('<div class="recap-stat"><span>Debt paid</span><b class="is-green">' + esc(money(r.debtPaid)) + '</b></div>');
    if (r.saved > 0) stats.push('<div class="recap-stat"><span>Saved</span><b class="is-green">' + esc(money(r.saved)) + '</b></div>');
    if (!stats.length) return r.paydays > 0 ? '<p class="recap-list" style="margin-top:14px">You kept your bills covered. That counts.</p>' : '<div style="height:14px"></div>';
    return '<div class="recap-stats' + (stats.length === 1 ? ' one' : '') + '">' + stats.join('') + '</div>';
  }

  // "Spent: $1,240 — top: Uber Eats $310 (9×), Shell $180"
  function recapSpentHTML(r) {
    const sp = r.spent;
    if (!sp || !(sp.count > 0)) return '';
    const top = sp.byPlace.slice(0, 2).map(function (x) {
      return esc(x.where) + ' ' + esc(money(x.total)) + (x.count > 1 ? ' (' + x.count + '×)' : '');
    }).join(', ');
    return '<p class="recap-list">Spent: <b>' + esc(money(sp.total)) + '</b>' + (top ? ' — top: ' + top : '') + '</p>' +
      (r.compare && r.compare.text ? '<p class="recap-list recap-compare">' + esc(r.compare.text) + '</p>' : '');
  }

  function showRecap(r) {
    const home = r.where === 'home';   // a home stretch just ended: back out to sea
    const paid = r.paidOff && r.paidOff.length
      ? '<p class="recap-list">Paid off: <b class="is-green">' + esc(r.paidOff.join(', ')) + '</b></p>' : '';
    const steps = r.total > 0 ? '<p class="recap-list">✓ You ticked ' + r.ticked + ' of ' + plural(r.total, 'step') +
      ' on ' + plural(r.paydays, 'payday') + '.</p>' : '';
    openLayer('<div class="celebrate recap"><span class="lbl">Recap · ' + (home ? 'Home stretch' : 'Boat stretch') + ' · <span class="nowrap">' + esc(D.fmtRange(r.start, r.end)) + '</span></span>' +
      '<h2>' + esc(r.title || (home ? 'Back out to sea' : 'Welcome home!')) + '</h2>' +
      '<p style="margin-bottom:0">' + (home ? 'While you were home:' : 'While you were out:') + '</p>' +
      recapStats(r) +
      paid + steps + recapSpentHTML(r) +
      '<button type="button" class="btn btn-primary" data-la="close">Nice!</button></div>',
    { center: true, focus: 'box' });
  }

  // ================================================================== SHEETS

  const BILL_CHIPS = ['Phone', 'Rent', 'Car insurance', 'Internet', 'Streaming', 'Gym'];
  const DEBT_CHIPS = ['Credit card', 'Car loan', 'Afterpay', 'Student loan', 'Personal loan'];

  // Name suggestions; hidden once the name field has text, so the fields below stay above Save.
  function chipsHTML(list, name) {
    return '<div class="name-chips"' + (name ? ' hidden' : '') + '><div class="chips" style="margin:-6px 0 18px">' + list.map(function (c) {
      return '<button type="button" class="chip" data-la="chip" data-v="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div></div>';
  }
  function syncChips(box) {
    const input = box.querySelector('[data-chip-target]');
    const chips = box.querySelector('.name-chips');
    if (input && chips) chips.hidden = !!input.value.trim();
  }
  const chipAction = function (el, entry) {
    const input = entry.box.querySelector('[data-chip-target]');
    if (input) { input.value = el.dataset.v; syncChips(entry.box); input.focus(); }
  };

  // --- bill
  function openBillSheet(id) {
    const b = state.bills.find(function (x) { return x.id === id; });
    const cur = b || { name: '', amount: null, freq: 'monthly', dueDay: 1, dueMonth: 1 };
    const yearly = cur.freq === 'yearly';
    const tid = domId('bill');
    const html = sheetHead(b ? 'Edit bill' : 'Add a bill', tid) +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">Name</span><input class="input" id="b-name" data-chip-target maxlength="40" autocapitalize="words" enterkeyhint="next" placeholder="e.g. Phone" value="' + esc(cur.name) + '"></label>' +
      chipsHTML(BILL_CHIPS, cur.name) +
      '<label class="field"><span class="field-label">Amount</span>' + moneyField('b-amt', cur.amount, { enter: 'next' }) + '</label>' +
      '<div class="field"><span class="field-label">How often</span><div class="seg" role="group" aria-label="How often">' +
      '<button type="button" data-la="freq" data-v="monthly" aria-pressed="' + !yearly + '">Monthly</button>' +
      '<button type="button" data-la="freq" data-v="yearly" aria-pressed="' + yearly + '">Yearly</button></div>' +
      '<input type="hidden" id="b-freq" value="' + (yearly ? 'yearly' : 'monthly') + '"></div>' +
      '<div class="field"><span class="field-label" id="b-due-label">' + (yearly ? 'Due every year on' : 'Day it\'s due each month') + '</span>' +
      '<div class="due-row"><select class="select" id="b-month" aria-label="Month"' + (yearly ? '' : ' hidden') + '>' + monthOptions(cur.dueMonth || 1) + '</select>' +
      '<select class="select" id="b-day" aria-label="Day">' + dayOptions(cur.dueDay || 1) + '</select></div>' +
      '<span class="field-help" id="b-help">' + (yearly ? 'We\'ll set a little aside each payday, so it\'s ready when it\'s due.' : '') + '</span></div>' +
      '<div class="sheet-actions' + (b ? ' has-del' : '') + '"><button type="submit" class="btn btn-primary">' + 'Save' + '</button>' +
      (b ? '<button type="button" class="btn btn-danger btn-del" data-la="del" aria-label="Delete this bill">Delete</button>' : '') + '</div></form>';
    openLayer(html, {
      actions: {
        chip: chipAction,
        freq: function (el, entry) {
          const y = el.dataset.v === 'yearly';
          entry.box.querySelectorAll('[data-la="freq"]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === el)); });
          $('b-freq').value = y ? 'yearly' : 'monthly';
          $('b-month').hidden = !y;
          $('b-due-label').textContent = y ? 'Due every year on' : 'Day it\'s due each month';
          $('b-help').textContent = y ? 'We\'ll set a little aside each payday, so it\'s ready when it\'s due.' : '';
        },
        del: function (el, entry) {
          confirmBox('Delete ' + b.name + '?', 'It won\'t be counted on future paydays.', 'Delete bill', 'Keep it', true).then(function (yes) {
            if (!yes) return;
            state.bills = state.bills.filter(function (x) { return x.id !== b.id; });
            save(); closeLayer(entry); render(); toast('Bill deleted.');
          });
        },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const name = $('b-name').value.trim();
        const amt = parseMoney($('b-amt').value);
        if (!name) { setError('b-name', 'Give it a name, like "Phone".'); return; }
        if (!(amt > 0)) { setError('b-amt', 'How much is it? Try something like 80.'); return; }
        const freq = $('b-freq').value === 'yearly' ? 'yearly' : 'monthly';
        const data = { name: name, amount: amt, freq: freq, dueDay: parseInt($('b-day').value, 10) || 1, dueMonth: freq === 'yearly' ? (parseInt($('b-month').value, 10) || 1) : null };
        if (b) Object.assign(b, data);
        else state.bills.push(Object.assign({ id: E.uid() }, data));
        save(); closeLayer(entry); render();
        toast(b ? 'Saved.' : name + ' added.');
      },
    });
  }

  // --- debt
  function openDebtSheet(id) {
    const d = state.debts.find(function (x) { return x.id === id; });
    const est = d ? (summary().balances.debts[d.id] || { balance: d.balance }).balance : null;
    const cur = d || { name: '', balance: null, minPayment: null, dueDay: null, rate: null };
    const tid = domId('debt');
    const html = sheetHead(d ? 'Edit debt' : 'Add a debt', tid) +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">Name</span><input class="input" id="d-name" data-chip-target maxlength="40" autocapitalize="words" enterkeyhint="next" placeholder="e.g. Visa" value="' + esc(cur.name) + '"></label>' +
      (d ? '' : chipsHTML(DEBT_CHIPS, cur.name)) +
      '<label class="field"><span class="field-label">How much is left' + (d && state.setupDone ? ' (today)' : '') + '</span>' + moneyField('d-bal', d ? est : null, { enter: 'next' }) +
      (d && state.setupDone ? '<span class="field-help">Change it if your bank says something different.</span>' : '') + '</label>' +
      '<label class="field"><span class="field-label">Smallest monthly payment</span>' + moneyField('d-min', cur.minPayment, { enter: 'next' }) + '</label>' +
      '<div class="two">' +
      '<label class="field"><span class="field-label">Day it\'s due</span><select class="select" id="d-due">' + dayOptions(cur.dueDay, true) + '</select></label>' +
      '<label class="field"><span class="field-label">Interest rate %</span><input class="input" id="d-rate" type="text" inputmode="decimal" autocomplete="off" placeholder="Not sure" value="' + esc(cur.rate == null ? '' : String(cur.rate)) + '"></label>' +
      '</div><p class="field-help" style="margin-top:-8px;margin-bottom:18px">Not sure of the day or rate? Leave them — that\'s fine.</p>' +
      '<div class="sheet-actions' + (d ? ' has-del' : '') + '"><button type="submit" class="btn btn-primary">' + 'Save' + '</button>' +
      (d ? '<button type="button" class="btn btn-danger btn-del" data-la="del" aria-label="Delete this debt">Delete</button>' : '') + '</div></form>';
    openLayer(html, {
      actions: {
        chip: chipAction,
        del: function (el, entry) {
          confirmBox('Delete ' + d.name + '?', 'This removes it and its progress from Harbor. If you paid it off, keep it — it shows as a win on your voyage.', 'Delete debt', 'Keep it', true).then(function (yes) {
            if (!yes) return;
            state.debts = state.debts.filter(function (x) { return x.id !== d.id; });
            save(); closeLayer(entry); render(); toast('Debt deleted.');
          });
        },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const name = $('d-name').value.trim();
        const bal = parseMoney($('d-bal').value);
        const min = parseMoney($('d-min').value);
        const rateRaw = $('d-rate').value.replace('%', '').trim();
        const rate = rateRaw === '' ? null : parseMoney(rateRaw);
        if (!name) { setError('d-name', 'Give it a name, like "Visa".'); return; }
        if (bal === null || Number.isNaN(bal) || (!d && !(bal > 0))) { setError('d-bal', 'How much is left on it? Try something like 1200.'); return; }
        if (Number.isNaN(min)) { setError('d-min', 'That doesn\'t look like an amount.'); return; }
        if (rate !== null && (Number.isNaN(rate) || rate > 100)) { setError('d-rate', 'Type just the number, like 24.99 — or leave it empty.'); return; }
        const dueVal = $('d-due').value;
        const fields = { name: name, minPayment: min || 0, dueDay: dueVal ? parseInt(dueVal, 10) : null, rate: rate };
        if (d) {
          const termsChanged = fields.minPayment !== d.minPayment || fields.rate !== d.rate || fields.dueDay !== d.dueDay;
          const untouched = !state.paydays.length && !state.checkins.some(function (c) { return c.debts && c.debts[d.id] != null; });
          const balChanged = Math.abs(bal - est) >= 0.005;
          Object.assign(d, fields);
          if (untouched) { if (balChanged) { d.balance = bal; d.asOf = today(); } }
          else if (balChanged) E.act.setDebtBalance(state, d.id, bal, now());
          // New terms apply from today only: pin today's balance so past months aren't rebuilt with them.
          else if (termsChanged) E.act.setDebtBalance(state, d.id, est, now());
        } else {
          state.debts.push(Object.assign({ id: E.uid(), balance: bal, asOf: today() }, fields));
        }
        save(); closeLayer(entry); render();
        toast(d ? 'Saved.' : name + ' added.');
      },
    });
  }

  // --- rotation (banner tap / settings)
  function openRotationSheet() {
    const v = state.settings.boatDate || '';
    const html = sheetHead('Did your schedule change?', domId('rot')) +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">Next day you get on the boat, or the day you got on</span>' +
      '<input class="input" type="date" id="r-date" value="' + esc(v) + '" data-live="boatPreview" data-preview="r-preview" data-list="r-list"></label>' +
      '<div class="preview" id="r-preview" aria-live="polite">' + esc(rotationPreview(v)) + '</div>' +
      '<ul class="stretches" id="r-list" aria-label="Your next stretches">' + stretchesHTML(v) + '</ul>' +
      '<p class="small-note">Rotation length (' + state.settings.onDays + '/' + state.settings.offDays + ') is in Settings.</p>' +
      '<div class="sheet-actions" style="margin-top:18px"><button type="submit" class="btn btn-primary">Save</button></div></form>';
    openLayer(html, {
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const val = $('r-date').value;
        if (!D.isValid(val)) { setError('r-date', 'Pick a date.'); return; }
        E.act.setBoatDate(state, val, today());
        const msg = replanAfterRotation();
        save(); closeLayer(entry); render();
        toast(msg);
      },
    });
  }

  // After a schedule change: re-plan the open payday (if none of its money moves are ticked yet),
  // so its spending money matches the new home/boat days. Returns the toast to show.
  function replanAfterRotation() {
    const latest = state.paydays[state.paydays.length - 1];
    if (!latest || !(latest.nextDate > today())) return 'Got it. Everything\'s lined up.';
    const moved = (latest.plan.items || []).some(function (it) {
      return (it.kind === 'spend' || it.kind === 'debt' || it.kind === 'save') && latest.ticks && latest.ticks[it.key];
    });
    if (moved) return 'Updated. Your next payday will use the new dates.';
    const spendOf = function (pd) {
      const it = (pd.plan.items || []).find(function (x) { return x.kind === 'spend'; });
      return it ? it.amount : 0;
    };
    const oldSpend = spendOf(latest);
    try {
      E.act.editPayday(state, latest.id, { date: latest.date, amount: latest.amount, nextDate: latest.nextDate }, now(), { money: money });
    } catch (e) { return 'Got it. Everything\'s lined up.'; }
    const newSpend = spendOf(latest);
    if (Math.abs(newSpend - oldSpend) >= 0.005) return 'Got it. Your spending money for this payday is now ' + money(newSpend) + '.';
    return 'Got it. Everything\'s lined up.';
  }

  function openRotLenSheet() {
    const s = state.settings;
    const html = sheetHead('Rotation length', domId('rl')) +
      '<p class="sheet-lead">Only change this if your rotation changes.</p>' +
      '<form data-lsubmit novalidate autocomplete="off"><div class="two">' +
      '<label class="field"><span class="field-label">Days on the boat</span><input class="input" id="rl-on" type="text" inputmode="numeric" pattern="[0-9]*" value="' + s.onDays + '"></label>' +
      '<label class="field"><span class="field-label">Days at home</span><input class="input" id="rl-off" type="text" inputmode="numeric" pattern="[0-9]*" value="' + s.offDays + '"></label>' +
      '</div><div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button></div></form>';
    openLayer(html, {
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const on = parseInt($('rl-on').value, 10), off = parseInt($('rl-off').value, 10);
        if (!(on >= 1 && on <= 365)) { setError('rl-on', 'Pick a number from 1 to 365.'); return; }
        if (!(off >= 1 && off <= 365)) { setError('rl-off', 'Pick a number from 1 to 365.'); return; }
        // Keep the same daily spending rate when a stretch gets longer or shorter.
        const oldOn = s.onDays, oldOff = s.offDays;
        if (s.homeSpend != null && off !== oldOff) s.homeSpend = E.roundTo(s.homeSpend * off / oldOff, 10);
        if (s.boatSpend != null && on !== oldOn) s.boatSpend = E.roundTo(s.boatSpend * on / oldOn, 10);
        s.onDays = on; s.offDays = off;
        const msg = replanAfterRotation();
        save(); closeLayer(entry); render(); toast(msg);
      },
    });
  }

  // --- single money value sheets (paycheck, savings, cushion)
  function openMoneySheet(o) {
    const html = sheetHead(o.title, domId('m')) + (o.lead ? '<p class="sheet-lead">' + esc(o.lead) + '</p>' : '') +
      '<form data-lsubmit novalidate autocomplete="off"><label class="field"><span class="field-label">' + esc(o.label) + '</span>' +
      moneyField('m-val', o.value, { big: true, placeholder: o.placeholder }) + (o.help ? '<span class="field-help">' + esc(o.help) + '</span>' : '') + '</label>' +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button>' +
      (o.skip ? '<button type="button" class="btn btn-text" data-la="skip">' + esc(o.skip) + '</button>' : '') +
      (o.more ? '<button type="button" class="btn btn-text" data-la="more">' + esc(o.more.label) + '</button>' : '') + '</div></form>';
    openLayer(html, {
      actions: {
        skip: function (el, entry) { closeLayer(entry); },
        more: function (el, entry) { closeLayer(entry); o.more.fn(); },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const n = parseMoney($('m-val').value);
        if (n === null && o.allowEmpty) { o.save(null); save(); closeLayer(entry); render(); toast('Saved.'); return; }
        if (n === null || Number.isNaN(n) || n < 0 || (o.positive && !(n > 0))) { setError('m-val', 'That doesn\'t look like an amount. Try something like ' + (o.example || '1000') + '.'); return; }
        o.save(n); save(); closeLayer(entry); render(); toast('Saved.');
      },
    });
  }

  function openFreqSheet() {
    openLayer(sheetHead('How often do you get paid?', domId('fq')) + freqChoicesHTML('pickFreqSheet'), {
      actions: {
        pickFreqSheet: function (el, entry) {
          state.settings.payFreq = el.dataset.v;
          save(); closeLayer(entry); render(); toast('Saved.');
        },
      },
    });
  }

  function openCurrencySheet() {
    const renderIt = function () {
      const other = ui.otherCur || state.settings.currency === 'XXX';
      return sheetHead('Currency', 'cur-t') + currencyChoicesHTML('pickCurrencySheet') +
        (other ? '<form data-lsubmit novalidate autocomplete="off">' + symbolFieldHTML() +
          '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button></div></form>' : '');
    };
    openLayer(renderIt(), {
      render: renderIt,
      onClose: function () { ui.otherCur = false; },
      actions: {
        pickCurrencySheet: function (el, entry) {
          if (el.dataset.v === 'XXX') {
            ui.otherCur = true;
            refreshLayers();
            const f = $('f-sym'); if (f) f.focus();
            return;
          }
          state.settings.currency = el.dataset.v;
          state.settings.currencySymbol = null;
          ui.otherCur = false;
          save(); closeLayer(entry); render(); toast('Saved.');
        },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const v = $('f-sym').value.trim();
        if (!v) { setError('f-sym', 'Type your money symbol, like R or ₱.'); return; }
        state.settings.currency = 'XXX'; state.settings.currencySymbol = v;
        save(); closeLayer(entry); render(); toast('Saved.');
      },
    });
  }

  function openSpendingSheet() {
    const s = state.settings;
    const sug = E.suggestSpending(state, { today: today() });
    const html = sheetHead('Spending money', domId('sp')) +
      '<p class="sheet-lead">For everything that isn\'t a bill: groceries, gas, going out, shopping.</p>' +
      '<form data-lsubmit novalidate autocomplete="off">' +
      '<label class="field"><span class="field-label">Home stretch (' + s.offDays + ' days)</span>' + moneyField('sp-home', s.homeSpend, { placeholder: sug.ok ? numStr(sug.home) : '0', enter: 'next' }) + '</label>' +
      '<label class="field"><span class="field-label">Boat stretch (' + s.onDays + ' days)</span>' + moneyField('sp-boat', s.boatSpend, { placeholder: sug.ok ? numStr(sug.boat) : '0' }) + '</label>' +
      (sug.ok ? '<button type="button" class="btn btn-soft" data-la="suggest" style="margin-bottom:10px">Suggest for me</button>'
        : '<p class="field-help" style="margin-bottom:14px">' + (s.payAmount > 0 ? 'On paper your bills use up your paycheck. Set what you really need — we\'ll work with it.' : 'Add your normal paycheck and we can suggest amounts.') + '</p>') +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button></div></form>';
    openLayer(html, {
      actions: {
        suggest: function () {
          $('sp-home').value = numStr(sug.home);
          $('sp-boat').value = numStr(sug.boat);
        },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const h = parseMoney($('sp-home').value), b = parseMoney($('sp-boat').value);
        if (Number.isNaN(h)) { setError('sp-home', 'That doesn\'t look like an amount.'); return; }
        if (Number.isNaN(b)) { setError('sp-boat', 'That doesn\'t look like an amount.'); return; }
        s.homeSpend = h; s.boatSpend = b;
        save(); closeLayer(entry); render(); toast('Saved.');
      },
    });
  }

  function openMonthsSheet() {
    let opts = '';
    for (let m = 1; m <= 12; m++) opts += '<option value="' + m + '"' + (m === state.settings.safetyMonths ? ' selected' : '') + '>' + plural(m, 'month') + '</option>';
    const html = sheetHead('Full safety net', domId('mo')) +
      '<p class="sheet-lead">Once you\'re debt-free, savings grow until they cover this many months of bills and spending.</p>' +
      '<form data-lsubmit novalidate><label class="field"><span class="field-label">How many months?</span><select class="select" id="mo-val">' + opts + '</select></label>' +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button>' +
      (o.skip ? '<button type="button" class="btn btn-text" data-la="skip">' + esc(o.skip) + '</button>' : '') + '</div></form>';
    openLayer(html, {
      actions: { skip: function (el, entry) { closeLayer(entry); } },
      onSubmit: function (form, entry) {
        state.settings.safetyMonths = parseInt($('mo-val').value, 10) || 3;
        save(); closeLayer(entry); render(); toast('Saved.');
      },
    });
  }

  // --- monthly check-in (§6.6)
  function openCheckinSheet() {
    const s = summary();
    const open = s.debts.filter(function (d) { return d.open; });
    let fields = '';
    open.forEach(function (d) {
      fields += '<label class="field"><span class="field-label">' + esc(d.name) + '</span>' +
        moneyField('ci-' + d.id, null, { placeholder: 'We think ' + E.round2(d.balance).toLocaleString('en-US'), enter: 'next' }) + '</label>';
    });
    fields += '<label class="field"><span class="field-label">Savings</span>' +
      moneyField('ci-savings', null, { placeholder: 'We think ' + E.round2(s.savings).toLocaleString('en-US'), enter: 'next' }) + '</label>';
    // Checking, the spending card (= what's left to spend) and the user's own accounts.
    const accts = s.accounts.filter(function (a) { return a.id !== 'savings'; });
    accts.forEach(function (a) {
      const label = a.kind === 'spending' ? a.name + ' — what\'s left' : a.name;
      const guess = a.balance == null ? '' : 'We think ' + E.round2(a.kind === 'spending' ? Math.max(0, a.balance) : a.balance).toLocaleString('en-US');
      fields += '<label class="field"><span class="field-label">' + esc(label) + '</span>' +
        moneyField('ci-acct-' + a.id, null, { placeholder: guess }) + '</label>';
    });
    // Undone debt/savings steps from the latest payday: tick them first, so a real balance isn't counted twice.
    const latest = state.paydays[state.paydays.length - 1];
    const pending = latest ? (latest.plan.items || []).filter(function (it) {
      return it.amount > 0 && (it.kind === 'debt' || it.kind === 'save') && !(latest.ticks && latest.ticks[it.key]);
    }) : [];
    let pend = '';
    if (pending.length) {
      pend = '<div class="field ci-pending"><span class="field-label">Did you already do any of these?</span>' +
        '<span class="field-help" style="margin:-4px 2px 10px">Tick them first so we don\'t count them twice.</span>' +
        pending.map(function (it, i) {
          const cid = 'ci-step-' + i;
          return '<label class="check-row" for="' + cid + '"><input type="checkbox" id="' + cid + '" name="step:' + esc(it.key) + '" data-key="' + esc(it.key) + '">' +
            '<span>' + esc(it.label) + '</span></label>';
        }).join('') + '</div>';
    }
    const html = sheetHead('Quick check-in (30 seconds)', domId('ci')) +
      '<p class="sheet-lead">Open your bank apps and type what they say. Skip any you\'re not sure of.</p>' +
      '<form data-lsubmit novalidate autocomplete="off">' + pend + fields +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button>' +
      '<button type="button" class="btn btn-text" data-la="later">Not now</button></div></form>';
    openLayer(html, {
      actions: {
        later: function (el, entry) {
          E.act.snoozeCheckin(state, today(), 30);
          save(); closeLayer(entry); render();
        },
      },
      onSubmit: function (form, entry) {
        clearErrors(entry.box);
        const debts = {};
        let bad = null, any = false;
        open.forEach(function (d) {
          const n = parseMoney($('ci-' + d.id).value);
          if (n === null) return;
          if (Number.isNaN(n) || n < 0) { bad = bad || 'ci-' + d.id; return; }
          debts[d.id] = n; any = true;
        });
        const sv = parseMoney($('ci-savings').value);
        if (Number.isNaN(sv)) bad = bad || 'ci-savings';
        const accounts = {};
        accts.forEach(function (a) {
          const el = $('ci-acct-' + a.id);
          const n = el ? parseSigned(el.value, a.kind !== 'spending') : null;
          if (n === null) return;
          if (Number.isNaN(n)) { bad = bad || 'ci-acct-' + a.id; return; }
          accounts[a.id] = n; any = true;
        });
        if (bad) { setError(bad, 'That doesn\'t look like an amount.'); return; }
        if (sv !== null) any = true;
        const n = now();
        const ticked = [];
        entry.box.querySelectorAll('.ci-pending input[type=checkbox]').forEach(function (cb) {
          if (cb.checked) ticked.push(cb.dataset.key);
        });
        ticked.forEach(function (key) { E.act.tick(state, latest.id, key, true, n); });
        if (!any) {
          if (ticked.length) { save(); closeLayer(entry); render(); toast('Saved.'); return; }
          E.act.snoozeCheckin(state, today(), 30);
          save(); closeLayer(entry); render();
          return;
        }
        E.act.addCheckin(state, { debts: debts, savings: sv, accounts: accounts }, n);
        save(); closeLayer(entry); render();
        toast('Thanks! Your numbers are up to date.');
      },
    });
  }

  // --- logbook payday
  function openLogSheet(id) {
    const renderIt = function () {
      const pd = state.paydays.find(function (p) { return p.id === id; });
      if (!pd) return null;
      const isLatest = state.paydays[state.paydays.length - 1] === pd;
      const c = doneCount(pd);
      return sheetHead('Payday · ' + fdate(pd.date), 'log-t') +
        '<p class="sheet-lead">' + esc(money(pd.amount) + ' · next payday around ' + fdate(pd.nextDate) + ' · ' + c.done + ' of ' + c.total + ' done') + '</p>' +
        V.splitBar(pd.plan, money) +
        checklistHTML(pd) +
        '<div class="sheet-actions" style="margin-top:14px">' +
        (isLatest ? '<button type="button" class="btn btn-soft" data-action="fixPayday" data-id="' + esc(pd.id) + '">Fix amount</button>' : '') +
        '<button type="button" class="btn btn-danger" data-action="undoPayday" data-id="' + esc(pd.id) + '">Undo this payday</button></div>';
    };
    openLayer(renderIt(), { render: renderIt, focus: 'box' });
  }

  // ================================================================== BACKUP + RESTORE (§8)

  function backupName() { return 'harbor-backup-' + today() + '.json'; }

  function backedUp(how) {
    E.act.markBackedUp(state, today(), now());
    save();
    render();
    toast(how === 'share' ? 'Backup saved ✓ Keep it in Files or iCloud Drive.' : 'Backup downloaded ✓ Keep it somewhere safe.');
  }

  function downloadFile(text, name) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  function backup() {
    const text = JSON.stringify(E.makeBackup(state, today()), null, 1);
    const name = backupName();
    let file = null;
    try { file = new File([text], name, { type: 'application/json' }); } catch (e) { file = null; }
    let canShare = false;
    try { canShare = !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch (e) { canShare = false; }
    if (canShare) {
      navigator.share({ files: [file], title: 'Harbor backup' }).then(function () { backedUp('share'); }).catch(function (err) {
        if (err && err.name === 'AbortError') return;   // they closed the share sheet
        notice('Backup didn\'t finish', 'Tap Back up again. Your data is still here.');
      });
      return;
    }
    downloadFile(text, name);
    backedUp('download');
  }

  function startRestore() {
    try { $file.value = ''; } catch (e) { /* ignore */ }
    $file.click();
  }

  function readFileText(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  function onRestoreFile() {
    const file = $file.files && $file.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notice('That file didn\'t work', 'That file is too big to be a Harbor backup. Your current data wasn\'t changed.');
      return;
    }
    readFileText(file).then(function (text) {
      const r = E.readBackup(text, today());
      if (!r.ok) {
        notice('That file didn\'t work', (r.error || 'That file isn\'t a Harbor backup.') + ' Your current data wasn\'t changed.');
        return;
      }
      const from = r.info.exportedAt ? 'the backup from ' + fdate(r.info.exportedAt) : 'this backup';
      const n = r.info.paydays;
      const count = n === 0 ? 'no paydays yet' : plural(n, 'payday');
      confirmBox('Replace everything?', 'Replace everything in Harbor with ' + from + ' (' + count + ')?', 'Replace', 'Cancel', false).then(function (yes) {
        if (!yes) return;
        const prev = state;
        state = r.state;
        save();
        if (ui.saveError) {
          // There's no room to keep it: put the current data back, untouched.
          state = prev;
          ui.saveError = false;
          save();
          notice('Couldn\'t restore', 'There isn\'t room to save that backup on this device. Your current data wasn\'t changed.');
          return;
        }
        loadProblem = null;
        ui.why = {}; ui.flow = null; ui.otherCur = false;
        while (layers.length) closeLayer(layers[layers.length - 1]);
        renderBanner();
        if (state.setupDone) { dropStep(); go('today'); } else { ui.setupStep = 0; render(); }
        toast('Restored ✓ Welcome back.');
      });
    }).catch(function () {
      notice('That file didn\'t work', 'It couldn\'t be opened. Your current data wasn\'t changed.');
    });
  }

  function startOver() {
    choose({
      title: 'Start over?',
      body: 'This deletes everything in Harbor on this device: your plan, paydays and progress.',
      buttons: [
        { v: 'backup', label: 'Back up first', cls: 'btn-soft' },
        { v: 'go', label: 'Delete everything', cls: 'btn-danger' },
        { v: null, label: 'Cancel', cls: 'btn-text' },
      ],
    }).then(function (v) {
      if (v === 'backup') { backup(); return; }
      if (v !== 'go') return;
      return confirmBox('Are you sure?', 'This can\'t be undone.', 'Yes, delete it all', 'Keep my data', true).then(function (yes) {
        if (!yes) return;
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        dropStep();
        state = E.newState(today());
        ui.why = {}; ui.flow = null; ui.setupStep = 0; ui.hintOpen = false;
        version++;
        render();
        window.scrollTo(0, 0);
        toast('All cleared. Let\'s start fresh.');
      });
    });
  }

  // ================================================================== ACTIONS (data-action)

  function findPayday(id) { return state.paydays.find(function (p) { return p.id === id; }); }

  function undoPayday(id) {
    confirmBox('Undo this payday?', 'Its checklist and ticks will be removed.', 'Undo payday', 'Keep it', true).then(function (yes) {
      if (!yes) return;
      E.act.undoPayday(state, id);
      Object.keys(ui.why).forEach(function (k) { if (k.indexOf(id + '|') === 0) delete ui.why[k]; });
      save();
      if (ui.screen === 'payday') { ui.flow = null; go('today'); } else render();
      toast('That payday is removed.');
    });
  }

  const A = {
    go: function (el) { go(el.dataset.to); },

    // setup
    setupBack: function () {
      const name = STEPS[ui.setupStep];
      if (COMMIT[name]) COMMIT[name](true);
      save();
      setStep(ui.setupStep - 1);
    },
    setupSkip: function () { setStep(ui.setupStep + 1); },
    setupAnyway: function () { state.meta.tips.addToHome = true; save(); setStep(1); },
    hintToggle: function () { ui.hintOpen = !ui.hintOpen; render(); },
    pickCurrency: function (el) {
      const v = el.dataset.v;
      if (v === 'XXX') {
        ui.otherCur = true;
        render();
        const f = $('f-sym'); if (f) f.focus();
        return;
      }
      state.settings.currency = v;
      state.settings.currencySymbol = null;
      save();
      setStep(ui.setupStep + 1);
    },
    pickFreq: function (el) {
      state.settings.payFreq = el.dataset.v;
      save();
      setStep(ui.setupStep + 1);
    },
    step: function (el) {
      const input = $(el.dataset.target);
      if (!input) return;
      const cur = parseMoney(input.value);
      const next = Math.max(0, (Number.isFinite(cur) ? cur : 0) + Number(el.dataset.delta));
      input.value = numStr(next);
      LIVE.spendLive(input);
    },
    addBill: function () { openBillSheet(null); },
    editBill: function (el) { openBillSheet(el.dataset.id); },
    addDebt: function () { openDebtSheet(null); },
    editDebt: function (el) { openDebtSheet(el.dataset.id); },

    // today
    rotation: function () { openRotationSheet(); },
    startPayday: function () { startPayday(); },
    tick: function (el) {
      const pd = findPayday(el.dataset.pd);
      if (!pd) return;
      const key = el.dataset.key;
      const on = !(pd.ticks && pd.ticks[key]);
      const was = E.isComplete(pd);
      E.act.tick(state, pd.id, key, on, now());
      save();
      const done = !was && E.isComplete(pd);
      render();
      if (done && ui.screen !== 'payday') toast('All done! ' + streakText(E.streak(state)));
      later(maybeCelebrate, done ? 700 : 350);
    },
    why: function (el) {
      const wk = el.dataset.wk;
      ui.why[wk] = !ui.why[wk];
      render();
    },
    fixPayday: function (el) {
      const pd = findPayday(el.dataset.id);
      if (!pd) return;
      while (layers.length) closeLayer(layers[layers.length - 1]);
      ui.flow = { step: 'B', fromA: false, editId: pd.id, pdId: pd.id, amount: pd.amount, date: pd.date, nextDate: pd.nextDate, nextTouched: true };
      go('payday');
    },
    undoPayday: function (el) {
      const id = el.dataset.id;
      undoPayday(id);
    },
    checkin: function () { openCheckinSheet(); },
    snoozeCheckin: function () { E.act.snoozeCheckin(state, today(), 30); save(); render(); },
    backup: function () { backup(); },
    safariHow: function () { openSafariSheet(); },
    safariLater: function () { ui.safariLater = true; render(); },
    snoozeBackup: function () { E.act.snoozeBackup(state, today(), 3); save(); render(); toast('Okay — I\'ll remind you in a few days.'); },
    dismissLoad: function () { loadProblem = null; renderBanner(); },

    // payday flow
    flowClose: function () {
      // The spending-card tip is a one-time suggestion: once it has been shown on a plan, don't repeat it.
      const f = ui.flow;
      const pd = f && f.step === 'C' && findPayday(f.pdId);
      if (pd && !state.meta.tips.spendingCard &&
          (pd.plan.items || []).some(function (it) { return it.kind === 'spend' && it.amount > 0; })) {
        state.meta.tips.spendingCard = true;
        save();
      }
      ui.flow = null; go('today');
    },
    flowBack: function () { if (ui.flow) { ui.flow.step = 'A'; render(); window.scrollTo(0, 0); } },
    flowContinue: function () { ui.flow.step = 'B'; ui.flow.fromA = true; render(); window.scrollTo(0, 0); const a = $('p-amt'); if (a) a.focus(); },
    fillUsual: function () { const a = $('p-amt'); if (a) { a.value = numStr(state.settings.payAmount); a.focus(); } },
    tipDone: function () { state.meta.tips.spendingCard = true; save(); render(); },

    // money
    logPurchase: function () { openPurchaseSheet(null); },
    editPurchase: function (el) { openPurchaseSheet({ id: el.dataset.id }); },
    afford: function () { openAffordSheet(); },
    allBuys: function () { ui.allBuys = true; render(); },
    account: function (el) { openAccountSheet(el.dataset.id); },
    addAccount: function () { openAddAccountSheet(); },
    owe: function (el) { openOweSheet(el.dataset.id); },

    // voyage
    logOpen: function (el) { openLogSheet(el.dataset.id); },

    // settings
    rotLen: function () { openRotLenSheet(); },
    editPay: function () {
      openMoneySheet({ title: 'Normal paycheck', label: 'A normal paycheck', value: state.settings.payAmount, help: 'Just a normal one — it\'s fine if it changes.', example: '2000', positive: true,
        save: function (n) { state.settings.payAmount = n; } });
    },
    editFreq: function () { openFreqSheet(); },
    editSavings: function () {
      openMoneySheet({ title: 'Savings', label: 'What\'s in savings now', value: summary().savings, example: '500',
        save: function (n) {
          if (!state.paydays.length && !state.checkins.length) state.savings = { amount: n, asOf: today() };
          else E.act.setSavings(state, n, now());
        } });
    },
    editSpending: function () { openSpendingSheet(); },
    editCushion: function () {
      openMoneySheet({ title: 'Starter cushion', label: 'Starter cushion', lead: 'A small emergency fund you build first, so a surprise doesn\'t land back on a credit card.', value: state.settings.cushion, example: '1000',
        save: function (n) { state.settings.cushion = n; } });
    },
    editMonths: function () { openMonthsSheet(); },
    editCurrency: function () { openCurrencySheet(); },
    method: function (el) {
      state.settings.method = el.dataset.v === 'interest' ? 'interest' : 'quick';
      save(); render();
    },
    restore: function () { startRestore(); },
    startOver: function () { startOver(); },
  };

  // Live input handlers (data-live), fired on every keystroke / change.
  const LIVE = {
    boatPreview: function (el) {
      const p = el.dataset.preview && $(el.dataset.preview);
      if (p) p.textContent = rotationPreview(el.value);
      const l = el.dataset.list && $(el.dataset.list);
      if (l) l.innerHTML = stretchesHTML(el.value);
    },
    spendLive: function (el) {
      const sub = $(el.id + '-sub');
      if (sub) sub.textContent = perDayText(parseMoney(el.value), Number(el.dataset.days) || 1);
      const note = $('spend-note');
      if (note) {
        const h = parseMoney($('f-home') && $('f-home').value), b = parseMoney($('f-boatspend') && $('f-boatspend').value);
        note.innerHTML = spendNoteHTML(Number.isFinite(h) ? h : 0, Number.isFinite(b) ? b : 0);
      }
    },
    payDate: function (el) {
      const f = ui.flow;
      if (!f || !D.isValid(el.value)) return;
      f.date = el.value;
      const next = $('p-next');
      if (next) {
        next.min = D.addDays(el.value, 1);
        if (!f.nextTouched) { f.nextDate = E.pay.guessNext(state.settings, el.value); next.value = f.nextDate; }
      }
    },
    payNext: function (el) { if (ui.flow) { ui.flow.nextTouched = true; ui.flow.nextDate = el.value; } },
    share: function (el) {
      const share = 1 - Number(el.value) / 10;
      const t = shareText(share);
      const out = $('share-value'); if (out) out.textContent = t;
      el.setAttribute('aria-valuetext', t);
    },
  };

  // Change handlers (data-change): fire when a control is let go.
  const CHANGE = {
    shareSave: function (el) {
      state.settings.debtShare = Math.round((1 - Number(el.value) / 10) * 10) / 10;
      save();
      toast(shareText(state.settings.debtShare));
    },
  };

  // Form submits (data-submit).
  const SUBMIT = {
    setupNext: function () { setupNext(); },
    paydayGo: function () {
      const f = ui.flow;
      if (!f) return;
      clearErrors($app);
      const amtEl = $('p-amt');
      f.amount = amtEl.value;
      const amount = parseMoney(amtEl.value);
      const date = $('p-date').value;
      let next = $('p-next').value;
      if (amount === null) { setError('p-amt', 'Type the amount that hit your bank.'); return; }
      if (!(amount > 0)) { setError('p-amt', 'That doesn\'t look like an amount. Try something like 2000.'); return; }
      if (!D.isValid(date)) { setError('p-date', 'Pick the day you got paid.'); return; }
      const max = $('p-date').max;
      if (max && date > max) { setError('p-date', 'That day hasn\'t happened yet — pick today or earlier.'); return; }
      if (!D.isValid(next)) next = E.pay.guessNext(state.settings, date);
      if (next <= date) { setError('p-next', 'Your next payday needs to be after this one.'); return; }
      try {
        if (f.editId) {
          E.act.editPayday(state, f.editId, { date: date, amount: amount, nextDate: next }, now(), { money: money });
          f.pdId = f.editId;
        } else {
          const pd = E.act.addPayday(state, { date: date, amount: amount, nextDate: next }, now(), { money: money });
          f.pdId = pd.id;
        }
      } catch (err) {
        setError('p-amt', (err && err.message) || 'Something didn\'t work. Try again.');
        return;
      }
      save();
      f.step = 'C';
      render();
      window.scrollTo(0, 0);
    },
  };

  // ================================================================== EVENTS

  document.addEventListener('click', function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    // Layer-local actions first (sheets, dialogs).
    const la = t.closest('[data-la]');
    if (la) {
      const layerEl = la.closest('.layer');
      const entry = layers.find(function (l) { return l.el === layerEl; });
      if (entry) {
        ev.preventDefault();
        const name = la.dataset.la;
        if (name === 'close') closeLayer(entry);
        else if (entry.o.actions && entry.o.actions[name]) entry.o.actions[name](la, entry);
        return;
      }
    }
    // Backdrop tap closes the top layer.
    if (t.classList.contains('layer')) {
      const entry = topLayer();
      if (entry && entry.el === t && entry.o.dismiss !== false) closeLayer(entry);
      return;
    }
    const el = t.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = A[el.dataset.action];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });

  document.addEventListener('submit', function (ev) {
    const form = ev.target;
    ev.preventDefault();
    if (form.hasAttribute('data-lsubmit')) {
      const entry = layers.find(function (l) { return l.el.contains(form); });
      if (entry && entry.o.onSubmit) entry.o.onSubmit(form, entry);
      return;
    }
    const fn = SUBMIT[form.dataset.submit];
    if (fn) fn(form);
  });

  document.addEventListener('input', function (ev) {
    const el = ev.target;
    if (!(el instanceof Element)) return;
    if (el.hasAttribute('aria-invalid')) {
      el.removeAttribute('aria-invalid');
      const field = el.closest('.field');
      const err = field && field.querySelector('.field-error');
      if (err) err.remove();
    }
    if (el.hasAttribute('data-chip-target')) { const box = el.closest('.sheet'); if (box) syncChips(box); }
    const fn = el.dataset && LIVE[el.dataset.live];
    if (fn) fn(el);
  });

  document.addEventListener('change', function (ev) {
    const el = ev.target;
    if (!(el instanceof Element)) return;
    if (el.dataset && LIVE[el.dataset.live] && el.type === 'date') LIVE[el.dataset.live](el);
    const fn = el.dataset && CHANGE[el.dataset.change];
    if (fn) fn(el);
  });

  document.addEventListener('keydown', function (ev) {
    const top = topLayer();
    if (ev.key === 'Escape' && top) {
      ev.preventDefault();
      if (top.o.dismiss !== false) closeLayer(top);
      return;
    }
    if (ev.key === 'Tab' && top) {
      // Keep focus inside the open sheet.
      const f = Array.prototype.filter.call(top.box.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; });
      if (!f.length) { ev.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && (document.activeElement === first || document.activeElement === top.box)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target instanceof Element && ev.target.getAttribute('role') === 'button' && ev.target.dataset.action) {
      ev.preventDefault();
      ev.target.click();
    }
  });

  $file.addEventListener('change', onRestoreFile);

  // Keep sheets above the on-screen keyboard (iOS): size layers to the visual viewport.
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const syncVV = function () {
      root.style.setProperty('--vv-h', vv.height + 'px');
      root.style.setProperty('--vv-top', vv.offsetTop + 'px');
    };
    vv.addEventListener('resize', syncVV);
    vv.addEventListener('scroll', syncVV);
    syncVV();
  }

  let resizeTimer = 0;
  // LIVE / OFFLINE in the header.
  window.addEventListener('online', function () { if (!layers.length && ui.screen !== 'setup') render(); });
  window.addEventListener('offline', function () { if (!layers.length && ui.screen !== 'setup') render(); });
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (ui.screen === 'voyage') fillChart(); }, 150);
  });

  // A new day while the app sat open: refresh everything.
  let shownDay = today();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (today() !== shownDay) {
      shownDay = today();
      render();
      later(maybeCelebrate, 300);
    }
  });

  // Another tab/window changed the data: reload it (keeps two Safari tabs from fighting).
  window.addEventListener('storage', function (ev) {
    if (ev.key !== KEY || !ev.newValue) return;
    try {
      const r = E.normalizeState(JSON.parse(ev.newValue), today());
      if (r.ok) { state = r.state; version++; render(); }
    } catch (e) { /* ignore */ }
  });

  // ================================================================== START

  if (!state.setupDone) {
    ui.screen = 'setup';
    ui.setupStep = getStep();
  } else {
    ui.screen = 'today';
    askPersist();
  }
  renderBanner();
  render();
  later(maybeCelebrate, 400);

  // Tiny hook for automated tests and debugging (read-only use).
  window.Harbor = { get state() { return state; }, today: today, money: money, parseMoney: parseMoney };
})();

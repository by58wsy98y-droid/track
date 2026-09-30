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
    $app.innerHTML = '<div class="boot"><p class="boot-title">⚓ Harbor</p>' +
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
  };

  // ------------------------------------------------------------------ icons

  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5L12 3.8l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z"/></svg>',
    voyage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/></svg>',
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
    if (st.where === 'boat') return '🚢 So today is day ' + st.day + ' of ' + st.of + ' — home ' + when + '.';
    if (st.day) return '🏠 So today is day ' + st.day + ' of ' + st.of + ' at home — back out ' + when + '.';
    return '🏠 So you\'re home for now — back out ' + when + '.';
  }

  function bannerText(st) {
    if (!st) return '⚓ Tap to add your boat date';
    if (st.where === 'boat') {
      const left = st.daysLeft <= 0 ? 'home today' : st.daysLeft === 1 ? 'home tomorrow' : 'home in ' + st.daysLeft + ' days';
      return '🚢 Day ' + st.day + ' of ' + st.of + ' · ' + left;
    }
    const back = 'back out ' + (st.daysLeft === 1 ? 'tomorrow' : D.fmtShort(st.changeDate));
    if (st.day) return '🏠 Day ' + st.day + ' of ' + st.of + ' · ' + back;
    return '🏠 Home · ' + back;
  }

  function stretchesHTML(iso) {
    if (!D.isValid(iso)) return '';
    const s = Object.assign({}, state.settings, { boatDate: iso });
    const list = E.rotation.upcoming(s, today(), 4);
    return list.map(function (x, i) {
      const days = D.diffDays(x.start, x.end) + 1;
      return '<li class="' + (i === 0 ? 'is-now' : '') + '"><span aria-hidden="true">' + (x.where === 'boat' ? '🚢' : '🏠') + '</span>' +
        '<span>' + esc(D.fmtRange(x.start, x.end)) + (i === 0 ? '<span class="sr-only"> (now)</span>' : '') + '</span>' +
        '<span class="len">' + plural(days, 'day') + (x.where === 'boat' ? ' on' : ' home') + '</span></li>';
    }).join('');
  }

  // ------------------------------------------------------------------ checklist (Today, payday flow, logbook)

  function checklistHTML(pd) {
    const items = (pd.plan.items || []).filter(function (it) { return it.amount > 0; });
    if (!items.length) return '<p class="muted">Nothing to do for this one.</p>';
    return '<ul class="checklist">' + items.map(function (it) {
      const on = !!(pd.ticks && pd.ticks[it.key]);
      const wk = pd.id + '|' + it.key;
      const open = !!ui.why[wk];
      const whyId = 'why-' + pd.id + '-' + it.key.replace(/[^\w-]/g, '_');
      return '<li class="item"><div class="item-row">' +
        '<button type="button" class="tick" role="checkbox" aria-checked="' + on + '" data-action="tick" data-pd="' + esc(pd.id) +
        '" data-key="' + esc(it.key) + '" data-fk="t:' + esc(wk) + '">' +
        '<span class="box">' + ICON.check + '</span>' +
        '<span class="item-text"><span class="item-label">' + esc(it.label) + '</span>' +
        (it.sub ? '<span class="item-sub">' + esc(it.sub) + '</span>' : '') + '</span></button>' +
        '<button type="button" class="why-btn" aria-expanded="' + open + '" aria-controls="' + whyId + '" data-action="why" data-wk="' + esc(wk) +
        '" data-fk="w:' + esc(wk) + '">why?</button></div>' +
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
    return n === 1 ? '⭐ 1 payday all ticked off' : '⭐ ' + n + ' paydays in a row, all ticked off';
  }

  // ================================================================== SETUP (§6.1)

  const STEPS = ['welcome', 'boat', 'currency', 'pay', 'freq', 'bills', 'debts', 'savings', 'spending', 'done'];
  const DOT_STEPS = 8;   // steps 1..8 show progress dots

  function setupFrame(o) {
    const i = ui.setupStep;
    let dots = '';
    if (i > 0) {
      dots = '<div class="dots" role="img" aria-label="Step ' + Math.min(i, DOT_STEPS) + ' of ' + DOT_STEPS + '">';
      for (let k = 1; k <= DOT_STEPS; k++) dots += '<span class="dot' + (k < i ? ' is-done' : k === i ? ' is-now' : '') + '"></span>';
      dots += '</div>';
    } else dots = '<span></span>';
    return '<form class="setup" data-submit="setupNext" novalidate autocomplete="off">' +
      '<div class="topbar">' +
      (i > 0 ? '<button type="button" class="icon-btn" data-action="setupBack" aria-label="Back">' + ICON.back + '</button>' : '<span></span>') +
      dots + '<span></span></div>' +
      '<div class="setup-body">' +
      (o.emoji ? '<div class="q-emoji" aria-hidden="true">' + o.emoji + '</div>' : '') +
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
          '<p class="hint-title">📲 Add Harbor to your Home Screen first, then set up there.</p>' +
          '<p>Your ' + device + ' keeps the Home Screen app\'s data separate from Safari.</p>' +
          (ui.hintOpen ? '<ol class="hint-steps">' +
            '<li>Tap the <b>Share</b> button (the square with an arrow ↑).</li>' +
            '<li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>' +
            '<li>Open Harbor from its new icon and set up there.</li></ol>' : '') +
          '<div class="btn-row">' +
          '<button type="button" class="btn btn-soft" data-action="hintToggle" aria-expanded="' + ui.hintOpen + '">' + (ui.hintOpen ? 'Got it' : 'How?') + '</button>' +
          '<button type="button" class="btn btn-ghost" data-action="setupAnyway">Set up anyway</button></div></div>';
      }
      body += '<div class="links" style="margin-top:22px"><button type="button" class="link" data-action="restore">Have a backup file? Restore it</button></div>';
      return setupFrame({
        emoji: '⚓', title: 'Hi! Let\'s set up your money plan.',
        lead: 'About 5 minutes. Skip anything you\'re not sure of.',
        body: body, next: 'Let\'s go', skip: false, foot: !showHome,
      });
    },

    boat: function () {
      const v = state.settings.boatDate || '';
      return setupFrame({
        emoji: '🚢', title: 'When do you next get on the boat?', lead: 'Already on it? Pick the day you got on.',
        body: '<label class="field"><span class="field-label">Boat date</span>' +
          '<input class="input" type="date" id="f-boat" value="' + esc(v) + '" data-live="boatPreview" data-preview="boat-preview"></label>' +
          '<div class="preview" id="boat-preview" aria-live="polite">' + esc(rotationPreview(v)) + '</div>',
      });
    },

    currency: function () {
      const s = state.settings;
      const other = ui.otherCur || s.currency === 'XXX';
      return setupFrame({
        emoji: '💱', title: 'What money do you use?',
        body: currencyChoicesHTML('pickCurrency') + (other ? symbolFieldHTML() : ''),
        onlySkip: !other,
      });
    },

    pay: function () {
      return setupFrame({
        emoji: '💰', title: 'When payday comes, how much usually lands in your bank?',
        body: '<label class="field"><span class="field-label">A normal paycheck</span>' +
          moneyField('f-pay', state.settings.payAmount, { big: true, autofocus: true }) +
          '<span class="field-help">Just a normal one — it\'s fine if it changes.</span></label>',
      });
    },

    freq: function () {
      return setupFrame({
        emoji: '📅', title: 'How often do you get paid?',
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
        emoji: '🧾', title: 'What bills do you pay?', lead: 'Phone, insurance, rent, subscriptions… Debts come next.',
        body: list + '<button type="button" class="btn btn-soft" data-action="addBill">＋ Add a bill</button>',
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
        emoji: '💳', title: 'Anything you owe?', lead: 'Credit cards, loans, Afterpay, money you promised someone.',
        body: list + '<button type="button" class="btn btn-soft" data-action="addDebt">＋ Add a debt</button>',
      });
    },

    savings: function () {
      const a = state.savings.amount;
      return setupFrame({
        emoji: '🏦', title: 'How much do you have saved right now?', lead: money(0) + ' is totally fine.',
        body: '<label class="field"><span class="field-label">Saved right now</span>' +
          moneyField('f-sav', a > 0 ? a : null, { big: true, autofocus: true }) + '</label>',
      });
    },

    spending: function () {
      const s = state.settings;
      const sug = E.suggestSpending(state, { today: today() });
      const hasPay = s.payAmount > 0;
      const home = s.homeSpend != null ? s.homeSpend : (sug.ok ? sug.home : null);
      const boat = s.boatSpend != null ? s.boatSpend : (sug.ok ? sug.boat : null);
      const body =
        stepperHTML('f-home', '🏠 ' + s.offDays + ' days at home', home, 50, s.offDays) +
        stepperHTML('f-boatspend', '🚢 ' + s.onDays + ' days on the boat', boat, 10, s.onDays) +
        '<div id="spend-note" aria-live="polite">' + spendNoteHTML(home, boat) + '</div>' +
        (hasPay ? '' : '');
      return setupFrame({
        emoji: '🛒', title: 'Spending money',
        lead: 'For everything that isn\'t a bill: groceries, gas, going out, shopping.',
        body: body,
      });
    },

    done: function () {
      const hasDebts = state.debts.length > 0;
      const steps = [
        'Build a ' + money(state.settings.cushion) + ' starter cushion.',
        hasDebts ? 'Crush your debts one at a time.' : 'No debts to crush — you get to skip this one!',
        'Grow a full safety net.',
      ];
      return setupFrame({
        emoji: '⚓', title: 'You\'re all set', lead: 'Here\'s your plan, in 3 steps:',
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
    return '<h1 class="sr-only">Today</h1>' + bannerHTML(s) + nextCardHTML(s) + progressCardHTML(s);
  }

  function bannerHTML(s) {
    return '<button type="button" class="banner" data-action="rotation" aria-label="' + esc(bannerText(s.rotation) + '. Tap to change your boat date.') + '">' +
      '<span class="banner-text">' + (s.rotation
        ? bannerText(s.rotation).split(' · ').map(function (x) { return '<span class="nowrap">' + esc(x) + '</span>'; }).join(' · ')
        : esc(bannerText(null))) + '</span>' +
      (s.rotation ? '<span class="banner-go" aria-hidden="true">Change</span>' : '<span class="chev" aria-hidden="true">›</span>') + '</button>';
  }

  function remindersHTML(s) {
    let h = '';
    if (s.checkinDue) {
      h += '<div class="remind"><span class="remind-text">🔎 Monthly check-in<small>30 seconds</small></span>' +
        '<span class="remind-actions"><button type="button" class="btn btn-soft btn-small" data-action="checkin">Start</button>' +
        '<button type="button" class="btn btn-text btn-small" data-action="snoozeCheckin">Not now</button></span></div>';
    }
    if (s.backupDue) {
      const last = state.meta.lastBackupAt ? fdate(state.meta.lastBackupAt) : 'never';
      h += '<div class="remind"><span class="remind-text">💾 Back up your data<small>Last: ' + esc(last) + '</small></span>' +
        '<span class="remind-actions"><button type="button" class="btn btn-soft btn-small" data-action="backup">Back up</button>' +
        '<button type="button" class="btn btn-text btn-small" data-action="snoozeBackup">Later</button></span></div>';
    }
    return h ? '<div class="reminders">' + h + '</div>' : '';
  }

  function nextCardHTML(s) {
    const latest = s.latest;
    if (latest && s.openItems.length) {
      const c = doneCount(latest);
      return '<section class="card next-card" aria-labelledby="next-title">' +
        '<div class="card-head"><h2 class="card-title" id="next-title">From your payday</h2><span class="card-count">' + c.done + ' of ' + c.total + ' done</span></div>' +
        '<p class="next-sub">' + esc(money(latest.amount) + ' on ' + fdate(latest.date)) + '</p>' +
        checklistHTML(latest) +
        '<div class="links"><button type="button" class="link" data-action="fixPayday" data-id="' + esc(latest.id) + '">Fix amount</button>' +
        '<button type="button" class="link link-muted" data-action="undoPayday" data-id="' + esc(latest.id) + '">Undo payday</button></div>' +
        '<button type="button" class="btn btn-soft btn-again" data-action="startPayday">💰 I got paid again</button>' +
        remindersHTML(s) + '</section>';
    }
    let title, sub;
    if (!s.nextPayday) {
      title = 'No paydays yet';
      sub = 'When your pay lands, tap the button below.';
    } else {
      const diff = D.diffDays(today(), s.nextPayday);
      if (diff >= 2) { title = 'Next payday: around ' + fdate(s.nextPayday); sub = 'in ' + diff + ' days'; }
      else if (diff === 1) { title = 'Next payday: around ' + fdate(s.nextPayday); sub = 'tomorrow'; }
      else if (diff === 0) { title = 'Payday is around today'; sub = 'Tap the button when it lands.'; }
      else { title = 'Payday was due around ' + fdate(s.nextPayday); sub = 'Tap the button when it lands.'; }
    }
    return '<section class="card next-card" aria-labelledby="next-title">' +
      '<p class="next-when" id="next-title">' + esc(title).replace(/(around|due around) (\w{3} \d+(, \d{4})?)$/, '$1 <span class="nowrap">$2</span>') + '</p><p class="next-sub">' + esc(sub) + '</p>' +
      (latest ? '<p class="next-done">✓ Everything from your ' + esc(fdate(latest.date)) + ' payday is done.</p>' : '') +
      '<button type="button" class="btn btn-paid" data-action="startPayday">💰 I got paid</button>' +
      remindersHTML(s) + '</section>';
  }

  function stageLine(s) {
    if (s.stage === 4) return 'You made it to Safe Harbor ⚓';
    return 'Stage ' + s.stage + ' of 3 · ' + s.stageName;
  }
  // { text, soft }
  function goalLine(s) {
    const p = s.projection || {};
    if (s.stage === 4) return { text: 'Your safety net is full' };
    if (p.alreadyDebtFree) {
      if (!s.debts.length) {
        return p.safeHarbor ? { text: 'Safe Harbor by ' + D.fmtMonthYear(p.safeHarbor) } : { text: 'No debts — nice!' };
      }
      return { text: 'You\'re debt-free! 🎉' };
    }
    if (p.debtFree) return { text: 'Debt-free by ' + D.fmtMonthYear(p.debtFree) };
    if (p.reason === 'no-pay') return { text: 'Add your normal paycheck in Settings to see your debt-free date', soft: true };
    return { text: 'Every payday moves you closer', soft: true };
  }

  function progressCardHTML(s) {
    const g = goalLine(s);
    return '<section class="card progress-card" role="button" tabindex="0" data-action="go" data-to="voyage" aria-label="Your progress. Open your voyage.">' +
      V.miniRoute(s.voyage) +
      '<div class="progress-row"><div class="progress-jar">' + V.jar(s.jar, { size: 'small' }) + '</div>' +
      '<div class="progress-text"><div class="stage-line">' + esc(stageLine(s)).split(' · ').map(function (x, i) { return i ? '<span class="nowrap">' + x + '</span>' : x; }).join(' · ') + '</div>' +
      '<div class="goal-line' + (g.soft ? ' is-soft' : '') + '">' + esc(g.text) + '</div>' +
      '<div class="saved-line"><b>' + esc(money(s.savings)) + '</b> saved</div></div></div>' +
      '<div class="more" aria-hidden="true">See your voyage ›</div></section>';
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

  function flowTop(title, back) {
    return '<div class="flow-top">' +
      (back ? '<button type="button" class="icon-btn" data-action="flowBack" aria-label="Back">' + ICON.back + '</button>'
        : '<button type="button" class="icon-btn" data-action="flowClose" aria-label="Close">' + ICON.x + '</button>') +
      '<span class="flow-title">' + esc(title) + '</span></div>';
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
    let h = flowTop('Your payday plan', false) +
      '<div class="callout callout-' + status + '" role="status"><p>' + esc(plan.headline) + '</p>' +
      (plan.note ? '<p class="note">' + esc(plan.note) + '</p>' : '') + '</div>' +
      '<p class="plan-meta">' + esc(money(pd.amount) + ' on ' + fdate(pd.date) + ' · next payday around ' + fdate(pd.nextDate)) + '</p>' +
      '<section class="card">' + V.splitBar(plan, money) +
      '<div class="card-head" style="margin-top:18px"><h2 class="card-title">Your to-do list</h2><span class="card-count">' + c.done + ' of ' + c.total + ' done</span></div>' +
      checklistHTML(pd) +
      '<div class="links">' + (isLatest ? '<button type="button" class="link" data-action="fixPayday" data-id="' + esc(pd.id) + '">Fix amount</button>' : '') +
      '<button type="button" class="link link-muted" data-action="undoPayday" data-id="' + esc(pd.id) + '">Undo payday</button></div></section>';
    if (hasSpend && !state.meta.tips.spendingCard) {
      h += '<div class="tip"><span class="tip-emoji" aria-hidden="true">💡</span><div class="tip-body">' +
        'Keep your spending money on its own card or account, so your bank app shows exactly what\'s left.' +
        '<br><button type="button" class="btn btn-soft btn-small" data-action="tipDone">Got it</button></div></div>';
    }
    if (complete && c.total > 0) {
      h += '<div class="cheer" role="status"><p class="cheer-big">All done! Nice work.</p><p class="cheer-small">' + esc(streakText(E.streak(state))) + '</p></div>';
    }
    h += '<button type="button" class="btn btn-primary" data-action="flowClose">' + (complete ? 'Done' : 'Done for now') + '</button>';
    return h;
  }

  // ================================================================== VOYAGE (§6.4)

  function renderVoyage() {
    const s = summary();
    const p = s.projection || {};
    let title = 'Your voyage', sub = '';
    if (s.stage === 4) title = 'You made it to Safe Harbor ⚓';
    else if (p.alreadyDebtFree && s.debts.length) title = 'You\'re debt-free! 🎉';
    else if (p.debtFree && !p.alreadyDebtFree) title = 'Debt-free by ' + D.fmtMonthYear(p.debtFree);
    if (s.stage !== 4 && p.safeHarbor) sub = 'Safe Harbor by ' + D.fmtMonthYear(p.safeHarbor);
    else if (s.stage !== 4 && p.reason === 'no-pay') sub = 'Add your normal paycheck in Settings to see dates.';

    const jarLine = money(s.jar.amount) + ' of ' + money(s.jar.target);
    const jarSub = s.stage === 1 ? 'Starter cushion — for surprises'
      : 'Safety net — ' + plural(state.settings.safetyMonths, 'month') + ' of expenses';

    let h = '<header class="voy-head"><h1 class="page-title">' + esc(title) + '</h1>' + (sub ? '<p class="voy-sub">' + esc(sub) + '</p>' : '') + '</header>' +
      '<section class="card route-card" aria-label="Your route"><div id="route-slot"></div></section>' +
      '<section class="card" aria-label="Your plan">' + V.stagePath(s.stage) + '</section>' +
      '<section class="card jar-wrap" aria-label="Your savings">' + V.jar(s.jar, { size: 'large' }) +
      '<p class="jar-amount">' + esc(jarLine) + '</p><p class="jar-sub">' + esc(jarSub) + '</p></section>';

    if (s.debts.length) {
      h += '<h2 class="section-title">Your debts</h2>' + V.debtBars(s.debts, money);
    }
    if (s.streak > 0) {
      h += '<section class="card streak" style="margin-top:16px"><span class="star" aria-hidden="true">⭐</span><span>' +
        esc(s.streak === 1 ? '1 payday all ticked off' : s.streak + ' paydays in a row, all ticked off') + '</span></section>';
    }
    h += '<h2 class="section-title">Logbook</h2>';
    if (!state.paydays.length) {
      h += '<p class="empty-note">Your paydays will show up here.</p>';
    } else {
      h += '<section class="card card-flush"><ul class="log">' + state.paydays.slice().reverse().map(function (pd) {
        const c = doneCount(pd);
        const all = c.done === c.total;
        return '<li><button type="button" class="log-row" data-action="logOpen" data-id="' + esc(pd.id) + '">' +
          '<span class="list-main"><span class="log-date">' + esc(fdate(pd.date) + ' · ' + money(pd.amount)) + '</span>' +
          '<span class="log-sub' + (all ? ' is-done' : '') + '">' + (all ? '✓ ' : '') + c.done + ' of ' + c.total + ' done</span></span>' +
          '<span class="chev" aria-hidden="true">›</span></button></li>';
      }).join('') + '</ul></section>';
    }
    return h;
  }

  function fillRoute() {
    const slot = $('route-slot');
    if (!slot) return;
    const w = Math.round(slot.clientWidth) || 340;
    slot.innerHTML = V.routeMap(summary().voyage, { width: Math.max(280, w) });
  }

  // ================================================================== SETTINGS (§6.5)

  function row(action, label, value, o) {
    o = o || {};
    return '<button type="button" class="row' + (o.cls ? ' ' + o.cls : '') + '" data-action="' + action + '"' + (o.id ? ' data-id="' + esc(o.id) + '"' : '') + '>' +
      '<span class="row-label">' + esc(label) + (o.small ? '<small>' + esc(o.small) + '</small>' : '') + '</span>' +
      (value != null ? '<span class="row-value">' + esc(value) + '</span>' : '') +
      (o.noChev ? '' : '<span class="chev" aria-hidden="true">›</span>') + '</button>';
  }

  function renderSettings() {
    const s = state.settings;
    const sum = summary();
    const share = Math.round(s.debtShare * 10) / 10;
    const byId = {};
    sum.debts.forEach(function (d) { byId[d.id] = d; });

    let h = '<h1 class="page-title">Settings</h1>';

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
      row('addBill', '＋ Add a bill', null, { cls: 'add', noChev: true }) + '</div>';

    h += '<h2 class="section-title">Debts</h2><div class="card group">' +
      state.debts.map(function (d) {
        const r = byId[d.id];
        const open = r ? r.open : d.balance > 0;
        return row('editDebt', d.name, open ? money(r ? r.balance : d.balance) + ' left' : 'Paid off 🎉', {
          id: d.id, small: money(d.minPayment) + ' a month' + (d.rate != null ? ' · ' + d.rate + '% interest' : ''),
        });
      }).join('') +
      row('addDebt', '＋ Add a debt', null, { cls: 'add', noChev: true }) + '</div>';

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
      row('backup', '💾 Back up now', 'Last: ' + last) +
      row('restore', '📂 Restore from a backup', null) +
      '<div class="group-pad"><ul class="warn-list">' +
      warn('🔒', 'Your money info lives only on this device — nothing is sent anywhere.') +
      warn('📲', 'Always open Harbor from its Home Screen icon. Safari and the Home Screen app keep separate data.') +
      warn('🗑️', 'Deleting the Harbor icon from your Home Screen deletes its data.') +
      warn('🧹', 'Clearing Safari\'s history and website data can wipe it.') +
      warn('📱', 'Your iPad and iPhone don\'t sync. Pick one, or move your data with a backup file.') +
      warn('☁️', 'Keep a backup in iCloud Drive or Files — we\'ll remind you once a month.') +
      '</ul></div>' +
      row('startOver', 'Start over', null, { cls: 'danger', noChev: true }) + '</div>';

    h += '<p class="footer">Harbor · works offline · your data stays on this device<br>Version ' + esc(E.version) + '</p>';
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

  const SCREENS = { setup: renderSetup, today: renderToday, payday: renderPayday, voyage: renderVoyage, settings: renderSettings };

  function render() {
    if (!state.setupDone) ui.screen = 'setup';
    else if (ui.screen === 'setup') ui.screen = 'today';
    const fk = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-fk');
    const inLayer = document.activeElement && document.activeElement.closest && document.activeElement.closest('.layer');
    $app.innerHTML = (SCREENS[ui.screen] || renderToday)();
    renderTabs();
    document.body.classList.toggle('no-tabs', ui.screen === 'setup' || ui.screen === 'payday');
    if (ui.screen === 'voyage') fillRoute();
    refreshLayers();
    if (fk) {
      const scope = inLayer && inLayer.isConnected ? inLayer : (inLayer ? null : $app);
      const el = scope && scope.querySelector('[data-fk="' + cssEsc(fk) + '"]');
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function renderTabs() {
    const show = state.setupDone && (ui.screen === 'today' || ui.screen === 'voyage' || ui.screen === 'settings');
    $tabs.hidden = !show;
    if (!show) { $tabs.innerHTML = ''; return; }
    const tabs = [['today', 'Today'], ['voyage', 'Voyage'], ['settings', 'Settings']];
    $tabs.innerHTML = '<div class="tabs-inner">' + tabs.map(function (t) {
      const on = ui.screen === t[0];
      return '<button type="button" class="tab" data-action="go" data-to="' + t[0] + '"' + (on ? ' aria-current="page"' : '') + '>' +
        ICON[t[0]] + '<span>' + t[1] + '</span></button>';
    }).join('') + '</div>';
  }

  function renderBanner() {
    let h = '';
    if (ui.saveError) {
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
    openLayer('<div class="celebrate"><div class="big-emoji" aria-hidden="true">' + m.emoji + '</div>' +
      '<h2>' + esc(m.title) + '</h2><p>' + esc(m.message) + '</p>' +
      '<button type="button" class="btn btn-primary" data-la="close">Keep going</button></div>',
    { center: true, focus: 'box', onClose: function () { render(); } });
    V.confetti();
  }

  function recapStats(r) {
    const stats = [];
    if (r.debtPaid > 0) stats.push('<div class="recap-stat"><b>' + esc(money(r.debtPaid)) + '</b><span>paid on debts</span></div>');
    if (r.saved > 0) stats.push('<div class="recap-stat"><b>' + esc(money(r.saved)) + '</b><span>saved</span></div>');
    if (!stats.length) return '<p class="recap-list" style="margin-top:14px">You kept your bills covered. That counts.</p>';
    return '<div class="recap-stats' + (stats.length === 1 ? ' one' : '') + '">' + stats.join('') + '</div>';
  }

  function showRecap(r) {
    const paid = r.paidOff && r.paidOff.length
      ? '<p class="recap-list">🏝️ Paid off: <b>' + esc(r.paidOff.join(', ')) + '</b></p>' : '';
    const steps = r.total > 0 ? '<p class="recap-list">✓ You ticked ' + r.ticked + ' of ' + plural(r.total, 'step') +
      ' on ' + plural(r.paydays, 'payday') + '.</p>' : '';
    openLayer('<div class="celebrate"><div class="big-emoji" aria-hidden="true">🏠</div>' +
      '<h2>Welcome home!</h2><p style="margin-bottom:0">While you were out <span class="nowrap">(' + esc(D.fmtRange(r.start, r.end)) + '):</span></p>' +
      recapStats(r) +
      paid + steps +
      '<button type="button" class="btn btn-primary" data-la="close">Nice!</button></div>',
    { center: true, focus: 'box' });
  }

  // ================================================================== SHEETS

  const BILL_CHIPS = ['Phone', 'Rent', 'Car insurance', 'Internet', 'Streaming', 'Gym'];
  const DEBT_CHIPS = ['Credit card', 'Car loan', 'Afterpay', 'Student loan', 'Personal loan'];

  function chipsHTML(list) {
    return '<div class="chips" style="margin:-6px 0 18px">' + list.map(function (c) {
      return '<button type="button" class="chip" data-la="chip" data-v="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';
  }
  const chipAction = function (el, entry) {
    const input = entry.box.querySelector('[data-chip-target]');
    if (input) { input.value = el.dataset.v; input.focus(); }
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
      chipsHTML(BILL_CHIPS) +
      '<label class="field"><span class="field-label">Amount</span>' + moneyField('b-amt', cur.amount, { enter: 'next' }) + '</label>' +
      '<div class="field"><span class="field-label">How often</span><div class="seg" role="group" aria-label="How often">' +
      '<button type="button" data-la="freq" data-v="monthly" aria-pressed="' + !yearly + '">Monthly</button>' +
      '<button type="button" data-la="freq" data-v="yearly" aria-pressed="' + yearly + '">Yearly</button></div>' +
      '<input type="hidden" id="b-freq" value="' + (yearly ? 'yearly' : 'monthly') + '"></div>' +
      '<div class="field"><span class="field-label" id="b-due-label">' + (yearly ? 'Due every year on' : 'Due on the … of the month') + '</span>' +
      '<div class="due-row"><select class="select" id="b-month" aria-label="Month"' + (yearly ? '' : ' hidden') + '>' + monthOptions(cur.dueMonth || 1) + '</select>' +
      '<select class="select" id="b-day" aria-label="Day">' + dayOptions(cur.dueDay || 1) + '</select></div>' +
      '<span class="field-help" id="b-help">' + (yearly ? 'We\'ll set a little aside each payday, so it\'s ready when it\'s due.' : '') + '</span></div>' +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button></div>' +
      (b ? '<button type="button" class="btn btn-text" data-la="del" style="color:var(--coral-ink);margin-top:14px">Delete this bill</button>' : '') + '</form>';
    openLayer(html, {
      actions: {
        chip: chipAction,
        freq: function (el, entry) {
          const y = el.dataset.v === 'yearly';
          entry.box.querySelectorAll('[data-la="freq"]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === el)); });
          $('b-freq').value = y ? 'yearly' : 'monthly';
          $('b-month').hidden = !y;
          $('b-due-label').textContent = y ? 'Due every year on' : 'Due on the … of the month';
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
      (d ? '' : chipsHTML(DEBT_CHIPS)) +
      '<label class="field"><span class="field-label">How much is left' + (d && state.setupDone ? ' (today)' : '') + '</span>' + moneyField('d-bal', d ? est : null, { enter: 'next' }) +
      (d && state.setupDone ? '<span class="field-help">Change it if your bank says something different.</span>' : '') + '</label>' +
      '<label class="field"><span class="field-label">Smallest monthly payment</span>' + moneyField('d-min', cur.minPayment, { enter: 'next' }) + '</label>' +
      '<div class="two">' +
      '<label class="field"><span class="field-label">Due on the…</span><select class="select" id="d-due">' + dayOptions(cur.dueDay, true) + '</select></label>' +
      '<label class="field"><span class="field-label">Interest rate %</span><input class="input" id="d-rate" type="text" inputmode="decimal" autocomplete="off" placeholder="Not sure" value="' + esc(cur.rate == null ? '' : String(cur.rate)) + '"></label>' +
      '</div><p class="field-help" style="margin-top:-8px;margin-bottom:18px">Not sure of the day or rate? Leave them — that\'s fine.</p>' +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button></div>' +
      (d ? '<button type="button" class="btn btn-text" data-la="del" style="color:var(--coral-ink);margin-top:14px">Delete this debt</button>' : '') + '</form>';
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
          Object.assign(d, fields);
          if (Math.abs(bal - est) >= 0.005) {
            const untouched = !state.paydays.length && !state.checkins.some(function (c) { return c.debts && c.debts[d.id] != null; });
            if (untouched) { d.balance = bal; d.asOf = today(); } else E.act.setDebtBalance(state, d.id, bal, now());
          }
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
        E.act.setBoatDate(state, val);
        save(); closeLayer(entry); render();
        toast('Got it — everything\'s lined up.');
      },
    });
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
        s.onDays = on; s.offDays = off;
        save(); closeLayer(entry); render(); toast('Rotation updated.');
      },
    });
  }

  // --- single money value sheets (paycheck, savings, cushion)
  function openMoneySheet(o) {
    const html = sheetHead(o.title, domId('m')) + (o.lead ? '<p class="sheet-lead">' + esc(o.lead) + '</p>' : '') +
      '<form data-lsubmit novalidate autocomplete="off"><label class="field"><span class="field-label">' + esc(o.label) + '</span>' +
      moneyField('m-val', o.value, { big: true }) + (o.help ? '<span class="field-help">' + esc(o.help) + '</span>' : '') + '</label>' +
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button></div></form>';
    openLayer(html, {
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
      '<label class="field"><span class="field-label">🏠 Home stretch (' + s.offDays + ' days)</span>' + moneyField('sp-home', s.homeSpend, { placeholder: sug.ok ? numStr(sug.home) : '0', enter: 'next' }) + '</label>' +
      '<label class="field"><span class="field-label">🚢 Boat stretch (' + s.onDays + ' days)</span>' + moneyField('sp-boat', s.boatSpend, { placeholder: sug.ok ? numStr(sug.boat) : '0' }) + '</label>' +
      (sug.ok ? '<button type="button" class="btn btn-soft" data-la="suggest" style="margin-bottom:10px">✨ Suggest for me</button>'
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
      '<div class="sheet-actions"><button type="submit" class="btn btn-primary">Save</button></div></form>';
    openLayer(html, {
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
      moneyField('ci-savings', null, { placeholder: 'We think ' + E.round2(s.savings).toLocaleString('en-US') }) + '</label>';
    const html = sheetHead('Quick check-in (30 seconds)', domId('ci')) +
      '<p class="sheet-lead">Open your bank apps and type what they say. Skip any you\'re not sure of.</p>' +
      '<form data-lsubmit novalidate autocomplete="off">' + fields +
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
        if (bad) { setError(bad, 'That doesn\'t look like an amount.'); return; }
        if (sv !== null) any = true;
        if (!any) {
          E.act.snoozeCheckin(state, today(), 30);
          save(); closeLayer(entry); render();
          return;
        }
        E.act.addCheckin(state, { debts: debts, savings: sv }, now());
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
    E.act.markBackedUp(state, today());
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
        downloadFile(text, name);
        backedUp('download');
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
        state = r.state;
        loadProblem = null;
        ui.why = {}; ui.flow = null; ui.otherCur = false;
        while (layers.length) closeLayer(layers[layers.length - 1]);
        save();
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
        { v: 'backup', label: '💾 Back up first', cls: 'btn-soft' },
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
    snoozeBackup: function () { E.act.snoozeBackup(state, today(), 7); save(); render(); toast('Okay — we\'ll remind you next week.'); },
    dismissLoad: function () { loadProblem = null; renderBanner(); },

    // payday flow
    flowClose: function () { ui.flow = null; go('today'); },
    flowBack: function () { if (ui.flow) { ui.flow.step = 'A'; render(); window.scrollTo(0, 0); } },
    flowContinue: function () { ui.flow.step = 'B'; ui.flow.fromA = true; render(); window.scrollTo(0, 0); const a = $('p-amt'); if (a) a.focus(); },
    fillUsual: function () { const a = $('p-amt'); if (a) { a.value = numStr(state.settings.payAmount); a.focus(); } },
    tipDone: function () { state.meta.tips.spendingCard = true; save(); render(); },

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
      const edited = !!f.editId;
      f.step = 'C';
      render();
      window.scrollTo(0, 0);
      if (edited) toast('Plan updated.');
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
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (ui.screen === 'voyage') fillRoute(); }, 150);
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

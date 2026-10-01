/* Harbor engine — pure money + calendar logic. No DOM, no clock (except dates.todayLocal).
 * Contract: docs/SPEC.md §2–§4. Browser: window.Engine. Node: module.exports. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 0.005;            // anything below half a cent counts as zero
  const SCHEMA = 2;             // §10.1 — schema 1 (v1) data migrates on load/restore
  const PAY_FREQS = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'rotation', 'varies'];
  const STAGE_NAMES = { 1: 'Starter cushion', 2: 'Crush the debt', 3: 'Full safety net', 4: 'Safe Harbor' };
  const DAYS_PER_MONTH = 365.25 / 12;

  // ---------------------------------------------------------------- numbers & money

  function round2(n) {
    n = Number(n) || 0;
    return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
  }
  function roundTo(n, step) { return Math.round(n / step) * step; }
  // Whole units, rounding up — but 290.0000001 stays 290.
  function ceilWhole(n) { return Math.ceil(round2(n) - 1e-9); }
  function floorWhole(n) { return Math.floor(round2(n) + 1e-9); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function sum(list, f) { return round2(list.reduce((a, x) => a + (f ? f(x) : x), 0)); }

  // Default formatter: "$1,200", "$446.37" (cents only when present).
  function money(n) {
    n = round2(n);
    const whole = Math.abs(n - Math.round(n)) < EPS;
    const s = Math.abs(n).toLocaleString('en-US', whole
      ? { maximumFractionDigits: 0 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : '') + '$' + s;
  }
  // Friendly per-day figure: whole units unless it's under 1.
  function perDay(x) { return x >= 1 ? Math.round(x) : round2(x); }

  function listJoin(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------- dates (§2, §4.1)

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parts(iso) { return [+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8, 10)]; }
  function isoOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  const dates = {
    dayNum(iso) { const [y, m, d] = parts(iso); return Date.UTC(y, m - 1, d) / 86400000; },
    fromDayNum(n) {
      const dt = new Date(Math.round(n) * 86400000);
      return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    },
    addDays(iso, n) { return dates.fromDayNum(dates.dayNum(iso) + n); },
    addMonths(iso, n) {
      const [y, m, d] = parts(iso);
      const idx = (m - 1) + n;
      const ny = y + Math.floor(idx / 12), nm = ((idx % 12) + 12) % 12 + 1;
      return isoOf(ny, nm, Math.min(d, dates.daysInMonth(ny, nm)));
    },
    diffDays(a, b) { return dates.dayNum(b) - dates.dayNum(a); },
    daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); },
    todayLocal() { const n = new Date(); return isoOf(n.getFullYear(), n.getMonth() + 1, n.getDate()); },
    isValid(iso) {
      if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
      const [y, m, d] = parts(iso);
      return m >= 1 && m <= 12 && d >= 1 && d <= dates.daysInMonth(y, m);
    },
    fmtShort(iso) { const [, m, d] = parts(iso); return MONTHS[m - 1] + ' ' + d; },
    fmtDay(iso) {
      const wd = new Date(dates.dayNum(iso) * 86400000).getUTCDay();
      return WEEKDAYS[wd] + ', ' + dates.fmtShort(iso);
    },
    fmtMonthYear(iso) { const [y, m] = parts(iso); return MONTHS_LONG[m - 1] + ' ' + y; },
    fmtRange(a, b) { return dates.fmtShort(a) + ' – ' + dates.fmtShort(b); },
  };
  const D = dates;
  function maxIso(a, b) { return a > b ? a : b; }
  function minIso(a, b) { return a < b ? a : b; }

  // Day `dueDay` of month (y, m), clamped to the month's last day.
  function clampedDate(y, m, dueDay) { return isoOf(y, m, Math.min(dueDay, D.daysInMonth(y, m))); }

  // Every monthly due date (dueDay clamped) inside [fromIso, toIso].
  function monthlyDatesIn(dueDay, fromIso, toIso) {
    const out = [];
    if (fromIso > toIso) return out;
    let [y, m] = parts(fromIso);
    const [ty, tm] = parts(toIso);
    while (y < ty || (y === ty && m <= tm)) {
      const due = clampedDate(y, m, dueDay || 1);
      if (due >= fromIso && due <= toIso) out.push(due);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  // Next yearly occurrence on/after fromIso.
  function nextYearly(bill, fromIso) {
    const y = parts(fromIso)[0], m = bill.dueMonth || 1, d = bill.dueDay || 1;
    const here = clampedDate(y, m, d);
    return here >= fromIso ? here : clampedDate(y + 1, m, d);
  }

  // ---------------------------------------------------------------- rotation (§4.2)

  function rot(settings) {
    const on = Math.max(1, Math.round(num(settings && settings.onDays) || 28));
    const off = Math.max(1, Math.round(num(settings && settings.offDays) || 14));
    return { on, off, cycle: on + off };
  }
  function hasBoat(settings) { return !!(settings && D.isValid(settings.boatDate)); }

  // Kind of day number t: 'boat' | 'home' | null.
  function kindAt(settings, t) {
    if (!hasBoat(settings)) return null;
    const { on, cycle } = rot(settings);
    const b = D.dayNum(settings.boatDate);
    if (t < b) return 'home';
    return ((t - b) % cycle) < on ? 'boat' : 'home';
  }

  const rotation = {
    status(settings, today) {
      if (!hasBoat(settings)) return null;
      const { on, off, cycle } = rot(settings);
      const t = D.dayNum(today), b = D.dayNum(settings.boatDate);
      if (t < b) {
        const daysLeft = b - t;
        // Home since a known day (the boat date was moved later while home): count from then.
        const hs = settings.homeSince;
        if (D.isValid(hs) && hs <= today && hs < settings.boatDate) {
          const h = D.dayNum(hs);
          return {
            where: 'home', day: t - h + 1, of: b - h,
            changeDate: settings.boatDate, daysLeft, stretchStart: hs,
            stretchEnd: D.fromDayNum(b - 1), beforeStart: true,
          };
        }
        const inside = daysLeft <= off;
        return {
          where: 'home', day: inside ? off - daysLeft + 1 : null, of: inside ? off : null,
          changeDate: settings.boatDate, daysLeft, stretchStart: null,
          stretchEnd: D.fromDayNum(b - 1), beforeStart: true,
        };
      }
      const pos = (t - b) % cycle;
      let where, day, of, start, change;
      if (pos < on) {
        where = 'boat'; day = pos + 1; of = on; start = t - pos; change = start + on;
      } else {
        where = 'home'; day = pos - on + 1; of = off; start = t - (pos - on); change = t - pos + cycle;
      }
      return {
        where, day, of, changeDate: D.fromDayNum(change), daysLeft: change - t,
        stretchStart: D.fromDayNum(start), stretchEnd: D.fromDayNum(change - 1), beforeStart: false,
      };
    },

    kindOf(settings, iso) { return kindAt(settings, D.dayNum(iso)); },

    countDays(settings, fromIso, toIso) {
      const out = { home: 0, boat: 0, other: 0 };
      if (!D.isValid(fromIso) || !D.isValid(toIso) || toIso < fromIso) return out;
      const a = D.dayNum(fromIso), z = D.dayNum(toIso);
      if (!hasBoat(settings)) { out.other = z - a + 1; return out; }
      for (let t = a; t <= z; t++) out[kindAt(settings, t)]++;
      return out;
    },

    upcoming(settings, today, n) {
      const st = rotation.status(settings, today);
      if (!st) return [];
      const { on, off } = rot(settings);
      const out = [];
      let where, start;
      if (st.beforeStart) {
        out.push({ where: 'home', start: today, end: st.stretchEnd });
        where = 'boat'; start = settings.boatDate;
      } else {
        out.push({ where: st.where, start: st.stretchStart, end: st.stretchEnd });
        where = st.where === 'boat' ? 'home' : 'boat'; start = st.changeDate;
      }
      while (out.length < n) {
        const len = where === 'boat' ? on : off;
        out.push({ where, start, end: D.addDays(start, len - 1) });
        start = D.addDays(start, len);
        where = where === 'boat' ? 'home' : 'boat';
      }
      return out.slice(0, n);
    },

    lastBoatStretch(settings, today) {
      const st = rotation.status(settings, today);
      if (!st || st.beforeStart || st.where !== 'home') return null;
      const { on } = rot(settings);
      const start = D.addDays(st.stretchStart, -on);
      if (start < settings.boatDate) return null;
      return { start, end: D.addDays(st.stretchStart, -1) };
    },
  };

  // ---------------------------------------------------------------- pay (§4.3)

  const pay = {
    intervalDays(settings) {
      switch (settings && settings.payFreq) {
        case 'weekly': return 7;
        case 'biweekly': return 14;
        case 'semimonthly': return 15;
        case 'monthly': return 30;
        case 'rotation': return rot(settings).cycle;
        default: return 14;
      }
    },
    perMonth(settings) {
      switch (settings && settings.payFreq) {
        case 'weekly': return 52 / 12;
        case 'biweekly': return 26 / 12;
        case 'semimonthly': return 2;
        case 'monthly': return 1;
        case 'rotation': return DAYS_PER_MONTH / rot(settings).cycle;
        default: return 26 / 12;
      }
    },
    guessNext(settings, dateIso) {
      switch (settings && settings.payFreq) {
        case 'weekly': return D.addDays(dateIso, 7);
        case 'semimonthly': {
          const [y, m, d] = parts(dateIso);
          const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
          if (d === 15) return isoOf(y, m, D.daysInMonth(y, m));        // the 15th → month end
          if (d === D.daysInMonth(y, m)) return isoOf(ny, nm, 15);       // month end → the 15th
          if (d < 15) return isoOf(y, m, Math.min(d + 15, D.daysInMonth(y, m)));
          return isoOf(ny, nm, Math.max(1, d - 15));
        }
        case 'monthly': {
          const [y, m, d] = parts(dateIso);
          if (d === D.daysInMonth(y, m)) {                                // month end stays month end
            const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
            return isoOf(ny, nm, D.daysInMonth(ny, nm));
          }
          return D.addMonths(dateIso, 1);
        }
        case 'rotation': return D.addDays(dateIso, rot(settings).cycle);
        default: return D.addDays(dateIso, 14); // biweekly, varies, unknown
      }
    },
  };

  // ---------------------------------------------------------------- accounts & categories (§10.1)

  const BUILTIN_ACCOUNTS = [
    { id: 'checking', name: 'Checking', kind: 'checking' },
    { id: 'spending', name: 'Spending card', kind: 'spending' },
    { id: 'savings', name: 'Savings', kind: 'savings' },
  ];
  const BUILTIN_IDS = { checking: true, spending: true, savings: true };
  const MONEY_KINDS = { checking: true, cash: true, other: true };   // plain balances adjusted by events
  const CATEGORIES = [
    { key: 'eat', emoji: '🍔', label: 'Eating out' },
    { key: 'delivery', emoji: '🛵', label: 'Delivery' },
    { key: 'groceries', emoji: '🛒', label: 'Groceries' },
    { key: 'gas', emoji: '⛽', label: 'Gas' },
    { key: 'fun', emoji: '🎉', label: 'Going out' },
    { key: 'shopping', emoji: '🛍️', label: 'Shopping' },
    { key: 'travel', emoji: '✈️', label: 'Travel' },
    { key: 'other', emoji: '📦', label: 'Other' },
  ];
  const CAT = {};
  CATEGORIES.forEach((c) => { CAT[c.key] = c; });

  function cleanText(v, max) {
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';
  }
  // A number the user really typed (not blank / null / junk).
  function given(v) {
    return v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
  }

  // Built-ins first (always there, maybe renamed), then the user's own accounts.
  function accountsOf(state) {
    const list = Array.isArray(state && state.accounts) ? state.accounts : [];
    const out = BUILTIN_ACCOUNTS.map((b) => {
      const f = list.find((a) => a && a.id === b.id);
      return { id: b.id, name: (f && cleanText(f.name, 40)) || b.name, kind: b.kind, builtIn: true };
    });
    list.forEach((a) => {
      if (!a || typeof a.id !== 'string' || !a.id || BUILTIN_IDS[a.id]) return;
      if (out.some((x) => x.id === a.id)) return;
      out.push({ id: a.id, name: cleanText(a.name, 40) || 'Account', kind: a.kind === 'cash' ? 'cash' : 'other', builtIn: false });
    });
    return out;
  }

  // ---------------------------------------------------------------- replay (§4.4, §10.2)

  function isTicked(pd, key) { return !!(pd.ticks && pd.ticks[key]); }

  /* Event order inside one day:
   *   0 due dates (debt interest + minimum, bills)
   *   1 ticks, 2 purchases + check-ins (by t)      — things done before that day's payday was logged
   *   3 paydays (deposit + pot refill)
   *   4 ticks, 5 purchases + check-ins (by t)      — everything after it
   * A payday without `t` (made by v1) counts as logged first thing, so v1 data keeps
   * "payday, then ticks, then check-ins". A check-in always follows same-day ticks of its group. */
  function replay(state, untilIso, opts) {
    opts = opts || {};
    if (!D.isValid(untilIso)) untilIso = D.todayLocal();
    const debts = {};
    const byId = {};
    const log = [];
    (state.debts || []).forEach((d) => {
      byId[d.id] = d;
      debts[d.id] = { balance: round2(Math.max(0, num(d.balance))), start: round2(num(d.balance)), paidOffOn: null };
    });
    const sv = state.savings || { amount: 0, asOf: state.createdAt };
    let savings = round2(Math.max(0, num(sv.amount)));
    const savingsAsOf = sv.asOf || '0000-01-01';
    let savingsSetOn = D.isValid(sv.asOf) ? sv.asOf : null, savingsChanged = false;

    // Money accounts: unknown (null) until a check-in sets one.
    const acctList = accountsOf(state);
    const acc = {};
    acctList.forEach((a) => { if (MONEY_KINDS[a.kind]) acc[a.id] = { balance: null, asOf: null, changed: false }; });
    const adjust = (id, delta) => {
      const a = acc[id];
      if (!a || a.balance === null || !delta) return;
      a.balance = round2(a.balance + delta);
      a.changed = true;
    };

    const paydays = (state.paydays || []).filter((pd) => pd && pd.id !== opts.excludePaydayId &&
      pd.plan && Array.isArray(pd.plan.items) && D.isValid(pd.date));
    const purchases = (state.purchases || []).filter((p) => p && D.isValid(p.date) && num(p.amount) > 0);
    const checkins = (state.checkins || []).filter((c) => c && D.isValid(c.date));
    const setsAcct = (c, id) => !!(c.accounts && given(c.accounts[id]));

    // The spending pot starts once logging starts (§10.2).
    let firstLog = null;
    purchases.forEach((p) => { if (!firstLog || p.date < firstLog) firstLog = p.date; });
    checkins.forEach((c) => { if (setsAcct(c, 'spending') && (!firstLog || c.date < firstLog)) firstLog = c.date; });
    let potStart = null;
    if (firstLog && firstLog <= untilIso) {
      let best = null;
      paydays.forEach((pd) => { if (pd.date <= firstLog && (!best || pd.date > best)) best = pd.date; });
      potStart = best || firstLog;
    }
    let pot = potStart ? 0 : null;
    let potSetOn = null, potChanged = false;
    const refills = [];

    // Bills only matter once checking has a real number.
    let checkingFrom = null;
    checkins.forEach((c) => {
      if (c.date <= untilIso && setsAcct(c, 'checking') && (!checkingFrom || c.date < checkingFrom)) checkingFrom = c.date;
    });

    // Same-day ordering around a payday (see the comment above).
    const payT = new Map();
    paydays.forEach((pd) => {
      if (pd.date > untilIso) return;
      const t = Number.isFinite(pd.t) && pd.t > 0 ? pd.t : -Infinity;
      payT.set(pd.date, payT.has(pd.date) ? Math.min(payT.get(pd.date), t) : t);
    });
    const after = (date, t) => payT.has(date) && t >= payT.get(date);

    // Collect events: { date, order, t, seq, run }
    const events = [];
    let seq = 0;
    const push = (date, order, t, run) => events.push({ date, order, t, seq: seq++, run });
    (state.debts || []).forEach((d) => {
      if (!D.isValid(d.asOf)) return;
      monthlyDatesIn(d.dueDay || 1, D.addDays(d.asOf, 1), untilIso).forEach((due) => {
        push(due, 0, 0, () => dueDate(d, due));
      });
    });
    if (checkingFrom) {
      (state.bills || []).forEach((b) => {
        const amt = round2(Math.max(0, num(b.amount)));
        if (!(amt > 0)) return;
        const run = () => adjust('checking', -amt);
        if (b.freq === 'yearly') {
          for (let y = parts(checkingFrom)[0]; y <= parts(untilIso)[0]; y++) {
            const due = clampedDate(y, b.dueMonth || 1, b.dueDay || 1);
            if (due >= checkingFrom && due <= untilIso) push(due, 0, 0, run);
          }
        } else {
          monthlyDatesIn(b.dueDay || 1, checkingFrom, untilIso).forEach((due) => push(due, 0, 0, run));
        }
      });
    }
    paydays.forEach((pd) => {
      if (pd.date <= untilIso) push(pd.date, 3, num(pd.t), () => payIn(pd));
      pd.plan.items.forEach((it) => {
        if (!isTicked(pd, it.key) || !(it.amount > 0)) return;
        if (it.kind !== 'debt' && it.kind !== 'save' && it.kind !== 'spend') return;
        const tk = pd.ticks[it.key];
        if (!D.isValid(tk.d)) return;
        // pullLaterTicks: a step already done after untilIso still counts (as of untilIso).
        if (tk.d > untilIso && !opts.pullLaterTicks) return;
        const at = minIso(tk.d, untilIso);
        const t = num(tk.t);
        push(at, after(at, t) ? 4 : 1, t, () => {
          if (it.kind === 'debt') {
            const d = byId[it.debtId];
            if (d && !(tk.d < d.asOf)) extra(d, at, it.amount);
          } else if (it.kind === 'save') {
            if (tk.d >= savingsAsOf) save(at, it.amount);
          }
          adjust('checking', -round2(it.amount));
        });
      });
    });
    purchases.forEach((p) => {
      if (p.date > untilIso) return;
      const t = num(p.t);
      push(p.date, after(p.date, t) ? 5 : 2, t, () => spend(p));
    });
    checkins.forEach((c) => {
      if (c.date > untilIso) return;
      // On the same day a check-in comes after ticks — its real number already includes them.
      const t = num(c.t);
      push(c.date, after(c.date, t) ? 5 : 2, t, () => checkin(c));
    });
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      a.order - b.order || a.t - b.t || a.seq - b.seq);
    events.forEach((e) => e.run());

    function settle(id, date) {
      const r = debts[id];
      if (r.balance <= EPS) {
        r.balance = 0;
        if (!r.paidOffOn) r.paidOffOn = date;
      }
    }
    // Order 0: interest on the balance, then the minimum payment (it leaves checking).
    function dueDate(d, date) {
      const r = debts[d.id];
      if (r.balance <= EPS) return;
      const interest = round2(r.balance * num(d.rate) / 100 / 12);
      if (interest > 0) {
        r.balance = round2(r.balance + interest);
        log.push({ date, type: 'interest', debtId: d.id, amount: interest });
      }
      const paid = round2(Math.min(r.balance, Math.max(0, num(d.minPayment))));
      if (paid > 0) {
        r.balance = round2(r.balance - paid);
        log.push({ date, type: 'min', debtId: d.id, amount: paid });
        adjust('checking', -paid);
      }
      settle(d.id, date);
    }
    function extra(d, date, amount) {
      const r = debts[d.id];
      const paid = round2(Math.min(r.balance, amount));
      r.balance = round2(Math.max(0, r.balance - amount));
      log.push({ date, type: 'extra', debtId: d.id, amount: paid });
      settle(d.id, date);
    }
    function save(date, amount) {
      savings = round2(savings + amount);
      savingsChanged = true;
      log.push({ date, type: 'save', amount: round2(amount) });
    }
    function payIn(pd) {
      adjust('checking', round2(num(pd.amount)));
      if (pot !== null && pd.date >= potStart) {
        const amt = round2(Math.max(0, num(pd.plan.spend && pd.plan.spend.amount)));
        refills.push({ paydayId: pd.id, date: pd.date, before: pot, amount: amt });
        pot = round2(pot + amt);
        potChanged = true;
      }
    }
    function spend(p) {
      const amt = round2(num(p.amount));
      if (pot !== null) { pot = round2(pot - amt); potChanged = true; }
      const pw = typeof p.paidWith === 'string' && p.paidWith ? p.paidWith : 'spending';
      if (pw.indexOf('debt:') === 0) charge(pw.slice(5), p.date, amt);
      else adjust(pw, -amt);
    }
    // Bought on a credit card (or any debt): it owes more, and a paid-off one is open again.
    function charge(id, date, amount) {
      const d = byId[id];
      if (!d || date < d.asOf) return;
      const r = debts[id];
      r.balance = round2(r.balance + amount);
      if (r.balance > EPS) r.paidOffOn = null;
      log.push({ date, type: 'charge', debtId: id, amount });
    }
    function checkin(c) {
      Object.keys(c.debts || {}).forEach((id) => {
        const d = byId[id];
        const v = Number(c.debts[id]);
        if (!d || !Number.isFinite(v) || c.date < d.asOf) return;
        const r = debts[id];
        r.balance = round2(Math.max(0, v));
        if (r.balance > EPS) r.paidOffOn = null;       // re-opened
        log.push({ date: c.date, type: 'checkin', debtId: id, amount: r.balance });
        settle(id, c.date);
      });
      if (c.savings !== null && c.savings !== undefined && Number.isFinite(Number(c.savings)) &&
          c.date >= savingsAsOf) {
        savings = round2(Math.max(0, Number(c.savings)));
        savingsSetOn = c.date; savingsChanged = false;
        log.push({ date: c.date, type: 'checkin', amount: savings });
      }
      Object.keys(c.accounts || {}).forEach((id) => {
        if (!given(c.accounts[id])) return;
        const v = round2(Number(c.accounts[id]));
        if (id === 'spending') {
          if (pot === null) return;
          pot = v; potSetOn = c.date; potChanged = false;
        } else if (acc[id]) {
          Object.assign(acc[id], { balance: v, asOf: c.date, changed: false });
        }
      });
    }

    const accounts = {};
    acctList.forEach((a) => {
      if (a.kind === 'spending') accounts[a.id] = { balance: pot, asOf: potSetOn, changed: pot !== null && potChanged };
      else if (a.kind === 'savings') accounts[a.id] = { balance: savings, asOf: savingsSetOn, changed: savingsChanged };
      else accounts[a.id] = acc[a.id];
    });
    return { debts, savings, log, accounts, pot, potStart, refills };
  }

  // ---------------------------------------------------------------- stage & targets (§4.5)

  function monthlyBills(state) {
    return round2((state.bills || []).reduce((a, b) =>
      a + (b.freq === 'yearly' ? num(b.amount) / 12 : num(b.amount)), 0));
  }
  function monthlySpend(settings) {
    const h = num(settings && settings.homeSpend), b = num(settings && settings.boatSpend);
    return round2((h + b) * DAYS_PER_MONTH / rot(settings).cycle);
  }
  // Monthly spending the plan really uses: skipped stretch amounts fall back to the suggestion.
  function monthlySpendOf(state) {
    const s = state.settings || {};
    const paydays = state.paydays || [];
    let payAmt = num(s.payAmount);
    if (!(payAmt > 0)) payAmt = paydays.length ? sum(paydays, (p) => num(p.amount)) / paydays.length : 0;
    const r = spendingRates(state, payAmt);
    return round2((r.home + r.boat) * DAYS_PER_MONTH / rot(s).cycle);
  }
  function cushionOf(state) { return Math.max(0, num(state.settings && state.settings.cushion)); }
  function safetyTarget(state) {
    const months = num(state.settings && state.settings.safetyMonths) || 3;
    const t = Math.max(cushionOf(state), months * (monthlyBills(state) + monthlySpendOf(state)));
    return roundTo(t, 10);
  }
  function stage(o) {
    if (o.savings < o.cushion - 0.5) return 1;
    if (o.openDebtCount > 0) return 2;
    if (o.savings < o.safetyTarget - 0.5) return 3;
    return 4;
  }
  // list items need {balance, rate, name}; returns a new sorted array.
  function orderDebts(list, method) {
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    return list.slice().sort(method === 'interest'
      ? (a, b) => num(b.rate) - num(a.rate) || a.balance - b.balance || byName(a, b)
      : (a, b) => a.balance - b.balance || byName(a, b));
  }

  // ---------------------------------------------------------------- spending (§4.6)

  function suggestSpending(state, opts) {
    opts = opts || {};
    const s = state.settings || {};
    const { on, off, cycle } = rot(s);
    const payAmt = opts.payAmount != null ? num(opts.payAmount) : num(s.payAmount);
    const income = payAmt * pay.perMonth(s);
    const bal = opts.today ? replay(state, opts.today) : null;
    const mins = (state.debts || []).reduce((a, d) => {
      const open = bal ? bal.debts[d.id].balance > EPS : num(d.balance) > EPS;
      return a + (open ? num(d.minPayment) : 0);
    }, 0);
    const bills = monthlyBills(state) + mins;
    const free = income - bills;
    const base = { perMonthIncome: round2(income), perMonthBills: round2(bills) };
    if (free <= 0) {
      return Object.assign({ home: 0, boat: 0, homeDaily: 0, boatDaily: 0, perMonthGoals: round2(free), ok: false }, base);
    }
    const perCycle = (free * 0.5) * cycle / DAYS_PER_MONTH;
    const unit = perCycle / (off + 0.15 * on);          // a boat day costs 15% of a home day
    const home = roundTo(unit * off, 50);
    const boat = roundTo(unit * 0.15 * on, 10);
    const goals = income - bills - monthlySpend({ homeSpend: home, boatSpend: boat, onDays: on, offDays: off });
    return Object.assign({
      home, boat, homeDaily: round2(home / off), boatDaily: round2(boat / on),
      perMonthGoals: round2(goals), ok: true,
    }, base);
  }

  // Daily spending rates. Unset stretch amounts fall back to the suggestion.
  function spendingRates(state, fallbackPay) {
    const s = state.settings || {};
    const { on, off, cycle } = rot(s);
    let home = s.homeSpend, boat = s.boatSpend;
    if (home == null || boat == null) {
      const sug = suggestSpending(state, { payAmount: fallbackPay });
      if (home == null) home = sug.home;
      if (boat == null) boat = sug.boat;
    }
    home = Math.max(0, num(home)); boat = Math.max(0, num(boat));
    return { home, boat, homeDaily: home / off, boatDaily: boat / on, otherDaily: (home + boat) / cycle };
  }
  function desiredSpend(days, rates) {
    return Math.round(days.home * rates.homeDaily + days.boat * rates.boatDaily + days.other * rates.otherDaily);
  }

  // ---------------------------------------------------------------- the split helpers (shared by makePlan + project)

  // Bills first, then spending, then whole units to goals. Stray cents stay with bills.
  function splitMoney(amount, billsNeed, desired) {
    amount = round2(amount);
    if (amount + EPS < billsNeed) {
      return { billsKeep: amount, spend: 0, goals: 0, leftover: 0, short: true };
    }
    const billsKeep = Math.min(amount, ceilWhole(billsNeed));
    const rem = round2(amount - billsKeep);
    const spend = Math.max(0, Math.min(desired, floorWhole(rem)));
    const goals = Math.max(0, floorWhole(rem - spend));
    return { billsKeep, spend, goals, leftover: round2(rem - spend - goals), short: false };
  }

  /* Goals waterfall (§4.7 step 3).
   * total: whole units. debts: [{id, name, toClear}] already in payoff order.
   * Returns { savings, debts: [{debtId, name, amount, clears}], parts: {cushion, share, overflow, rest} }. */
  function goalsWaterfall(o) {
    let rest = Math.max(0, Math.floor(o.total));
    const parts = { cushion: 0, share: 0, overflow: 0, rest: 0 };
    const out = [];
    // 1. Starter cushion first.
    if (o.savings < o.cushion - EPS && rest > 0) {
      parts.cushion = Math.min(rest, ceilWhole(o.cushion - o.savings));
      rest -= parts.cushion;
    }
    // 2. Crush the debt: debtShare to debts one at a time, the rest keeps the cushion growing.
    const targets = o.debts.filter((d) => d.toClear > EPS);
    if (targets.length && rest > 0) {
      const debtPart = Math.floor(rest * o.debtShare + 1e-9);
      parts.share = rest - debtPart;
      let pour = debtPart;
      for (const d of targets) {
        if (pour <= 0) break;
        const need = ceilWhole(d.toClear);
        const amt = Math.min(pour, need);
        out.push({ debtId: d.id, name: d.name, amount: amt, clears: amt >= need });
        pour -= amt;
      }
      parts.overflow = pour;                 // every debt cleared — leftover goes to savings
      rest = 0;
    }
    // 3. Everything else grows the safety net.
    parts.rest = rest;
    return { savings: parts.cushion + parts.share + parts.overflow + parts.rest, debts: out, parts };
  }

  // Apply interest + minimum on each due date in [fromIso, toIso] to a balance (simulation).
  function simulateMins(debt, balance, fromIso, toIso) {
    const mins = [];
    if (!D.isValid(debt.asOf)) return { balance, mins };
    const from = maxIso(fromIso, D.addDays(debt.asOf, 1));
    for (const due of monthlyDatesIn(debt.dueDay || 1, from, toIso)) {
      if (balance <= EPS) { balance = 0; break; }
      balance = round2(balance + round2(balance * num(debt.rate) / 100 / 12));
      const paid = round2(Math.min(balance, Math.max(0, num(debt.minPayment))));
      balance = round2(balance - paid);
      if (paid > 0) mins.push({ due, amount: paid });
    }
    return { balance: balance <= EPS ? 0 : balance, mins };
  }

  // ---------------------------------------------------------------- makePlan (§4.7)

  function settingsOf(state) { return state.settings || {}; }

  function makePlan(state, input, opts) {
    opts = opts || {};
    const m = opts.money || money;
    const s = settingsOf(state);
    const date = input.date;
    const nextDate = input.nextDate && input.nextDate > date ? input.nextDate : pay.guessNext(s, date);
    const amount = Math.max(0, round2(input.amount));
    const others = (state.paydays || []).filter((p) => p.id !== input.excludeId && p.date <= date && p.plan);
    // Steps from earlier paydays that were ticked after this payday's date (e.g. "Paid on" set
    // to yesterday) already happened, so they count — otherwise money would be sent twice.
    const bal = replay(state, date, { excludePaydayId: input.excludeId, pullLaterTicks: true });
    const cushion = cushionOf(state);
    const target = safetyTarget(state);

    // Windows: never cover a bill or a spending day twice.
    let prevBillsTo = null, prevSpendTo = null;
    others.forEach((p) => {
      const w = p.plan.window || {};
      if (D.isValid(w.billsTo) && (!prevBillsTo || w.billsTo > prevBillsTo)) prevBillsTo = w.billsTo;
      if (D.isValid(w.spendTo) && (!prevSpendTo || w.spendTo > prevSpendTo)) prevSpendTo = w.spendTo;
    });
    const billsFrom = prevBillsTo ? maxIso(D.addDays(prevBillsTo, 1), D.addDays(date, -31)) : date;
    const billsTo = nextDate;
    const spendFrom = prevSpendTo ? maxIso(D.addDays(prevSpendTo, 1), date) : date;
    const spendTo = D.addDays(nextDate, -1);

    // 1. Bills
    const bills = [];
    const yearlyAside = [];
    const windowOpen = billsFrom <= billsTo;
    (state.bills || []).forEach((b) => {
      const amt = round2(Math.max(0, num(b.amount)));
      if (b.freq === 'yearly') {
        if (!windowOpen) return;
        const due = nextYearly(b, billsFrom);
        const saved = sum(others, (p) => sum((p.plan.yearlyAside || [])
          .filter((y) => y.billId === b.id && y.dueDate === due), (y) => num(y.amount)));
        const left = round2(Math.max(0, amt - saved));
        if (due <= billsTo) {
          if (left > 0) bills.push({ refId: b.id, name: b.name, amount: left, due, kind: 'yearly', past: due < date });
        } else {
          // A little each payday so the full amount is there when it's due.
          const paydaysLeft = Math.max(1, Math.ceil(D.diffDays(date, due) / pay.intervalDays(s)));
          const aside = round2(left / paydaysLeft);
          if (aside > 0) yearlyAside.push({ billId: b.id, name: b.name, amount: aside, dueDate: due });
        }
      } else {
        if (amt <= 0) return;
        monthlyDatesIn(b.dueDay || 1, billsFrom, billsTo).forEach((due) =>
          bills.push({ refId: b.id, name: b.name, amount: amt, due, kind: 'bill', past: due < date }));
      }
    });

    // Debt minimums. Due dates up to today already happened in the replay; later ones are simulated.
    const debtsNow = [];
    (state.debts || []).forEach((d) => {
      const r = bal.debts[d.id];
      if (billsFrom <= date) {
        monthlyDatesIn(d.dueDay || 1, billsFrom, minIso(date, billsTo)).forEach((due) => {
          const paid = sum(bal.log.filter((e) => e.type === 'min' && e.debtId === d.id && e.date === due), (e) => e.amount);
          if (paid > 0) bills.push({ refId: d.id, name: d.name, amount: paid, due, kind: 'min', past: due < date });
        });
      }
      // Simulate every future due date through billsTo (even ones an earlier payday covered)
      // so toClear is the real balance left after the minimums.
      const sim = simulateMins(d, r.balance, D.addDays(date, 1), billsTo);
      sim.mins.filter((x) => x.due >= billsFrom).forEach((x) =>
        bills.push({ refId: d.id, name: d.name, amount: x.amount, due: x.due, kind: 'min', past: false }));
      if (r.balance > EPS) debtsNow.push({ id: d.id, name: d.name, rate: d.rate, balance: r.balance, toClear: sim.balance });
    });
    bills.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    let billsNeed = round2(sum(bills, (b) => b.amount) + sum(yearlyAside, (y) => y.amount));

    // 2. Spending money
    const days = rotation.countDays(s, spendFrom, spendTo);
    const rates = spendingRates(state, s.payAmount != null ? s.payAmount : amount);
    const desired = desiredSpend(days, rates);
    // Only record the set-aside money that was really there, so a later yearly bill isn't short.
    const trimAside = (avail) => {
      yearlyAside.forEach((y) => { y.amount = round2(Math.min(y.amount, avail)); avail = round2(avail - y.amount); });
      for (let i = yearlyAside.length - 1; i >= 0; i--) if (!(yearlyAside[i].amount > 0)) yearlyAside.splice(i, 1);
    };
    const dueBills = sum(bills, (b) => b.amount);
    if (amount + EPS >= dueBills && amount + EPS < billsNeed) {
      // Every bill due is covered; only the yearly set-aside falls short. That's tight, not short.
      trimAside(round2(amount - dueBills));
      billsNeed = round2(dueBills + sum(yearlyAside, (y) => y.amount));
    }
    const split = splitMoney(amount, billsNeed, desired);
    if (split.short) trimAside(round2(Math.max(0, amount - dueBills)));

    // 3. Goals
    const ordered = orderDebts(debtsNow, s.method);
    const wf = goalsWaterfall({
      total: split.goals, savings: bal.savings, cushion, debtShare: clampShare(s.debtShare),
      debts: ordered.map((d) => ({ id: d.id, name: d.name, toClear: d.toClear })),
    });
    // A debt this payday clears: pay its upcoming regular payments now too, so ticking the one
    // step pays it off today. That money moves from the bills pile to the debt step.
    const folded = {};
    wf.debts.forEach((x) => {
      if (!x.clears) return;
      let f = 0;
      for (let i = bills.length - 1; i >= 0; i--) {
        const b = bills[i];
        if (b.kind === 'min' && b.refId === x.debtId && b.due > date) { f = round2(f + b.amount); bills.splice(i, 1); }
      }
      if (!(f > 0)) return;
      folded[x.debtId] = f;
      x.amount = round2(x.amount + f);
      split.billsKeep = round2(split.billsKeep - f);
      billsNeed = round2(billsNeed - f);
      // Interest the simulation added won't be charged when it's paid off today.
      const cap = ceilWhole(bal.debts[x.debtId].balance);
      if (x.amount > cap) {
        const back = floorWhole(x.amount - cap);            // whole units to savings, stray cents stay in checking
        split.leftover = round2(split.leftover + (x.amount - cap - back));
        x.amount = cap;
        if (!(wf.savings > 0)) wf.parts.overflow += back;
        wf.savings += back;
      }
    });
    const paidBy = {};
    wf.debts.forEach((x) => { paidBy[x.debtId] = x.clears ? Infinity : x.amount; });
    const stageBefore = stage({ savings: bal.savings, openDebtCount: debtsNow.length, cushion, safetyTarget: target });
    const stageAfter = stage({
      savings: bal.savings + wf.savings,
      openDebtCount: debtsNow.filter((d) => d.toClear - (paidBy[d.id] || 0) > EPS).length,
      cushion, safetyTarget: target,
    });

    let status = 'ok';
    if (split.short) status = 'short';
    else if (split.spend < desired || (split.goals === 0 && desired > 0)) status = 'tight';
    const shortBy = split.short ? round2(dueBills - amount) : 0;

    const plan = {
      v: 1, date, amount, nextDate,
      window: { billsFrom, billsTo, spendFrom, spendTo, homeDays: days.home, boatDays: days.boat, otherDays: days.other },
      bills, yearlyAside, billsNeed, billsKeep: split.billsKeep,
      spend: {
        amount: split.spend, desired,
        homeDaily: round2(rates.homeDaily), boatDaily: round2(rates.boatDaily), otherDaily: round2(rates.otherDaily),
      },
      goals: { total: split.goals, savings: wf.savings, debts: wf.debts, stageBefore, stageAfter },
      status, shortBy,
      headline: '', note: null, items: [],
    };
    const ctx = { m, s, cushion, target, savingsBefore: bal.savings, wf, split, days, rates, desired, folded, openDebts: debtsNow.length };
    Object.assign(plan, planText(plan, ctx));
    plan.items = planItems(plan, ctx);
    return plan;
  }

  function clampShare(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.8;
    return Math.min(1, Math.max(0.2, Math.round(n * 10) / 10));
  }

  // Headline + note: kind, never guilt-tripping.
  function planText(plan, ctx) {
    const m = ctx.m;
    if (plan.status === 'short') {
      return {
        headline: 'This check is ' + m(plan.shortBy) + ' short of your bills. That happens, and it\'s fixable.',
        note: 'Keep all of it in checking and pay the bills due soonest first. If you have savings, covering the gap is exactly what it\'s for.',
      };
    }
    if (plan.status === 'tight') {
      if (plan.spend.amount < plan.spend.desired) {
        const spendBit = plan.spend.amount > 0
          ? 'Bills are covered and you\'ve got ' + m(plan.spend.amount) + ' for spending.'
          : 'Bills are covered, and that\'s the most important part.';
        return { headline: 'This one\'s a bit tight. ' + spendBit + ' Goals can wait until next time — that\'s okay.', note: null };
      }
      return { headline: 'Bills and spending are covered. Goals can wait until next time — that\'s okay.', note: null };
    }
    if (plan.goals.total > 0) {
      return { headline: 'Nice! Bills are covered, spending\'s set, and ' + m(plan.goals.total) + ' goes to your goals.', note: null };
    }
    return { headline: 'Nice! Everything that needs covering is covered.', note: null };
  }

  function planItems(plan, ctx) {
    const { m, s, wf, split, days } = ctx;
    const items = [];

    // Bills: "Leave $X in checking" (+ stray cents so the list adds up exactly).
    const keep = round2(split.billsKeep + split.leftover);
    const hasBills = plan.bills.length > 0 || plan.yearlyAside.length > 0;
    if (keep > 0 && (hasBills || keep >= 1)) {
      items.push({ key: 'bills', kind: 'bills', amount: keep,
        label: 'Leave ' + m(keep) + ' in checking for bills', sub: billsSub(plan, m), why: billsWhy(plan, m) });
    }

    // Spending money.
    if (split.spend > 0) {
      items.push({ key: 'spend', kind: 'spend', amount: split.spend,
        label: 'Move ' + m(split.spend) + ' to your spending card',
        sub: spendSub(plan, days, m), why: spendWhy(plan, days, m) });
    }

    // Debts.
    const pct = Math.round(clampShare(s.debtShare) * 100);
    const lead = pct >= 100 ? 'Everything left after bills and spending' : pct + '% of what\'s left after bills and spending';
    const how = s.method === 'interest'
      ? ' goes to one debt at a time, highest interest rate first, so you pay less interest.'
      : ' goes to one debt at a time, smallest first, for quick wins.';
    wf.debts.forEach((d) => {
      if (!(d.amount > 0)) return;
      const how1 = ctx.openDebts === 1 ? ' goes to ' + d.name + ' until it\'s gone.' : how;
      const whole = d.clears && ctx.folded && ctx.folded[d.debtId] > 0;
      const it = { key: 'debt:' + d.debtId, kind: 'debt', amount: d.amount,
        label: 'Pay ' + m(d.amount) + (whole ? ' on ' : ' extra on ') + d.name + (d.clears ? ' — that clears it! 🎉' : ''),
        why: lead + how1 + (whole ? ' This pays off the whole balance, including this month\'s regular payment.'
          : d.clears ? ' This pays it off.' : ''),
        debtId: d.debtId, clears: !!d.clears };
      items.push(it);
    });

    // Savings.
    if (wf.savings > 0) {
      items.push({ key: 'save', kind: 'save', amount: wf.savings,
        label: 'Move ' + m(wf.savings) + ' to savings', why: saveWhy(ctx, pct) });
    }
    return items;
  }

  function billsSub(plan, m) {
    const n = plan.bills.length;
    const aside = sum(plan.yearlyAside, (y) => y.amount);
    const onNext = plan.bills.some((b) => b.due >= plan.nextDate);
    const parts = [];
    if (n) parts.push(plural(n, 'bill') + (onNext ? ' by ' : ' before ') + D.fmtShort(plan.nextDate));
    if (aside > 0) parts.push(m(aside) + ' set aside for yearly bills');
    if (plan.status === 'short') return parts.length ? parts.join(' · ') : 'Keep it all in checking';
    return parts.join(' · ') || 'A little buffer in checking';
  }

  function billsWhy(plan, m) {
    const late = plan.status !== 'short' && plan.bills.some((b) => b.past === true)
      ? ' Some of these were due before today, so pay them now if you haven\'t yet.' : '';
    const base = billsWhyBase(plan, m);
    return base.charAt(0).toUpperCase() + base.slice(1) + late;
  }
  function billsWhyBase(plan, m) {
    const names = [];
    plan.bills.filter((b) => b.kind !== 'min').forEach((b) => { if (names.indexOf(b.name) < 0) names.push(b.name); });
    plan.bills.filter((b) => b.kind === 'min').forEach((b) => {
      const n = 'your ' + b.name + ' minimum';
      if (names.indexOf(n) < 0) names.push(n);
    });
    const asideNames = plan.yearlyAside.map((y) => y.name);
    if (plan.status === 'short') {
      return 'This check doesn\'t quite cover everything due before your next payday, so keep it all in checking for the bills due soonest.';
    }
    if (names.length && asideNames.length) {
      return listJoin(names) + (names.length === 1 ? ' is' : ' are') +
        ' due before your next payday, and a little is set aside for ' + listJoin(asideNames) +
        ', so this stays put to cover them.';
    }
    if (names.length) {
      return listJoin(names) + (names.length === 1 ? ' is' : ' are') +
        ' due before your next payday, so this stays put to cover ' + (names.length === 1 ? 'it.' : 'them.');
    }
    if (asideNames.length) {
      return 'A little is set aside for ' + listJoin(asideNames) + ' each payday, so the full amount is there when it\'s due.';
    }
    return 'Just the loose change — it stays in checking as a small buffer.';
  }

  function spendSub(plan, days, m) {
    const sp = plan.spend;
    const total = days.home + days.boat + days.other;
    if (sp.amount < sp.desired) {
      const rate = sp.amount / Math.max(1, total);
      return rate < 1 ? 'less than ' + m(1) + ' a day' : 'about ' + m(perDay(rate)) + ' a day';
    }
    if (days.home > 0 && days.boat > 0) {
      return 'about ' + m(perDay(sp.homeDaily)) + ' a day at home · ' + m(perDay(sp.boatDaily)) + ' on the boat';
    }
    const rate = days.home > 0 ? sp.homeDaily : days.boat > 0 ? sp.boatDaily : sp.otherDaily;
    return 'about ' + m(perDay(rate)) + ' a day';
  }

  function spendWhy(plan, days, m) {
    const sp = plan.spend;
    if (sp.amount < sp.desired) {
      return 'Bills come first, so this is what\'s left for groceries, gas and fun until your next payday.';
    }
    const bits = [];
    if (days.home > 0) bits.push(plural(days.home, 'day') + ' at home at about ' + m(perDay(sp.homeDaily)) + ' a day');
    if (days.boat > 0) bits.push(plural(days.boat, 'day') + ' on the boat at about ' + m(perDay(sp.boatDaily)) + ' a day');
    if (days.other > 0) bits.push(plural(days.other, 'day') + ' at about ' + m(perDay(sp.otherDaily)) + ' a day');
    const tail = days.home > 0 && days.boat > 0
      ? '. Home days get more because that\'s when life costs more.'
      : '. That\'s enough for groceries, gas and fun until your next payday.';
    return bits.join(', plus ') + tail;
  }

  function saveWhy(ctx, pct) {
    const { m, wf, cushion, target, savingsBefore } = ctx;
    const p = wf.parts;
    const savePct = 100 - pct;
    if (p.overflow > 0) {
      return 'That covers every debt this payday can reach, so the rest goes to savings.';
    }
    if (p.cushion > 0 && p.share > 0) {
      return 'This finishes your ' + m(cushion) + ' starter cushion, and ' + savePct +
        '% of the rest keeps growing your safety net while you crush debt.';
    }
    if (p.cushion > 0 && p.rest > 0) {
      return 'This finishes your ' + m(cushion) + ' starter cushion, and the rest starts your full safety net.';
    }
    if (p.cushion > 0) {
      return 'You\'re building a ' + m(cushion) + ' starter cushion first, so a surprise doesn\'t land back on a credit card.';
    }
    if (p.share > 0) return savePct + '% keeps growing your safety net while you crush debt.';
    if (savingsBefore < target - 0.5) {
      const months = num(ctx.s.safetyMonths) || 3;
      const goal = plural(months, 'month') + ' of bills and spending (' + m(target) + ').';
      if (ctx.openDebts > 0) {
        return 'Your last debt gets paid off by its regular payment before your next payday, so extra money now grows your safety net to ' + goal;
      }
      return 'You\'re debt-free! Extra money now grows your safety net to ' + goal;
    }
    return 'Your safety net is full — this keeps growing your savings. (Your own goals, like a truck or a trip, are coming later.)';
  }

  // ---------------------------------------------------------------- projection (§4.8)

  function project(state, today, pre) {
    const s = settingsOf(state);
    const bal = (pre && pre.balances) || replay(state, today);
    const cushion = cushionOf(state);
    const target = safetyTarget(state);
    const debts = (state.debts || []).map((d) => ({
      id: d.id, name: d.name, rate: d.rate, minPayment: d.minPayment, dueDay: d.dueDay, asOf: d.asOf,
      balance: bal.debts[d.id].balance,
    }));
    const paidDates = (state.debts || []).map((d) => bal.debts[d.id].paidOffOn).filter(Boolean).sort();
    const alreadyDebtFree = debts.every((d) => d.balance <= EPS);
    const res = {
      debtFree: alreadyDebtFree ? (paidDates[paidDates.length - 1] || today) : null,
      safeHarbor: null, alreadyDebtFree,
    };
    if (alreadyDebtFree && bal.savings >= target - 0.5) { res.safeHarbor = today; return res; }

    const paydays = state.paydays || [];
    let payAmt = num(s.payAmount);
    if (!(payAmt > 0) && paydays.length) payAmt = sum(paydays, (p) => num(p.amount)) / paydays.length;
    if (!(payAmt > 0)) { res.reason = 'no-pay'; return res; }

    const rates = spendingRates(state, payAmt);
    const latest = paydays[paydays.length - 1];
    let p = latest && latest.nextDate >= today ? latest.nextDate : today;
    const lastW = latest && latest.plan && latest.plan.window;
    let billsFrom = lastW && D.isValid(lastW.billsTo) ? maxIso(D.addDays(lastW.billsTo, 1), p) : p;
    let cursor = today;                    // due dates through `cursor` are already in the balances
    let savings = bal.savings;
    // The latest payday's steps not ticked yet are money already planned: count them in the
    // simulation (not in alreadyDebtFree, so nothing is claimed before it's ticked).
    if (latest && latest.plan && Array.isArray(latest.plan.items)) {
      latest.plan.items.forEach((it) => {
        if (!(it.amount > 0) || isTicked(latest, it.key)) return;
        if (it.kind === 'debt') {
          const d = debts.find((y) => y.id === it.debtId);
          if (d) d.balance = round2(Math.max(0, d.balance - it.amount));
        } else if (it.kind === 'save') {
          savings = round2(savings + it.amount);
        }
      });
    }
    const end = D.addDays(today, 3653);    // give up after 10 years
    const yearlyTotal = sum((state.bills || []).filter((b) => b.freq === 'yearly'), (b) => num(b.amount));
    const monthly = (state.bills || []).filter((b) => b.freq !== 'yearly');
    let totalGoals = 0;

    const markDebtFree = (date) => {
      if (!res.debtFree && debts.every((d) => d.balance <= EPS)) res.debtFree = date;
    };

    while (p <= end) {
      // Minimums between paydays (already budgeted by earlier checks unless inside this window).
      let need = 0;
      let lastCleared = null;
      debts.forEach((d) => {
        if (d.balance <= EPS) return;
        const sim = simulateMins(d, d.balance, D.addDays(cursor, 1), p);
        sim.mins.forEach((x) => { if (x.due >= billsFrom) need += x.amount; });
        d.balance = sim.balance;
        if (sim.balance <= EPS && sim.mins.length) lastCleared = maxIso(lastCleared || '', sim.mins[sim.mins.length - 1].due);
      });
      if (lastCleared) markDebtFree(lastCleared);   // the LAST debt to hit 0 sets the date
      cursor = p;
      const next = pay.guessNext(s, p);

      // This payday's bills (≈): monthly due dates + a slice of yearly bills + upcoming minimums.
      if (billsFrom <= next) {
        monthly.forEach((b) => { need += num(b.amount) * monthlyDatesIn(b.dueDay || 1, billsFrom, next).length; });
        need += yearlyTotal * (D.diffDays(billsFrom, next) + 1) / 365;
      }
      const open = debts.filter((d) => d.balance > EPS).map((d) => {
        const sim = simulateMins(d, d.balance, D.addDays(p, 1), next);
        sim.mins.forEach((x) => { if (x.due >= billsFrom) need += x.amount; });
        return { id: d.id, name: d.name, rate: d.rate, balance: d.balance, toClear: sim.balance };
      });
      const desired = desiredSpend(rotation.countDays(s, p, D.addDays(next, -1)), rates);
      const split = splitMoney(payAmt, round2(need), desired);
      const wf = goalsWaterfall({
        total: split.goals, savings, cushion, debtShare: clampShare(s.debtShare),
        debts: orderDebts(open, s.method),
      });
      totalGoals += split.goals;
      wf.debts.forEach((x) => {
        const d = debts.find((y) => y.id === x.debtId);
        d.balance = round2(Math.max(0, d.balance - x.amount));
        if (d.balance <= EPS) d.balance = 0;
      });
      savings = round2(savings + wf.savings);
      markDebtFree(p);
      if (res.debtFree && savings >= target - 0.5) { res.safeHarbor = p; return res; }
      billsFrom = D.addDays(next, 1);
      p = next;
    }
    if (!res.debtFree || !res.safeHarbor) res.reason = totalGoals === 0 ? 'no-extra' : 'too-long';
    return res;
  }

  // ---------------------------------------------------------------- streak, milestones, recap (§4.10)

  function isComplete(pd) {
    const items = (pd.plan && pd.plan.items) || [];
    return items.every((it) => !(it.amount > 0) || isTicked(pd, it.key));
  }

  function streak(state) {
    const list = (state.paydays || []).slice();
    let i = list.length - 1;
    if (i >= 0 && !isComplete(list[i])) i--;           // newest still in progress: don't break the streak
    let n = 0;
    for (; i >= 0 && isComplete(list[i]); i--) n++;
    return n;
  }

  // Everything derived from balances, shared by summary / milestones.
  function context(state, today) {
    const s = settingsOf(state);
    const balances = replay(state, today);
    const cushion = cushionOf(state);
    const target = safetyTarget(state);
    const rows = (state.debts || []).map((d) => {
      const r = balances.debts[d.id];
      return { id: d.id, name: d.name, start: r.start, balance: r.balance, paidOffOn: r.paidOffOn,
        rate: d.rate == null ? null : d.rate, minPayment: num(d.minPayment), isTarget: false, open: r.balance > EPS };
    });
    const openOrdered = orderDebts(rows.filter((d) => d.open), s.method);
    if (openOrdered.length) openOrdered[0].isTarget = true;
    const paid = rows.filter((d) => !d.open)
      .sort((a, b) => String(a.paidOffOn || '').localeCompare(String(b.paidOffOn || '')));
    const debts = paid.concat(openOrdered);
    const savings = balances.savings;
    const st = stage({ savings, openDebtCount: openOrdered.length, cushion, safetyTarget: target });
    return { s, balances, cushion, target, debts, openOrdered, savings, stage: st,
      totalDebtStart: sum(rows, (d) => d.start), totalDebtNow: sum(rows, (d) => d.balance) };
  }

  function milestones(state, today, opts, ctx) {
    const m = (opts && opts.money) || money;
    ctx = ctx || context(state, today);
    const out = [];
    const add = (key, emoji, title, message) => out.push({ key, emoji, title, message });
    if ((state.paydays || []).some(isComplete)) {
      add('first', '🎉', 'First payday done!', 'You followed your plan for a whole payday. That\'s the hardest part, and you did it.');
    }
    if (ctx.savings >= ctx.cushion - 0.5 && ctx.cushion > 0) {
      add('cushion', '🛟', 'Starter cushion reached!', 'You\'ve got ' + m(ctx.cushion) + ' set aside for surprises. Next up: ' +
        (ctx.openOrdered.length > 0 ? 'crushing your debts.' : 'growing your full safety net.'));
    }
    ctx.debts.filter((d) => !d.open).forEach((d) => {
      add('paid:' + d.id, '🏝️', d.name + ': PAID OFF!', d.name + ' is gone for good. One less thing to carry.');
    });
    if (ctx.totalDebtStart > 0 && ctx.totalDebtNow <= ctx.totalDebtStart * 0.5) {
      add('halfway', '🧭', 'Halfway to debt-free!', 'Your debts are half the size they were when you started. Keep sailing.');
    }
    if (ctx.debts.length > 0 && ctx.openOrdered.length === 0) {
      add('debtfree', '🏁', 'DEBT-FREE!', 'You don\'t owe anyone anything. From now on, extra money builds your safety net.');
    }
    if (ctx.stage === 4) {
      add('harbor', '⚓', 'Safe Harbor!', 'Your safety net is full. You made it to Safe Harbor.');
    }
    return out;
  }

  // ---------------------------------------------------------------- spending pot, afford, where it went (§10.3–§10.6)

  function latestPayday(state) {
    const list = state.paydays || [];
    return list.length ? list[list.length - 1] : null;
  }
  // Same daily rates makePlan uses.
  function ratesFor(state) {
    const s = settingsOf(state);
    const latest = latestPayday(state);
    return spendingRates(state, s.payAmount != null ? s.payAmount : (latest ? num(latest.amount) : 0));
  }
  // Days from today through until − 1, split by rotation.
  function daysUntil(s, today, until) {
    if (!D.isValid(until)) return { daysLeft: null, home: 0, boat: 0, other: 0 };
    const daysLeft = Math.max(0, D.diffDays(today, until));
    const c = daysLeft > 0 ? rotation.countDays(s, today, D.addDays(until, -1)) : { home: 0, boat: 0, other: 0 };
    return { daysLeft, home: c.home, boat: c.boat, other: c.other };
  }
  function needFor(days, rates) {
    return round2(days.home * rates.homeDaily + days.boat * rates.boatDaily + days.other * rates.otherDaily);
  }
  // { left, perDay, perHome, perBoat } — per-day figures are null when no days are left.
  function perFor(left, days, rates) {
    const out = { left: left === null ? null : round2(left), perDay: null, perHome: null, perBoat: null };
    if (left === null || !days.daysLeft) return out;
    const L = Math.max(0, left);
    const need = needFor(days, rates);
    const avg = L / days.daysLeft;
    const scale = need > 0 ? L / need : null;
    out.perDay = round2(avg);
    out.perHome = round2(scale === null ? avg : scale * rates.homeDaily);
    out.perBoat = round2(scale === null ? avg : scale * rates.boatDaily);
    return out;
  }
  // "about $71 a day" | "about $100 a day at home · $10 on the boat" | "less than $1 a day"
  function dayText(per, days, m) {
    const one = (x) => (x > 0 && x < 1 ? 'less than ' + m(1) : 'about ' + m(perDay(x)));
    if (days.home > 0 && days.boat > 0 && per.perHome > 0 && per.perBoat > 0) {
      return one(per.perHome) + ' a day at home · ' + m(perDay(per.perBoat)) + ' on the boat';
    }
    return one(per.perDay) + ' a day';
  }

  function paidWithName(state, pw) {
    if (typeof pw === 'string' && pw.indexOf('debt:') === 0) {
      const d = (state.debts || []).find((x) => x.id === pw.slice(5));
      return d ? d.name : 'A card you removed';
    }
    const a = accountsOf(state).find((x) => x.id === (pw || 'spending'));
    return a ? a.name : 'An account you removed';
  }
  function decoratePurchase(state, p) {
    const c = CAT[p.category] || CAT.other;
    return Object.assign({}, p, { label: c.label, emoji: c.emoji, paidWithName: paidWithName(state, p.paidWith) });
  }
  const newestFirst = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : num(b.t) - num(a.t));
  const placeKey = (w) => String(w || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function spending(state, today, opts, bal) {
    if (!D.isValid(today)) today = D.todayLocal();
    const m = (opts && opts.money) || money;
    const s = settingsOf(state);
    bal = bal || replay(state, today);
    const latest = latestPayday(state);
    const started = bal.pot !== null;
    const left = started ? round2(bal.pot) : null;
    const until = latest ? latest.nextDate : null;
    const rates = ratesFor(state);
    const days = daysUntil(s, today, until);
    const per = perFor(left, days, rates);
    const need = days.daysLeft ? needFor(days, rates) : 0;

    let status = null, sub = null, overText = null;
    if (started) {
      status = left < -EPS ? 'over' : (need > 0 && left < 0.5 * need ? 'low' : 'ok');
      if (status === 'over') overText = 'You\'re ' + m(-left) + ' over. No stress — it comes out of your next spending money.';
      if (until) {
        if (days.daysLeft === 0) sub = 'Payday\'s due — this is what\'s left until it lands.';
        else if (left <= EPS) sub = 'Your next spending money comes with payday on ' + D.fmtShort(until) + '.';
        else sub = dayText(per, days, m) + ' until ' + D.fmtShort(until);
      }
    }
    let carried = null;
    if (started && latest) {
      const r = bal.refills.find((x) => x.paydayId === latest.id);
      if (r) carried = round2(r.before);
    }

    const all = (state.purchases || []).filter((p) => p && D.isValid(p.date)).slice().sort(newestFirst);
    const recent = all.filter((p) => p.date <= today).slice(0, 30).map((p) => decoratePurchase(state, p));
    const placeMap = new Map();
    all.forEach((p) => {          // newest first: the first one seen is the latest spelling
      const k = placeKey(p.where);
      if (!k) return;
      const x = placeMap.get(k);
      if (x) x.count++;
      else placeMap.set(k, { where: p.where, category: p.category, paidWith: p.paidWith, count: 1, order: placeMap.size });
    });
    const places = Array.from(placeMap.values()).sort((a, b) => b.count - a.count || a.order - b.order)
      .slice(0, 50).map((x) => ({ where: x.where, category: x.category, paidWith: x.paidWith, count: x.count }));

    return {
      started, left,
      from: latest ? latest.date : null, until,
      daysLeft: days.daysLeft, homeDays: days.home, boatDays: days.boat, otherDays: days.other,
      perDay: per.perDay, perHome: per.perHome, perBoat: per.perBoat,
      need, sub, status, overText, carried, potStart: bal.potStart,
      recent, places,
    };
  }

  function afford(state, today, price, opts, bal) {
    if (!D.isValid(today)) today = D.todayLocal();
    const m = (opts && opts.money) || money;
    const s = settingsOf(state);
    bal = bal || replay(state, today);
    price = Math.max(0, round2(num(price)));
    const latest = latestPayday(state);
    const rates = ratesFor(state);
    const until = latest ? latest.nextDate : D.addDays(today, pay.intervalDays(s));
    const days = daysUntil(s, today, until);
    const need = days.daysLeft ? needFor(days, rates) : 0;
    const started = bal.pot !== null;
    let left;
    if (started) left = round2(bal.pot);
    else if (latest) left = round2(Math.max(0, num(latest.plan && latest.plan.spend && latest.plan.spend.amount)));
    else left = need;                                    // no payday yet: a normal stretch of spending
    const afterLeft = round2(left - price);
    const before = perFor(left, days, rates);
    const aft = perFor(afterLeft, days, rates);
    const hasDays = days.daysLeft > 0;
    const paydayBit = until > today ? 'payday on ' + D.fmtShort(until) : 'your paycheck lands';
    let verdict, headline, sub;
    if (afterLeft < -EPS) {
      verdict = 'wait';
      headline = left > EPS
        ? 'That\'s more than you\'ve got left (' + m(left) + '). Maybe wait until ' + paydayBit + '.'
        : 'This payday\'s spending money is used up. Maybe wait until ' + paydayBit + '.';
      sub = until > today ? 'Your next spending money comes ' + D.fmtShort(until) + '.' : '';
    } else {
      if (need <= 0 || afterLeft >= 0.85 * need) {
        verdict = 'ok';
        headline = hasDays ? 'Go for it — you\'d still have ' + dayText(aft, days, m) + '.'
          : 'Go for it — you\'d still have ' + m(afterLeft) + ' left.';
      } else if (afterLeft >= 0.5 * need) {
        verdict = 'tight';
        headline = 'You can, but the rest of the days get tighter: ' + dayText(aft, days, m) + '.';
      } else {
        verdict = 'wait';
        headline = 'That would leave ' + dayText(aft, days, m) + ' until ' + D.fmtShort(until) +
          '. Maybe wait, or find a cheaper option.';
      }
      sub = 'That leaves ' + m(afterLeft) + (until > today ? ' until ' + D.fmtShort(until) : '') + '.';
    }
    if (!started) sub = (sub ? sub + ' ' : '') + 'Log your purchases for a sharper answer.';
    return { verdict, headline, sub, before, after: aft, price, started, until, daysLeft: days.daysLeft };
  }

  function whereItWent(state, fromIso, toIso) {
    const list = (state.purchases || []).filter((p) => p && D.isValid(p.date) && num(p.amount) > 0 &&
      (!fromIso || p.date >= fromIso) && (!toIso || p.date <= toIso)).slice().sort(newestFirst);
    const places = new Map(), cats = new Map();
    list.forEach((p) => {
      const amt = round2(num(p.amount));
      const k = placeKey(p.where) || '—';
      const x = places.get(k) || { where: p.where || 'Somewhere', total: 0, count: 0 };
      x.total = round2(x.total + amt); x.count++;
      places.set(k, x);
      const c = CAT[p.category] || CAT.other;
      const y = cats.get(c.key) || { category: c.key, label: c.label, emoji: c.emoji, total: 0, count: 0 };
      y.total = round2(y.total + amt); y.count++;
      cats.set(c.key, y);
    });
    const byTotal = (a, b) => b.total - a.total || b.count - a.count;
    return {
      total: sum(list, (p) => num(p.amount)), count: list.length,
      byPlace: Array.from(places.values()).sort(byTotal),
      byCategory: Array.from(cats.values()).sort(byTotal),
    };
  }

  // The stretch that just ended (boat or home), when it's a real in-rotation stretch.
  function endedStretch(s, today) {
    const st = rotation.status(s, today);
    if (!st || st.beforeStart) return null;
    const { off } = rot(s);
    if (st.where === 'home') {
      const last = rotation.lastBoatStretch(s, today);
      return last ? { where: 'boat', start: last.start, end: last.end } : null;
    }
    const start = D.addDays(st.stretchStart, -off);
    if (start >= s.boatDate) return { where: 'home', start, end: D.addDays(st.stretchStart, -1) };
    // First boat stretch after the boat date was moved later while home.
    if (st.stretchStart === s.boatDate && D.isValid(s.homeSince) && s.homeSince < s.boatDate) {
      return { where: 'home', start: s.homeSince, end: D.addDays(s.boatDate, -1), unusual: true };
    }
    return null;
  }
  // The same kind of stretch one full rotation earlier (only once logging had started by then).
  function previousSameKind(s, stretch, potStart) {
    if (!stretch || stretch.unusual || !hasBoat(s)) return null;
    const { on, off, cycle } = rot(s);
    const start = D.addDays(stretch.start, -cycle);
    if (start < s.boatDate || !potStart || potStart > start) return null;
    return { where: stretch.where, start, end: D.addDays(start, (stretch.where === 'boat' ? on : off) - 1) };
  }
  function compareText(diff, m) {
    if (Math.abs(diff) < 0.5) return 'About the same as last time';
    return diff < 0 ? m(-diff) + ' less than last time 🎉' : m(diff) + ' more than last time';
  }

  function stretchSpending(state, today, bal) {
    if (!D.isValid(today)) today = D.todayLocal();
    const s = settingsOf(state);
    const potStart = (bal || replay(state, today)).potStart;
    const fallbackStart = minIso(potStart || state.createdAt || today, today);
    const wrap = (x) => (x ? Object.assign({}, x, { summary: whereItWent(state, x.start, x.end) }) : null);
    const st = rotation.status(s, today);
    if (st) {
      if (st.beforeStart) {
        const start = st.stretchStart || (st.day ? D.addDays(today, -(st.day - 1)) : fallbackStart);
        return { current: wrap({ where: 'home', start: minIso(start, today), end: today }), previous: null };
      }
      const cur = { where: st.where, start: st.stretchStart, end: today };
      return { current: wrap(cur), previous: wrap(previousSameKind(s, cur, potStart)) };
    }
    // No boat date: this pay period vs the one before.
    const pds = (state.paydays || []).filter((p) => p.date <= today);
    if (!pds.length) return { current: wrap({ where: 'pay', start: fallbackStart, end: today }), previous: null };
    const latest = pds[pds.length - 1];
    let prevDate = null;
    for (let i = pds.length - 2; i >= 0; i--) { if (pds[i].date < latest.date) { prevDate = pds[i].date; break; } }
    const previous = prevDate && potStart && potStart <= prevDate
      ? { where: 'pay', start: prevDate, end: D.addDays(latest.date, -1) } : null;
    return { current: wrap({ where: 'pay', start: latest.date, end: today }), previous: wrap(previous) };
  }

  // Welcome-home / back-out-to-sea recap for the stretch that just ended (§4.10, §10.6).
  function recap(state, today, ctx, m) {
    m = m || money;
    const s = settingsOf(state);
    const last = endedStretch(s, today);
    if (!last || last.end < (state.createdAt || '')) return null;
    const shown = state.meta && state.meta.recapsShown;
    if (shown && shown[last.start]) return null;
    const inside = (d) => d >= last.start && d <= last.end;
    const log = ctx.balances.log.filter((e) => inside(e.date));
    const debtPaid = sum(log.filter((e) => e.type === 'min' || e.type === 'extra'), (e) => e.amount);
    const saved = sum(log.filter((e) => e.type === 'save'), (e) => e.amount);
    const pds = (state.paydays || []).filter((p) => inside(p.date));
    const spent = whereItWent(state, last.start, last.end);
    if (!pds.length && debtPaid <= 0 && spent.count === 0) return { key: last.start, empty: true };
    let ticked = 0, total = 0;
    pds.forEach((p) => (p.plan.items || []).forEach((it) => {
      if (!(it.amount > 0)) return;
      total++; if (isTicked(p, it.key)) ticked++;
    }));
    const paidOff = ctx.debts.filter((d) => d.paidOffOn && inside(d.paidOffOn)).map((d) => d.name);
    let compare = null;
    const prev = spent.count > 0 ? previousSameKind(s, last, ctx.balances.potStart) : null;
    if (prev) {
      const previousTotal = whereItWent(state, prev.start, prev.end).total;
      const diff = round2(spent.total - previousTotal);
      compare = { previousTotal, diff, text: compareText(diff, m), start: prev.start, end: prev.end };
    }
    return { key: last.start, where: last.where,
      title: last.where === 'boat' ? 'Welcome home!' : 'Back out to sea ⚓',
      start: last.start, end: last.end, debtPaid, saved, paidOff,
      paydays: pds.length, ticked, total, spent, compare };
  }

  function accountsList(state, today, bal) {
    if (!D.isValid(today)) today = D.todayLocal();
    bal = bal || replay(state, today);
    return accountsOf(state).map((a) => {
      const r = bal.accounts[a.id] || { balance: null, asOf: null, changed: false };
      return { id: a.id, name: a.name, kind: a.kind, balance: r.balance, asOf: r.asOf,
        estimated: r.balance !== null && !!r.changed, builtIn: a.builtIn };
    });
  }

  function snoozed(until, today) { return D.isValid(until) && today < until; }

  function checkinDue(state, today, ctx) {
    if (!(ctx.openOrdered.length > 0 || ctx.savings > 0)) return false;
    let last = state.createdAt || today;
    (state.checkins || []).forEach((c) => { if (c.date > last) last = c.date; });
    return D.diffDays(last, today) >= 30 && !snoozed(state.meta && state.meta.checkinSnoozeUntil, today);
  }
  function backupDue(state, today) {
    if (!(state.paydays || []).length) return false;
    const meta = state.meta || {};
    const old = !D.isValid(meta.lastBackupAt) || D.diffDays(meta.lastBackupAt, today) >= 30;
    return old && !snoozed(meta.backupSnoozeUntil, today);
  }

  // ---------------------------------------------------------------- summary (§4.9)

  function voyage(ctx, m) {
    const { savings, cushion, target, debts } = ctx;
    const stops = [{ key: 'start', kind: 'start', label: 'Start', sub: 'Where you began', done: true }];
    stops.push({ key: 'cushion', kind: 'cushion', label: 'Starter cushion', sub: m(cushion), done: savings >= cushion - 0.5 });
    if (!debts.length) {
      stops.push({ key: 'debtfree', kind: 'debtfree', label: 'Debt-Free', sub: 'No debts', done: true });
    } else {
      debts.forEach((d, i) => {
        const last = i === debts.length - 1;
        stops.push(last
          ? { key: 'debtfree', kind: 'debtfree', label: 'Debt-Free', sub: d.name, done: !d.open, debtId: d.id }
          : { key: 'debt:' + d.id, kind: 'debt', label: d.name, sub: d.open ? m(d.balance) + ' left' : 'Paid off', done: !d.open, debtId: d.id });
      });
    }
    stops.push({ key: 'harbor', kind: 'harbor', label: 'Safe Harbor', sub: m(target), done: ctx.stage === 4 });

    const clamp = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
    const i = stops.findIndex((st) => !st.done);
    let position = stops.length - 1;
    if (i > 0) {
      const st = stops[i];
      let f = 0;
      if (st.kind === 'cushion') f = cushion > 0 ? savings / cushion : 1;
      else if (st.kind === 'harbor') f = target > 0 ? savings / target : 1;
      else {
        const d = debts.find((x) => x.id === st.debtId);
        const start = Math.max(d.start, d.balance);
        f = start > 0 ? 1 - d.balance / start : 1;
      }
      position = (i - 1) + clamp(f);
    }
    return { stops, position };
  }

  function summary(state, today, opts) {
    if (!D.isValid(today)) today = D.todayLocal();
    const m = (opts && opts.money) || money;
    const ctx = context(state, today);
    const paydays = state.paydays || [];
    const latest = paydays.length ? paydays[paydays.length - 1] : null;
    const openItems = latest ? (latest.plan.items || []).filter((it) => it.amount > 0 && !isTicked(latest, it.key)) : [];
    const celebrated = (state.meta && state.meta.celebrated) || {};
    const jarTarget = ctx.stage === 1 ? ctx.cushion : ctx.target;
    return {
      rotation: rotation.status(ctx.s, today),
      balances: ctx.balances,
      savings: ctx.savings, cushion: ctx.cushion, safetyTarget: ctx.target,
      monthlyExpenses: round2(monthlyBills(state) + monthlySpendOf(state)),
      stage: ctx.stage, stageName: STAGE_NAMES[ctx.stage],
      debts: ctx.debts,
      totalDebtStart: ctx.totalDebtStart, totalDebtNow: ctx.totalDebtNow,
      projection: project(state, today, { balances: ctx.balances }),
      voyage: voyage(ctx, m),
      jar: {
        amount: ctx.savings, target: jarTarget,
        fraction: jarTarget > 0 ? Math.max(0, Math.min(1, ctx.savings / jarTarget)) : 1,
        label: ctx.stage === 1 ? 'Starter cushion' : 'Safety net',
      },
      latest, openItems,
      nextPayday: latest ? latest.nextDate : null,
      streak: streak(state),
      newMilestones: milestones(state, today, opts, ctx).filter((x) => !celebrated[x.key]),
      recap: recap(state, today, ctx, m),
      spending: spending(state, today, opts, ctx.balances),
      accounts: accountsList(state, today, ctx.balances),
      stretch: stretchSpending(state, today, ctx.balances),
      checkinDue: checkinDue(state, today, ctx),
      backupDue: backupDue(state, today),
    };
  }

  // ---------------------------------------------------------------- state, backup (§3, §4.11)

  function newState(today) {
    return {
      schema: SCHEMA, app: 'harbor', createdAt: today, setupDone: false,
      settings: {
        currency: 'USD', currencySymbol: null, boatDate: null, onDays: 28, offDays: 14,
        payAmount: null, payFreq: null, homeSpend: null, boatSpend: null, homeSince: null,
        cushion: 1000, safetyMonths: 3, debtShare: 0.8, method: 'quick',
      },
      bills: [], debts: [],
      savings: { amount: 0, asOf: today },
      paydays: [], checkins: [],
      accounts: BUILTIN_ACCOUNTS.map((a) => Object.assign({}, a)),
      purchases: [],
      meta: { lastBackupAt: null, backupSnoozeUntil: null, checkinSnoozeUntil: null, celebrated: {}, recapsShown: {}, tips: {} },
    };
  }

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const posNumOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : round2(Number(v)));
  const intIn = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
  };
  const dateOr = (v, dflt) => (D.isValid(v) ? v : dflt);
  const str = (v, dflt) => (typeof v === 'string' && v.trim() ? v : dflt);

  function normalizeState(obj, today) {
    const fail = (error) => ({ ok: false, state: null, error });
    try {
      if (!isObj(obj)) return fail('That doesn\'t look like Harbor data.');
      if (obj.app !== 'harbor') return fail('That doesn\'t look like Harbor data.');
      if (Number(obj.schema) > SCHEMA) return fail('This was made by a newer version of Harbor.');
      if (!isObj(obj.settings)) return fail('Some Harbor data is missing (settings).');
      for (const k of ['bills', 'debts', 'paydays', 'checkins', 'accounts', 'purchases']) {
        if (obj[k] !== undefined && !Array.isArray(obj[k])) return fail('Some Harbor data is damaged (' + k + ').');
      }
      today = D.isValid(today) ? today : D.todayLocal();
      const st = newState(dateOr(obj.createdAt, today));
      st.setupDone = !!obj.setupDone;
      const i = obj.settings, s = st.settings;
      s.currency = str(i.currency, 'USD');
      s.currencySymbol = typeof i.currencySymbol === 'string' && i.currencySymbol ? i.currencySymbol : null;
      s.boatDate = D.isValid(i.boatDate) ? i.boatDate : null;
      s.homeSince = D.isValid(i.homeSince) ? i.homeSince : null;
      s.onDays = intIn(i.onDays, 1, 365, 28);
      s.offDays = intIn(i.offDays, 1, 365, 14);
      s.payAmount = posNumOrNull(i.payAmount);
      s.payFreq = PAY_FREQS.indexOf(i.payFreq) >= 0 ? i.payFreq : null;
      s.homeSpend = posNumOrNull(i.homeSpend);
      s.boatSpend = posNumOrNull(i.boatSpend);
      s.cushion = posNumOrNull(i.cushion) == null ? 1000 : posNumOrNull(i.cushion);
      s.safetyMonths = intIn(i.safetyMonths, 1, 12, 3);
      s.debtShare = i.debtShare == null ? 0.8 : clampShare(i.debtShare);
      s.method = i.method === 'interest' ? 'interest' : 'quick';

      const seen = {};
      const idOf = (v) => {
        let id = typeof v === 'string' && v ? v : uid();
        while (seen[id]) id = uid();
        seen[id] = true;
        return id;
      };
      st.bills = (obj.bills || []).filter(isObj).map((b) => {
        const yearly = b.freq === 'yearly';
        return { id: idOf(b.id), name: str(b.name, 'Bill'), amount: posNumOrNull(b.amount) || 0,
          freq: yearly ? 'yearly' : 'monthly', dueDay: intIn(b.dueDay, 1, 31, 1),
          dueMonth: yearly ? intIn(b.dueMonth, 1, 12, 1) : null };
      });
      st.debts = (obj.debts || []).filter(isObj).map((d) => ({
        id: idOf(d.id), name: str(d.name, 'Debt'), balance: posNumOrNull(d.balance) || 0,
        asOf: dateOr(d.asOf, st.createdAt), minPayment: posNumOrNull(d.minPayment) || 0,
        dueDay: d.dueDay == null ? null : intIn(d.dueDay, 1, 31, null),
        rate: posNumOrNull(d.rate),
      }));
      const sv = isObj(obj.savings) ? obj.savings : {};
      st.savings = { amount: posNumOrNull(sv.amount) || 0, asOf: dateOr(sv.asOf, st.createdAt) };
      st.paydays = (obj.paydays || []).filter((p) => isObj(p) && D.isValid(p.date) && D.isValid(p.nextDate) &&
        Number.isFinite(Number(p.amount)) && isObj(p.plan) && Array.isArray(p.plan.items))
        .map((p) => {
          const ticks = {};
          if (isObj(p.ticks)) {
            Object.keys(p.ticks).forEach((k) => {
              const t = p.ticks[k];
              if (isObj(t) && D.isValid(t.d)) ticks[k] = { d: t.d, t: num(t.t) };
            });
          }
          const plan = Object.assign({}, p.plan, {
            items: p.plan.items.filter((it) => isObj(it) && typeof it.key === 'string')
              .map((it) => Object.assign({}, it, { amount: round2(num(it.amount)) })),
            yearlyAside: Array.isArray(p.plan.yearlyAside) ? p.plan.yearlyAside.filter(isObj) : [],
            window: isObj(p.plan.window) ? p.plan.window : {},
          });
          const out = { id: idOf(p.id), date: p.date, amount: round2(Number(p.amount)), nextDate: p.nextDate, plan, ticks };
          if (given(p.t)) out.t = Number(p.t);
          return out;
        })
        .map((p, idx) => [p, idx]).sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1]))
        .map((x) => x[0]);
      st.checkins = (obj.checkins || []).filter((c) => isObj(c) && D.isValid(c.date)).map((c) => {
        const debts = {};
        if (isObj(c.debts)) Object.keys(c.debts).forEach((k) => { const v = posNumOrNull(c.debts[k]); if (v != null) debts[k] = v; });
        const accounts = {};
        if (isObj(c.accounts)) Object.keys(c.accounts).forEach((k) => { if (given(c.accounts[k])) accounts[k] = round2(Number(c.accounts[k])); });
        let savings = posNumOrNull(c.savings);
        if ('savings' in accounts) {                 // savings always lives in .savings
          if (savings == null && accounts.savings >= 0) savings = accounts.savings;
          delete accounts.savings;
        }
        return { id: idOf(c.id), date: c.date, t: num(c.t), debts, savings, accounts };
      });
      // Schema 2: accounts (built-ins always there) and purchases. Schema 1 simply has none yet.
      const rawAccts = (obj.accounts || []).filter(isObj);
      const acctSeen = Object.assign({}, BUILTIN_IDS);
      st.accounts = BUILTIN_ACCOUNTS.map((b) => {
        const f = rawAccts.find((a) => a.id === b.id);
        return { id: b.id, name: (f && cleanText(f.name, 40)) || b.name, kind: b.kind };
      });
      rawAccts.forEach((a) => {
        if (BUILTIN_IDS[a.id]) return;
        let id = typeof a.id === 'string' && a.id && a.id.indexOf('debt:') !== 0 ? a.id : uid();
        while (acctSeen[id]) id = uid();
        acctSeen[id] = true;
        st.accounts.push({ id, name: cleanText(a.name, 40) || 'Account', kind: a.kind === 'cash' ? 'cash' : 'other' });
      });
      st.purchases = sortedPurchases((obj.purchases || []).filter((p) => isObj(p) && D.isValid(p.date) &&
        given(p.amount) && round2(Number(p.amount)) > 0).map((p) => {
        const category = CAT[p.category] ? p.category : 'other';
        return { id: idOf(p.id), date: p.date, t: num(p.t), amount: round2(Number(p.amount)),
          where: cleanText(p.where, 60) || CAT[category].label, what: cleanText(p.what, 80), category,
          paidWith: typeof p.paidWith === 'string' && p.paidWith ? p.paidWith : 'spending' };
      }));
      const mt = isObj(obj.meta) ? obj.meta : {};
      st.meta = {
        lastBackupAt: D.isValid(mt.lastBackupAt) ? mt.lastBackupAt : null,
        backupSnoozeUntil: D.isValid(mt.backupSnoozeUntil) ? mt.backupSnoozeUntil : null,
        checkinSnoozeUntil: D.isValid(mt.checkinSnoozeUntil) ? mt.checkinSnoozeUntil : null,
        celebrated: isObj(mt.celebrated) ? Object.assign({}, mt.celebrated) : {},
        recapsShown: isObj(mt.recapsShown) ? Object.assign({}, mt.recapsShown) : {},
        tips: isObj(mt.tips) ? Object.assign({}, mt.tips) : {},
      };
      return { ok: true, state: st, error: null };
    } catch (e) {
      return fail('That file couldn\'t be read.');
    }
  }

  function makeBackup(state, today) {
    const data = JSON.parse(JSON.stringify(state));
    // The file records its own backup date, so restoring it doesn't ask for a backup right away.
    if (isObj(data.meta)) { data.meta.lastBackupAt = today; data.meta.backupSnoozeUntil = null; }
    return { app: 'harbor', schema: SCHEMA, exportedAt: today, data };
  }

  function readBackup(obj, today) {
    const fail = (error) => ({ ok: false, state: null, info: null, error });
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (e) { return fail('That file isn\'t a Harbor backup.'); }
    }
    if (!isObj(obj) || obj.app !== 'harbor') return fail('That file isn\'t a Harbor backup.');
    const data = isObj(obj.data) ? obj.data : (isObj(obj.settings) ? obj : null);   // wrapped or raw state
    if (!data) return fail('That backup is missing its data.');
    const r = normalizeState(data, today);
    if (!r.ok) return fail(r.error);
    return { ok: true, state: r.state, error: null,
      info: { exportedAt: D.isValid(obj.exportedAt) ? obj.exportedAt : null,
        paydays: r.state.paydays.length, debts: r.state.debts.length } };
  }

  // ---------------------------------------------------------------- actions (§4.11)

  function nowOr(now) {
    return { d: now && D.isValid(now.d) ? now.d : D.todayLocal(), t: now && Number.isFinite(now.t) ? now.t : Date.now() };
  }
  function checkPaydayInput(input) {
    if (!D.isValid(input.date)) throw new Error('Pick the day you got paid.');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Type the amount that hit your bank.');
    if (input.nextDate != null && (!D.isValid(input.nextDate) || input.nextDate <= input.date)) {
      throw new Error('Your next payday needs to be after this one.');
    }
  }
  function sortPaydays(state) {
    const idx = new Map(state.paydays.map((p, i) => [p, i]));
    state.paydays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : idx.get(a) - idx.get(b)));
  }

  function sortedPurchases(list) {
    return list.map((p, i) => [p, i]).sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : 0) ||
      num(a[0].t) - num(b[0].t) || a[1] - b[1]).map((x) => x[0]);
  }
  function ensureV2(state) {
    if (!Array.isArray(state.purchases)) state.purchases = [];
    if (!Array.isArray(state.accounts)) state.accounts = [];
    BUILTIN_ACCOUNTS.forEach((b, i) => {
      if (!state.accounts.some((a) => a && a.id === b.id)) state.accounts.splice(i, 0, Object.assign({}, b));
    });
  }
  function validPaidWith(state, pw) {
    if (typeof pw !== 'string' || !pw) return 'spending';
    if (pw.indexOf('debt:') === 0) return (state.debts || []).some((d) => d.id === pw.slice(5)) ? pw : 'spending';
    const a = accountsOf(state).find((x) => x.id === pw);
    return a && a.kind !== 'savings' ? pw : 'spending';
  }
  // Friendly checks for a purchase. `keep` = the purchase being edited (its paid-with may be a removed account).
  function cleanPurchase(state, input, today, keep) {
    if (!given(input.amount) || !(round2(Number(input.amount)) > 0)) throw new Error('Type how much it cost.');
    const amount = round2(Number(input.amount));
    const date = input.date == null || input.date === '' ? today : input.date;
    if (!D.isValid(date)) throw new Error('Pick the day you bought it.');
    if (date > today) throw new Error('That day hasn\'t happened yet. Pick today or an earlier day.');
    const category = CAT[input.category] ? input.category : 'other';
    const paidWith = keep && input.paidWith === keep.paidWith ? keep.paidWith : validPaidWith(state, input.paidWith);
    return { date, amount, where: cleanText(input.where, 60) || CAT[category].label,
      what: cleanText(input.what, 80), category, paidWith };
  }

  const act = {
    addPayday(state, input, now, opts) {
      checkPaydayInput(input);
      const latest = state.paydays[state.paydays.length - 1];
      if (latest && input.date < latest.date) throw new Error('This payday is before your last one.');
      const nextDate = input.nextDate || pay.guessNext(state.settings, input.date);
      const plan = makePlan(state, { date: input.date, amount: input.amount, nextDate }, opts);
      const pd = { id: uid(), date: input.date, amount: plan.amount, nextDate, plan, ticks: {}, t: nowOr(now).t };
      state.paydays.push(pd);
      sortPaydays(state);
      return pd;
    },

    editPayday(state, id, input, now, opts) {
      checkPaydayInput(input);
      const i = state.paydays.findIndex((p) => p.id === id);
      if (i < 0) throw new Error('That payday is gone.');
      if (i !== state.paydays.length - 1) throw new Error('Only your latest payday can be changed.');
      const prev = state.paydays[i - 1];
      if (prev && input.date < prev.date) throw new Error('This payday is before your last one.');
      const pd = state.paydays[i];
      const nextDate = input.nextDate || pay.guessNext(state.settings, input.date);
      const plan = makePlan(state, { date: input.date, amount: input.amount, nextDate, excludeId: id }, opts);
      // Keep a tick only when the same step still asks for the same money.
      const ticks = {};
      plan.items.forEach((it) => {
        const old = (pd.plan.items || []).find((x) => x.key === it.key);
        if (old && pd.ticks[it.key] && Math.abs(old.amount - it.amount) < EPS) ticks[it.key] = pd.ticks[it.key];
      });
      Object.assign(pd, { date: input.date, amount: plan.amount, nextDate, plan, ticks });
      sortPaydays(state);
      return state;
    },

    undoPayday(state, id) {
      state.paydays = state.paydays.filter((p) => p.id !== id);
      return state;
    },

    tick(state, paydayId, key, on, now) {
      const pd = state.paydays.find((p) => p.id === paydayId);
      if (!pd || !(pd.plan.items || []).some((it) => it.key === key)) return state;
      pd.ticks = pd.ticks || {};
      if (on) pd.ticks[key] = nowOr(now);
      else delete pd.ticks[key];
      return state;
    },

    addCheckin(state, input, now) {
      ensureV2(state);
      const n = nowOr(now);
      const debts = {};
      Object.keys((input && input.debts) || {}).forEach((k) => {
        const v = Number(input.debts[k]);
        if (input.debts[k] !== null && input.debts[k] !== '' && Number.isFinite(v) && v >= 0) debts[k] = round2(v);
      });
      const sv = input && input.savings;
      const savings = sv !== null && sv !== undefined && sv !== '' && Number.isFinite(Number(sv)) && Number(sv) >= 0
        ? round2(Number(sv)) : null;
      let sav = savings;
      const accounts = {};
      const known = accountsOf(state);
      Object.keys((input && input.accounts) || {}).forEach((k) => {
        const v = input.accounts[k];
        if (!given(v)) return;
        if (k === 'savings') { if (sav === null && Number(v) >= 0) sav = round2(Number(v)); return; }
        if (known.some((a) => a.id === k)) accounts[k] = round2(Number(v));
      });
      state.checkins.push({ id: uid(), date: n.d, t: n.t, debts, savings: sav, accounts });
      return state;
    },

    // ------------------------------------------------ purchases & accounts (§10.8)

    addPurchase(state, input, now) {
      ensureV2(state);
      const n = nowOr(now);
      const p = Object.assign({ id: uid(), t: n.t }, cleanPurchase(state, input || {}, n.d));
      state.purchases.push(p);
      state.purchases = sortedPurchases(state.purchases);
      return p;
    },
    editPurchase(state, id, fields, now) {
      ensureV2(state);
      const p = state.purchases.find((x) => x.id === id);
      if (!p) throw new Error('That purchase is gone.');
      const n = nowOr(now);
      Object.assign(p, cleanPurchase(state, Object.assign({}, p, fields || {}), maxIso(n.d, p.date), p));
      state.purchases = sortedPurchases(state.purchases);
      return state;
    },
    deletePurchase(state, id) {
      ensureV2(state);
      state.purchases = state.purchases.filter((x) => x.id !== id);
      return state;
    },
    addAccount(state, input) {
      ensureV2(state);
      const name = cleanText(input && input.name, 40);
      if (!name) throw new Error('Give it a name, like "Cash".');
      let id = uid();
      while (state.accounts.some((a) => a.id === id)) id = uid();
      const a = { id, name, kind: input && input.kind === 'cash' ? 'cash' : 'other' };
      state.accounts.push(a);
      return a;
    },
    renameAccount(state, id, name) {
      ensureV2(state);
      const a = state.accounts.find((x) => x && x.id === id);
      if (!a) throw new Error('That account is gone.');
      const clean = cleanText(name, 40);
      if (!clean) throw new Error('Give it a name.');
      a.name = clean;
      return state;
    },
    // Purchases that used it keep their record but stop changing any balance.
    deleteAccount(state, id) {
      ensureV2(state);
      if (BUILTIN_IDS[id]) throw new Error('Checking, Spending card and Savings always stay. You can rename them.');
      state.accounts = state.accounts.filter((x) => x && x.id !== id);
      return state;
    },
    setAccountBalance(state, id, amount, now) {
      if (!given(amount)) throw new Error('Type an amount.');
      if (id === 'savings') {
        if (Number(amount) < 0) throw new Error('Savings can\'t be below zero.');
        return act.setSavings(state, amount, now);
      }
      if (!accountsOf(state).some((a) => a.id === id)) throw new Error('That account is gone.');
      return act.addCheckin(state, { debts: {}, savings: null, accounts: { [id]: amount } }, now);
    },

    // today (optional): when the new date is later and you're home, remember when you got home
    // so the banner keeps counting from then instead of making up a stretch.
    setBoatDate(state, iso, today) {
      if (iso !== null && !D.isValid(iso)) throw new Error('Pick a date.');
      const s = state.settings;
      let homeSince = null;
      if (D.isValid(today) && iso && iso > today) {
        const old = rotation.status(s, today);
        if (old && old.where === 'home') {
          if (!old.beforeStart) homeSince = old.stretchStart;
          else if (D.isValid(s.homeSince) && s.homeSince <= today) homeSince = s.homeSince;
          else if (old.day) homeSince = D.addDays(today, -(old.day - 1));
        }
      }
      s.boatDate = iso;
      s.homeSince = homeSince;
      return state;
    },

    markCelebrated(state, keys, today) {
      (keys || []).forEach((k) => { state.meta.celebrated[k] = today; });
      return state;
    },
    markAllCelebrated(state, today) {
      return act.markCelebrated(state, milestones(state, today).map((x) => x.key), today);
    },
    setDebtBalance(state, debtId, amount, now) {
      return act.addCheckin(state, { debts: { [debtId]: amount }, savings: null }, now);
    },
    setSavings(state, amount, now) {
      return act.addCheckin(state, { debts: {}, savings: amount }, now);
    },

    // Small extras for the UI (not in the spec table, but handy).
    snoozeCheckin(state, today, days) { state.meta.checkinSnoozeUntil = D.addDays(today, days || 30); return state; },
    snoozeBackup(state, today, days) { state.meta.backupSnoozeUntil = D.addDays(today, days || 7); return state; },
    markBackedUp(state, today) { state.meta.lastBackupAt = today; state.meta.backupSnoozeUntil = null; return state; },
    markRecapShown(state, key) { state.meta.recapsShown[key] = true; return state; },
  };

  return {
    version: '2.0.0', SCHEMA,
    round2, roundTo, money, uid,
    dates, rotation, pay,
    replay, monthlyBills, monthlySpend, safetyTarget, stage, stageName: (n) => STAGE_NAMES[n],
    STAGE_NAMES, orderDebts,
    suggestSpending, makePlan, project, summary,
    CATEGORIES, BUILTIN_ACCOUNTS,
    spending: (state, today, opts) => spending(state, today, opts),
    afford: (state, today, price, opts) => afford(state, today, price, opts),
    whereItWent, stretchSpending: (state, today) => stretchSpending(state, today),
    accounts: (state, today) => accountsList(state, today),
    streak, milestones, isComplete,
    newState, normalizeState, makeBackup, readBackup,
    act,
    internal: { monthlySpendOf, goalsWaterfall, splitMoney, spendingRates, simulateMins, monthlyDatesIn, nextYearly,
      accountsOf, endedStretch, previousSameKind, ratesFor },
  };
});

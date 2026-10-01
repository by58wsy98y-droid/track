// Engine unit tests — run with `node --test tests/`.
// All numbers are generic examples (SPEC §9), never real personal figures.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'engine.js'));

const { dates } = E;

// ---------------------------------------------------------------- fixtures

// SPEC §9 worked-example state.
function base(overrides) {
  const s = E.newState('2026-09-30');
  Object.assign(s.settings, {
    boatDate: '2026-09-08', onDays: 28, offDays: 14, payAmount: 2000, payFreq: 'biweekly',
    homeSpend: 1400, boatSpend: 280, cushion: 1000, debtShare: 0.8, method: 'quick',
  }, overrides && overrides.settings);
  s.bills = [
    { id: 'ins', name: 'Car insurance', amount: 150, freq: 'monthly', dueDay: 5, dueMonth: null },
    { id: 'phone', name: 'Phone', amount: 80, freq: 'monthly', dueDay: 12, dueMonth: null },
    { id: 'stream', name: 'Streaming', amount: 15, freq: 'monthly', dueDay: 20, dueMonth: null },
    { id: 'reg', name: 'Car registration', amount: 240, freq: 'yearly', dueDay: 15, dueMonth: 3 },
  ];
  s.debts = [
    { id: 'visa', name: 'Visa', balance: 1200, asOf: '2026-09-30', minPayment: 40, dueDay: 10, rate: 24 },
    { id: 'store', name: 'Store card', balance: 500, asOf: '2026-09-30', minPayment: 25, dueDay: 18, rate: null },
  ];
  s.savings = { amount: 200, asOf: '2026-09-30' };
  s.setupDone = true;
  return s;
}

let clock = 1000;
const now = (d) => ({ d, t: ++clock });

function tickAll(state, pd, d) {
  pd.plan.items.forEach((it) => E.act.tick(state, pd.id, it.key, true, now(d)));
}
function item(plan, key) { return plan.items.find((i) => i.key === key); }
function itemsSum(plan) { return E.round2(plan.items.reduce((a, i) => a + i.amount, 0)); }

// P1 then P2 (ticking P1 on Oct 1), as in SPEC §9.
function afterP1() {
  const s = base();
  const p1 = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, now('2026-10-01'));
  tickAll(s, p1, '2026-10-01');
  return { s, p1 };
}
function afterP2(amount) {
  const { s, p1 } = afterP1();
  const p2 = E.act.addPayday(s, { date: '2026-10-15', amount: amount || 2000, nextDate: '2026-10-29' }, now('2026-10-15'));
  return { s, p1, p2 };
}

// ---------------------------------------------------------------- dates

test('dates: day numbers, month math, leap years, formatting', () => {
  assert.equal(dates.fromDayNum(dates.dayNum('2026-09-30')), '2026-09-30');
  assert.equal(dates.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dates.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(dates.addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(dates.addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(dates.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(dates.addMonths('2026-08-31', 1), '2026-09-30');
  assert.equal(dates.addMonths('2026-11-15', 2), '2027-01-15');
  assert.equal(dates.addMonths('2027-01-15', -2), '2026-11-15');
  assert.equal(dates.diffDays('2026-10-01', '2027-03-15'), 165);
  assert.equal(dates.diffDays('2026-10-15', '2026-10-01'), -14);
  assert.equal(dates.daysInMonth(2028, 2), 29);
  assert.equal(dates.daysInMonth(2027, 2), 28);
  assert.equal(dates.daysInMonth(2026, 9), 30);
  assert.equal(dates.isValid('2026-02-29'), false);
  assert.equal(dates.isValid('2028-02-29'), true);
  assert.equal(dates.isValid('2026-13-01'), false);
  assert.equal(dates.isValid('nope'), false);
  assert.equal(dates.isValid(null), false);
  assert.equal(dates.fmtShort('2026-10-12'), 'Oct 12');
  assert.equal(dates.fmtDay('2026-10-12'), 'Mon, Oct 12');
  assert.equal(dates.fmtMonthYear('2027-03-01'), 'March 2027');
  assert.equal(dates.fmtRange('2026-09-08', '2026-10-05'), 'Sep 8 – Oct 5');
  assert.ok(dates.isValid(dates.todayLocal()));
});

test('money: default formatter and rounding', () => {
  assert.equal(E.money(1200), '$1,200');
  assert.equal(E.money(446.37), '$446.37');
  assert.equal(E.money(446.3), '$446.30');
  assert.equal(E.money(0), '$0');
  assert.equal(E.round2(0.1 + 0.2), 0.3);
  assert.equal(E.round2(1.005), 1.01);
});

// ---------------------------------------------------------------- rotation

test('rotation: SPEC §9 status cases', () => {
  const s = { boatDate: '2026-09-08', onDays: 28, offDays: 14 };
  const st = (d) => E.rotation.status(s, d);
  assert.deepEqual(st('2026-09-08'), { where: 'boat', day: 1, of: 28, changeDate: '2026-10-06', daysLeft: 28,
    stretchStart: '2026-09-08', stretchEnd: '2026-10-05', beforeStart: false });
  assert.equal(st('2026-09-30').where, 'boat');
  assert.equal(st('2026-09-30').day, 23);
  assert.equal(st('2026-09-30').daysLeft, 6);
  assert.equal(st('2026-10-05').day, 28);
  assert.equal(st('2026-10-05').daysLeft, 1);
  assert.deepEqual(st('2026-10-06'), { where: 'home', day: 1, of: 14, changeDate: '2026-10-20', daysLeft: 14,
    stretchStart: '2026-10-06', stretchEnd: '2026-10-19', beforeStart: false });
  assert.equal(st('2026-10-19').day, 14);
  assert.equal(st('2026-10-19').daysLeft, 1);
  assert.equal(st('2026-10-20').where, 'boat');
  assert.equal(st('2026-10-20').day, 1);
  assert.equal(st('2027-03-01').where, 'boat');
  assert.equal(st('2027-03-01').day, 7);
});

test('rotation: before the first boat date', () => {
  const a = E.rotation.status({ boatDate: '2026-10-12', onDays: 28, offDays: 14 }, '2026-09-30');
  assert.deepEqual(a, { where: 'home', day: 3, of: 14, changeDate: '2026-10-12', daysLeft: 12,
    stretchStart: null, stretchEnd: '2026-10-11', beforeStart: true });
  const b = E.rotation.status({ boatDate: '2026-11-30', onDays: 28, offDays: 14 }, '2026-09-30');
  assert.equal(b.where, 'home');
  assert.equal(b.day, null);
  assert.equal(b.of, null);
  assert.equal(b.daysLeft, 61);
  assert.equal(E.rotation.status({ boatDate: null }, '2026-09-30'), null);
});

test('rotation: kindOf, countDays, upcoming, lastBoatStretch, custom lengths', () => {
  const s = { boatDate: '2026-09-08', onDays: 28, offDays: 14 };
  assert.equal(E.rotation.kindOf(s, '2026-09-01'), 'home');
  assert.equal(E.rotation.kindOf(s, '2026-10-05'), 'boat');
  assert.equal(E.rotation.kindOf(s, '2026-10-06'), 'home');
  assert.equal(E.rotation.kindOf({ boatDate: null }, '2026-10-06'), null);
  assert.deepEqual(E.rotation.countDays(s, '2026-10-01', '2026-10-14'), { home: 9, boat: 5, other: 0 });
  assert.deepEqual(E.rotation.countDays(s, '2026-10-14', '2026-10-01'), { home: 0, boat: 0, other: 0 });
  assert.deepEqual(E.rotation.countDays({ boatDate: null, onDays: 28, offDays: 14 }, '2026-10-01', '2026-10-14'),
    { home: 0, boat: 0, other: 14 });
  assert.deepEqual(E.rotation.upcoming(s, '2026-09-30', 3), [
    { where: 'boat', start: '2026-09-08', end: '2026-10-05' },
    { where: 'home', start: '2026-10-06', end: '2026-10-19' },
    { where: 'boat', start: '2026-10-20', end: '2026-11-16' },
  ]);
  assert.deepEqual(E.rotation.upcoming({ boatDate: '2026-10-12', onDays: 28, offDays: 14 }, '2026-09-30', 2), [
    { where: 'home', start: '2026-09-30', end: '2026-10-11' },
    { where: 'boat', start: '2026-10-12', end: '2026-11-08' },
  ]);
  assert.equal(E.rotation.lastBoatStretch(s, '2026-09-30'), null);
  assert.deepEqual(E.rotation.lastBoatStretch(s, '2026-10-10'), { start: '2026-09-08', end: '2026-10-05' });
  assert.equal(E.rotation.lastBoatStretch({ boatDate: '2026-10-12', onDays: 28, offDays: 14 }, '2026-09-30'), null);
  // A 21/21 rotation.
  const r = { boatDate: '2026-09-01', onDays: 21, offDays: 21 };
  assert.equal(E.rotation.status(r, '2026-09-22').where, 'home');
  assert.equal(E.rotation.status(r, '2026-10-13').where, 'boat');
});

// ---------------------------------------------------------------- pay

test('pay: intervals, per-month, guessNext for every frequency', () => {
  const f = (payFreq) => ({ payFreq, onDays: 28, offDays: 14 });
  assert.equal(E.pay.intervalDays(f('weekly')), 7);
  assert.equal(E.pay.intervalDays(f('semimonthly')), 15);
  assert.equal(E.pay.intervalDays(f('monthly')), 30);
  assert.equal(E.pay.intervalDays(f('rotation')), 42);
  assert.equal(E.pay.intervalDays(f('varies')), 14);
  assert.equal(E.pay.intervalDays(f(null)), 14);
  assert.equal(E.pay.perMonth(f('semimonthly')), 2);
  assert.equal(E.pay.perMonth(f('rotation')), (365.25 / 12) / 42);
  assert.equal(E.pay.guessNext(f('weekly'), '2026-10-01'), '2026-10-08');
  assert.equal(E.pay.guessNext(f('biweekly'), '2026-10-01'), '2026-10-15');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-10-01'), '2026-10-16');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-10-15'), '2026-10-31');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-10-16'), '2026-11-01');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-10-31'), '2026-11-15');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2027-02-15'), '2027-02-28');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2028-02-14'), '2028-02-29');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-12-20'), '2027-01-05');
  assert.equal(E.pay.guessNext(f('monthly'), '2027-01-31'), '2027-02-28');
  assert.equal(E.pay.guessNext(f('monthly'), '2028-01-31'), '2028-02-29');
  assert.equal(E.pay.guessNext(f('rotation'), '2026-10-01'), '2026-11-12');
  assert.equal(E.pay.guessNext({ payFreq: 'rotation', onDays: 21, offDays: 21 }, '2026-10-01'), '2026-11-12');
  assert.equal(E.pay.guessNext(f('varies'), '2026-10-01'), '2026-10-15');
  assert.equal(E.pay.guessNext(f(null), '2026-10-01'), '2026-10-15');
});

// ---------------------------------------------------------------- worked examples

test('P1: first payday splits $2,000 exactly as the spec says', () => {
  const s = base();
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, now('2026-10-01'));
  const p = pd.plan;
  assert.deepEqual(p.window, { billsFrom: '2026-10-01', billsTo: '2026-10-15', spendFrom: '2026-10-01',
    spendTo: '2026-10-14', homeDays: 9, boatDays: 5, otherDays: 0 });
  assert.deepEqual(p.bills.map((b) => [b.name, b.amount, b.due, b.kind]), [
    ['Car insurance', 150, '2026-10-05', 'bill'],
    ['Visa', 40, '2026-10-10', 'min'],
    ['Phone', 80, '2026-10-12', 'bill'],
  ]);
  assert.deepEqual(p.yearlyAside, [{ billId: 'reg', name: 'Car registration', amount: 20, dueDate: '2027-03-15' }]);
  assert.equal(p.billsNeed, 290);
  assert.equal(p.billsKeep, 290);
  assert.equal(p.spend.amount, 950);
  assert.equal(p.spend.desired, 950);
  assert.equal(p.goals.total, 760);
  assert.equal(p.goals.savings, 760);
  assert.deepEqual(p.goals.debts, []);
  assert.equal(p.goals.stageBefore, 1);
  assert.equal(p.status, 'ok');
  assert.deepEqual(p.items.map((i) => [i.key, i.amount]), [['bills', 290], ['spend', 950], ['save', 760]]);
  assert.equal(item(p, 'bills').label, 'Leave $290 in checking for bills');
  assert.equal(item(p, 'spend').label, 'Move $950 to your spending card');
  assert.equal(item(p, 'spend').sub, 'about $100 a day at home · $10 on the boat');
  assert.match(item(p, 'spend').why, /9 days at home at about \$100 a day, plus 5 days on the boat at about \$10 a day\./);
  assert.equal(item(p, 'save').label, 'Move $760 to savings');
  assert.match(item(p, 'save').why, /\$1,000 starter cushion/);
  assert.match(item(p, 'bills').why, /Car insurance, Phone and your Visa minimum are due/);
  assert.equal(item(p, 'bills').sub, '3 bills before Oct 15 · $20 set aside for yearly bills');
  assert.equal(itemsSum(p), 2000);
  assert.match(p.headline, /\$760 goes to your goals/);
  p.items.forEach((i) => assert.ok(i.why && i.why.length > 10, 'every item has a why'));
});

test('P2: stage 1 → 2 inside one paycheck, quick wins, clears Store card', () => {
  const { s, p2 } = afterP2();
  const p = p2.plan;
  assert.equal(p.window.billsFrom, '2026-10-16');
  assert.equal(p.window.billsTo, '2026-10-29');
  assert.equal(p.window.spendFrom, '2026-10-15');
  assert.equal(p.window.spendTo, '2026-10-28');
  // The Store card's Oct 18 minimum moves into the step that clears it.
  assert.deepEqual(p.bills.map((b) => [b.name, b.amount, b.due, b.kind]), [
    ['Streaming', 15, '2026-10-20', 'bill'],
  ]);
  assert.deepEqual(p.yearlyAside, [{ billId: 'reg', name: 'Car registration', amount: 20, dueDate: '2027-03-15' }]);
  assert.equal(p.billsNeed, 35);
  assert.equal(p.spend.amount, 590);
  assert.equal(p.window.homeDays, 5);
  assert.equal(p.window.boatDays, 9);
  assert.equal(p.goals.total, 1350);
  assert.deepEqual(p.goals.debts, [
    { debtId: 'store', name: 'Store card', amount: 500, clears: true },
    { debtId: 'visa', name: 'Visa', amount: 573, clears: false },
  ]);
  assert.equal(p.goals.savings, 302);
  assert.equal(p.goals.stageBefore, 1);
  assert.equal(p.goals.stageAfter, 2);
  assert.deepEqual(p.items.map((i) => [i.key, i.amount]), [
    ['bills', 35], ['spend', 590], ['debt:store', 500], ['debt:visa', 573], ['save', 302]]);
  assert.equal(item(p, 'debt:store').label, 'Pay $500 on Store card — that clears it! 🎉');
  assert.equal(item(p, 'debt:store').clears, true);
  assert.equal(item(p, 'debt:store').debtId, 'store');
  assert.match(item(p, 'debt:store').why, /80% of what's left after bills and spending goes to one debt at a time, smallest first, for quick wins\. This pays off the whole balance, including this month's regular payment\./);
  assert.equal(item(p, 'debt:visa').label, 'Pay $573 extra on Visa');
  assert.equal(item(p, 'save').label, 'Move $302 to savings');
  assert.match(item(p, 'save').why, /starter cushion.*20% of the rest/);
  assert.equal(itemsSum(p), 2000);
  // Ticking the Store card payment pays it off right away.
  tickAll(s, p2, '2026-10-15');
  const r = E.replay(s, '2026-10-18');
  assert.equal(r.debts.store.balance, 0);
  assert.equal(r.debts.store.paidOffOn, '2026-10-15');
  assert.equal(r.debts.visa.balance, 611);
  assert.equal(r.savings, 1262);
});

test('P3: $80 is tight — bills covered, a little spending, goals wait', () => {
  const { p2 } = afterP2(80);
  const p = p2.plan;
  assert.equal(p.billsKeep, 60);
  assert.equal(p.spend.amount, 20);
  assert.equal(p.spend.desired, 590);
  assert.equal(p.goals.total, 0);
  assert.equal(p.status, 'tight');
  assert.deepEqual(p.items.map((i) => [i.key, i.amount]), [['bills', 60], ['spend', 20]]);
  assert.match(p.headline, /bit tight.*\$20 for spending.*that's okay/);
  assert.equal(item(p, 'spend').sub, 'about $1 a day');
  assert.equal(itemsSum(p), 80);
});

test('P4: $30 is short — kind words, keep it all for bills', () => {
  const { p2 } = afterP2(30);
  const p = p2.plan;
  assert.equal(p.status, 'short');
  assert.equal(p.shortBy, 10);            // $40 of bills due (Store card minimum + Streaming)
  assert.equal(p.billsKeep, 30);
  assert.equal(p.spend.amount, 0);
  assert.equal(p.goals.total, 0);
  assert.deepEqual(p.yearlyAside, []);
  assert.deepEqual(p.items.map((i) => [i.key, i.amount]), [['bills', 30]]);
  assert.equal(p.headline, 'This check is $10 short of your bills. That happens, and it\'s fixable.');
  assert.match(p.note, /Keep all of it in checking/);
  assert.doesNotMatch(p.headline + p.note, /should|must|failed|overspen/i);
});

// ---------------------------------------------------------------- bills edge cases

test('bills due on the 31st land on the last day of short months (incl. leap Feb)', () => {
  const s = base();
  s.bills = [{ id: 'rent', name: 'Rent', amount: 900, freq: 'monthly', dueDay: 31, dueMonth: null }];
  s.debts = [];
  const feb27 = E.makePlan(s, { date: '2027-02-20', amount: 3000, nextDate: '2027-03-06' });
  assert.deepEqual(feb27.bills.map((b) => b.due), ['2027-02-28']);
  const feb28 = E.makePlan(s, { date: '2028-02-20', amount: 3000, nextDate: '2028-03-06' });
  assert.deepEqual(feb28.bills.map((b) => b.due), ['2028-02-29']);
  const nov = E.makePlan(s, { date: '2026-11-20', amount: 3000, nextDate: '2026-12-04' });
  assert.deepEqual(nov.bills.map((b) => b.due), ['2026-11-30']);
  // A monthly paycheck window can hold two due dates for the same bill.
  const long = E.makePlan(s, { date: '2026-10-31', amount: 3000, nextDate: '2026-12-31' });
  assert.deepEqual(long.bills.map((b) => b.due), ['2026-10-31', '2026-11-30', '2026-12-31']);
});

test('debt due day 31 and "not sure" (1st) on due dates, incl. Feb 2028', () => {
  const s = E.newState('2028-01-01');
  s.debts = [
    { id: 'a', name: 'Loan', balance: 1000, asOf: '2028-01-01', minPayment: 100, dueDay: 31, rate: 0 },
    { id: 'b', name: 'Friend', balance: 300, asOf: '2028-01-01', minPayment: 50, dueDay: null, rate: null },
  ];
  const r = E.replay(s, '2028-03-01');
  const mins = r.log.filter((e) => e.type === 'min').map((e) => [e.debtId, e.date]);
  assert.deepEqual(mins, [['a', '2028-01-31'], ['b', '2028-02-01'], ['a', '2028-02-29'], ['b', '2028-03-01']]);
  assert.equal(r.debts.a.balance, 800);
  assert.equal(r.debts.b.balance, 200);
});

test('yearly bill due inside the window: full remaining amount, minus what was set aside', () => {
  const s = base();
  s.debts = [];
  const plan = E.makePlan(s, { date: '2027-03-05', amount: 2000, nextDate: '2027-03-19' });
  const reg = plan.bills.find((b) => b.refId === 'reg');
  assert.equal(reg.amount, 240);
  assert.equal(reg.kind, 'yearly');
  assert.equal(reg.due, '2027-03-15');
  assert.deepEqual(plan.yearlyAside, []);

  // With paydays that already set some aside, only the rest is due.
  const t = base();
  t.debts = [];
  const a = E.act.addPayday(t, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  const b = E.act.addPayday(t, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' });
  assert.equal(a.plan.yearlyAside[0].amount, 20);
  assert.equal(b.plan.yearlyAside[0].amount, 20);
  const late = E.act.addPayday(t, { date: '2027-03-05', amount: 2000, nextDate: '2027-03-19' });
  const due = late.plan.bills.find((x) => x.refId === 'reg');
  assert.equal(due.amount, 200);
  // Next payday: next year's registration starts a fresh set-aside.
  const after = E.act.addPayday(t, { date: '2027-03-19', amount: 2000, nextDate: '2027-04-02' });
  assert.equal(after.plan.yearlyAside[0].dueDate, '2028-03-15');
});

test('late paycheck: 31-day catch-up covers bills due since the last window', () => {
  const { s } = afterP1();
  const p = E.act.addPayday(s, { date: '2026-10-20', amount: 2000, nextDate: '2026-11-03' }).plan;
  assert.equal(p.window.billsFrom, '2026-10-16');
  const store = p.bills.find((b) => b.refId === 'store');
  assert.equal(store.due, '2026-10-18');
  assert.equal(store.amount, 25);
  assert.equal(store.past, true);
  assert.ok(p.bills.find((b) => b.refId === 'stream' && b.due === '2026-10-20'));
  assert.ok(p.bills.find((b) => b.refId === 'ins' && b.due === '2026-11-05') === undefined);
  // Spending restarts the day after the last covered day (no gap/overlap).
  assert.equal(p.window.spendFrom, '2026-10-20');
  // Two weeks late still reaches back to the last window.
  const { s: s2 } = afterP1();
  const q = E.act.addPayday(s2, { date: '2026-10-30', amount: 2000, nextDate: '2026-11-13' }).plan;
  assert.equal(q.window.billsFrom, '2026-10-16');
  assert.ok(q.bills.find((b) => b.refId === 'stream' && b.past));
  assert.ok(q.bills.find((b) => b.refId === 'store' && b.past));
  // A very late paycheck only reaches back 31 days.
  const { s: s3 } = afterP1();
  const r = E.act.addPayday(s3, { date: '2026-11-30', amount: 2000, nextDate: '2026-12-14' }).plan;
  assert.equal(r.window.billsFrom, '2026-10-30');
  assert.equal(r.bills.find((b) => b.refId === 'stream' && b.due === '2026-10-20'), undefined);
});

test('early paycheck: no bill or spending day counted twice', () => {
  const { s } = afterP1();
  const p = E.act.addPayday(s, { date: '2026-10-10', amount: 2000, nextDate: '2026-10-24' }).plan;
  assert.equal(p.window.billsFrom, '2026-10-16');
  assert.equal(p.window.spendFrom, '2026-10-15');
  assert.equal(p.window.spendTo, '2026-10-23');
  assert.equal(p.bills.find((b) => b.refId === 'phone'), undefined, 'Phone (Oct 12) was covered by P1');
  assert.equal(p.bills.find((b) => b.refId === 'visa'), undefined, 'Visa min (Oct 10) was covered by P1');
  assert.equal(p.window.homeDays + p.window.boatDays, 9);
  assert.equal(p.spend.amount, 5 * 100 + 4 * 10);
  // Visa's Oct 10 minimum already came off before this payday's extra.
  assert.equal(itemsSum(p), 2000);
});

test('two paydays on the same date: second gets no spending; bills only if the window extends', () => {
  const { s } = afterP1();
  const same = E.act.addPayday(s, { date: '2026-10-01', amount: 500, nextDate: '2026-10-15' }).plan;
  assert.equal(same.spend.amount, 0);
  assert.equal(same.billsNeed, 0);
  assert.deepEqual(same.bills, []);
  assert.deepEqual(same.yearlyAside, []);
  assert.equal(item(same, 'bills'), undefined);
  assert.equal(same.goals.total, 500);
  assert.equal(itemsSum(same), 500);
  assert.equal(same.status, 'ok');

  const { s: s2 } = afterP1();
  const ext = E.act.addPayday(s2, { date: '2026-10-01', amount: 500, nextDate: '2026-10-29' }).plan;
  assert.equal(ext.window.billsFrom, '2026-10-16');
  assert.equal(ext.window.spendFrom, '2026-10-15');
  assert.deepEqual(ext.bills.map((b) => b.refId), ['store', 'stream']);
  assert.equal(itemsSum(ext), 500);
});

test('payday entered with an earlier "Paid on" date still counts steps ticked since', () => {
  // Last payday's steps get ticked on Oct 16, then the user logs a payday that landed Oct 15.
  const s = base();
  const p1 = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  tickAll(s, p1, '2026-10-16');
  const p = E.act.addPayday(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }).plan;
  assert.deepEqual(p.items.map((i) => [i.key, i.amount]), [
    ['bills', 35], ['spend', 590], ['debt:store', 500], ['debt:visa', 573], ['save', 302]]);
  // Plain replay still dates those ticks on Oct 16.
  assert.equal(E.replay(s, '2026-10-15').savings, 200);
  assert.equal(E.replay(s, '2026-10-16').savings, 960);
});

test('a tight or short paycheck only records the set-aside money that was really there', () => {
  const { s, p2 } = afterP2(45);
  assert.equal(p2.plan.status, 'tight', 'every bill is covered; only the set-aside is partial');
  assert.deepEqual(p2.plan.yearlyAside.map((y) => y.amount), [5]);   // 45 − 40 of real bills
  assert.equal(p2.plan.billsNeed, 45);
  const tiny = E.act.addPayday(s, { date: '2026-10-29', amount: 10, nextDate: '2026-11-12' }).plan;
  assert.equal(tiny.status, 'short');
  assert.deepEqual(tiny.yearlyAside, [], 'nothing left over for set-asides');
  // At due time the bill asks for 240 − 20 (P1) − 5 (P2) = 215.
  const due = E.act.addPayday(s, { date: '2027-03-05', amount: 3000, nextDate: '2027-03-19' }).plan;
  assert.equal(due.bills.find((b) => b.refId === 'reg').amount, 215);
});

// ---------------------------------------------------------------- goals waterfall

test('one big paycheck clears both debts; the overflow goes to savings', () => {
  const { p2 } = afterP2(5000);
  const p = p2.plan;
  assert.equal(p.goals.total, 4350);
  // cushion 40; rest 4310 → debt part 3448: Store 475 + Visa 1184 = 1659; overflow 1789; save part 862.
  // The Store card step also takes its $25 minimum from the bills pile.
  assert.deepEqual(p.goals.debts.map((d) => [d.debtId, d.amount, d.clears]), [['store', 500, true], ['visa', 1184, true]]);
  assert.equal(p.goals.savings, 40 + 862 + 1789);
  assert.equal(p.goals.stageAfter, 3);
  assert.match(item(p, 'save').why, /every debt/);
  // Visa has no regular payment before the next payday, so this step alone pays it off.
  assert.match(item(p, 'debt:visa').why, /This pays it off\.$/);
  assert.match(item(p, 'debt:store').why, /including this month's regular payment/);
  assert.equal(itemsSum(p), 5000);
});

test('a very tight payday on the boat says "less than $1 a day", not cents', () => {
  const { p2 } = afterP2(70);
  assert.equal(p2.plan.status, 'tight');
  assert.equal(item(p2.plan, 'spend').amount, 10);
  assert.equal(item(p2.plan, 'spend').sub, 'less than $1 a day');
});

test('debtShare 1.0 and 0.2', () => {
  const all = afterP2Settings({ debtShare: 1 });
  assert.deepEqual(all.goals.debts.map((d) => d.amount), [500, 835]);
  assert.equal(all.goals.savings, 40);
  assert.match(item(all, 'debt:store').why, /^Everything left after bills and spending/);
  const little = afterP2Settings({ debtShare: 0.2 });
  assert.deepEqual(little.goals.debts.map((d) => [d.debtId, d.amount, d.clears]), [['store', 262, false]]);
  assert.equal(little.goals.savings, 40 + 1048);
  assert.match(item(little, 'save').why, /80% of the rest/);
  assert.equal(itemsSum(little), 2000);
});
function afterP2Settings(settings) {
  const s = base({ settings });
  const p1 = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  tickAll(s, p1, '2026-10-01');
  return E.act.addPayday(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }).plan;
}

test("'interest' order: highest rate first, unknown rate counts as 0, tie → smaller balance", () => {
  const list = [
    { id: 'a', name: 'A', balance: 100, rate: null },
    { id: 'b', name: 'B', balance: 900, rate: 5 },
    { id: 'c', name: 'C', balance: 2000, rate: 20 },
    { id: 'd', name: 'D', balance: 50, rate: null },
  ];
  assert.deepEqual(E.orderDebts(list, 'interest').map((d) => d.id), ['c', 'b', 'd', 'a']);
  assert.deepEqual(E.orderDebts(list, 'quick').map((d) => d.id), ['d', 'a', 'b', 'c']);
  const p = afterP2Settings({ method: 'interest' });
  assert.deepEqual(p.goals.debts.map((d) => [d.debtId, d.amount]), [['visa', 1048]]);
  assert.match(item(p, 'debt:visa').why, /highest interest rate first, so you pay less interest/);
});

test('stage 1 only: a small paycheck all goes to the cushion; no debt items', () => {
  const s = base();
  s.savings = { amount: 0, asOf: '2026-09-30' };
  const p = E.makePlan(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(p.goals.savings, 760);
  assert.equal(p.goals.debts.length, 0);
});

test('no debts, cushion full: stage 3 and stage 4 wording', () => {
  const s = base();
  s.debts = [];
  s.savings = { amount: 1500, asOf: '2026-09-30' };
  const p = E.makePlan(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(p.goals.stageBefore, 3);
  assert.match(item(p, 'save').why, /You're debt-free! Extra money now grows your safety net to 3 months of bills and spending \(\$4,450\)/);
  s.savings.amount = 10000;
  const q = E.makePlan(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(q.goals.stageBefore, 4);
  assert.match(item(q, 'save').why, /safety net is full/);
});

test('a regular payment that finishes a debt inside the window: bills cover the rest, no extra item', () => {
  const s = base();
  s.debts[1].balance = 20;                     // Store card: $20 left, $25 minimum due Oct 18
  const p = E.makePlan(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' });
  assert.equal(p.bills.find((b) => b.refId === 'store').amount, 20);
  assert.equal(item(p, 'debt:store'), undefined);
  assert.ok(item(p, 'debt:visa'));
  assert.equal(itemsSum(p), 2000);
});

// ---------------------------------------------------------------- replay

test('replay: interest then minimum on each due date; start stays the original balance', () => {
  const s = base();
  const r = E.replay(s, '2026-11-10');
  assert.equal(r.debts.visa.balance, 1167.68);   // 1200 +24 −40 = 1184; +23.68 −40
  assert.equal(r.debts.visa.start, 1200);
  assert.equal(r.debts.store.balance, 475);
  const visa = r.log.filter((e) => e.debtId === 'visa');
  assert.deepEqual(visa.map((e) => [e.date, e.type, e.amount]), [
    ['2026-10-10', 'interest', 24], ['2026-10-10', 'min', 40],
    ['2026-11-10', 'interest', 23.68], ['2026-11-10', 'min', 40],
  ]);
  // A due date on asOf itself doesn't count.
  const t = base();
  t.debts[0].asOf = '2026-10-10';
  assert.equal(E.replay(t, '2026-10-10').debts.visa.balance, 1200);
});

test('replay: tick / untick moves progress only when ticked', () => {
  const s = base();
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(E.replay(s, '2026-10-01').savings, 200);
  E.act.tick(s, pd.id, 'save', true, now('2026-10-01'));
  assert.equal(E.replay(s, '2026-10-01').savings, 960);
  assert.equal(E.replay(s, '2026-09-30').savings, 200, 'ticks count from their tick date');
  E.act.tick(s, pd.id, 'save', false, now('2026-10-01'));
  assert.equal(E.replay(s, '2026-10-01').savings, 200);
  assert.deepEqual(pd.ticks, {});
  E.act.tick(s, pd.id, 'nope', true, now('2026-10-01'));
  assert.deepEqual(pd.ticks, {}, 'unknown key is ignored');
});

test('replay: check-ins override; on the same day a check-in always comes after ticks', () => {
  const s = base();
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  E.act.tick(s, pd.id, 'save', true, { d: '2026-10-01', t: 100 });
  E.act.addCheckin(s, { savings: 500 }, { d: '2026-10-01', t: 50 });
  assert.equal(E.replay(s, '2026-10-01').savings, 500, 'the check-in wins even when made before the tick');
  s.checkins[0].t = 200;
  assert.equal(E.replay(s, '2026-10-01').savings, 500, 'tick first, then the check-in sets 500');
  // Debt check-in replaces the estimate; a later due date works from it.
  E.act.setDebtBalance(s, 'visa', 1000, { d: '2026-10-05', t: 300 });
  const r = E.replay(s, '2026-10-10');
  assert.equal(r.debts.visa.balance, 980);   // 1000 + 20 interest − 40
  assert.ok(r.log.some((e) => e.type === 'checkin' && e.debtId === 'visa' && e.amount === 1000));
  // Only the fields the user filled are recorded.
  E.act.addCheckin(s, { debts: { store: '', visa: null }, savings: '' }, now('2026-10-11'));
  assert.deepEqual(s.checkins[s.checkins.length - 1].debts, {});
  assert.equal(s.checkins[s.checkins.length - 1].savings, null);
});

test('replay: a check-in can re-open a paid-off debt (and zero one out)', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  assert.equal(E.replay(s, '2026-10-20').debts.store.paidOffOn, '2026-10-15');
  E.act.setDebtBalance(s, 'store', 120, { d: '2026-10-21', t: 1 });
  const r = E.replay(s, '2026-10-21');
  assert.equal(r.debts.store.balance, 120);
  assert.equal(r.debts.store.paidOffOn, null);
  const sum = E.summary(s, '2026-10-21');
  assert.ok(sum.debts.find((d) => d.id === 'store').open);
  E.act.setDebtBalance(s, 'store', 0, { d: '2026-10-22', t: 1 });
  assert.equal(E.replay(s, '2026-10-22').debts.store.paidOffOn, '2026-10-22');
});

test('replay: ticks before a debt\'s start date and unknown debts are ignored', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  s.debts.find((d) => d.id === 'visa').asOf = '2026-10-16';
  assert.equal(E.replay(s, '2026-10-16').debts.visa.balance, 1200);
  s.debts = s.debts.filter((d) => d.id !== 'store');
  assert.doesNotThrow(() => E.replay(s, '2026-10-20'));
  assert.equal(E.replay(s, '2026-10-20').debts.store, undefined);
});

// ---------------------------------------------------------------- actions

test('addPayday validates dates and amounts', () => {
  const { s } = afterP1();
  assert.throws(() => E.act.addPayday(s, { date: '2026-09-20', amount: 100, nextDate: '2026-10-04' }));
  assert.throws(() => E.act.addPayday(s, { date: '2026-10-15', amount: 0, nextDate: '2026-10-29' }));
  assert.throws(() => E.act.addPayday(s, { date: '2026-10-15', amount: 'abc', nextDate: '2026-10-29' }));
  assert.throws(() => E.act.addPayday(s, { date: '2026-10-15', amount: 100, nextDate: '2026-10-15' }));
  assert.throws(() => E.act.addPayday(s, { date: 'bad', amount: 100 }));
  const pd = E.act.addPayday(s, { date: '2026-10-15', amount: '2000' });
  assert.equal(pd.nextDate, '2026-10-29', 'guesses the next payday when missing');
  assert.equal(pd.amount, 2000);
  assert.equal(s.paydays.length, 2);
});

test('editPayday: recomputes, keeps a tick only when key and amount still match', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  E.act.editPayday(s, p2.id, { date: '2026-10-15', amount: 2100, nextDate: '2026-10-29' }, now('2026-10-15'));
  const p = s.paydays[1];
  assert.equal(p.amount, 2100);
  assert.equal(p.plan.amount, 2100);
  assert.equal(item(p.plan, 'debt:visa').amount, 653);
  assert.deepEqual(Object.keys(p.ticks).sort(), ['bills', 'debt:store', 'spend']);
  // The edit ignores the payday's own old ticks when reading balances.
  assert.equal(p.plan.goals.stageBefore, 1);
  assert.equal(itemsSum(p.plan), 2100);
  // Only the latest can be edited.
  assert.throws(() => E.act.editPayday(s, s.paydays[0].id, { date: '2026-10-01', amount: 10, nextDate: '2026-10-15' }));
  assert.throws(() => E.act.editPayday(s, p2.id, { date: '2026-09-01', amount: 10, nextDate: '2026-10-15' }));
});

test('editPayday: fixing the amount does not double-count the edited payday\'s own set-aside', () => {
  const { s, p2 } = afterP2();
  E.act.editPayday(s, p2.id, { date: '2026-10-15', amount: 1900, nextDate: '2026-10-29' });
  assert.equal(s.paydays[1].plan.yearlyAside[0].amount, 20);
  assert.equal(s.paydays[1].plan.billsNeed, 35);   // Streaming 15 + set-aside 20 (Store card minimum is in its clearing step)
});

test('undoPayday restores balances and the checklist', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  assert.equal(E.replay(s, '2026-10-20').debts.store.balance, 0);
  E.act.undoPayday(s, p2.id);
  const r = E.replay(s, '2026-10-20');
  assert.equal(r.debts.store.balance, 475);
  assert.equal(r.savings, 960);
  assert.equal(s.paydays.length, 1);
  // Undo an older payday too.
  E.act.undoPayday(s, s.paydays[0].id);
  assert.equal(E.replay(s, '2026-10-20').savings, 200);
});

test('setBoatDate re-lines the rotation', () => {
  const s = base();
  E.act.setBoatDate(s, '2026-10-12');
  assert.equal(E.summary(s, '2026-09-30').rotation.beforeStart, true);
  assert.throws(() => E.act.setBoatDate(s, 'nope'));
});

// ---------------------------------------------------------------- streak, milestones, recap, reminders

test('streak: consecutive complete paydays; an in-progress latest one does not break it', () => {
  const s = base();
  const a = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(E.streak(s), 0);
  tickAll(s, a, '2026-10-01');
  assert.equal(E.streak(s), 1);
  const b = E.act.addPayday(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' });
  assert.equal(E.streak(s), 1, 'newest still in progress');
  tickAll(s, b, '2026-10-15');
  assert.equal(E.streak(s), 2);
  const c = E.act.addPayday(s, { date: '2026-10-29', amount: 2000, nextDate: '2026-11-12' });
  E.act.tick(s, c.id, c.plan.items[0].key, true, now('2026-10-29'));
  assert.equal(E.streak(s), 2);
  E.act.tick(s, b.id, 'spend', false, now('2026-10-29'));
  assert.equal(E.streak(s), 0, 'an unfinished older payday breaks it');
  tickAll(s, c, '2026-10-29');
  assert.equal(E.streak(s), 1);
});

test('milestones: every key, and newMilestones skips celebrated ones', () => {
  const s = base();
  const keys = () => E.milestones(s, '2026-11-01').map((m) => m.key);
  assert.deepEqual(keys(), []);
  const a = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  tickAll(s, a, '2026-10-01');
  assert.deepEqual(keys(), ['first']);
  E.act.setSavings(s, 1000, now('2026-10-02'));
  assert.deepEqual(keys(), ['first', 'cushion']);
  E.act.setDebtBalance(s, 'visa', 300, now('2026-10-03'));   // 300 + 475(store after min Oct 18) ≤ 850
  assert.deepEqual(keys(), ['first', 'cushion', 'halfway']);
  E.act.setDebtBalance(s, 'store', 0, now('2026-10-04'));
  assert.deepEqual(keys(), ['first', 'cushion', 'paid:store', 'halfway']);
  const paid = E.milestones(s, '2026-11-01').find((m) => m.key === 'paid:store');
  assert.equal(paid.title, 'Store card: PAID OFF!');
  assert.equal(paid.emoji, '🏝️');
  E.act.setDebtBalance(s, 'visa', 0, now('2026-10-05'));
  assert.deepEqual(keys(), ['first', 'cushion', 'paid:store', 'paid:visa', 'halfway', 'debtfree']);
  E.act.setSavings(s, 10000, now('2026-10-06'));
  assert.deepEqual(keys(), ['first', 'cushion', 'paid:store', 'paid:visa', 'halfway', 'debtfree', 'harbor']);
  const ms = E.milestones(s, '2026-11-01');
  ms.forEach((m) => { assert.ok(m.emoji && m.title && m.message); });
  assert.equal(ms.find((m) => m.key === 'debtfree').title, 'DEBT-FREE!');
  assert.equal(ms.find((m) => m.key === 'harbor').emoji, '⚓');

  E.act.markCelebrated(s, ['first', 'cushion'], '2026-11-01');
  assert.deepEqual(E.summary(s, '2026-11-01').newMilestones.map((m) => m.key),
    ['paid:store', 'paid:visa', 'halfway', 'debtfree', 'harbor']);
  E.act.markAllCelebrated(s, '2026-11-01');
  assert.deepEqual(E.summary(s, '2026-11-01').newMilestones, []);
  assert.equal(s.meta.celebrated.harbor, '2026-11-01');
});

test('milestones: no debts never means "debt-free" or "halfway"', () => {
  const s = base();
  s.debts = [];
  const keys = E.milestones(s, '2026-10-01').map((m) => m.key);
  assert.ok(!keys.includes('debtfree') && !keys.includes('halfway'));
});

test('recap: what happened on the last boat stretch', () => {
  const s = base();
  s.createdAt = '2026-09-01';
  s.debts.forEach((d) => { d.asOf = '2026-09-01'; });
  s.savings.asOf = '2026-09-01';
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  tickAll(s, pd, '2026-10-01');
  assert.equal(E.summary(s, '2026-10-05').recap, null, 'still on the boat');
  const r = E.summary(s, '2026-10-06').recap;
  assert.equal(r.key, '2026-09-08');
  assert.equal(r.start, '2026-09-08');
  assert.equal(r.end, '2026-10-05');
  assert.equal(r.saved, 760);
  // Sep 10 Visa minimum and Sep 18 Store card minimum were paid while out there.
  assert.equal(r.debtPaid, 65);
  assert.deepEqual(r.paidOff, []);
  assert.equal(r.paydays, 1);
  assert.equal(r.ticked, 3);
  assert.equal(r.total, 3);
  E.act.markRecapShown(s, r.key);
  assert.equal(E.summary(s, '2026-10-06').recap, null);
});

test('recap: empty stretch, and a stretch that ended before setup', () => {
  const s = base();
  s.createdAt = '2026-10-01';
  s.debts.forEach((d) => { d.asOf = '2026-10-01'; });
  assert.deepEqual(E.summary(s, '2026-10-06').recap, { key: '2026-09-08', empty: true });
  s.createdAt = '2026-10-06';
  assert.equal(E.summary(s, '2026-10-06').recap, null);
  s.settings.boatDate = '2026-10-20';
  assert.equal(E.summary(s, '2026-10-06').recap, null, 'beforeStart');
});

test('checkinDue and backupDue, incl. snooze', () => {
  const s = base();
  assert.equal(E.summary(s, '2026-10-29').checkinDue, false);
  assert.equal(E.summary(s, '2026-10-30').checkinDue, true);
  E.act.snoozeCheckin(s, '2026-10-30', 30);
  assert.equal(E.summary(s, '2026-11-15').checkinDue, false);
  assert.equal(E.summary(s, '2026-11-29').checkinDue, true);
  s.meta.checkinSnoozeUntil = null;
  E.act.addCheckin(s, { savings: 300 }, now('2026-11-01'));
  assert.equal(E.summary(s, '2026-11-30').checkinDue, false);
  assert.equal(E.summary(s, '2026-12-01').checkinDue, true);
  const empty = E.newState('2026-09-30');
  assert.equal(E.summary(empty, '2027-09-30').checkinDue, false, 'nothing to check');

  assert.equal(E.summary(s, '2026-10-01').backupDue, false, 'no paydays yet');
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(E.summary(s, '2026-10-01').backupDue, true, 'never backed up');
  E.act.markBackedUp(s, '2026-10-01');
  assert.equal(E.summary(s, '2026-10-30').backupDue, false);
  assert.equal(E.summary(s, '2026-10-31').backupDue, true);
  E.act.snoozeBackup(s, '2026-10-31', 7);
  assert.equal(E.summary(s, '2026-11-06').backupDue, false);
  assert.equal(E.summary(s, '2026-11-07').backupDue, true);
});

// ---------------------------------------------------------------- projection

test('project: a bigger paycheck means an earlier debt-free date', () => {
  const small = base({ settings: { payAmount: 1200 } });
  const big = base({ settings: { payAmount: 2500 } });
  const a = E.project(small, '2026-09-30');
  const b = E.project(big, '2026-09-30');
  assert.ok(dates.isValid(a.debtFree) && dates.isValid(b.debtFree));
  assert.ok(b.debtFree < a.debtFree, b.debtFree + ' < ' + a.debtFree);
  assert.equal(a.alreadyDebtFree, false);
  assert.ok(dates.isValid(b.safeHarbor) && b.safeHarbor >= b.debtFree);
});

test('project: the latest plan counts once entered; ticking keeps the date; paying more moves it closer', () => {
  const { s, p2 } = afterP2();
  const before = E.project(s, '2026-10-15');
  tickAll(s, p2, '2026-10-15');
  const after = E.project(s, '2026-10-15');
  assert.equal(after.debtFree, before.debtFree);
  E.act.setDebtBalance(s, 'visa', 5000, now('2026-10-16'));
  const big = E.project(s, '2026-10-16');
  E.act.setDebtBalance(s, 'visa', 4000, now('2026-10-17'));
  const more = E.project(s, '2026-10-17');
  assert.ok(more.debtFree < big.debtFree, more.debtFree + ' < ' + big.debtFree);
});

test('project: debt-free date is when the LAST debt hits zero', () => {
  // Paid down only by regular payments: A clears Nov 20, B clears Nov 5 (A comes first in the list).
  const s = base({ settings: { payAmount: 100, payFreq: 'monthly' } });   // both land between the same paydays
  s.bills = [];
  s.debts = [
    { id: 'a', name: 'A', balance: 60, asOf: '2026-09-30', minPayment: 30, dueDay: 20, rate: 0 },
    { id: 'b', name: 'B', balance: 60, asOf: '2026-09-30', minPayment: 30, dueDay: 5, rate: 0 },
  ];
  s.settings.homeSpend = 5000;                  // no money left for extra payments
  assert.equal(E.project(s, '2026-09-30').debtFree, '2026-11-20');
});

test('project: no pay → null with reason; no debts → already debt-free; average of paydays', () => {
  const s = base({ settings: { payAmount: null } });
  const r = E.project(s, '2026-09-30');
  assert.equal(r.debtFree, null);
  assert.equal(r.reason, 'no-pay');
  const n = base();
  n.debts = [];
  const q = E.project(n, '2026-09-30');
  assert.equal(q.alreadyDebtFree, true);
  assert.ok(q.debtFree);
  assert.ok(dates.isValid(q.safeHarbor));
  // payAmount unset but paydays logged → uses their average.
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.ok(dates.isValid(E.project(s, '2026-10-01').debtFree));
});

test('project: gives up within 10 years when it can\'t get there', () => {
  const s = base({ settings: { payAmount: 700 } });
  s.debts.push({ id: 'loan', name: 'Big loan', balance: 90000, asOf: '2026-09-30', minPayment: 50, dueDay: 1, rate: 20 });
  const t0 = Date.now();
  const r = E.project(s, '2026-09-30');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.debtFree, null);
  assert.ok(r.reason === 'too-long' || r.reason === 'no-extra');
  const broke = base({ settings: { payAmount: 50 } });
  assert.equal(E.project(broke, '2026-09-30').reason, 'no-extra');
});

// ---------------------------------------------------------------- spending suggestions

test('suggestSpending: realistic amounts rounded to 50 / 10', () => {
  const s = base({ settings: { homeSpend: null, boatSpend: null } });
  const g = E.suggestSpending(s);
  assert.equal(g.ok, true);
  assert.equal(g.home % 50, 0);
  assert.equal(g.boat % 10, 0);
  // income 2000×26/12 = 4333.33; bills 265 + 65 minimums → free 4003.33; half → 2001.67/month.
  assert.equal(g.perMonthIncome, 4333.33);
  assert.equal(g.perMonthBills, 330);
  assert.equal(g.home, 2100);
  assert.equal(g.boat, 640);
  assert.equal(g.homeDaily, 150);
  assert.ok(g.homeDaily > g.boatDaily);
  assert.ok(g.perMonthGoals > 1000);
  const other = E.suggestSpending(s, { payAmount: 1000 });
  assert.ok(other.home < g.home);
});

test('suggestSpending: ok:false when bills eat the paycheck', () => {
  const s = base({ settings: { payAmount: 100 } });
  const g = E.suggestSpending(s);
  assert.equal(g.ok, false);
  assert.equal(g.home, 0);
  assert.equal(g.boat, 0);
  assert.ok(g.perMonthGoals < 0);
});

test('spending falls back to the suggestion when home/boat amounts are unset', () => {
  const s = base({ settings: { homeSpend: null, boatSpend: null } });
  const p = E.makePlan(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  // 9 home × 150 + 5 boat × 640/28
  assert.equal(p.spend.desired, Math.round(9 * 150 + 5 * 640 / 28));
  assert.equal(itemsSum(p), 2000);
  // With no normal paycheck set, the suggestion uses this paycheck.
  const t = base({ settings: { homeSpend: null, boatSpend: null, payAmount: null } });
  const q = E.makePlan(t, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(q.spend.desired, p.spend.desired);
});

test('no boat date: spending uses the blended daily rate', () => {
  const s = base({ settings: { boatDate: null } });
  const p = E.makePlan(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(p.window.otherDays, 14);
  assert.equal(p.window.homeDays, 0);
  assert.equal(p.spend.otherDaily, 40);          // (1400 + 280) / 42
  assert.equal(p.spend.amount, 560);
  assert.equal(item(p, 'spend').sub, 'about $40 a day');
  assert.match(item(p, 'spend').why, /14 days at about \$40 a day/);
  assert.equal(itemsSum(p), 2000);
});

// ---------------------------------------------------------------- money details

test('cents: stray cents stay in checking and items add up exactly', () => {
  const s = base();
  const p = E.makePlan(s, { date: '2026-10-01', amount: 2000.37, nextDate: '2026-10-15' });
  assert.equal(item(p, 'bills').amount, 290.37);
  assert.equal(item(p, 'bills').label, 'Leave $290.37 in checking for bills');
  assert.equal(item(p, 'spend').amount, 950);
  assert.equal(item(p, 'save').amount, 760);
  assert.equal(itemsSum(p), 2000.37);
  // Bills with cents round the keep up to whole units; the rest still adds up.
  const t = base();
  t.bills[1].amount = 79.99;
  const q = E.makePlan(t, { date: '2026-10-01', amount: 1999.99, nextDate: '2026-10-15' });
  assert.equal(q.billsNeed, 289.99);
  assert.equal(q.billsKeep, 290);
  assert.equal(itemsSum(q), 1999.99);
  q.items.filter((i) => i.kind !== 'bills').forEach((i) => assert.equal(i.amount, Math.round(i.amount)));
});

test('custom money formatter is used in every label', () => {
  const s = base();
  const fmt = (n) => 'R' + E.round2(n).toFixed(0);
  const { s: s2, p2 } = afterP2();
  const plan = E.makePlan(s2, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29', excludeId: p2.id }, { money: fmt });
  assert.equal(item(plan, 'bills').label, 'Leave R35 in checking for bills');
  assert.equal(item(plan, 'spend').label, 'Move R590 to your spending card');
  assert.equal(item(plan, 'debt:store').label, 'Pay R500 on Store card — that clears it! 🎉');
  assert.equal(item(plan, 'save').label, 'Move R302 to savings');
  assert.match(plan.headline, /R1350/);
  plan.items.forEach((i) => assert.doesNotMatch(i.label + (i.sub || '') + i.why, /\$/));
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, now('2026-10-01'), { money: fmt });
  assert.equal(item(pd.plan, 'save').label, 'Move R760 to savings');
  assert.equal(E.summary(s, '2026-10-01', { money: fmt }).voyage.stops[1].sub, 'R1000');
});

// ---------------------------------------------------------------- targets & stage

test('targets and stage', () => {
  const s = base();
  assert.equal(E.monthlyBills(s), 265);
  assert.equal(E.monthlySpend(s.settings), 1217.5);
  assert.equal(E.safetyTarget(s), 4450);
  assert.equal(E.monthlySpend({ homeSpend: null, boatSpend: null, onDays: 28, offDays: 14 }), 0);
  s.settings.cushion = 9000;
  assert.equal(E.safetyTarget(s), 9000);
  const o = { cushion: 1000, safetyTarget: 4450 };
  assert.equal(E.stage({ ...o, savings: 999, openDebtCount: 0 }), 1);
  assert.equal(E.stage({ ...o, savings: 999.6, openDebtCount: 1 }), 2);
  assert.equal(E.stage({ ...o, savings: 2000, openDebtCount: 0 }), 3);
  assert.equal(E.stage({ ...o, savings: 4450, openDebtCount: 0 }), 4);
  assert.equal(E.stageName(2), 'Crush the debt');
});

// ---------------------------------------------------------------- summary

test('summary: debts in payoff order, voyage stops and boat position, jar', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  const sum = E.summary(s, '2026-10-20');
  assert.equal(sum.stage, 2);
  assert.equal(sum.stageName, 'Crush the debt');
  assert.deepEqual(sum.debts.map((d) => [d.id, d.open, d.isTarget]), [['store', false, false], ['visa', true, true]]);
  assert.equal(sum.totalDebtStart, 1700);
  assert.equal(sum.totalDebtNow, 611);
  assert.deepEqual(sum.voyage.stops.map((x) => [x.kind, x.label, x.done]), [
    ['start', 'Start', true], ['cushion', 'Starter cushion', true], ['debt', 'Store card', true],
    ['debtfree', 'Debt-Free', false], ['harbor', 'Safe Harbor', false]]);
  assert.equal(sum.voyage.stops[3].sub, 'Visa');
  // Boat between Store card (index 2) and Debt-Free (3): 1 − 611/1200 of the way.
  assert.equal(sum.voyage.position, 2 + (1 - 611 / 1200));
  assert.deepEqual(sum.jar, { amount: 1262, target: 4450, fraction: 1262 / 4450, label: 'Safety net' });
  assert.equal(sum.latest.id, p2.id);
  assert.deepEqual(sum.openItems, []);
  assert.equal(sum.nextPayday, '2026-10-29');
  assert.equal(sum.streak, 2);
  assert.ok(sum.newMilestones.some((m) => m.key === 'paid:store'));
  assert.ok(sum.projection && 'debtFree' in sum.projection);
  assert.equal(sum.rotation.where, 'boat');
});

test('summary: brand-new state is safe to render', () => {
  const s = E.newState('2026-09-30');
  const sum = E.summary(s, '2026-09-30');
  assert.equal(sum.rotation, null);
  assert.equal(sum.latest, null);
  assert.deepEqual(sum.openItems, []);
  assert.equal(sum.nextPayday, null);
  assert.equal(sum.stage, 1);
  assert.equal(sum.jar.label, 'Starter cushion');
  assert.deepEqual(sum.voyage.stops.map((x) => x.kind), ['start', 'cushion', 'debtfree', 'harbor']);
  assert.equal(sum.voyage.stops[2].sub, 'No debts');
  assert.equal(sum.voyage.position, 0);
  assert.equal(sum.projection.reason, 'no-pay');
  assert.equal(sum.recap, null);
});

// ---------------------------------------------------------------- state & backup

test('normalizeState / readBackup accept a real backup', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  E.act.addCheckin(s, { debts: { visa: 600 }, savings: 1300 }, now('2026-10-20'));
  const bk = E.makeBackup(s, '2026-10-20');
  assert.equal(bk.app, 'harbor');
  assert.equal(bk.schema, 2, 'SPEC §10.1: backups are written as schema 2');
  assert.equal(bk.exportedAt, '2026-10-20');
  const text = JSON.stringify(bk);
  const r = E.readBackup(text, '2026-10-21');
  assert.equal(r.ok, true);
  assert.deepEqual(r.info, { exportedAt: '2026-10-20', paydays: 2, debts: 2 });
  const expected = JSON.parse(JSON.stringify(s));
  expected.meta.lastBackupAt = '2026-10-20';           // the backup records its own date
  assert.deepEqual(r.state, expected);
  assert.equal(E.readBackup(JSON.parse(text), '2026-10-21').ok, true);
  const n = E.normalizeState(JSON.parse(JSON.stringify(s)), '2026-10-21');
  assert.equal(n.ok, true);
  assert.deepEqual(E.summary(n.state, '2026-10-21').balances, E.summary(s, '2026-10-21').balances);
});

test('normalizeState / readBackup reject garbage without throwing', () => {
  const bad = [null, undefined, 42, 'hello', '{not json', [], [1, 2], {}, { app: 'other', data: {} },
    { app: 'harbor' }, { app: 'harbor', schema: 1, data: null }, { app: 'harbor', data: { app: 'harbor' } },
    { app: 'harbor', data: { app: 'harbor', settings: {}, paydays: 'x' } },
    { app: 'harbor', data: { app: 'harbor', schema: 9, settings: {} } }];
  bad.forEach((b) => {
    let r;
    assert.doesNotThrow(() => { r = E.readBackup(b, '2026-09-30'); });
    assert.equal(r.ok, false, JSON.stringify(b));
    assert.ok(typeof r.error === 'string' && r.error.length);
  });
  // Junk inside a payday's plan is cleaned, not fatal.
  const junk = E.normalizeState({ app: 'harbor', settings: {}, paydays: [{ id: 'p', date: '2026-10-01',
    nextDate: '2026-10-15', amount: 100, plan: { items: [null, 7, { key: 'save', kind: 'save', amount: '50' }] },
    ticks: { save: { d: '2026-10-01', t: 1 }, bad: 'x' } }] }, '2026-09-30');
  assert.equal(junk.ok, true);
  assert.equal(junk.state.paydays[0].plan.items.length, 1);
  assert.deepEqual(Object.keys(junk.state.paydays[0].ticks), ['save']);
  assert.equal(E.summary(junk.state, '2026-10-02').savings, 50);
  [null, [], 'x', { app: 'nope', settings: {} }, { app: 'harbor' }].forEach((b) => {
    const r = E.normalizeState(b, '2026-09-30');
    assert.equal(r.ok, false);
  });
});

test('normalizeState fills defaults and cleans odd values', () => {
  const r = E.normalizeState({
    app: 'harbor', settings: { onDays: 'x', debtShare: 0.07, method: 'weird', payAmount: '1500', payFreq: 'hourly' },
    bills: [{ name: 'Phone', amount: '80', dueDay: 40, freq: 'yearly' }, 'junk'],
    debts: [{ id: 'd1', name: 'Visa', balance: 100, rate: 'not sure', dueDay: null }],
    paydays: [{ id: 'x', date: '2026-10-01' }],
  }, '2026-09-30');
  assert.equal(r.ok, true);
  const s = r.state;
  assert.equal(s.settings.onDays, 28);
  assert.equal(s.settings.debtShare, 0.2);
  assert.equal(s.settings.method, 'quick');
  assert.equal(s.settings.payAmount, 1500);
  assert.equal(s.settings.payFreq, null);
  assert.equal(s.bills.length, 1);
  assert.equal(s.bills[0].amount, 80);
  assert.equal(s.bills[0].dueDay, 1);
  assert.equal(s.bills[0].dueMonth, 1);
  assert.ok(s.bills[0].id);
  assert.equal(s.debts[0].rate, null);
  assert.equal(s.debts[0].asOf, '2026-09-30');
  assert.deepEqual(s.paydays, [], 'a payday without a plan is dropped');
  assert.deepEqual(s.meta.celebrated, {});
  assert.doesNotThrow(() => E.summary(s, '2026-10-01'));
});

test('newState has the spec shape', () => {
  const s = E.newState('2026-09-30');
  assert.equal(s.schema, 2, 'SPEC §10.1');
  assert.equal(s.app, 'harbor');
  assert.equal(s.createdAt, '2026-09-30');
  assert.equal(s.settings.cushion, 1000);
  assert.equal(s.settings.safetyMonths, 3);
  assert.equal(s.settings.debtShare, 0.8);
  assert.equal(s.settings.method, 'quick');
  assert.deepEqual(s.savings, { amount: 0, asOf: '2026-09-30' });
  assert.deepEqual(Object.keys(s.meta).sort(),
    ['backupSnoozeUntil', 'celebrated', 'checkinSnoozeUntil', 'lastBackupAt', 'recapsShown', 'tips']);
  assert.ok(typeof E.uid() === 'string' && E.uid() !== E.uid());
});

// ---------------------------------------------------------------- review fixes

// Check-in then a same-day tick: the check-in's real number already includes that payment.
function checkinTickState() {
  const s = E.newState('2026-09-01');
  Object.assign(s.settings, { boatDate: '2026-09-08', payAmount: 2000, payFreq: 'biweekly', homeSpend: 1400, boatSpend: 280 });
  s.debts = [{ id: 'visa', name: 'Visa', balance: 1200, asOf: '2026-09-01', minPayment: 40, dueDay: 10, rate: 0 }];
  s.savings = { amount: 1000, asOf: '2026-09-01' };
  s.setupDone = true;
  return s;
}

test('fix: a tick on the same day as a check-in is absorbed by the check-in (debt)', () => {
  const s = checkinTickState();
  const p1 = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, { d: '2026-10-01', t: 10 });
  const debt = p1.plan.items.find((i) => i.kind === 'debt');
  assert.ok(debt);
  ['bills', 'spend'].forEach((k) => E.act.tick(s, p1.id, k, true, { d: '2026-10-01', t: 11 }));
  const real = 1200 - 40 - debt.amount;
  assert.equal(real, 352);
  E.act.addCheckin(s, { debts: { visa: real }, savings: null }, { d: '2026-10-15', t: 20 });
  E.act.tick(s, p1.id, debt.key, true, { d: '2026-10-15', t: 30 });
  const sm = E.summary(s, '2026-10-15');
  assert.equal(sm.debts[0].balance, 352);
  assert.equal(sm.debts[0].paidOffOn, null);
  assert.ok(!sm.newMilestones.some((m) => m.key === 'debtfree' || m.key === 'paid:visa'));
  const p2 = E.act.addPayday(s, { date: '2026-10-15', amount: 2000 }, { d: '2026-10-15', t: 40 });
  assert.ok(p2.plan.items.some((i) => i.kind === 'debt' && i.debtId === 'visa'));
});

test('fix: a tick on the same day as a check-in is absorbed by the check-in (savings)', () => {
  const s = base();
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  E.act.addCheckin(s, { savings: 900 }, { d: '2026-10-05', t: 10 });
  E.act.tick(s, pd.id, 'save', true, { d: '2026-10-05', t: 20 });
  assert.equal(E.replay(s, '2026-10-05').savings, 900);
  // A tick on a later day than the check-in still counts.
  const t = base();
  const pt = E.act.addPayday(t, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  E.act.addCheckin(t, { savings: 900 }, { d: '2026-10-05', t: 10 });
  E.act.tick(t, pt.id, 'save', true, { d: '2026-10-06', t: 5 });
  assert.equal(E.replay(t, '2026-10-06').savings, 1660);
  const u = checkinTickState();
  const pu = E.act.addPayday(u, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  const debt = pu.plan.items.find((i) => i.kind === 'debt');
  E.act.addCheckin(u, { debts: { visa: 1000 } }, { d: '2026-10-12', t: 10 });
  E.act.tick(u, pu.id, debt.key, true, { d: '2026-10-13', t: 1 });
  assert.equal(E.replay(u, '2026-10-13').debts.visa.balance, E.round2(Math.max(0, 1000 - debt.amount)));
});

test('fix: "that clears it" pays the whole balance, including the regular payment due in the window', () => {
  const s = base();
  s.debts = [{ id: 'store', name: 'Store card', balance: 500, asOf: '2026-09-30', minPayment: 25, dueDay: 18, rate: null }];
  s.savings = { amount: 1000, asOf: '2026-09-30' };
  const pd = E.act.addPayday(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }, now('2026-10-15'));
  const p = pd.plan;
  const debts = p.items.filter((i) => i.kind === 'debt');
  assert.equal(debts.length, 1);
  assert.equal(debts[0].amount, 500);
  assert.equal(debts[0].clears, true);
  assert.equal(debts[0].label, 'Pay $500 on Store card — that clears it! 🎉');
  assert.match(debts[0].why, /This pays off the whole balance, including this month's regular payment\.$/);
  assert.equal(p.bills.find((b) => b.refId === 'store' && b.kind === 'min'), undefined);
  assert.equal(p.billsNeed, E.round2(p.bills.reduce((a, b) => a + b.amount, 0) + p.yearlyAside.reduce((a, y) => a + y.amount, 0)));
  assert.equal(itemsSum(p), 2000);
  tickAll(s, pd, '2026-10-16');
  const card = E.summary(s, '2026-10-16').debts.find((d) => d.id === 'store');
  assert.equal(card.balance, 0);
  assert.equal(card.paidOffOn, '2026-10-16');
});

test('fix: a clearing payment with interest is capped at today\'s balance; the rest goes to savings', () => {
  const s = base();
  s.debts = [{ id: 'card', name: 'Card', balance: 500, asOf: '2026-09-30', minPayment: 25, dueDay: 18, rate: 24 }];
  s.savings = { amount: 1000, asOf: '2026-09-30' };
  s.settings.debtShare = 1;
  const pd = E.act.addPayday(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }, now('2026-10-15'));
  const p = pd.plan;
  const d = item(p, 'debt:card');
  assert.equal(d.amount, 500);
  assert.equal(d.clears, true);
  assert.equal(p.bills.find((b) => b.refId === 'card'), undefined);
  assert.ok(item(p, 'save').amount > 0);
  assert.equal(p.goals.stageAfter, 3);
  assert.equal(itemsSum(p), 2000);
  tickAll(s, pd, '2026-10-15');
  assert.equal(E.replay(s, '2026-10-15').debts.card.paidOffOn, '2026-10-15');
});

test('fix: skipping the spending question still gives a real safety-net target', () => {
  const mk = () => {
    const s = E.newState('2026-09-30');
    Object.assign(s.settings, { boatDate: '2026-09-08', payAmount: 2000, payFreq: 'biweekly', homeSpend: null, boatSpend: null });
    s.bills = [{ id: 'ph', name: 'Phone', amount: 80, freq: 'monthly', dueDay: 12 },
      { id: 'ins', name: 'Insurance', amount: 150, freq: 'monthly', dueDay: 5 }];
    s.savings = { amount: 900, asOf: '2026-09-30' };
    s.setupDone = true;
    return s;
  };
  const s = mk();
  const typed = mk();
  const sug = E.suggestSpending(typed);
  typed.settings.homeSpend = sug.home; typed.settings.boatSpend = sug.boat;
  assert.equal(E.safetyTarget(typed), 6890);
  assert.equal(E.safetyTarget(s), 6890);
  assert.equal(E.summary(s, '2026-10-01').monthlyExpenses, E.summary(typed, '2026-10-01').monthlyExpenses);
  const p = E.act.addPayday(s, { date: '2026-10-01', amount: 2000 }, now('2026-10-01'));
  tickAll(s, p, '2026-10-01');
  const st = E.summary(s, '2026-10-02').stage;
  assert.ok(st === 2 || st === 3, 'stage ' + st);
  // No normal paycheck set: the average of logged paydays is used.
  const t = mk();
  t.settings.payAmount = null;
  E.act.addPayday(t, { date: '2026-10-01', amount: 2000 }, now('2026-10-01'));
  assert.equal(E.safetyTarget(t), 6890);
});

test('fix: a paycheck up to a month late still lists the bills due in the gap', () => {
  const s = base();
  s.bills.push({ id: 'gym', name: 'Gym', amount: 60, freq: 'monthly', dueDay: 17, dueMonth: null });
  const p1 = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, now('2026-10-01'));
  tickAll(s, p1, '2026-10-01');
  const p = E.act.addPayday(s, { date: '2026-10-27', amount: 2000, nextDate: '2026-11-10' }, now('2026-10-27')).plan;
  assert.equal(p.window.billsFrom, '2026-10-16');
  const gym = p.bills.find((b) => b.refId === 'gym');
  assert.equal(gym.due, '2026-10-17');
  assert.equal(gym.past, true);
  assert.equal(p.bills.find((b) => b.refId === 'store' && b.due === '2026-10-18').past, true);
  assert.match(item(p, 'bills').why, / Some of these were due before today, so pay them now if you haven't yet\.$/);
  assert.equal(itemsSum(p), 2000);
});

test('fix: a yearly bill due in a late paycheck\'s gap is listed with what\'s still unfunded', () => {
  const s = base();
  s.debts = [];
  s.bills.push({ id: 'lic', name: 'License', amount: 120, freq: 'yearly', dueDay: 18, dueMonth: 10 });
  const p1 = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, now('2026-10-01'));
  const aside = p1.plan.yearlyAside.find((y) => y.billId === 'lic');
  assert.ok(aside && aside.amount > 0 && aside.amount < 120);
  const p = E.act.addPayday(s, { date: '2026-10-27', amount: 2000, nextDate: '2026-11-10' }, now('2026-10-27')).plan;
  const lic = p.bills.find((b) => b.refId === 'lic');
  assert.equal(lic.due, '2026-10-18');
  assert.equal(lic.past, true);
  assert.equal(lic.amount, E.round2(120 - aside.amount));
});

test('fix: moving the boat date later while home keeps counting from the day you got home', () => {
  const s = base();                                   // boat Sep 8 → home since Oct 6
  E.act.setBoatDate(s, '2026-10-27', '2026-10-15');
  assert.equal(s.settings.homeSince, '2026-10-06');
  const st = E.rotation.status(s.settings, '2026-10-15');
  assert.equal(st.where, 'home');
  assert.equal(st.day, 10);
  assert.equal(st.of, 21);
  assert.equal(st.stretchStart, '2026-10-06');
  assert.equal(st.changeDate, '2026-10-27');
  // Moving it again while still before the new date keeps the same homecoming.
  E.act.setBoatDate(s, '2026-10-29', '2026-10-16');
  assert.equal(s.settings.homeSince, '2026-10-06');
  assert.equal(E.rotation.status(s.settings, '2026-10-16').of, 23);
  // Survives a backup round trip.
  assert.equal(E.normalizeState(JSON.parse(JSON.stringify(s)), '2026-10-16').state.settings.homeSince, '2026-10-06');
  // A past (or today's) boat date clears it.
  E.act.setBoatDate(s, '2026-10-16', '2026-10-16');
  assert.equal(s.settings.homeSince, null);
  E.act.setBoatDate(s, '2026-10-27', '2026-10-17');   // on the boat now: not home
  assert.equal(s.settings.homeSince, null);
  // No "today" given: old behaviour.
  const t = base();
  E.act.setBoatDate(t, '2026-10-27');
  assert.equal(t.settings.homeSince, null);
  assert.equal(E.newState('2026-09-30').settings.homeSince, null);
});

test('fix: every bill covered but not the whole yearly set-aside is "tight", not "short"', () => {
  const s = base();
  const p = E.act.addPayday(s, { date: '2026-10-01', amount: 280, nextDate: '2026-10-15' }, now('2026-10-01')).plan;
  assert.equal(E.round2(p.bills.reduce((a, b) => a + b.amount, 0)), 270);
  assert.equal(p.status, 'tight');
  assert.equal(p.shortBy, 0);
  assert.equal(p.note, null);
  assert.match(p.headline, /Bills are covered/);
  assert.equal(E.round2(p.yearlyAside.reduce((a, y) => a + y.amount, 0)), 10);
  assert.equal(p.billsNeed, 280);
  assert.equal(itemsSum(p), 280);
  // Still short when the real bills aren't covered; shortBy counts real bills only.
  const q = E.makePlan(base(), { date: '2026-10-01', amount: 250, nextDate: '2026-10-15' });
  assert.equal(q.status, 'short');
  assert.equal(q.shortBy, 20);
  assert.deepEqual(q.yearlyAside, []);
});

test('fix: the debt-free date doesn\'t jump later just because a payday was entered', () => {
  const s = base();
  s.debts[0].balance = 9000; s.debts[0].minPayment = 250;
  s.debts[1].balance = 4000; s.debts[1].minPayment = 120;
  s.savings.amount = 1000;
  let d = '2026-10-01';
  for (let i = 0; i < 12; i++) {
    const next = dates.addDays(d, 14);
    const pd = E.act.addPayday(s, { date: d, amount: 2000, nextDate: next }, now(d));
    const entered = E.project(s, d);
    tickAll(s, pd, d);
    const ticked = E.project(s, d);
    assert.equal(entered.debtFree, ticked.debtFree, 'payday ' + d);
    d = next;
  }
  // Unticked money never makes Today claim debt-free early.
  const t = base();
  t.debts = [{ id: 'x', name: 'Tiny', balance: 100, asOf: '2026-09-30', minPayment: 10, dueDay: 25, rate: 0 }];
  t.savings.amount = 1000;
  E.act.addPayday(t, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, now('2026-10-01'));
  const r = E.project(t, '2026-10-01');
  assert.equal(r.alreadyDebtFree, false);
  assert.ok(r.debtFree);
});

test('fix: a restored backup knows when it was made, so it doesn\'t nag right away', () => {
  const { s } = afterP1();
  s.meta.backupSnoozeUntil = '2026-10-20';
  const r = E.readBackup(E.makeBackup(s, '2026-10-16'), '2026-10-16');
  assert.equal(r.ok, true);
  assert.equal(r.state.meta.lastBackupAt, '2026-10-16');
  assert.equal(r.state.meta.backupSnoozeUntil, null);
  assert.equal(E.summary(r.state, '2026-10-16').backupDue, false);
  assert.equal(s.meta.lastBackupAt, null, 'the live state is not changed');
});

test('fix: month-end paydays keep landing on the month end', () => {
  const chain = (payFreq, start, n) => {
    const out = [];
    let d = start;
    for (let i = 0; i < n; i++) { d = E.pay.guessNext({ payFreq }, d); out.push(d); }
    return out;
  };
  assert.deepEqual(chain('monthly', '2027-01-31', 3), ['2027-02-28', '2027-03-31', '2027-04-30']);
  assert.deepEqual(chain('semimonthly', '2027-01-15', 5), ['2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31']);
  assert.equal(E.pay.guessNext({ payFreq: 'monthly' }, '2027-01-15'), '2027-02-15');
  assert.equal(E.pay.guessNext({ payFreq: 'monthly' }, '2027-01-30'), '2027-02-28');
});

test('fix: plain, accurate wording in whys and milestones', () => {
  // A tiny last debt paid off by its own regular payment: not "debt-free" yet.
  const s = E.newState('2026-09-30');
  Object.assign(s.settings, { boatDate: '2026-09-08', payAmount: 2000, payFreq: 'biweekly', homeSpend: 1400, boatSpend: 280 });
  s.debts = [{ id: 'a', name: 'Store card', balance: 30, asOf: '2026-09-30', minPayment: 50, dueDay: 10, rate: 0 },
    { id: 'b', name: 'Visa', balance: 900, asOf: '2026-09-30', minPayment: 40, dueDay: 20, rate: 20 }];
  s.savings = { amount: 1000, asOf: '2026-09-30' };
  let p = E.makePlan(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(item(p, 'bills').why, 'Your Store card minimum is due before your next payday, so this stays put to cover it.');
  assert.equal(item(p, 'spend').why, '9 days at home at about $100 a day, plus 5 days on the boat at about $10 a day. ' +
    'Home days get more because that\'s when life costs more.');
  assert.equal(item(p, 'debt:b').why, '80% of what\'s left after bills and spending goes to one debt at a time, smallest first, for quick wins.');
  assert.equal(item(p, 'save').why, '20% keeps growing your safety net while you crush debt.');
  s.debts = [s.debts[0]];
  p = E.makePlan(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(item(p, 'save').why, 'Your last debt gets paid off by its regular payment before your next payday, so extra money ' +
    'now grows your safety net to 3 months of bills and spending ($3,650).');
  // One open debt: name it.
  const one = base();
  one.debts = [one.debts[0]];
  one.savings.amount = 1000;
  const q = E.makePlan(one, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(item(q, 'debt:visa').why, '80% of what\'s left after bills and spending goes to Visa until it\'s gone.');
  one.settings.debtShare = 1;
  const q1 = E.makePlan(one, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.match(item(q1, 'debt:visa').why, /^Everything left after bills and spending goes to Visa until it's gone\./);
  // Only one kind of day: no home/boat comparison.
  const nb = E.makePlan(base({ settings: { boatDate: null } }), { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  assert.equal(item(nb, 'spend').why, '14 days at about $40 a day. That\'s enough for groceries, gas and fun until your next payday.');
  [p, q, nb].forEach((x) => x.items.forEach((i) => assert.doesNotMatch(i.why, /×|\+| — /)));
  // Cushion milestone points at what's really next.
  const withDebt = base();
  withDebt.savings.amount = 1000;
  assert.equal(E.milestones(withDebt, '2026-10-01').find((x) => x.key === 'cushion').message,
    'You\'ve got $1,000 set aside for surprises. Next up: crushing your debts.');
  const noDebt = base();
  noDebt.debts = [];
  noDebt.savings.amount = 1000;
  assert.equal(E.milestones(noDebt, '2026-10-01').find((x) => x.key === 'cushion').message,
    'You\'ve got $1,000 set aside for surprises. Next up: growing your full safety net.');
});

// ================================================================ v2: accounts, spending pot, purchase log (SPEC §10)

// A purchase at a known moment. Examples are generic (Uber Eats $38, Shell $52 …).
let pt = 5000;
function buy(s, date, amount, where, extra) {
  return E.act.addPurchase(s, Object.assign({ date, amount, where, category: 'other' }, extra), { d: date, t: ++pt });
}
const at = (d, t) => ({ d, t });
function pot(s, d) { return E.replay(s, d).pot; }

test('§10.1 CATEGORIES and built-in accounts', () => {
  assert.deepEqual(E.CATEGORIES.map((c) => c.key), ['eat', 'delivery', 'groceries', 'gas', 'fun', 'shopping', 'travel', 'other']);
  assert.deepEqual(E.CATEGORIES[0], { key: 'eat', emoji: '🍔', label: 'Eating out' });
  assert.deepEqual(E.CATEGORIES.map((c) => c.emoji), ['🍔', '🛵', '🛒', '⛽', '🎉', '🛍️', '✈️', '📦']);
  const s = E.newState('2026-09-30');
  assert.deepEqual(s.accounts, [
    { id: 'checking', name: 'Checking', kind: 'checking' },
    { id: 'spending', name: 'Spending card', kind: 'spending' },
    { id: 'savings', name: 'Savings', kind: 'savings' }]);
  assert.deepEqual(s.purchases, []);
});

test('§10.2 pot start rule: latest payday on/before the first purchase, else the purchase day; null until logging', () => {
  const s = base();
  const p1 = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  assert.equal(p1.plan.spend.amount, 950);
  assert.equal(pot(s, '2026-10-05'), null, 'never logged → null');
  assert.equal(E.replay(s, '2026-10-05').potStart, null);
  assert.equal(E.spending(s, '2026-10-05').started, false);
  assert.equal(E.spending(s, '2026-10-05').left, null);
  buy(s, '2026-10-03', 38, 'Uber Eats', { category: 'delivery' });
  const r = E.replay(s, '2026-10-03');
  assert.equal(r.potStart, '2026-10-01');
  assert.equal(r.pot, 912, '0 at the payday, + $950 refill, − $38');
  assert.equal(pot(s, '2026-10-02'), null, 'as of a day before logging started: not started');
  // No payday before it: the pot starts on the purchase day at 0.
  const t = base();
  buy(t, '2026-10-03', 52, 'Shell', { category: 'gas' });
  assert.equal(E.replay(t, '2026-10-03').potStart, '2026-10-03');
  assert.equal(pot(t, '2026-10-03'), -52);
  // A spending-card check-in can be the first log too.
  const u = base();
  E.act.addPayday(u, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  E.act.setAccountBalance(u, 'spending', 400, at('2026-10-04', 20));
  assert.equal(E.replay(u, '2026-10-04').potStart, '2026-10-01');
  assert.equal(pot(u, '2026-10-04'), 400);
  assert.equal(pot(u, '2026-10-03'), null);
  // The latest payday on/before the first purchase — not an earlier one.
  const v = base();
  E.act.addPayday(v, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  const p2 = E.act.addPayday(v, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }, at('2026-10-15', 11));
  buy(v, '2026-10-16', 25, 'Groceries');
  assert.equal(E.replay(v, '2026-10-16').potStart, '2026-10-15');
  assert.equal(pot(v, '2026-10-16'), E.round2(p2.plan.spend.amount - 25));
});

test('§10.2 refill per payday; leftovers and overspending roll over; carried', () => {
  const { s } = afterP1();
  buy(s, '2026-10-03', 38, 'Uber Eats');
  buy(s, '2026-10-10', 100, 'Shell');
  const p2 = E.act.addPayday(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }, now('2026-10-15'));
  assert.equal(p2.plan.spend.amount, 590);
  assert.equal(pot(s, '2026-10-14'), 812);
  assert.equal(pot(s, '2026-10-15'), 1402, '$812 left over + $590');
  assert.equal(E.spending(s, '2026-10-15').carried, 812);
  buy(s, '2026-10-12', 900, 'Store');
  assert.equal(pot(s, '2026-10-14'), -88);
  assert.equal(pot(s, '2026-10-15'), 502, 'overspending comes out of the next spending money');
  assert.equal(E.spending(s, '2026-10-15').carried, -88);
  assert.deepEqual(E.replay(s, '2026-10-15').refills.map((x) => [x.date, x.amount]), [['2026-10-01', 950], ['2026-10-15', 590]]);
});

test('§10.2 every paidWith kind: spending, checking, cash/other, debt, removed account', () => {
  const s = base();
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  const wallet = E.act.addAccount(s, { name: 'Wallet', kind: 'cash' });
  const jar = E.act.addAccount(s, { name: 'Holiday jar', kind: 'savings' });
  assert.equal(jar.kind, 'other', 'user accounts are cash or other');
  E.act.addCheckin(s, { accounts: { checking: 500, [wallet.id]: 100, [jar.id]: 300 } }, at('2026-10-02', 1));
  buy(s, '2026-10-03', 10, 'Coffee', { paidWith: 'spending' });
  buy(s, '2026-10-03', 20, 'Groceries', { paidWith: 'checking' });
  buy(s, '2026-10-03', 30, 'Market', { paidWith: wallet.id });
  buy(s, '2026-10-03', 40, 'Hardware', { paidWith: 'debt:visa' });
  buy(s, '2026-10-03', 5, 'Bakery', { paidWith: jar.id });
  assert.equal(buy(s, '2026-10-03', 1, 'X', { paidWith: 'nope' }).paidWith, 'spending', 'unknown → spending card');
  assert.equal(buy(s, '2026-10-03', 1, 'Y', { paidWith: 'savings' }).paidWith, 'spending', 'not from savings');
  assert.equal(buy(s, '2026-10-03', 1, 'Z', { paidWith: 'debt:gone' }).paidWith, 'spending', 'unknown debt');
  const r = E.replay(s, '2026-10-03');
  assert.equal(r.pot, 950 - 108, 'every purchase comes out of the pot, whatever paid for it');
  assert.equal(r.accounts.checking.balance, 480);
  assert.equal(r.accounts[wallet.id].balance, 70);
  assert.equal(r.accounts[jar.id].balance, 295);
  assert.equal(r.debts.visa.balance, 1240);
  assert.equal(r.debts.store.balance, 500);
  assert.deepEqual(r.log.filter((e) => e.type === 'charge'), [{ date: '2026-10-03', type: 'charge', debtId: 'visa', amount: 40 }]);
  // Removing an account keeps its purchases (still in the pot) but stops changing balances.
  E.act.deleteAccount(s, wallet.id);
  const r2 = E.replay(s, '2026-10-03');
  assert.equal(r2.pot, r.pot);
  assert.equal(r2.accounts[wallet.id], undefined);
  assert.equal(s.purchases.filter((p) => p.paidWith === wallet.id).length, 1);
  assert.equal(E.spending(s, '2026-10-03').recent.find((p) => p.where === 'Market').paidWithName, 'An account you removed');
  // A charge dated before the debt's starting balance is already in that balance.
  const t = base();
  t.debts[0].asOf = '2026-10-05';
  buy(t, '2026-10-03', 40, 'Hardware', { paidWith: 'debt:visa' });
  assert.equal(E.replay(t, '2026-10-05').debts.visa.balance, 1200);
});

test('§10.2 a credit purchase re-opens a paid-off debt and the next payday pays it back', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  assert.equal(E.replay(s, '2026-10-15').debts.store.paidOffOn, '2026-10-15');
  assert.ok(E.milestones(s, '2026-10-16').some((m) => m.key === 'paid:store'));
  buy(s, '2026-10-16', 120, 'Shoe shop', { paidWith: 'debt:store', category: 'shopping' });
  const r = E.replay(s, '2026-10-16');
  assert.equal(r.debts.store.balance, 120);
  assert.equal(r.debts.store.paidOffOn, null);
  const sum = E.summary(s, '2026-10-16');
  assert.ok(sum.debts.find((d) => d.id === 'store').open);
  assert.ok(!E.milestones(s, '2026-10-16').some((m) => m.key === 'paid:store'));
  // Oct 18: its regular payment ($25) comes out again.
  assert.equal(E.replay(s, '2026-10-18').debts.store.balance, 95);
  const p3 = E.act.addPayday(s, { date: '2026-10-29', amount: 2000, nextDate: '2026-11-12' }, now('2026-10-29'));
  const it = p3.plan.items.find((i) => i.key === 'debt:store');
  assert.ok(it, 'the plan pays the card back');
  assert.equal(it.clears, true);
  tickAll(s, p3, '2026-10-29');
  assert.equal(E.replay(s, '2026-10-29').debts.store.balance, 0);
  assert.equal(E.replay(s, '2026-10-29').debts.store.paidOffOn, '2026-10-29');
});

test('§10.2 check-ins set the pot and accounts; savings stays in .savings', () => {
  const s = base();
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  E.act.addCheckin(s, { accounts: { spending: 200, checking: 1000, savings: 300, ghost: 5 } }, at('2026-10-02', 20));
  const c = s.checkins[0];
  assert.deepEqual(c.accounts, { spending: 200, checking: 1000 });
  assert.equal(c.savings, 300);
  const r = E.replay(s, '2026-10-02');
  assert.equal(r.pot, 200);
  assert.equal(r.savings, 300);
  assert.deepEqual(r.accounts.checking, { balance: 1000, asOf: '2026-10-02', changed: false });
  assert.deepEqual(r.accounts.spending, { balance: 200, asOf: '2026-10-02', changed: false });
  buy(s, '2026-10-03', 38, 'Uber Eats');
  assert.deepEqual(E.replay(s, '2026-10-03').accounts.spending, { balance: 162, asOf: '2026-10-02', changed: true });
  // setAccountBalance routes: savings → setSavings, spending → pot, others → a check-in.
  E.act.setAccountBalance(s, 'savings', 450, at('2026-10-04', 1));
  E.act.setAccountBalance(s, 'checking', -20, at('2026-10-04', 2));
  E.act.setAccountBalance(s, 'spending', 75.5, at('2026-10-04', 3));
  const r2 = E.replay(s, '2026-10-04');
  assert.equal(r2.savings, 450);
  assert.equal(r2.accounts.checking.balance, -20, 'an overdrawn account is allowed');
  assert.equal(r2.pot, 75.5);
  assert.throws(() => E.act.setAccountBalance(s, 'nope', 5), /gone/);
  assert.throws(() => E.act.setAccountBalance(s, 'checking', ''), /amount/);
  assert.throws(() => E.act.setAccountBalance(s, 'savings', -5), /below zero/);
});

test('§10.2 same-day order: purchases vs check-ins by t; check-ins after same-day ticks; payday t', () => {
  const s = base();
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  E.act.addPurchase(s, { date: '2026-10-03', amount: 38, where: 'Uber Eats' }, at('2026-10-03', 100));
  E.act.setAccountBalance(s, 'spending', 500, at('2026-10-03', 200));
  assert.equal(pot(s, '2026-10-03'), 500, 'purchase then check-in: the check-in number already includes it');
  s.checkins[0].t = 50;
  assert.equal(pot(s, '2026-10-03'), 462, 'check-in then purchase');

  // Checking on payday: a check-in typed before the payday was logged is topped up by it.
  const mk = () => {
    const x = base();
    const pd = E.act.addPayday(x, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 1000));
    return { x, pd };
  };
  let { x, pd } = mk();
  E.act.setAccountBalance(x, 'checking', 300, at('2026-10-01', 500));
  ['bills', 'spend', 'save'].forEach((k, i) => E.act.tick(x, pd.id, k, true, at('2026-10-01', 1001 + i)));
  assert.equal(E.replay(x, '2026-10-01').accounts.checking.balance, 300 + 2000 - 950 - 760);
  // After the payday: the check-in wins over the deposit and every same-day tick, even later ones.
  ({ x, pd } = mk());
  E.act.setAccountBalance(x, 'checking', 300, at('2026-10-01', 1500));
  ['bills', 'spend', 'save'].forEach((k, i) => E.act.tick(x, pd.id, k, true, at('2026-10-01', 1600 + i)));
  assert.equal(E.replay(x, '2026-10-01').accounts.checking.balance, 300);
  assert.equal(E.replay(x, '2026-10-01').savings, 960, 'savings ticks still count (no savings check-in)');
  // A v1 payday (no t) counts as logged first thing that day.
  ({ x, pd } = mk());
  delete pd.t;
  E.act.setAccountBalance(x, 'checking', 300, at('2026-10-01', 500));
  ['spend', 'save'].forEach((k, i) => E.act.tick(x, pd.id, k, true, at('2026-10-01', 400 + i)));
  assert.equal(E.replay(x, '2026-10-01').accounts.checking.balance, 300);
  // Spending card typed on payday morning, then the payday: leftover + refill.
  ({ x } = mk());
  E.act.setAccountBalance(x, 'spending', 30, at('2026-10-01', 900));
  assert.equal(pot(x, '2026-10-01'), 980);
  x.checkins[0].t = 1100;
  assert.equal(pot(x, '2026-10-01'), 30);
});

test('§10.2 checking ledger: payday, bills (monthly + yearly), minimums, ticks', () => {
  const s = base();
  assert.equal(E.replay(s, '2026-10-01').accounts.checking.balance, null, 'unknown until entered');
  E.act.setAccountBalance(s, 'checking', 1000, at('2026-09-30', 1));
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  tickAll(s, pd, '2026-10-01');
  const ck = (d) => E.replay(s, d).accounts.checking.balance;
  assert.equal(ck('2026-09-30'), 1000);
  assert.equal(ck('2026-10-01'), 1000 + 2000 - 950 - 760, 'the "leave in checking" step moves nothing');
  assert.equal(ck('2026-10-05'), 1140, 'Car insurance $150');
  assert.equal(ck('2026-10-10'), 1100, 'Visa minimum $40');
  assert.equal(ck('2026-10-12'), 1020, 'Phone $80');
  assert.equal(ck('2026-10-18'), 995, 'Store card minimum $25');
  assert.equal(ck('2026-10-20'), 980, 'Streaming $15');
  assert.equal(E.round2(ck('2027-03-14') - ck('2027-03-15')), 240, 'yearly bill: the full amount on its due date');
  const r = E.replay(s, '2026-10-20').accounts.checking;
  assert.equal(r.asOf, '2026-09-30');
  assert.equal(r.changed, true);
  const acc = E.accounts(s, '2026-10-20').find((a) => a.id === 'checking');
  assert.equal(acc.estimated, true);
  // A debt tick and a checking purchase come out too.
  const t = base();
  t.savings.amount = 1000;
  E.act.setAccountBalance(t, 'checking', 0, at('2026-09-30', 1));
  const p = E.act.addPayday(t, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  const debt = p.plan.items.find((i) => i.kind === 'debt');
  E.act.tick(t, p.id, debt.key, true, at('2026-10-02', 11));
  buy(t, '2026-10-02', 20, 'Pharmacy', { paidWith: 'checking' });
  assert.equal(E.replay(t, '2026-10-02').accounts.checking.balance, E.round2(2000 - debt.amount - 20));
});

test('§10.3 spending(): left, per-day split, sub, status, overText', () => {
  const s = base();
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  E.act.setAccountBalance(s, 'spending', 950, at('2026-10-01', 20));
  let sp = E.spending(s, '2026-10-01');
  assert.equal(sp.started, true);
  assert.equal(sp.left, 950);
  assert.equal(sp.from, '2026-10-01');
  assert.equal(sp.until, '2026-10-15');
  assert.deepEqual([sp.daysLeft, sp.homeDays, sp.boatDays, sp.otherDays], [14, 9, 5, 0]);
  assert.equal(sp.perHome, 100);
  assert.equal(sp.perBoat, 10);
  assert.equal(sp.perDay, 67.86);
  assert.equal(sp.sub, 'about $100 a day at home · $10 on the boat until Oct 15');
  assert.equal(sp.status, 'ok');
  assert.equal(sp.overText, null);
  // Only home days left.
  sp = E.spending(s, '2026-10-08');
  assert.equal(sp.sub, 'about $136 a day until Oct 15', '$950 over 7 home days');
  // No boat date: one blended rate.
  const nb = base({ settings: { boatDate: null } });
  E.act.addPayday(nb, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  buy(nb, '2026-10-01', 2, 'Gum');
  sp = E.spending(nb, '2026-10-01');
  assert.equal(sp.left, E.round2(nb.paydays[0].plan.spend.amount - 2));
  assert.equal(sp.otherDays, 14);
  assert.match(sp.sub, /^about \$\d+ a day until Oct 15$/);
  // Low, over, payday due.
  E.act.setAccountBalance(s, 'spending', 400, at('2026-10-01', 30));
  assert.equal(E.spending(s, '2026-10-01').status, 'low');
  buy(s, '2026-10-01', 440, 'Tyres', { category: 'other' });
  sp = E.spending(s, '2026-10-01');
  assert.equal(sp.left, -40);
  assert.equal(sp.status, 'over');
  assert.equal(sp.overText, 'You\'re $40 over. No stress — it comes out of your next spending money.');
  assert.equal(sp.perDay, 0);
  assert.equal(sp.sub, 'Your next spending money comes with payday on Oct 15.');
  E.act.setAccountBalance(s, 'spending', 80, at('2026-10-15', 1));
  sp = E.spending(s, '2026-10-15');
  assert.equal(sp.daysLeft, 0);
  assert.equal(sp.perDay, null);
  assert.equal(sp.sub, 'Payday\'s due — this is what\'s left until it lands.');
  // Not started.
  const n = base();
  sp = E.spending(n, '2026-10-01');
  assert.deepEqual([sp.started, sp.left, sp.status, sp.sub, sp.carried], [false, null, null, null, null]);
  assert.deepEqual(sp.recent, []);
  assert.deepEqual(sp.places, []);
});

test('§10.3 recent purchases and places for autocomplete', () => {
  const s = base();
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  buy(s, '2026-10-02', 38, 'Uber Eats', { category: 'delivery', what: 'Burgers' });
  buy(s, '2026-10-03', 52, 'Shell', { category: 'gas', paidWith: 'debt:visa' });
  buy(s, '2026-10-04', 25, 'uber eats', { category: 'delivery', paidWith: 'checking' });
  buy(s, '2026-10-01', 9, 'Bakery', { category: 'eat' });
  const sp = E.spending(s, '2026-10-04');
  assert.deepEqual(sp.recent.map((p) => p.where), ['uber eats', 'Shell', 'Uber Eats', 'Bakery']);
  const shell = sp.recent[1];
  assert.equal(shell.emoji, '⛽');
  assert.equal(shell.label, 'Gas');
  assert.equal(shell.paidWithName, 'Visa');
  assert.equal(sp.recent[0].paidWithName, 'Checking');
  assert.equal(sp.recent[3].paidWithName, 'Spending card');
  assert.equal(sp.recent[2].what, 'Burgers');
  assert.deepEqual(sp.places[0], { where: 'uber eats', category: 'delivery', paidWith: 'checking', count: 2 });
  assert.deepEqual(sp.places.map((p) => p.where), ['uber eats', 'Shell', 'Bakery']);
  for (let i = 0; i < 35; i++) buy(s, '2026-10-04', 1, 'Shop ' + i);
  assert.equal(E.spending(s, '2026-10-04').recent.length, 30);
});

test('§10.4 afford(): ok / tight / wait thresholds, zero days, not started', () => {
  const s = base();
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  E.act.setAccountBalance(s, 'spending', 950, at('2026-10-01', 20));
  // need = 9 home × $100 + 5 boat × $10 = $950.
  let a = E.afford(s, '2026-10-01', 100);
  assert.equal(a.verdict, 'ok', '850 ≥ 0.85 × 950');
  assert.equal(a.headline, 'Go for it — you\'d still have about $89 a day at home · $9 on the boat.');
  assert.equal(a.sub, 'That leaves $850 until Oct 15.');
  assert.deepEqual(a.before, { left: 950, perDay: 67.86, perHome: 100, perBoat: 10 });
  assert.equal(a.after.left, 850);
  assert.equal(E.afford(s, '2026-10-01', 142.5).verdict, 'ok', 'exactly 0.85 × need is ok');
  a = E.afford(s, '2026-10-01', 300);
  assert.equal(a.verdict, 'tight');
  assert.equal(a.headline, 'You can, but the rest of the days get tighter: about $68 a day at home · $7 on the boat.');
  assert.equal(E.afford(s, '2026-10-01', 475).verdict, 'tight', 'exactly half the need is tight');
  a = E.afford(s, '2026-10-01', 600);
  assert.equal(a.verdict, 'wait');
  assert.equal(a.headline, 'That would leave about $37 a day at home · $4 on the boat until Oct 15. Maybe wait, or find a cheaper option.');
  a = E.afford(s, '2026-10-01', 1000);
  assert.equal(a.verdict, 'wait');
  assert.equal(a.headline, 'That\'s more than you\'ve got left ($950). Maybe wait until payday on Oct 15.');
  assert.equal(a.after.left, -50);
  assert.equal(a.after.perDay, 0);
  // Only home days: one per-day figure.
  assert.equal(E.afford(s, '2026-10-08', 250).headline, 'Go for it — you\'d still have about $100 a day.');
  // Payday is due today: no days left, so anything that fits is fine.
  a = E.afford(s, '2026-10-15', 100);
  assert.equal(a.verdict, 'ok');
  assert.equal(a.headline, 'Go for it — you\'d still have $850 left.');
  assert.equal(E.afford(s, '2026-10-15', 2000).headline, 'That\'s more than you\'ve got left ($950). Maybe wait until your paycheck lands.');
  // Over already.
  buy(s, '2026-10-02', 1000, 'Laptop', { category: 'shopping' });
  assert.equal(E.afford(s, '2026-10-02', 5).headline, 'This payday\'s spending money is used up. Maybe wait until payday on Oct 15.');
  // Not started: the latest plan's spending money, and a gentle nudge.
  const n = base();
  E.act.addPayday(n, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  a = E.afford(n, '2026-10-01', 100);
  assert.equal(a.verdict, 'ok');
  assert.equal(a.before.left, 950);
  assert.equal(a.sub, 'That leaves $850 until Oct 15. Log your purchases for a sharper answer.');
  // No payday at all: a normal pay period of spending money.
  const z = base();
  a = E.afford(z, '2026-10-01', 100);
  assert.equal(a.before.left, 950);
  assert.equal(a.verdict, 'ok');
  [E.afford(z, '2026-10-01', 'abc'), E.afford(z, '2026-10-01', -5)].forEach((x) => assert.equal(x.after.left, 950));
});

test('§10.5 whereItWent: totals, case-insensitive places (latest spelling), categories, range', () => {
  const s = base();
  buy(s, '2026-10-02', 38, 'Uber Eats', { category: 'delivery' });
  buy(s, '2026-10-03', 25, ' uber  eats ', { category: 'delivery' });
  buy(s, '2026-10-04', 30, 'UBER EATS', { category: 'delivery' });
  buy(s, '2026-10-04', 52, 'Shell', { category: 'gas' });
  buy(s, '2026-10-20', 99, 'Shell', { category: 'gas' });
  const w = E.whereItWent(s, '2026-10-01', '2026-10-19');
  assert.equal(w.total, 145);
  assert.equal(w.count, 4);
  assert.deepEqual(w.byPlace, [{ where: 'UBER EATS', total: 93, count: 3 }, { where: 'Shell', total: 52, count: 1 }]);
  assert.deepEqual(w.byCategory, [
    { category: 'delivery', label: 'Delivery', emoji: '🛵', total: 93, count: 3 },
    { category: 'gas', label: 'Gas', emoji: '⛽', total: 52, count: 1 }]);
  assert.equal(s.purchases[1].where, 'uber eats', 'where is trimmed');
  assert.deepEqual(E.whereItWent(s, '2026-11-01', '2026-11-30'), { total: 0, count: 0, byPlace: [], byCategory: [] });
});

// Rotation Sep 8 boat · Oct 6 home · Oct 20 boat · Nov 17 home · Dec 1 boat.
function stretchState() {
  const s = E.newState('2026-09-01');
  Object.assign(s.settings, { boatDate: '2026-09-08', payAmount: 2000, payFreq: 'biweekly', homeSpend: 1400, boatSpend: 280 });
  s.setupDone = true;
  E.act.addPayday(s, { date: '2026-09-08', amount: 2000, nextDate: '2026-09-22' }, at('2026-09-08', 1));
  buy(s, '2026-09-20', 50, 'Shell', { category: 'gas' });            // boat
  buy(s, '2026-10-08', 200, 'Uber Eats', { category: 'delivery' });  // home
  buy(s, '2026-10-25', 70, 'Shell', { category: 'gas' });            // boat
  buy(s, '2026-11-20', 150, 'Uber Eats', { category: 'delivery' });  // home
  return s;
}

test('§10.5 stretchSpending: this stretch so far vs the last stretch of the same kind', () => {
  const s = stretchState();
  let r = E.stretchSpending(s, '2026-11-22');
  assert.deepEqual([r.current.where, r.current.start, r.current.end, r.current.summary.total], ['home', '2026-11-17', '2026-11-22', 150]);
  assert.deepEqual([r.previous.where, r.previous.start, r.previous.end, r.previous.summary.total], ['home', '2026-10-06', '2026-10-19', 200]);
  r = E.stretchSpending(s, '2026-10-25');
  assert.deepEqual([r.current.where, r.current.start, r.current.summary.total], ['boat', '2026-10-20', 70]);
  assert.deepEqual([r.previous.where, r.previous.start, r.previous.end, r.previous.summary.total], ['boat', '2026-09-08', '2026-10-05', 50]);
  r = E.stretchSpending(s, '2026-10-10');
  assert.equal(r.previous, null, 'no home stretch before the first boat date');
  // Logging started part-way through the last stretch: no unfair comparison.
  const t = E.newState('2026-09-01');
  Object.assign(t.settings, { boatDate: '2026-09-08' });
  buy(t, '2026-10-08', 20, 'Shell');
  assert.equal(E.stretchSpending(t, '2026-11-22').previous, null);
  // No boat date: this pay period vs the previous one.
  const nb = base({ settings: { boatDate: null } });
  E.act.addPayday(nb, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 1));
  E.act.addPayday(nb, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }, at('2026-10-15', 2));
  buy(nb, '2026-10-03', 40, 'Shell');
  buy(nb, '2026-10-16', 25, 'Shell');
  r = E.stretchSpending(nb, '2026-10-20');
  assert.deepEqual([r.current.where, r.current.start, r.current.end, r.current.summary.total], ['pay', '2026-10-15', '2026-10-20', 25]);
  assert.deepEqual([r.previous.where, r.previous.start, r.previous.end, r.previous.summary.total], ['pay', '2026-10-01', '2026-10-14', 40]);
  const none = E.newState('2026-10-01');
  r = E.stretchSpending(none, '2026-10-05');
  assert.deepEqual([r.current.where, r.current.start, r.current.summary.total, r.previous], ['pay', '2026-10-01', 0, null]);
});

test('§10.6 recap covers home and boat stretches, with spent and a same-kind comparison', () => {
  const s = stretchState();
  assert.equal(E.summary(s, '2026-10-19').recap.key, '2026-09-08', 'still home: the boat stretch before it');
  // Home stretch Oct 6–19 just ended (first one: nothing to compare with).
  let r = E.summary(s, '2026-10-20').recap;
  assert.equal(r.key, '2026-10-06');
  assert.equal(r.where, 'home');
  assert.equal(r.title, 'Back out to sea ⚓');
  assert.equal(r.end, '2026-10-19');
  assert.equal(r.spent.total, 200);
  assert.deepEqual(r.spent.byPlace, [{ where: 'Uber Eats', total: 200, count: 1 }]);
  assert.equal(r.compare, null);
  E.act.markRecapShown(s, r.key);
  assert.equal(E.summary(s, '2026-10-20').recap, null);
  // Boat stretch Oct 20 – Nov 16 vs Sep 8 – Oct 5.
  r = E.summary(s, '2026-11-17').recap;
  assert.equal(r.key, '2026-10-20');
  assert.equal(r.where, 'boat');
  assert.equal(r.title, 'Welcome home!');
  assert.equal(r.spent.total, 70);
  assert.deepEqual(r.compare, { previousTotal: 50, diff: 20, text: '$20 more than last time', start: '2026-09-08', end: '2026-10-05' });
  // Home stretch Nov 17–30 vs Oct 6–19.
  r = E.summary(s, '2026-12-01').recap;
  assert.equal(r.key, '2026-11-17');
  assert.equal(r.compare.text, '$50 less than last time 🎉');
  assert.equal(r.compare.diff, -50);
  // Nothing at all happened at home → empty (marked shown silently).
  const e = E.newState('2026-09-01');
  Object.assign(e.settings, { boatDate: '2026-09-08' });
  assert.deepEqual(E.summary(e, '2026-10-20').recap, { key: '2026-10-06', empty: true });
  // A purchase alone makes it worth showing.
  buy(e, '2026-10-07', 12, 'Cinema', { category: 'fun' });
  assert.equal(E.summary(e, '2026-10-20').recap.spent.total, 12);
  assert.equal(E.summary(e, '2026-10-20').recap.paydays, 0);
});

test('§10.7 accounts(): order, balances, estimated, renamed built-ins', () => {
  const s = base();
  E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' }, at('2026-10-01', 10));
  const cash = E.act.addAccount(s, { name: '  Wallet  ', kind: 'cash' });
  assert.equal(cash.name, 'Wallet');
  E.act.renameAccount(s, 'spending', 'Debit card');
  E.act.setAccountBalance(s, cash.id, 60, at('2026-10-02', 1));
  let list = E.accounts(s, '2026-10-02');
  assert.deepEqual(list.map((a) => [a.id, a.name, a.kind, a.builtIn]), [
    ['checking', 'Checking', 'checking', true], ['spending', 'Debit card', 'spending', true],
    ['savings', 'Savings', 'savings', true], [cash.id, 'Wallet', 'cash', false]]);
  assert.deepEqual(list[0], { id: 'checking', name: 'Checking', kind: 'checking', balance: null, asOf: null, estimated: false, builtIn: true });
  assert.equal(list[1].balance, null, 'pot not started');
  assert.deepEqual([list[2].balance, list[2].asOf, list[2].estimated], [200, '2026-09-30', false]);
  assert.deepEqual([list[3].balance, list[3].asOf, list[3].estimated], [60, '2026-10-02', false]);
  buy(s, '2026-10-03', 10, 'Market', { paidWith: cash.id });
  list = E.accounts(s, '2026-10-03');
  assert.deepEqual([list[1].balance, list[1].estimated], [940, true]);
  assert.deepEqual([list[3].balance, list[3].estimated], [50, true]);
  E.act.tick(s, s.paydays[0].id, 'save', true, at('2026-10-03', 5));
  assert.equal(E.accounts(s, '2026-10-03')[2].estimated, true);
  assert.throws(() => E.act.deleteAccount(s, 'checking'), /always stay/);
  assert.throws(() => E.act.renameAccount(s, 'savings', '   '), /name/);
  assert.throws(() => E.act.addAccount(s, { name: '' }), /name/);
  assert.equal(E.act.addAccount(s, { name: 'Jar', kind: 'checking' }).kind, 'other');
  // Summary carries what Today and Money need.
  const sum = E.summary(s, '2026-10-03');
  assert.equal(sum.spending.left, 940);
  assert.equal(sum.accounts.length, 5);
  assert.equal(sum.stretch.current.where, 'boat');
});

test('§10.8 addPurchase / editPurchase / deletePurchase validate kindly', () => {
  const s = base();
  const n = at('2026-10-05', 1);
  assert.throws(() => E.act.addPurchase(s, { amount: 0, where: 'X' }, n), /how much/);
  assert.throws(() => E.act.addPurchase(s, { amount: -5, where: 'X' }, n), /how much/);
  assert.throws(() => E.act.addPurchase(s, { amount: 'abc', where: 'X' }, n), /how much/);
  assert.throws(() => E.act.addPurchase(s, { amount: 5, where: 'X', date: '2026-02-30' }, n), /day/);
  assert.throws(() => E.act.addPurchase(s, { amount: 5, where: 'X', date: '2026-10-06' }, n), /hasn't happened/);
  const p = E.act.addPurchase(s, { amount: '12.345', where: 'x'.repeat(80), what: 'y'.repeat(100), category: 'bogus' }, n);
  assert.equal(p.amount, 12.35);
  assert.equal(p.date, '2026-10-05', 'date defaults to today');
  assert.equal(p.t, 1);
  assert.equal(p.where.length, 60);
  assert.equal(p.what.length, 80);
  assert.equal(p.category, 'other');
  assert.equal(p.paidWith, 'spending');
  assert.equal(E.act.addPurchase(s, { amount: 5, where: '  ', category: 'groceries' }, n).where, 'Groceries', 'blank where → category name');
  assert.equal(E.act.addPurchase(s, { amount: 5, where: 'A' }, n).what, '');
  // Edit: changes stick, bad edits throw and change nothing.
  E.act.editPurchase(s, p.id, { amount: 20, where: 'Shell', category: 'gas', date: '2026-10-01' }, n);
  assert.deepEqual([p.amount, p.where, p.category, p.date, p.t], [20, 'Shell', 'gas', '2026-10-01', 1]);
  assert.equal(s.purchases[0].id, p.id, 'kept in date order');
  assert.throws(() => E.act.editPurchase(s, p.id, { amount: 0 }, n), /how much/);
  assert.equal(p.amount, 20);
  assert.throws(() => E.act.editPurchase(s, 'gone', { amount: 3 }, n), /gone/);
  // A purchase on a removed account keeps it when edited for something else.
  const w = E.act.addAccount(s, { name: 'Wallet', kind: 'cash' });
  const q = E.act.addPurchase(s, { amount: 5, where: 'Market', paidWith: w.id }, n);
  E.act.deleteAccount(s, w.id);
  E.act.editPurchase(s, q.id, { what: 'Apples' }, n);
  assert.equal(q.paidWith, w.id);
  E.act.deletePurchase(s, q.id);
  assert.ok(!s.purchases.some((x) => x.id === q.id));
});

test('§10.2 undo/edit payday and edit/delete purchase all flow through the pot', () => {
  const { s, p1 } = afterP1();
  const a = buy(s, '2026-10-03', 38, 'Uber Eats');
  const b = buy(s, '2026-10-04', 52, 'Shell');
  assert.equal(pot(s, '2026-10-04'), 860);
  E.act.editPurchase(s, a.id, { amount: 50 }, at('2026-10-04', 1));
  assert.equal(pot(s, '2026-10-04'), 848);
  E.act.editPurchase(s, a.id, { paidWith: 'debt:visa' }, at('2026-10-04', 2));
  assert.equal(pot(s, '2026-10-04'), 848);
  assert.equal(E.replay(s, '2026-10-04').debts.visa.balance, 1250);
  E.act.deletePurchase(s, b.id);
  assert.equal(pot(s, '2026-10-04'), 900);
  assert.equal(E.replay(s, '2026-10-04').debts.visa.balance, 1250);
  const p2 = E.act.addPayday(s, { date: '2026-10-15', amount: 2000, nextDate: '2026-10-29' }, now('2026-10-15'));
  assert.equal(pot(s, '2026-10-15'), 900 + p2.plan.spend.amount);
  E.act.editPayday(s, p2.id, { date: '2026-10-15', amount: 300, nextDate: '2026-10-29' }, now('2026-10-15'));
  assert.equal(p2.plan.spend.amount, 240, '$300 − $60 bills');
  assert.equal(pot(s, '2026-10-15'), E.round2(900 + p2.plan.spend.amount));
  E.act.undoPayday(s, p2.id);
  assert.equal(pot(s, '2026-10-15'), 900);
  E.act.undoPayday(s, p1.id);
  assert.equal(E.replay(s, '2026-10-15').potStart, '2026-10-03', 'no payday before the first purchase any more');
  assert.equal(pot(s, '2026-10-15'), -50);
  E.act.deletePurchase(s, a.id);
  assert.equal(pot(s, '2026-10-15'), null, 'nothing logged → not started');
});

// ---------------------------------------------------------------- migration (§10.1)

// Turn a state into exactly what Harbor v1 saved (schema 1, no v2 fields).
function asV1(state) {
  const o = JSON.parse(JSON.stringify(state));
  o.schema = 1;
  delete o.accounts; delete o.purchases;
  o.paydays.forEach((p) => { delete p.t; });
  o.checkins.forEach((c) => { delete c.accounts; });
  return o;
}

test('§10.1 schema-1 state migrates losslessly', () => {
  const { s, p2 } = afterP2();
  tickAll(s, p2, '2026-10-15');
  E.act.addCheckin(s, { debts: { visa: 600 }, savings: 1300 }, now('2026-10-20'));
  s.meta.celebrated = { first: '2026-10-01' };
  s.meta.recapsShown = { '2026-09-08': true };
  const v1 = asV1(s);
  const r = E.normalizeState(JSON.parse(JSON.stringify(v1)), '2026-10-21');
  assert.equal(r.ok, true);
  const st = r.state;
  assert.equal(st.schema, 2);
  assert.deepEqual(st.accounts, E.newState('2026-10-21').accounts);
  assert.deepEqual(st.purchases, []);
  ['createdAt', 'setupDone', 'settings', 'bills', 'debts', 'savings', 'meta'].forEach((k) => assert.deepEqual(st[k], v1[k], k));
  assert.deepEqual(st.paydays, v1.paydays, 'paydays (plans, ticks) unchanged; no made-up t');
  assert.deepEqual(st.checkins.map((c) => { const x = Object.assign({}, c); delete x.accounts; return x; }), v1.checkins);
  st.checkins.forEach((c) => assert.deepEqual(c.accounts, {}));
  // Same numbers everywhere.
  ['2026-10-15', '2026-10-21', '2026-12-01'].forEach((d) => {
    const a = E.summary(v1, d), b = E.summary(st, d);
    assert.deepEqual(b.balances.debts, a.balances.debts);
    assert.equal(b.balances.savings, a.balances.savings);
    assert.deepEqual(b.balances.log, a.balances.log);
    assert.deepEqual(b.projection, a.projection);
    assert.equal(b.spending.started, false);
  });
  // A v1 state's check-in with only savings keeps working; new purchases land on top.
  buy(st, '2026-10-22', 38, 'Uber Eats');
  assert.equal(E.replay(st, '2026-10-22').potStart, '2026-10-15');
});

test('§10.1 schema-1 backup restores; schema-2 backups round-trip', () => {
  const { s } = afterP1();
  const v1 = asV1(s);
  const file = JSON.stringify({ app: 'harbor', schema: 1, exportedAt: '2026-10-02', data: v1 });
  const r = E.readBackup(file, '2026-10-03');
  assert.equal(r.ok, true);
  assert.deepEqual(r.info, { exportedAt: '2026-10-02', paydays: 1, debts: 2 });
  assert.equal(r.state.schema, 2);
  assert.deepEqual(r.state.paydays, v1.paydays);
  assert.deepEqual(r.state.debts, v1.debts);
  assert.equal(E.readBackup({ app: 'harbor', schema: 3, data: Object.assign({}, v1, { schema: 3 }) }, '2026-10-03').ok, false);
  // v2 with everything new in it.
  const t = r.state;
  const w = E.act.addAccount(t, { name: 'Wallet', kind: 'cash' });
  E.act.renameAccount(t, 'checking', 'Main bank');
  E.act.addCheckin(t, { accounts: { checking: 1500, spending: 300, [w.id]: 40 } }, at('2026-10-03', 9));
  buy(t, '2026-10-03', 38, 'Uber Eats', { category: 'delivery', paidWith: 'debt:visa', what: 'Late dinner' });
  buy(t, '2026-10-03', 12, 'Market', { paidWith: w.id });
  E.act.deleteAccount(t, w.id);
  const bk = E.makeBackup(t, '2026-10-03');
  assert.equal(bk.schema, 2);
  const back = E.readBackup(JSON.stringify(bk), '2026-10-04');
  assert.equal(back.ok, true);
  const expected = JSON.parse(JSON.stringify(t));
  expected.meta.lastBackupAt = '2026-10-03';
  assert.deepEqual(back.state, expected);
  // Old-style savings inside accounts is folded into .savings.
  const odd = E.normalizeState(Object.assign(JSON.parse(JSON.stringify(t)), {
    checkins: [{ id: 'c', date: '2026-10-03', t: 1, debts: {}, savings: null, accounts: { savings: 500, checking: 'x' } }],
    purchases: [{ id: 'p', date: '2026-10-03', amount: -4 }, { id: 'q', date: 'nope', amount: 4 }, 'junk',
      { id: 'r', date: '2026-10-03', amount: '7', category: 'zzz' }],
    accounts: [{ id: 'checking', name: '' }, { id: 'spending', name: 'Card', kind: 'cash' }, { name: 'Tin', kind: 'cash' }, 7],
  }), '2026-10-04');
  assert.equal(odd.ok, true);
  assert.deepEqual(odd.state.checkins[0].accounts, {});
  assert.equal(odd.state.checkins[0].savings, 500);
  assert.deepEqual(odd.state.purchases.map((p) => [p.id, p.amount, p.category, p.where, p.paidWith]), [['r', 7, 'other', 'Other', 'spending']]);
  assert.deepEqual(odd.state.accounts.map((a) => [a.name, a.kind]), [['Checking', 'checking'], ['Card', 'spending'], ['Savings', 'savings'], ['Tin', 'cash']]);
});

// ---------------------------------------------------------------- fuzz

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function assertSane(x, path) {
  if (typeof x === 'number') assert.ok(Number.isFinite(x), path + ' is ' + x);
  else if (typeof x === 'string') assert.ok(!/NaN|undefined|Infinity/.test(x), path + ': ' + x);
  else if (Array.isArray(x)) x.forEach((v, i) => assertSane(v, path + '[' + i + ']'));
  else if (x && typeof x === 'object') Object.keys(x).forEach((k) => assertSane(x[k], path + '.' + k));
}

test('fuzz: random histories of paydays, ticks, purchases, check-ins and undos stay sane', () => {
  const places = ['Uber Eats', 'uber eats', 'Shell', 'SHELL', 'Market', 'Cinema', 'Store'];
  const cats = E.CATEGORIES.map((c) => c.key).concat(['bogus']);
  for (let seed = 1; seed <= 24; seed++) {
    const r = rng(seed);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const setsPot = seed % 3 === 0;                 // these histories also type the spending card's balance
    const s = base();
    if (seed % 4 === 1) s.settings.boatDate = null;
    const wallet = E.act.addAccount(s, { name: 'Wallet', kind: 'cash' });
    const paidWiths = ['spending', 'spending', 'checking', wallet.id, 'debt:visa', 'debt:store', 'savings', 'bogus'];
    let t = 1;
    for (let day = 0; day <= 100; day++) {
      const d = dates.addDays('2026-10-01', day);
      const n = () => ({ d, t: t++ });
      if (day === 0 || r() < 0.08) {
        E.act.addPayday(s, { date: d, amount: Math.round(300 + r() * 2700), nextDate: dates.addDays(d, 7 + Math.floor(r() * 14)) }, n());
      }
      const latest = s.paydays[s.paydays.length - 1];
      if (latest) latest.plan.items.forEach((it) => { if (r() < 0.25) E.act.tick(s, latest.id, it.key, r() < 0.9, n()); });
      for (let k = Math.floor(r() * 3); k > 0; k--) {
        E.act.addPurchase(s, { date: dates.addDays(d, -Math.floor(r() * 3)), amount: E.round2(0.01 + r() * 60),
          where: pick(places), category: pick(cats), paidWith: pick(paidWiths) }, n());
      }
      if (r() < 0.06) {
        const acc = { checking: E.round2(r() * 3000 - 300), [wallet.id]: E.round2(r() * 200) };
        if (setsPot) acc.spending = E.round2(r() * 600 - 100);
        E.act.addCheckin(s, { debts: r() < 0.5 ? { visa: E.round2(r() * 1500) } : {}, savings: r() < 0.5 ? E.round2(r() * 3000) : null, accounts: acc }, n());
      }
      if (s.paydays.length > 1 && r() < 0.03) E.act.undoPayday(s, pick(s.paydays).id);
      if (s.purchases.length && r() < 0.05) E.act.deletePurchase(s, pick(s.purchases).id);
      if (s.purchases.length && r() < 0.05) {
        E.act.editPurchase(s, pick(s.purchases).id, { amount: E.round2(1 + r() * 80), paidWith: pick(paidWiths) }, n());
      }
      if (latest && r() < 0.02) {
        E.act.editPayday(s, latest.id, { date: latest.date, amount: Math.round(200 + r() * 2000), nextDate: latest.nextDate }, n());
      }
      if (day % 7 !== 3) continue;
      // ---- invariants as of today
      const sum = E.summary(s, d);
      assertSane(sum, 'seed ' + seed + ' ' + d + ' summary');
      assertSane(E.afford(s, d, E.round2(r() * 400)), 'afford');
      assertSane(E.stretchSpending(s, d), 'stretch');
      const bal = E.replay(s, d);
      if (!setsPot && bal.potStart) {
        const refills = E.round2(s.paydays.filter((p) => p.date >= bal.potStart && p.date <= d)
          .reduce((a, p) => a + p.plan.spend.amount, 0));
        const spent = E.round2(s.purchases.filter((p) => p.date <= d).reduce((a, p) => a + p.amount, 0));
        assert.equal(bal.pot, E.round2(refills - spent), 'pot = refills − purchases (seed ' + seed + ', ' + d + ')');
      }
      Object.values(bal.debts).forEach((x) => assert.ok(x.balance >= 0));
      const back = E.readBackup(JSON.stringify(E.makeBackup(s, d)), d);
      assert.equal(back.ok, true);
      const sum2 = E.summary(back.state, d);
      assert.deepEqual(sum2.balances, sum.balances);
      assert.deepEqual(sum2.spending, sum.spending);
      assert.deepEqual(sum2.accounts, sum.accounts);
      assert.deepEqual(sum2.recap, sum.recap);
    }
  }
});

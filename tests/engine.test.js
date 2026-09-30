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
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-10-15'), '2026-10-30');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-10-16'), '2026-11-01');
  assert.equal(E.pay.guessNext(f('semimonthly'), '2026-10-31'), '2026-11-16');
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
  assert.match(item(p, 'spend').why, /9 days at home × \$100 \+ 5 days on the boat × \$10/);
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
  assert.deepEqual(p.bills.map((b) => [b.name, b.amount, b.due, b.kind]), [
    ['Store card', 25, '2026-10-18', 'min'],
    ['Streaming', 15, '2026-10-20', 'bill'],
  ]);
  assert.deepEqual(p.yearlyAside, [{ billId: 'reg', name: 'Car registration', amount: 20, dueDate: '2027-03-15' }]);
  assert.equal(p.billsNeed, 60);
  assert.equal(p.spend.amount, 590);
  assert.equal(p.window.homeDays, 5);
  assert.equal(p.window.boatDays, 9);
  assert.equal(p.goals.total, 1350);
  assert.deepEqual(p.goals.debts, [
    { debtId: 'store', name: 'Store card', amount: 475, clears: true },
    { debtId: 'visa', name: 'Visa', amount: 573, clears: false },
  ]);
  assert.equal(p.goals.savings, 302);
  assert.equal(p.goals.stageBefore, 1);
  assert.equal(p.goals.stageAfter, 2);
  assert.deepEqual(p.items.map((i) => [i.key, i.amount]), [
    ['bills', 60], ['spend', 590], ['debt:store', 475], ['debt:visa', 573], ['save', 302]]);
  assert.equal(item(p, 'debt:store').label, 'Pay $475 extra on Store card — that clears it! 🎉');
  assert.equal(item(p, 'debt:store').clears, true);
  assert.equal(item(p, 'debt:store').debtId, 'store');
  assert.match(item(p, 'debt:store').why, /80% of your extra money goes to one debt at a time, smallest first, for quick wins\. This plus your regular payment pays it off\./);
  assert.equal(item(p, 'debt:visa').label, 'Pay $573 extra on Visa');
  assert.equal(item(p, 'save').label, 'Move $302 to savings');
  assert.match(item(p, 'save').why, /starter cushion.*20% of the rest/);
  assert.equal(itemsSum(p), 2000);
  // Ticking the Store card payment pays it off on its due date (the minimum covers the last $25).
  tickAll(s, p2, '2026-10-15');
  const r = E.replay(s, '2026-10-18');
  assert.equal(r.debts.store.balance, 0);
  assert.equal(r.debts.store.paidOffOn, '2026-10-18');
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

test('P4: $45 is short — kind words, keep it all for bills', () => {
  const { p2 } = afterP2(45);
  const p = p2.plan;
  assert.equal(p.status, 'short');
  assert.equal(p.shortBy, 15);
  assert.equal(p.billsKeep, 45);
  assert.equal(p.spend.amount, 0);
  assert.equal(p.goals.total, 0);
  assert.deepEqual(p.items.map((i) => [i.key, i.amount]), [['bills', 45]]);
  assert.equal(p.headline, 'This check is $15 short of your bills. That happens, and it\'s fixable.');
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

test('late paycheck: 7-day catch-up covers bills due since the last window', () => {
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
  // A very late paycheck only reaches back 7 days.
  const { s: s2 } = afterP1();
  const q = E.act.addPayday(s2, { date: '2026-10-30', amount: 2000, nextDate: '2026-11-13' }).plan;
  assert.equal(q.window.billsFrom, '2026-10-23');
  assert.equal(q.bills.find((b) => b.refId === 'stream'), undefined);
  assert.equal(q.bills.find((b) => b.refId === 'store'), undefined);
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
    ['bills', 60], ['spend', 590], ['debt:store', 475], ['debt:visa', 573], ['save', 302]]);
  // Plain replay still dates those ticks on Oct 16.
  assert.equal(E.replay(s, '2026-10-15').savings, 200);
  assert.equal(E.replay(s, '2026-10-16').savings, 960);
});

test('a short paycheck only records the set-aside money that was really there', () => {
  const { s, p2 } = afterP2(45);
  assert.equal(p2.plan.status, 'short');
  assert.deepEqual(p2.plan.yearlyAside.map((y) => y.amount), [5]);   // 45 − 40 of real bills
  assert.equal(p2.plan.billsNeed, 60);
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
  assert.deepEqual(p.goals.debts.map((d) => [d.debtId, d.amount, d.clears]), [['store', 475, true], ['visa', 1184, true]]);
  assert.equal(p.goals.savings, 40 + 862 + 1789);
  assert.equal(p.goals.stageAfter, 3);
  assert.match(item(p, 'save').why, /every debt/);
  assert.equal(itemsSum(p), 5000);
});

test('debtShare 1.0 and 0.2', () => {
  const all = afterP2Settings({ debtShare: 1 });
  assert.deepEqual(all.goals.debts.map((d) => d.amount), [475, 835]);
  assert.equal(all.goals.savings, 40);
  assert.match(item(all, 'debt:store').why, /^All of your extra money/);
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
  assert.match(item(p, 'save').why, /You're debt-free! Extra money now grows your safety net to 3 months of expenses \(\$4,450\)/);
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

test('replay: check-ins override; same-day order by t', () => {
  const s = base();
  const pd = E.act.addPayday(s, { date: '2026-10-01', amount: 2000, nextDate: '2026-10-15' });
  E.act.tick(s, pd.id, 'save', true, { d: '2026-10-01', t: 100 });
  E.act.addCheckin(s, { savings: 500 }, { d: '2026-10-01', t: 50 });
  assert.equal(E.replay(s, '2026-10-01').savings, 1260, 'check-in first, then the tick adds 760');
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
  assert.equal(E.replay(s, '2026-10-20').debts.store.paidOffOn, '2026-10-18');
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
  assert.equal(s.paydays[1].plan.billsNeed, 60);
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

test('project: moves closer as extra payments are ticked', () => {
  const { s, p2 } = afterP2();
  const before = E.project(s, '2026-10-15');
  tickAll(s, p2, '2026-10-15');
  const after = E.project(s, '2026-10-15');
  assert.ok(after.debtFree < before.debtFree, after.debtFree + ' < ' + before.debtFree);
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
  assert.match(item(p, 'spend').why, /14 days × \$40/);
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
  assert.equal(item(plan, 'bills').label, 'Leave R60 in checking for bills');
  assert.equal(item(plan, 'spend').label, 'Move R590 to your spending card');
  assert.equal(item(plan, 'debt:store').label, 'Pay R475 extra on Store card — that clears it! 🎉');
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
  assert.equal(bk.schema, 1);
  assert.equal(bk.exportedAt, '2026-10-20');
  const text = JSON.stringify(bk);
  const r = E.readBackup(text, '2026-10-21');
  assert.equal(r.ok, true);
  assert.deepEqual(r.info, { exportedAt: '2026-10-20', paydays: 2, debts: 2 });
  assert.deepEqual(r.state, JSON.parse(JSON.stringify(s)));
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
  assert.equal(s.schema, 1);
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

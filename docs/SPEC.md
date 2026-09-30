# Harbor — design spec (the contract every file follows)

Harbor is a dead-simple, offline, phone/iPad-first money coach for someone who works a
rotation (default 28 days on a boat, 14 days home). The user never logs purchases. After a
5-minute setup they only ever do two things:

1. Enter the date they get on the boat (rarely, when the schedule shifts).
2. On payday, tap **I got paid**, type the amount that hit the bank, and follow a short
   checklist of exact money moves, ticking each one when done.

Everything else (bills due, spending money, which debt to hit, savings, progress visuals,
debt-free date) is worked out automatically.

## 0. Principles (read these first; they decide every judgment call)

- **Babyfied.** Plain English, no finance jargon (never say APR, snowball, avalanche,
  allocation, amortization, sinking fund, liquidity). Say "interest rate", "quick wins",
  "least interest", "set aside".
- **Encouraging, never preachy or guilt-tripping.** Short paychecks get kind words.
- **Big.** Base font 18px, inputs >= 18px (prevents iOS zoom), primary buttons >= 56px tall,
  the "I got paid" button ~76px. Everything reachable with one thumb.
- **The Today screen answers 3 things only:** where am I in my rotation, what do I do next,
  how close am I to my goals. Nothing else.
- **When in doubt, leave it out.**
- **No personal numbers in code.** Examples/tests/demo data use generic values
  (e.g. "Visa $1,200", "Phone $80"). Never hard-code real user figures.
- **Plain HTML/CSS/JS.** No frameworks, no build step, no CDN, no network calls at runtime.
  Must work fully offline. Must work from a sub-path (GitHub Pages serves it at
  `https://<user>.github.io/track/`), so **every URL is relative** (`./app.js`, never `/app.js`).
- Target browsers: iOS/iPadOS Safari 16+ (home-screen web app), Chrome Android. The user
  mostly uses an **iPad**, sometimes an iPhone. Layout is a single centered column
  (max-width ~560px) that looks good on iPhone (390px wide) and iPad (820px+ wide).

## 1. Files

| File | Owner | What |
|---|---|---|
| `index.html` | UI | Shell: meta tags, loads `styles.css`, `engine.js`, `visuals.js`, `app.js` (plain `<script defer>`), registers `sw.js`. |
| `styles.css` | UI | All styles. CSS variables, light + dark (`prefers-color-scheme`). |
| `app.js` | UI | State load/save, screens, flows, event handling. Uses `window.Engine`, `window.Visuals`. |
| `engine.js` | Engine | Pure logic. No DOM. UMD: `window.Engine` in browser, `module.exports` in Node. |
| `visuals.js` | Visuals | SVG/HTML string builders + confetti. `window.Visuals`. May touch DOM only in `confetti()`. |
| `sw.js` | PWA | Service worker, cache-first offline. |
| `manifest.webmanifest` | PWA | Name "Harbor", `start_url: "./"`, `scope: "./"`, `display: "standalone"`, icons. |
| `icons/` | PWA | `icon.svg`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`. |
| `.nojekyll` | PWA | Empty file so GitHub Pages serves files as-is. |
| `tests/engine.test.js` | Engine | Unit tests: `node --test tests/engine.test.js`. |
| `tests/e2e.test.js` | Integration | Playwright end-to-end run (see §9). |

UMD pattern for engine.js / visuals.js:
```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;          // root.Visuals for visuals.js
})(typeof self !== 'undefined' ? self : this, function () { 'use strict'; /* ... */ return {...}; });
```

## 2. Dates

- All dates are ISO strings `YYYY-MM-DD`. All date math uses **UTC day numbers**
  (`Date.UTC(y, m-1, d) / 86400000`) so time zones/DST never shift a day.
- "Today" comes from the device's local calendar date (`new Date()` → `getFullYear/getMonth/getDate`).
  Only `Engine.dates.todayLocal()` reads the clock; every other engine function takes `today` as a parameter.
- Month names are fixed English (`Jan..Dec`, `January..December`), not Intl, so output is deterministic.

## 3. State (saved in `localStorage['harbor.v1']` as JSON)

```js
{
  schema: 1,
  app: 'harbor',
  createdAt: 'YYYY-MM-DD',          // setup day
  setupDone: false,
  settings: {
    currency: 'USD',                // ISO 4217 code, or 'XXX' when custom symbol is used
    currencySymbol: null,           // e.g. 'R' when currency === 'XXX'
    boatDate: null,                 // 'YYYY-MM-DD' — a day the user got/gets on the boat (day 1 of a boat stretch)
    onDays: 28,
    offDays: 14,
    payAmount: null,                // normal paycheck (number) or null
    payFreq: null,                  // 'weekly'|'biweekly'|'semimonthly'|'monthly'|'rotation'|'varies'|null
    homeSpend: null,                // spending money for one whole home stretch (offDays days), number or null
    boatSpend: null,                // spending money for one whole boat stretch (onDays days), number or null
    cushion: 1000,                  // starter cushion target
    safetyMonths: 3,                // full safety net = this many months of expenses
    debtShare: 0.8,                 // stage 2: share of extra money that goes to debt (0.2..1.0, step 0.1)
    method: 'quick',                // 'quick' (smallest balance first) | 'interest' (highest rate first)
  },
  bills: [ { id, name, amount, freq: 'monthly'|'yearly', dueDay: 1..31, dueMonth: 1..12|null } ],
  debts: [ { id, name, balance, asOf: 'YYYY-MM-DD', minPayment, dueDay: 1..31|null, rate: number|null } ],
  //   balance = balance on asOf (the starting point). rate = yearly interest rate in percent (e.g. 24.99) or null = "not sure".
  //   dueDay null = "not sure" → treated as the 1st.
  savings: { amount: 0, asOf: 'YYYY-MM-DD' },
  paydays: [ { id, date, amount, nextDate, plan: Plan, ticks: { [itemKey]: { d: 'YYYY-MM-DD', t: msEpoch } } } ],
  //   sorted by date ascending; plan is FROZEN when the payday is saved (recomputed only by editPayday).
  checkins: [ { id, date, t: msEpoch, debts: { [debtId]: number }, savings: number|null } ],
  meta: {
    lastBackupAt: null,             // 'YYYY-MM-DD'
    backupSnoozeUntil: null,
    checkinSnoozeUntil: null,
    celebrated: {},                 // { [milestoneKey]: 'YYYY-MM-DD' }
    recapsShown: {},                // { [boatStretchStartIso]: true }
    tips: {},                       // { spendingCard: true, addToHome: true }
  }
}
```

## 4. Engine API (`engine.js`) — exact names

Money: keep amounts as numbers rounded to cents (`Engine.round2`). The engine builds human
text using a money formatter passed in `opts.money` (default: `'$' + n.toLocaleString('en-US')`
with cents only when the amount isn't whole, e.g. `$1,200`, `$446.37`).

### 4.1 `Engine.dates`
`dayNum(iso)`, `fromDayNum(n)`, `addDays(iso, n)`, `addMonths(iso, n)` (clamps day to month end),
`diffDays(a, b)` (= b − a in days), `daysInMonth(y, m)`, `todayLocal()`, `isValid(iso)`,
`fmtShort(iso)` → `'Oct 12'`, `fmtDay(iso)` → `'Mon, Oct 12'`, `fmtMonthYear(iso)` → `'March 2027'`,
`fmtRange(a, b)` → `'Sep 8 – Oct 5'`.

### 4.2 `Engine.rotation`
Let B = `boatDate`, C = `onDays + offDays`.

`status(settings, today)` → `null` if no boatDate, else
`{ where: 'boat'|'home', day, of, changeDate, daysLeft, stretchStart, stretchEnd, beforeStart }`
- t ≥ B: `pos = mod(t − B, C)`.
  - `pos < onDays` → boat, `day = pos + 1`, `of = onDays`, `stretchStart = t − pos`,
    `changeDate = stretchStart + onDays` (first home day), `stretchEnd = changeDate − 1`.
  - else home, `day = pos − onDays + 1`, `of = offDays`, `stretchStart = t − (pos − onDays)`,
    `changeDate = t − pos + C` (next boat day), `stretchEnd = changeDate − 1`.
  - `daysLeft = changeDate − t`, `beforeStart = false`.
- t < B (user entered the date they NEXT get on): home, `changeDate = B`, `daysLeft = B − t`,
  `beforeStart = true`. If `daysLeft <= offDays`: `day = offDays − daysLeft + 1`, `of = offDays`;
  else `day = null`, `of = null`. `stretchStart = null`, `stretchEnd = B − 1`.

`kindOf(settings, iso)` → `'boat'|'home'|null` (null when no boatDate; dates before B are `'home'`).

`countDays(settings, fromIso, toIso)` → `{ home, boat, other }` counting **inclusive** of both ends
(returns zeros when `toIso < fromIso`; `other` counts days when boatDate is unknown).

`upcoming(settings, today, n)` → next `n` stretches starting with the current one:
`[{ where, start, end }]` (for beforeStart the current one is `{where:'home', start: today, end: B−1}`).

`lastBoatStretch(settings, today)` → when currently home and not beforeStart and a full boat
stretch precedes this home stretch: `{ start, end }` of that boat stretch; else `null`.

Banner text is built by UI from `status` (see §6.2).

### 4.3 `Engine.pay`
`intervalDays(settings)`: weekly 7, biweekly 14, semimonthly 15, monthly 30, rotation `onDays+offDays`, varies/null 14.
`perMonth(settings)`: weekly 52/12, biweekly 26/12, semimonthly 2, monthly 1, rotation `(365.25/12)/(onDays+offDays)`, varies/null 26/12.
`guessNext(settings, dateIso)`: weekly +7; biweekly +14; semimonthly: day ≤ 15 → same month `min(day+15, lastDay)`,
else next month `max(1, day−15)`; monthly `addMonths(+1)`; rotation `+ (onDays+offDays)`; varies/null +14.

### 4.4 `Engine.replay(state, untilIso, opts?)`
Rebuilds balances by replaying history. `opts.excludePaydayId` skips one payday's ticks.
Returns:
```js
{ debts: { [id]: { balance, start, paidOffOn } }, savings, log: [ {date, type, debtId?, amount} ] }
```
- Start: each debt at `balance` on `asOf`; savings at `savings.amount` on `savings.asOf`.
- Events up to and including `untilIso`, sorted by (date, order, t):
  - order 0 — **debt due date** (each month on `dueDay || 1`, clamped; only dates strictly after
    `asOf`): if balance > 0: `interest = balance × (rate||0)/100/12` (rounded to cents) → add;
    `pay = min(balance, minPayment)` → subtract; log `{type:'interest'}`, `{type:'min'}`.
  - order 1 — **ticks** of plan items (only when the item is ticked; tick date `d`):
    `kind 'debt'` subtract amount from that debt (skip if `d < asOf` or unknown debt);
    `kind 'save'` add to savings (skip if `d < savings.asOf`). Log `{type:'extra'|'save'}`.
  - order 1 — **check-ins**: set each listed debt balance and/or savings to the entered value
    (check-ins and ticks on the same day are ordered by their `t`). Log `{type:'checkin'}`.
- Balance never below 0. When a debt hits ≤ 0.005 → 0 and `paidOffOn = date` (first time).
  A check-in that sets a positive balance clears `paidOffOn`.
- `start` = the debt's `balance` field (its starting point, used for "shrinking bar" progress).

### 4.5 Stage & targets
- `Engine.monthlyBills(state)` = Σ monthly bills + Σ yearly/12 (no debt minimums).
- `Engine.monthlySpend(settings)` = `(homeSpend + boatSpend) × (365.25/12) / (onDays+offDays)` (0 if unset).
- `Engine.safetyTarget(state)` = `max(cushion, safetyMonths × (monthlyBills + monthlySpend))`, rounded to the nearest 10.
- `Engine.stage({ savings, openDebtCount, cushion, safetyTarget })`:
  1 if `savings < cushion − 0.5`; else 2 if any open debt; else 3 if `savings < safetyTarget − 0.5`; else 4.
- Stage names: 1 "Starter cushion", 2 "Crush the debt", 3 "Full safety net", 4 "Safe Harbor".
- Debt order: `'quick'` → open debts by current balance ascending (tie: name); `'interest'` →
  by rate descending (unknown rate treated as 0), tie: balance ascending.

### 4.6 `Engine.suggestSpending(state, opts?)`
Returns `{ home, boat, homeDaily, boatDaily, perMonthIncome, perMonthBills, perMonthGoals, ok }`.
- income = `(opts.payAmount ?? settings.payAmount ?? 0) × perMonth`.
- bills = `monthlyBills + Σ open debt minPayment`.
- free = income − bills. If free ≤ 0 → `{home: 0, boat: 0, ok: false, ...}`.
- spendPerMonth = `free × 0.5` (the other half is for goals).
- perCycle = `spendPerMonth × (onDays+offDays) / (365.25/12)`.
- Boat days cost 15% of a home day: `unit = perCycle / (offDays + 0.15 × onDays)`.
- `home = roundTo(unit × offDays, 50)`, `boat = roundTo(unit × 0.15 × onDays, 10)`.
- `perMonthGoals = income − bills − monthlySpend(with these values)`.

### 4.7 `Engine.makePlan(state, input, opts?)` — THE payday split
`input = { date, amount, nextDate, excludeId? }`. Uses balances from `replay(state, date, {excludePaydayId: excludeId})`
and the other paydays (excluding `excludeId`, only those with `date <= input.date`).

**Windows**
- `prevBillsTo` = max `plan.window.billsTo` of other paydays; `prevSpendTo` = max `plan.window.spendTo`.
- `billsFrom` = `prevBillsTo ? max(prevBillsTo + 1, date − 7) : date`; `billsTo = nextDate` (inclusive).
  (Bills due ON the next payday are covered now — safer against overdrafts. The 7-day catch-up covers a late paycheck.)
- `spendFrom` = `prevSpendTo ? max(prevSpendTo + 1, date) : date`; `spendTo = nextDate − 1`.

**1. Bills** (list each occurrence in `[billsFrom, billsTo]`):
- Monthly bills: each month's due date (`dueDay` clamped) in the window.
- Yearly bills: next occurrence `D ≥ billsFrom` (month/day, clamped). `saved` = Σ this bill's
  `plan.yearlyAside` entries with the same `dueDate` in other paydays.
  - If `D ≤ billsTo`: due now → amount `max(0, bill.amount − saved)` (kind `'yearly'`).
  - Else: set aside `max(0, (bill.amount − saved) / max(1, ceil((D − date) / intervalDays)))`, rounded to cents →
    goes into `plan.yearlyAside` `{billId, name, amount, dueDate: D}` and counts toward the bills total.
- Debt minimums (open debts only): due dates in the window. Past/today ones (≤ `date`) use the amount the
  replay log already applied; future ones are simulated from the current balance (interest then
  `min(minPayment, balance)`). Kind `'min'`. The simulated balance after these minimums is the debt's
  `toClear` amount for step 3.
- `billsNeed` = Σ all of the above (cents). `billsKeep = min(amount, ceil(billsNeed))`.

**2. Spending money**
- Days in `[spendFrom, spendTo]` split with `rotation.countDays` into home / boat / other.
- `homeDaily = homeSpend/offDays`, `boatDaily = boatSpend/onDays`, `otherDaily = (homeSpend+boatSpend)/(onDays+offDays)`.
  If homeSpend/boatSpend are null, use `suggestSpending(state, {payAmount: settings.payAmount ?? amount})`.
- `desired = round(home × homeDaily + boat × boatDaily + other × otherDaily)` (whole units).
- `spend = min(desired, floor(amount − billsKeep))` (never negative).

**3. Goals** — `G = floor(amount − billsKeep − spend)` whole units, waterfall:
1. Stage 1: if savings < cushion → `x = min(G, ceil(cushion − savings))` to savings.
2. Stage 2 (open debts with `toClear > 0`, in debt order): `debtPart = floor(rest × debtShare)`,
   `savePart = rest − debtPart`. Pour `debtPart` into debts in order, each up to `ceil(toClear)`
   (mark `clears: true` when it reaches it). Whatever debtPart can't place (all cleared) goes to savings.
3. Stage 3/4: everything left → savings.
- Leftover cents (`amount − billsKeep − spend − G`) are added to the bills "keep in checking" item.

**Status**
- `'short'` when `amount < billsNeed` → `shortBy = billsNeed − amount`, spend 0, goals 0.
- `'tight'` when bills covered but `spend < desired`, or goals `G == 0` with desired > 0.
- `'ok'` otherwise.

**Items** (the checklist, in this order; omit zero-amount items; omit the bills item when it has no bills and < 1 unit):
| key | kind | label | sub | why (one sentence, plain English) |
|---|---|---|---|---|
| `bills` | bills | `Leave $446.37 in checking for bills` | `3 bills before Oct 14` | "Phone, Car insurance and your Visa minimum are due before your next payday, so this stays put to cover them." |
| `spend` | spend | `Move $950 to your spending card` | `about $100 a day at home · $10 on the boat` (or `about $68 a day` if only one kind) | "9 days at home × $100 + 5 days on the boat × $10 — home days get more because that's when life costs more." |
| `debt:<id>` | debt | `Pay $475 extra on Store card` (+ ` — that clears it! 🎉` when clears) | — | quick: "80% of your extra money goes to one debt at a time, smallest first, for quick wins." interest: "…highest interest rate first, so you pay less interest." If clears: "This plus your regular payment pays it off." |
| `save` | save | `Move $302 to savings` | — | stage 1: "You're building a $1,000 starter cushion first, so a surprise doesn't land back on a credit card." stage 2: "20% keeps your cushion growing while you crush debt." stage 3: "You're debt-free! Extra money now grows your safety net to 3 months of expenses ($X)." stage 4: "Your safety net is full — this keeps growing your savings. (Your own goals, like a truck or a trip, are coming later.)" |

Plan object (frozen into the payday):
```js
{ v: 1, date, amount, nextDate,
  window: { billsFrom, billsTo, spendFrom, spendTo, homeDays, boatDays, otherDays },
  bills: [ { refId, name, amount, due, kind: 'bill'|'yearly'|'min', past } ],   // sorted by due
  yearlyAside: [ { billId, name, amount, dueDate } ],
  billsNeed, billsKeep,
  spend: { amount, desired, homeDaily, boatDaily, otherDaily },
  goals: { total, savings, debts: [ { debtId, name, amount, clears } ], stageBefore, stageAfter },
  status: 'ok'|'tight'|'short', shortBy,
  headline,     // kind one-liner, e.g. ok: "Nice! Bills are covered, spending's set, and $1,350 goes to your goals."
                // tight: "This one's a bit tight. Bills are covered and you've got $20 for spending. Goals can wait until next time — that's okay."
                // short: "This check is $15 short of your bills. That happens, and it's fixable."
  note,         // optional extra kind sentence; short: "Keep all of it in checking and pay the bills due soonest first. If you have savings, covering the gap is exactly what it's for."
  items: [ { key, kind, amount, label, sub?, why, debtId?, clears? } ] }
```

### 4.8 Projection — `Engine.project(state, today)`
Simulates future paydays from `today` with current balances (replay to today):
- Paycheck = `settings.payAmount`; if null use the average of logged paydays; if none → `{ debtFree: null, reason: 'no-pay' }`.
- Payday dates step with `guessNext` from the latest payday's `nextDate` (or today if none/past).
- Each window: debt due dates → interest + minimums; bills ≈ monthly bills in window + yearly × days/365;
  spending by rotation days (same rates as makePlan); goals waterfall (shared helper with makePlan).
- Stop when debts are 0 and savings ≥ safetyTarget, or after 10 years.
- Returns `{ debtFree: iso|null, safeHarbor: iso|null, alreadyDebtFree: bool, reason?: 'no-pay'|'too-long'|'no-extra' }`
  (`debtFree` = the date the last debt hits 0).

### 4.9 Summary — `Engine.summary(state, today, opts?)` (everything the screens need)
```js
{ rotation,                          // status() or null
  balances,                          // replay(state, today)
  savings, cushion, safetyTarget, monthlyExpenses,
  stage, stageName,
  debts: [ { id, name, start, balance, paidOffOn, rate, minPayment, isTarget, open } ],   // payoff order: paid first (by paidOffOn), then open in debt order
  totalDebtStart, totalDebtNow,
  projection,                        // project()
  voyage: { stops: [ { key, kind: 'start'|'cushion'|'debt'|'debtfree'|'harbor', label, sub, done } ], position },
  jar: { amount, target, fraction, label },   // stage 1: target = cushion, label "Starter cushion"; else safety target, "Safety net"
  latest,                            // latest payday or null
  openItems,                         // unticked items (with amount > 0) of the latest payday
  nextPayday,                        // latest.nextDate, or null
  streak,                            // see 4.10
  newMilestones,                     // milestones achieved but not in meta.celebrated
  recap,                             // see 4.10, or null
  checkinDue, backupDue }
```
**Voyage stops**: Start (done) → Starter cushion (done when savings ≥ cushion) → one stop per debt
(paid ones first, then open ones in debt order; the LAST debt stop has `kind: 'debtfree'`,
`label: 'Debt-Free'`, `sub: <debt name>`; if no debts, a single done `debtfree` stop with `sub: 'No debts'`) →
Safe Harbor (done at stage 4). `position` (float 0..stops.length−1): first not-done stop index `i` →
`(i − 1) + fraction` where fraction = savings/cushion (cushion stop), `1 − balance/start` (debt stop),
`savings/safetyTarget` (harbor), clamped 0..1. All done → last index.

### 4.10 Streak, milestones, recap, reminders
- `streak`: walk paydays newest → oldest. A payday is *complete* when every item with amount > 0 is ticked.
  Skip the newest payday if it's incomplete (still in progress). Count consecutive complete ones.
- Milestones (key → emoji/title/message):
  - `first` — first time any payday is complete. 🎉 "First payday done!"
  - `cushion` — savings ≥ cushion. 🛟 "Starter cushion reached!"
  - `paid:<debtId>` — that debt paid off. 🏝️ "<Name>: PAID OFF!"
  - `halfway` — total debt now ≤ 50% of total starting debt (total start > 0). 🧭 "Halfway to debt-free!"
  - `debtfree` — had ≥1 debt, all paid. 🏁 "DEBT-FREE!"
  - `harbor` — stage 4. ⚓ "Safe Harbor!"
  `Engine.milestones(state, today)` returns achieved `[ {key, emoji, title, message} ]`; `summary.newMilestones` filters out `meta.celebrated`.
- `recap` (welcome-home): when currently home (not beforeStart), `lastBoatStretch` exists, its `end ≥ createdAt`,
  and `meta.recapsShown[start]` unset → `{ key: start, start, end, debtPaid, saved, paidOff: [names], paydays, ticked, total }`
  from the replay log within `[start, end]` (`debtPaid` = Σ min + extra; `saved` = Σ save). If nothing happened
  (no paydays and debtPaid = 0), return `{ key, empty: true }` so the UI can mark it shown silently.
- `checkinDue`: has open debts or savings > 0, `today − max(createdAt, last check-in date) ≥ 30`, and not snoozed.
- `backupDue`: ≥ 1 payday, and (`lastBackupAt` null or `today − lastBackupAt ≥ 30`), and not snoozed.

### 4.11 Actions (mutate `state` in place and return it; app saves after)
`Engine.act.addPayday(state, {date, amount, nextDate}, now)` → returns the new payday.
`Engine.act.editPayday(state, id, {date, amount, nextDate}, now)` (recomputes plan with `excludeId`; keeps a tick when the same key has the same amount).
`Engine.act.undoPayday(state, id)`, `Engine.act.tick(state, paydayId, key, on, now)` (`now = {d, t}`),
`Engine.act.addCheckin(state, {debts, savings}, now)`, `Engine.act.setBoatDate(state, iso)`,
`Engine.act.markCelebrated(state, keys, today)`, `Engine.act.markAllCelebrated(state, today)` (used at end of setup),
`Engine.act.setDebtBalance(state, debtId, amount, now)` (= a one-debt check-in), `Engine.act.setSavings(state, amount, now)`.
Other helpers: `Engine.uid()`, `Engine.newState(today)`, `Engine.normalizeState(obj, today)` →
`{ ok, state, error }` (validates/migrates/fills defaults; used on load and restore),
`Engine.makeBackup(state, today)` → `{ app: 'harbor', schema: 1, exportedAt, data }`,
`Engine.readBackup(obj, today)` → `{ ok, state, info: { exportedAt, paydays, debts }, error }`.

New payday dates must be ≥ the latest payday's date (UI enforces; engine validates).
Only the latest payday can be edited; any payday can be undone.

## 5. Visuals API (`visuals.js`) — pure string builders unless noted

- `Visuals.routeMap(voyage, opts)` → SVG string. Vertical winding sea route for the Voyage screen.
  Stops alternate left/right down the chart, connected by a curvy route (done part solid, rest dashed),
  gentle wave pattern background. Stop icons: start ⚓ (port), cushion 🛟, debt 🏝️ (small island/buoy with
  the debt name), debtfree 🏁 flag island labelled "Debt-Free", harbor 🗼/lighthouse "Safe Harbor".
  Done stops get a ✓. A ⛵ boat sits on the route at `voyage.position` (interpolate along the bezier).
  Labels must never overlap or overflow; long names truncate with "…". `opts.width` (default 340).
- `Visuals.miniRoute(voyage)` → SVG string. Compact horizontal version for the Today screen card
  (one row, dots for stops, ⛵ at position, only first/current/last labelled).
- `Visuals.jar(jar, opts)` → SVG string. A glass jar whose water fills to `jar.fraction` with a gently
  animated wave (CSS animation, disabled under `prefers-reduced-motion`). `opts.size` 'small'|'large'.
- `Visuals.debtBars(debts, money)` → HTML string. Each debt: name, "$225 left of $500", a bar whose
  filled width = remaining fraction (it shrinks as you pay), "Up next" tag on the target, and a rotated
  rubber-stamp **PAID OFF** over paid debts.
- `Visuals.splitBar(plan, money)` → HTML string: one stacked bar (bills / spending / goals) with a tiny legend.
- `Visuals.stagePath(stage)` → HTML string: 3 steps "Starter cushion → Crush the debt → Full safety net",
  current highlighted, done ones ticked.
- `Visuals.confetti(opts)` → fires a full-screen canvas confetti burst (~2.5s), removes itself;
  no-op under `prefers-reduced-motion`.
- All builders use CSS variables (`var(--sea, #1E6FA8)`, etc., see §7 — always with a light fallback) so dark mode works; escape all text.
- visuals.js owns its own CSS: on load in a browser it injects one `<style id="harbor-visuals">` with classes prefixed `v-`.
  `styles.css` (UI) must not need to know about `v-` classes.

## 6. Screens and flows (`app.js`)

Hash-free single page. A tiny router renders one screen into `<main id="app">`. Bottom tab bar
(Today · Voyage · Settings) visible except during setup and full-screen flows. All user text is escaped.
Testing hook: a `?today=YYYY-MM-DD` URL parameter overrides "today" everywhere in the app (ticks get that date too).
Nothing else about the app may depend on the URL.

### 6.1 Setup (first run) — one question per screen
Progress dots at top, Back (top-left), big **Next** button at bottom, "Skip for now" text button.
Every answer can be changed in Settings later.
0. **Welcome** — "Hi! Let's set up your money plan. About 5 minutes. Skip anything you're not sure of."
   If on iPhone/iPad and NOT running from the Home Screen (`navigator.standalone !== true` and not
   `display-mode: standalone`): a friendly card "Add Harbor to your Home Screen first, then set up here.
   Your iPad keeps the Home Screen app's data separate from Safari." with "How?" (shows the 3 steps) and
   "Set up anyway".
1. **Boat date** — "When do you next get on the boat?" helper: "Already on it? Pick the day you got on."
   Native date input. Live preview under it from `rotation.status`: "🚢 So today is day 23 of 28 — home Oct 6."
2. **Currency** — big buttons: US $, Canada $, Australia $, New Zealand $, UK £, Euro €, Norway kr, Other (type a symbol).
3. **Paycheck** — "When payday comes, how much usually lands in your bank?" Big money input. "Just a normal one — it's fine if it changes."
4. **How often** — big buttons: Every week · Every 2 weeks · Twice a month · Once a month · Once per rotation · It varies.
5. **Bills** — "What bills do you pay?" "Phone, insurance, rent, subscriptions… Debts come next." List + **Add a bill** →
   sheet: name (quick chips: Phone, Rent, Car insurance, Internet, Streaming, Gym), amount, "Due on the __ of the month"
   (1–31 select), How often: Monthly | Yearly (yearly → month select). Each bill row is tappable to edit/delete.
6. **Debts** — "Anything you owe?" "Credit cards, loans, Afterpay, money you promised someone." Add sheet: name,
   balance ("How much is left"), minimum payment ("Smallest monthly payment"), due day (or "Not sure"),
   interest rate % (or "Not sure").
7. **Savings** — "How much do you have saved right now?" "$0 is totally fine."
8. **Spending money** — "Spending money for everything that isn't a bill: groceries, gas, going out, shopping."
   Two big steppers (−/+ 50 home, −/+ 10 boat) prefilled from `suggestSpending`: "🏠 14 days at home: $1,400 (about $100 a day)",
   "🚢 28 days on the boat: $280 (about $10 a day)". Live line: "That leaves about $1,100 a month for your goals." If
   `ok:false`: kind note "On paper your bills use up your paycheck. Set what you really need — we'll work with it."
9. **All set** — "You're all set ⚓" + 3-step plan in plain words:
   "1. Build a $1,000 starter cushion. 2. Crush your debts one at a time. 3. Grow a full safety net."
   Button "Take me to my plan". Calls `markAllCelebrated`, sets `setupDone`.

### 6.2 Today (home screen) — 3 things only
1. **Rotation banner** (tappable): boat `🚢 Day 12 of 28 · home in 16 days` (`home tomorrow` when 1, `home today` when 0);
   home `🏠 Day 5 of 14 · back out Oct 12` (`back out tomorrow` when 1); beforeStart without day `🏠 Home · back out Nov 30`;
   no boat date: `⚓ Tap to add your boat date`. Tap → sheet: "Did your schedule change?" date input ("Next day you get on the
   boat, or the day you got on"), Save → `setBoatDate`; below, the next 4 stretches (`🚢 Oct 20 – Nov 16` …). Note: "Rotation
   length (28/14) is in Settings."
2. **Next up** card:
   - If the latest payday has unticked items: title "From your payday" + "2 of 4 done", the checklist inline (tick right here),
     each item: big checkbox, label, sub, and a small "why?" toggle that reveals the one-sentence `why`
     (bills item's why also lists the bills with due dates). Under the list: small links "Fix amount" (latest only) / "Undo payday".
     Then a secondary "I got paid again" button.
   - Else: "Next payday: around Oct 14 · in 14 days" (or "No paydays yet") + the giant **💰 I got paid** button.
   - Slim reminder rows only when due: "🔎 Monthly check-in · 30 seconds" [Start] [Not now → snooze 30 days];
     "💾 Back up your data (last: never)" [Back up] [Later → snooze 7 days].
3. **Progress** card (tap → Voyage): `miniRoute`, stage line ("Stage 2 of 3 · Crush the debt"), "Debt-free by March 2027"
   (or "You're debt-free! 🎉", or "Add your normal paycheck in Settings to see your debt-free date"), small jar + "$620 saved".

On open, in order: welcome-home recap modal (if `recap` and not empty; mark shown), then celebration modals for
`newMilestones` one at a time with confetti (mark celebrated).

### 6.3 Payday flow (full screen, Back/close in top-left)
A. If the latest payday has unticked items: "Before we start — did you do these from last payday?" checklist + Continue.
B. "How much hit your bank?" giant money input (inputmode decimal, autofocus). "Paid on" date (default today, max today,
   min latest payday date). "Next payday (our guess)" date defaulting to `guessNext` — changeable, must be after paid-on.
   Button "Show me what to do".
C. Plan: headline (+ note) in a colored callout (ok = sea, tight = sand, short = soft coral — never red/alarm), `splitBar`,
   the checklist (same component as Today), "Leave in checking" item shows the bills list when "why?" is opened.
   First time only: tip card "💡 Keep your spending money on its own card or account, so your bank app shows exactly
   what's left." [Got it]. Button "Done for now" → Today. Ticking the last item of a plan → small cheer + streak text;
   milestones → celebration.

Fix amount: reopens B prefilled (`editPayday`). Undo: confirm "Undo this payday? Its checklist and ticks will be removed." → `undoPayday`.

### 6.4 Voyage (progress)
Big headline "Debt-free by March 2027" + "Safe Harbor by Oct 2027" (if known) · `routeMap` · `stagePath` ·
`jar` (large) with "$620 of $1,000" · "Your debts" with `debtBars` · streak "⭐ 3 paydays in a row, all ticked off"
(hidden when 0) · **Logbook**: past paydays (newest first): date, amount, "4 of 4 done"; tap → view/tick its checklist,
"Undo this payday".

### 6.5 Settings (rarely needed; grouped cards, each row opens a small sheet)
- **Rotation**: boat date, days on (default 28), days off (default 14).
- **Pay**: normal paycheck, how often.
- **Bills**: list, add/edit/delete.
- **Debts**: list, add/edit/delete (changing the balance = `setDebtBalance`).
- **Savings**: "What's in savings now" (= `setSavings`).
- **Spending money**: home stretch, boat stretch, "Suggest for me".
- **Your plan**: slider "More to debt ↔ More to savings" (debtShare 1.0 … 0.2, label "80% to debt · 20% to savings"),
  switch "Quick wins (smallest debt first)" vs "Least interest (highest rate first)", starter cushion amount,
  safety net months (1–12).
- **Currency**.
- **Monthly check-in** (open it anytime).
- **Your data**: "Back up now", "Restore from a backup", "Last backup: Sep 30". Plain warnings (see §8). "Start over" (danger, double confirm, offers a backup first).
- Footer: "Harbor · works offline · your data stays on this device" + version.

### 6.6 Check-in sheet
"Quick check-in (30 seconds). Open your bank apps and type what they say. Skip any you're not sure of."
One money input per open debt (placeholder = our estimate "We think $225") + savings. Save → `addCheckin` with only the
fields the user filled; "Not now" → snooze 30 days.

## 7. Look & feel
Light nautical, clean and modern — not a spreadsheet. Rounded cards (radius 20px), soft shadows, generous spacing.
Font: `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (no web fonts).
CSS variables (light / dark):
```
--bg #F2F6F9 / #0A1628        --card #FFFFFF / #12233B      --ink #0B2545 / #E8F1F8
--muted #5B6B7F / #9FB3C8     --line #DDE6EE / #22364F      --sea #1E6FA8 / #4BA3E3
--sea-soft #DCEBF6 / #173A5C  --teal #1B998B / #3CC5B3      --teal-soft #D8F2EE / #103B38
--sand #F6ECD9 / #3A3222      --gold #E9A23B / #F2B94F      --coral #E07A5F / #F08E73
--coral-soft #FBE4DD / #3D2520
```
Split bar colors: bills `--muted`, spending `--gold`, goals `--teal`. The "I got paid" button: `--sea` background,
white text, 24px bold, 76px tall, radius 22px. Status bar: `apple-mobile-web-app-status-bar-style = default`,
`theme-color` #F2F6F9 (light) / #0A1628 (dark) via media attribute. Respect `env(safe-area-inset-*)`.
Money shows with the user's currency via `Intl.NumberFormat('en-US', {style:'currency', currency, maximumFractionDigits})`
(whole units unless cents are present); custom symbol → `symbol + number`.

## 8. Offline, storage, data safety
- `sw.js`: `const VERSION = 'harbor-v1'`; precache every app file with `cache: 'reload'` on install; `skipWaiting()`;
  on activate delete other caches + `clients.claim()`; fetch (GET, same-origin): cache-first, fall back to network,
  and for navigations fall back to cached `./index.html`. Bump VERSION on every release.
- `index.html` registers `./sw.js` with `{ scope: './', updateViaCache: 'none' }`.
- Storage: `localStorage['harbor.v1']`. Call `navigator.storage.persist()` once when available.
  If a save throws, show a kind but clear banner: "Couldn't save on this device. Make a backup now."
- Backup: JSON file `harbor-backup-YYYY-MM-DD.json` via Web Share with files when `navigator.canShare({files})`
  (iPad/iPhone → "Save to Files"), else a download link. Sets `lastBackupAt` when the share/download completes.
- Restore: `<input type=file accept=".json,application/json,text/plain">` → `readBackup` → confirm
  "Replace everything in Harbor with the backup from Sep 30 (4 paydays)?" → replace.
- Warnings shown in Settings → Your data (plain words):
  1. "Your money info lives only on this device — nothing is sent anywhere."
  2. "Always open Harbor from its Home Screen icon. Safari and the Home Screen app keep separate data."
  3. "Deleting the Harbor icon from your Home Screen deletes its data."
  4. "Clearing Safari's history and website data can wipe it."
  5. "Your iPad and iPhone don't sync. Pick one, or move your data with a backup file."
  6. "Keep a backup in iCloud Drive or Files — we'll remind you once a month."

## 9. Testing
- `node --test tests/engine.test.js` must pass (engine unit tests, incl. the worked examples below).
  (Node 22 does not expand a bare folder argument, so `node --test tests/` does not work.)
- `tests/e2e.test.js` (Playwright; run with `NODE_PATH=$(npm root -g) node --test tests/e2e.test.js`): serves the repo
  under `/track/` (like GitHub Pages) with a tiny static server on a random port, runs iPhone 13 and iPad (gen 7)
  contexts: setup → payday (P1) → ticks → reload → welcome-home recap (once) → payday (P2) → Voyage/Settings →
  check-in → tight payday + undo → backup (download) → start over → restore → offline reload (service worker;
  the server also drops connections, because Chromium's offline emulation doesn't reach service-worker fetches)
  → no console errors.

### Worked examples (must be unit tests)
Settings: boatDate `2026-09-08`, 28/14, pay 2000 biweekly, homeSpend 1400 ($100/day), boatSpend 280 ($10/day),
cushion 1000, debtShare 0.8, method quick. Bills: Car insurance $150 monthly due 5; Phone $80 monthly due 12;
Streaming $15 monthly due 20; Car registration $240 yearly due Mar 15. Debts (asOf 2026-09-30): Visa 1200, min 40,
due 10, rate 24; Store card 500, min 25, due 18, rate null. Savings 200 asOf 2026-09-30.

Rotation (boatDate 2026-09-08): Sep 8 → boat day 1/28, change Oct 6; Sep 30 → boat 23/28, daysLeft 6;
Oct 5 → boat 28/28, daysLeft 1; Oct 6 → home 1/14, change Oct 20; Oct 19 → home 14/14, daysLeft 1;
Oct 20 → boat 1/28; 2027-03-01 → pos = (174 mod 42) = 6 → boat day 7. With boatDate 2026-10-12 and today Sep 30 →
home, beforeStart, daysLeft 12, day 3 of 14. With boatDate 2026-11-30 and today Sep 30 → home, day null.

P1 — payday 2026-10-01, $2,000, next 2026-10-15:
bills window Oct 1–Oct 15: Car insurance 150 (Oct 5), Visa min 40 (Oct 10; interest 24 then pay 40), Phone 80 (Oct 12);
registration set-aside 240 / ceil(165/14 = 11.79 → 12) = 20.00 → billsNeed 290, billsKeep 290.
spending Oct 1–Oct 14: 5 boat days (Oct 1–5) + 9 home days (Oct 6–14) = 50 + 900 = 950.
goals 760 → stage 1 → all 760 to savings. Items: bills 290, spend 950, save 760 (sum 2000).

P2 — tick everything from P1 on 2026-10-01, then payday 2026-10-15, $2,000, next 2026-10-29:
bills window Oct 16–Oct 29 (prevBillsTo Oct 15): Streaming 15 (Oct 20), Store card min 25 (Oct 18);
registration set-aside (240 − 20) / ceil(151/14 = 10.79 → 11) = 20.00 → billsNeed 60.
spending Oct 15–Oct 28: 5 home (Oct 15–19) + 9 boat (Oct 20–28) = 500 + 90 = 590.
goals 1350: stage 1 needs 40 (savings 960) → 40 to savings; rest 1310 → debtPart 1048, savePart 262.
Quick wins order: Store card (500) then Visa (1184 after Oct 10's interest and minimum).
Store card toClear = 500 − 25 = 475 → pay 475 (clears); Visa gets 573. Savings total 40 + 262 = 302.
Items: bills 60, spend 590, debt Store card 475 (clears), debt Visa 573, save 302 (sum 2000).

P3 — same as P2 but amount $80: billsKeep 60, spend 20 (desired 590), goals 0 → status 'tight'.
P4 — same as P2 but amount $45: status 'short', shortBy 15, billsKeep 45, spend 0, goals 0.

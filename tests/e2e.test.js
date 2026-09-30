// Harbor end-to-end test (SPEC §9). Plain node:test + Playwright, no other dependencies.
// Run:  NODE_PATH=$(npm root -g) node --test tests/e2e.test.js
//
// Serves the repo under /track/ (like GitHub Pages) from a tiny built-in static server,
// then walks the whole app on an iPhone 13 and an iPad (gen 7):
// setup → payday → ticks → recap → check-in → tight payday + undo → backup → start over →
// restore → offline reload through the service worker. Any console error or page error fails.
// All numbers are the generic SPEC §9 examples — never real ones.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = '/track/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// ---------------------------------------------------------------- static server with an "offline" switch
function startServer() {
  const srv = { offline: false };
  srv.http = http.createServer((req, res) => {
    // Offline: drop the connection, like a boat with no signal. (Playwright's setOffline alone
    // doesn't reach service-worker fetches in Chromium, so the server has to go quiet too.)
    if (srv.offline) { req.socket.destroy(); return; }
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/track') { res.writeHead(301, { Location: PREFIX }); res.end(); return; }
    if (!p.startsWith(PREFIX)) { res.writeHead(404); res.end('not found'); return; }
    p = p.slice(PREFIX.length);
    if (p === '' || p.endsWith('/')) p += 'index.html';
    const file = path.resolve(ROOT, p);
    if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])\.git([\\/]|$)/.test(file)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
  return new Promise((resolve) => {
    srv.http.listen(0, '127.0.0.1', () => {
      srv.base = 'http://127.0.0.1:' + srv.http.address().port + PREFIX;
      resolve(srv);
    });
  });
}

// ---------------------------------------------------------------- helpers
const P1 = [
  ['Leave $290 in checking for bills', 290],
  ['Move $950 to your spending card', 950],
  ['Move $760 to savings', 760],
];
const P2 = [
  ['Leave $35 in checking for bills', 35],
  ['Move $590 to your spending card', 590],
  ['Pay $500 on Store card — that clears it! 🎉', 500],
  ['Pay $573 extra on Visa', 573],
  ['Move $302 to savings', 302],
];

function makeRunner(page, base, errors) {
  const r = {};
  r.at = async (day) => {
    await page.goto(base + '?today=' + day);
    await page.waitForSelector('#app > :not(.boot)');
    await page.waitForTimeout(900);   // recaps + celebrations open ~250–700 ms after a screen shows
  };
  r.next = () => page.click('.setup-foot button[type=submit]');
  r.state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.Harbor.state)));
  // Close every celebration/recap that pops up (they queue one at a time). Returns their titles.
  r.dismissPopups = async () => {
    const seen = [];
    for (let k = 0; k < 12; k++) {
      const pop = await page.$('.layer .celebrate');
      if (pop) {
        seen.push((await pop.$eval('h2', (h) => h.textContent)).trim());
        await pop.$eval('button', (b) => b.click());
        await page.waitForTimeout(150);
        continue;
      }
      await page.waitForTimeout(900);
      if (!(await page.$('.layer .celebrate'))) break;
    }
    return seen;
  };
  r.labels = () => page.$$eval('main .item-label', (els) => els.map((e) => e.textContent));
  r.planItems = async () => {
    const st = await r.state();
    const pd = st.paydays[st.paydays.length - 1];
    return pd.plan.items.filter((i) => i.amount > 0).map((i) => [i.label, i.amount]);
  };
  r.noSideScroll = async (where) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(w[0] <= w[1] + 1, where + ': page scrolls sideways (' + w[0] + ' > ' + w[1] + ')');
  };
  r.noErrors = (where) => assert.deepEqual(errors, [], 'console/page errors ' + where);
  return r;
}

async function runDevice(browser, srv, deviceName) {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-e2e-'));
  const ctx = await browser.newContext({ ...devices[deviceName], acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const r = makeRunner(page, srv.base, errors);
  const base = srv.base;

  try {
    // ------------------------------------------------------------ 1. setup (today = Sep 30)
    await r.at('2026-09-30');
    assert.match(await page.textContent('.q-title'), /set up your money plan/);
    // iPhone/iPad in the browser: the "Add to Home Screen first" card shows; tap "Set up anyway".
    const anyway = await page.$('[data-action=setupAnyway]');
    if (anyway) await anyway.click(); else await r.next();

    await page.fill('#f-boat', '2026-09-08');
    await page.dispatchEvent('#f-boat', 'change');
    assert.match(await page.textContent('#boat-preview'), /day 23 of 28 — home Oct 6/);
    await r.next();

    await page.click('[data-action=pickCurrency][data-v=USD]');
    await page.fill('#f-pay', '2000');
    await r.next();
    await page.click('[data-action=pickFreq][data-v=biweekly]');

    const addBill = async (name, amt, day, month) => {
      await page.click('[data-action=addBill]');
      await page.fill('#b-name', name);
      await page.fill('#b-amt', amt);
      if (month) { await page.click('[data-la=freq][data-v=yearly]'); await page.selectOption('#b-month', String(month)); }
      await page.selectOption('#b-day', String(day));
      await page.click('.layer button[type=submit]');
      await page.waitForSelector('.layer', { state: 'detached' });
    };
    await addBill('Car insurance', '150', 5);
    await addBill('Phone', '80', 12);
    await addBill('Streaming', '15', 20);
    await addBill('Car registration', '240', 15, 3);
    assert.equal(await page.$$eval('.list-row', (e) => e.length), 4);
    await r.next();

    const addDebt = async (name, bal, min, due, rate) => {
      await page.click('[data-action=addDebt]');
      await page.fill('#d-name', name);
      await page.fill('#d-bal', bal);
      await page.fill('#d-min', min);
      await page.selectOption('#d-due', due);
      if (rate) await page.fill('#d-rate', rate);
      await page.click('.layer button[type=submit]');
      await page.waitForSelector('.layer', { state: 'detached' });
    };
    await addDebt('Visa', '1200', '40', '10', '24');
    await addDebt('Store card', '500', '25', '18', '');   // interest rate "not sure"
    await r.next();

    await page.fill('#f-sav', '200');
    await r.next();

    // Spending: suggestions are prefilled; set the §9 amounts ($100/day home, $10/day boat).
    assert.ok(Number(await page.inputValue('#f-home')) > 0, 'home spending is suggested');
    await page.fill('#f-home', '1400');
    await page.fill('#f-boatspend', '300');
    await page.click('[data-action=step][data-target=f-boatspend][data-delta="-10"]');
    await page.click('[data-action=step][data-target=f-boatspend][data-delta="-10"]');
    assert.equal(await page.inputValue('#f-boatspend'), '280');
    assert.match(await page.textContent('#spend-note'), /a month for your goals/);
    await r.next();

    assert.match(await page.textContent('.q-title'), /all set/);
    await r.next();
    await page.waitForSelector('.banner');

    const st0 = await r.state();
    assert.equal(st0.setupDone, true);
    assert.equal(st0.bills.length, 4);
    assert.deepEqual(st0.debts.map((d) => [d.name, d.balance, d.minPayment, d.dueDay, d.rate]),
      [['Visa', 1200, 40, 10, 24], ['Store card', 500, 25, 18, null]]);
    assert.equal(st0.savings.amount, 200);
    assert.deepEqual([st0.settings.boatDate, st0.settings.payAmount, st0.settings.payFreq, st0.settings.homeSpend, st0.settings.boatSpend],
      ['2026-09-08', 2000, 'biweekly', 1400, 280]);
    const banner = (await page.textContent('.banner-text')).replace(/\s+/g, ' ').trim();
    assert.equal(banner, '🚢 Day 23 of 28 · home in 6 days');
    assert.equal(await page.$$eval('.tab', (e) => e.length), 3);
    await r.noSideScroll('today after setup');

    // ------------------------------------------------------------ 2. first payday (Oct 1, $2,000) = P1
    await r.at('2026-10-01');
    await page.click('[data-action=startPayday]');
    await page.fill('#p-amt', '2000');
    assert.equal(await page.inputValue('#p-date'), '2026-10-01');
    assert.equal(await page.inputValue('#p-next'), '2026-10-15', 'next payday is guessed 2 weeks out');
    await page.click('form[data-submit=paydayGo] button[type=submit]');
    await page.waitForSelector('.callout');
    assert.deepEqual(await r.labels(), P1.map((x) => x[0]));
    assert.deepEqual(await r.planItems(), P1);
    assert.ok(await page.$('.v-split'), 'split bar shown');
    // "why?" explains in one sentence; the bills one lists the bills.
    await page.click('main .why-btn >> nth=0');
    assert.match(await page.textContent('main .why'), /Car insurance/);
    await r.noSideScroll('payday plan');
    // Progress moves only when ticked.
    assert.equal((await r.state()).paydays[0].ticks && Object.keys((await r.state()).paydays[0].ticks).length, 0);
    for (let i = 0; i < 3; i++) {
      await page.click('main .tick[aria-checked=false] >> nth=0');
      await page.waitForTimeout(120);
    }
    await page.waitForSelector('.layer .celebrate', { timeout: 4000 });
    const cel1 = await r.dismissPopups();
    assert.ok(cel1.includes('First payday done!'), 'first payday celebration: ' + cel1.join(', '));
    assert.match(await page.textContent('.cheer'), /All done/);
    await page.click('[data-action=flowClose]');
    await page.waitForSelector('.banner');

    // Reload: everything was saved on the device.
    await page.reload();
    await page.waitForSelector('.banner');
    await page.waitForTimeout(900);
    assert.deepEqual(await r.dismissPopups(), [], 'no repeat celebration after reload');
    const st1 = await r.state();
    assert.equal(st1.paydays.length, 1);
    assert.deepEqual(Object.keys(st1.paydays[0].ticks).sort(), ['bills', 'save', 'spend']);
    assert.match(await page.textContent('.next-card'), /Next payday: around Oct 15/);
    assert.match(await page.textContent('.progress-card'), /\$960/);

    // ------------------------------------------------------------ 3. welcome-home recap (Oct 7), once
    await r.at('2026-10-07');
    assert.match(await page.textContent('.banner-text'), /Day 2 of 14 · back out Oct 20/);
    const recap = await page.$('.layer .celebrate');
    assert.ok(recap, 'welcome-home recap appears');
    const recapText = await recap.textContent();
    assert.match(recapText, /Welcome home/);
    assert.match(recapText, /\$760/);
    await r.dismissPopups();
    await r.at('2026-10-07');
    assert.equal(await page.$('.layer .celebrate'), null, 'recap shows only once');

    // ------------------------------------------------------------ 4. payday 2 (Oct 15, $2,000) = P2
    await r.at('2026-10-15');
    await page.click('[data-action=startPayday]');
    await page.fill('#p-amt', '2000');
    assert.equal(await page.inputValue('#p-next'), '2026-10-29');
    await page.click('form[data-submit=paydayGo] button[type=submit]');
    await page.waitForSelector('.callout-ok');
    assert.deepEqual(await r.labels(), P2.map((x) => x[0]));
    assert.deepEqual(await r.planItems(), P2);
    await page.click('[data-action=flowClose]');
    await page.waitForSelector('.next-card .tick');
    assert.equal(await page.$('.remind'), null, 'no reminders under an open checklist');

    // A schedule change re-plans the open payday's spending money (nothing ticked yet)…
    const spendOf = async () => (await r.state()).paydays[1].plan.items.find((i) => i.kind === 'spend').amount;
    const setBoat = async (iso) => {
      await page.click('[data-action=rotation]');
      await page.fill('#r-date', iso);
      await page.dispatchEvent('#r-date', 'change');
      await page.click('.layer button[type=submit]');
      await page.waitForSelector('.layer', { state: 'detached' });
      await page.waitForTimeout(100);
      const t = await page.textContent('#toast');
      await r.dismissPopups();
      return t;
    };
    let toastText = await setBoat('2026-10-27');
    assert.notEqual(await spendOf(), 590, 'spending money follows the new home days');
    assert.equal(toastText, 'Got it. Your spending money for this payday is now ' + '$' + (await spendOf()).toLocaleString('en-US') + '.');
    assert.match(await page.textContent('.banner-text'), /Day 10 of 21/);
    // …and moving it back gives the original plan again.
    toastText = await setBoat('2026-09-08');
    assert.equal(toastText, 'Got it. Your spending money for this payday is now $590.');
    assert.deepEqual(await r.planItems(), P2);

    // The check-in asks about undone steps first; ticking one with no balances typed just saves the tick.
    await page.click('.tab[data-to=settings]');
    await page.click('.group [data-action=checkin]');
    await page.waitForSelector('.layer .ci-pending');
    assert.deepEqual(await page.$$eval('.layer .check-row', (e) => e.map((x) => x.textContent)),
      P2.slice(2).map((x) => x[0]));
    await page.click('.layer .check-row >> text=Visa');
    await page.click('.layer button[type=submit]');
    await page.waitForSelector('.layer', { state: 'detached' });
    assert.equal(await page.textContent('#toast'), 'Saved.');
    const stTick = await r.state();
    assert.equal(stTick.checkins.length, 0, 'no check-in saved without balances');
    assert.deepEqual(Object.keys(stTick.paydays[1].ticks), ['debt:' + stTick.debts[0].id]);
    await r.dismissPopups();
    await page.click('.tab[data-to=today]');

    // Tick the rest from the Today screen.
    await page.waitForSelector('.next-card .tick');
    assert.match(await page.textContent('.next-card .card-count'), /1 of 5 done/);
    const celebrated = [];
    for (let i = 0; i < 4; i++) {
      await page.click('.next-card .tick[aria-checked=false] >> nth=0');
      await page.waitForTimeout(250);
      celebrated.push(...(await r.dismissPopups()));
    }
    assert.ok(celebrated.includes('Starter cushion reached!'), 'cushion celebration: ' + celebrated.join(', '));
    assert.match(await page.textContent('.next-card'), /Everything from your Oct 15 payday is done/);

    // Opened in a browser tab on an iPhone/iPad: one reminder, the Safari one, once the checklist is done.
    assert.equal(await page.$$eval('.remind', (e) => e.length), 1);
    assert.match(await page.textContent('.remind'), /Harbor is open in Safari/);
    await page.click('.remind [data-action=safariHow]');
    await page.waitForSelector('.layer .safe-steps');
    assert.equal(await page.$$eval('.layer .safe-steps li', (e) => e.length), 3);
    assert.match(await page.textContent('.layer'), /Open as Web App/);
    await page.click('.layer [data-la=close]');
    await page.waitForSelector('.layer', { state: 'detached' });
    await page.click('.remind [data-action=safariLater]');
    assert.equal(await page.$$eval('.remind', (e) => e.length), 1, 'the next reminder takes the slot');
    assert.doesNotMatch(await page.textContent('.remind'), /Safari/);

    // ------------------------------------------------------------ 5. Voyage + Settings
    await page.click('.tab[data-to=voyage]');
    await page.waitForSelector('.v-route');
    assert.ok(await page.$('.v-jar'), 'jar');
    assert.equal(await page.$$eval('.v-debts .v-debt', (e) => e.length), 2, 'two debt bars');
    assert.match(await page.textContent('.page-title'), /Debt-free by/);
    assert.equal(await page.$$eval('.log-row', (e) => e.length), 2, 'logbook has 2 paydays');
    await r.noSideScroll('voyage');
    await page.click('.tab[data-to=settings]');
    await page.waitForSelector('.page-title');
    assert.equal(await page.textContent('.page-title'), 'Settings');
    for (const t of ['Rotation', 'Pay', 'Bills', 'Debts', 'Your plan', 'Your data']) {
      assert.ok((await page.$$eval('.section-title', (e) => e.map((x) => x.textContent))).includes(t), 'settings section ' + t);
    }
    assert.ok(await page.$('#f-share'), 'debt/savings slider');
    await r.noSideScroll('settings');

    // Changing a debt's minimum doesn't rewrite its past: today's balance stays put.
    const visaLeft = async () => {
      await page.click('.tab[data-to=voyage]');
      await page.waitForSelector('.v-debt');
      const t = await page.$$eval('.v-debt', (e) => e.filter((x) => /Visa/.test(x.textContent)).map((x) => x.querySelector('.v-debt-amt').textContent)[0]);
      await page.click('.tab[data-to=settings]');
      await page.waitForSelector('.page-title');
      return t;
    };
    const visaBefore = await visaLeft();
    await page.click('.group [data-action=editDebt] >> text=Visa');
    await page.fill('#d-min', '60');
    await page.click('.layer button[type=submit]');
    await page.waitForSelector('.layer', { state: 'detached' });
    assert.equal((await r.state()).debts[0].minPayment, 60);
    assert.equal(await visaLeft(), visaBefore, 'Visa balance unchanged after editing its minimum');

    // ------------------------------------------------------------ 6. check-in (real balances)
    await page.click('.group [data-action=checkin]');
    await page.waitForSelector('.layer [id^=ci-]');
    const visaId = st0.debts.find((d) => d.name === 'Visa').id;
    assert.match(await page.getAttribute('#ci-' + visaId, 'placeholder'), /^We think /);
    await page.fill('#ci-' + visaId, '600');
    await page.click('.layer button[type=submit]');
    await page.waitForSelector('.layer', { state: 'detached' });
    const st2 = await r.state();
    assert.equal(st2.checkins.length, 2, 'the minimum change pinned a balance, then the check-in');
    assert.equal(st2.checkins[1].debts[visaId], 600);
    assert.equal(st2.checkins[1].savings, null, 'untouched savings field is not saved');

    // ------------------------------------------------------------ 7. a paycheck that barely covers bills → kind 'tight'
    await r.at('2026-10-29');
    await r.dismissPopups();   // e.g. "Store card: PAID OFF!" (cleared by its Oct 15 step)
    // Every bill due (from a plan too small to clear any debt) plus the full yearly set-aside.
    const need = await page.evaluate(() => {
      const plan = (amount) => window.Engine.makePlan(window.Harbor.state, { date: '2026-10-29', amount, nextDate: '2026-11-12' });
      const sum = (list) => list.reduce((a, x) => a + x.amount, 0);
      return sum(plan(1).bills) + sum(plan(100000).yearlyAside);
    });
    const tightAmount = Math.ceil(need) + 25;
    await page.click('[data-action=startPayday]');
    await page.fill('#p-amt', String(tightAmount));
    assert.equal(await page.inputValue('#p-next'), '2026-11-12');
    await page.click('form[data-submit=paydayGo] button[type=submit]');
    await page.waitForSelector('.callout-tight');
    const tightText = await page.textContent('.callout-tight');
    assert.match(tightText, /a bit tight/);
    assert.match(tightText, /that's okay/);
    assert.doesNotMatch(tightText, /should have|wasted|bad|fail/i);
    // Undo it.
    await page.click('main .links [data-action=undoPayday]');
    await page.click('.layer [data-la=pick] >> nth=0');
    await page.waitForSelector('.banner');
    assert.equal((await r.state()).paydays.length, 2, 'undo removed the tight payday');

    // ------------------------------------------------------------ 8. backup (download)
    await page.click('.tab[data-to=settings]');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.group [data-action=backup]'),
    ]);
    assert.match(download.suggestedFilename(), /^harbor-backup-2026-10-29\.json$/);
    const backupPath = path.join(dl, download.suggestedFilename());
    await download.saveAs(backupPath);
    const backupJson = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backupJson.app, 'harbor');
    assert.equal(backupJson.schema, 1);
    assert.equal(backupJson.data.paydays.length, 2);
    assert.equal((await r.state()).meta.lastBackupAt, '2026-10-29');
    await page.waitForTimeout(300);
    assert.match(await page.textContent('.group [data-action=backup]'), /Last: Oct 29/);

    // ------------------------------------------------------------ 9. start over (double confirm)
    await page.click('[data-action=startOver]');
    await page.click('.layer [data-la=pick] >> text=Delete everything');
    await page.click('.layer [data-la=pick] >> text=Yes, delete it all');
    await page.waitForSelector('.q-title');
    assert.match(await page.textContent('.q-title'), /set up your money plan/);
    assert.equal((await r.state()).paydays.length, 0);
    await page.reload();
    await page.waitForSelector('.q-title');
    assert.equal((await r.state()).setupDone, false, 'start over survives a reload');

    // ------------------------------------------------------------ 10. restore from the file
    await page.setInputFiles('#restore-file', backupPath);
    await page.waitForSelector('.layer [data-la=pick]');
    assert.match(await page.textContent('.layer'), /Replace everything in Harbor with the backup from Oct 29 \(2 paydays\)\?/);
    await page.click('.layer [data-la=pick] >> nth=0');
    await page.waitForSelector('.banner');
    const st3 = await r.state();
    assert.equal(st3.setupDone, true);
    assert.equal(st3.paydays.length, 2);
    assert.equal(st3.checkins.length, 2);
    await page.reload();
    await page.waitForSelector('.banner');
    assert.equal((await r.state()).paydays.length, 2, 'restored data persisted');

    // ------------------------------------------------------------ 11. offline reload through the service worker
    const controlled = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      return !!navigator.serviceWorker.controller;
    });
    if (!controlled) { await page.reload(); await page.waitForSelector('.banner'); }
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
    srv.offline = true;
    await ctx.setOffline(true);
    try {
      await page.goto(base + '?today=2026-10-29');
      await page.waitForSelector('.banner', { timeout: 10000 });
      assert.match(await page.textContent('.banner-text'), /Day 10 of 28/);
      assert.equal((await r.state()).paydays.length, 2);
      await page.click('.tab[data-to=voyage]');
      await page.waitForSelector('.v-route');
    } finally {
      await ctx.setOffline(false);
      srv.offline = false;
    }

    r.noErrors('on ' + deviceName);
  } finally {
    await ctx.close();
    fs.rmSync(dl, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the tests
let srv, browser;

// One missing precached file makes cache.addAll fail, and then the app never works offline.
test('offline file list (sw.js APP_FILES) matches the files on disk and in index.html', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const m = sw.match(/const APP_FILES = (\[[\s\S]*?\]);/);
  assert.ok(m, 'APP_FILES array found in sw.js');
  const files = JSON.parse(m[1].replace(/'/g, '"').replace(/,\s*\]$/, ']'));
  const norm = (u) => { u = u.replace(/^\.\//, ''); return u === '' ? 'index.html' : u; };
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, norm(f))), 'precached file exists: ' + f);
  }
  const listed = new Set(files.map(norm));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [];
  for (const t of html.match(/<script\b[^>]*\bsrc="[^"]+"/g) || []) refs.push(t.match(/src="([^"]+)"/)[1]);
  for (const t of html.match(/<link\b[^>]*>/g) || []) {
    if (/rel="(stylesheet|manifest|icon|apple-touch-icon)"/.test(t)) refs.push(t.match(/href="([^"]+)"/)[1]);
  }
  assert.ok(refs.length >= 5, 'found the page\'s scripts and links');
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r)) continue;   // not local
    assert.ok(listed.has(norm(r)), 'index.html uses ' + r + ' but sw.js doesn\'t precache it');
  }
});

test('Harbor end to end', { timeout: 240000 }, async (t) => {
  srv = await startServer();
  browser = await chromium.launch();
  try {
    await t.test('serves files with the right content types', async () => {
      for (const [p, type] of [['', 'text/html'], ['manifest.webmanifest', 'application/manifest+json'], ['sw.js', 'text/javascript'],
        ['styles.css', 'text/css'], ['icons/icon-192.png', 'image/png'], ['icons/icon.svg', 'image/svg+xml']]) {
        const res = await fetch(srv.base + p);
        assert.equal(res.status, 200, p);
        assert.ok(res.headers.get('content-type').startsWith(type), p + ' → ' + res.headers.get('content-type'));
      }
    });
    await t.test('iPhone 13', () => runDevice(browser, srv, 'iPhone 13'));
    await t.test('iPad (gen 7)', () => runDevice(browser, srv, 'iPad (gen 7)'));
  } finally {
    await browser.close();
    await new Promise((res) => srv.http.close(res));
  }
});

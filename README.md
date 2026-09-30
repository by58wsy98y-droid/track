# ⚓ Harbor — your payday coach

Harbor tells you exactly what to do with each paycheck and shows your progress to
**debt-free** and a **full safety net**. It's built for a 28-days-on / 14-days-home rotation.

After a 5-minute setup you only ever do two things:

1. **On payday:** tap **💰 I got paid**, type what hit your bank, and tick off the short to-do list.
2. **When your schedule changes:** tap the boat banner at the top and enter your new boat date.

Everything else (bills, spending money, which debt to pay, savings, your debt-free date) is worked out for you.

## Open it

**https://by58wsy98y-droid.github.io/track/**

On iPad or iPhone, open that link in **Safari**, tap **Share** (the square with an arrow ↑), then
**Add to Home Screen**. From then on, always open Harbor from its Home Screen icon.

## Keep your data safe

- Your money info lives **only on your device**. Nothing is sent anywhere, and there's no account.
- **Always open Harbor from the Home Screen icon.** Safari and the Home Screen app keep separate data.
- **Deleting the Harbor icon deletes its data.** So does clearing Safari's history and website data.
- Your iPad and iPhone **don't sync**. Pick one, or move your data with a backup file.
- **Back up** once a month: Settings → Your data → Back up now → Save to Files (iCloud Drive).
  Harbor reminds you. To bring data back (or onto another device): Settings → Your data → Restore.

## Works offline

After the first open, Harbor works with no internet at all, which suits spotty boat Wi-Fi.

---

## For whoever maintains this

Plain HTML/CSS/JavaScript: no build step, no libraries, no server.

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The screens |
| `engine.js` | All the money and rotation logic (no screen code) |
| `visuals.js` | Route map, savings jar, debt bars, confetti |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and the Home Screen icon |
| `docs/SPEC.md` | The full design spec |

- **Every release: bump `VERSION` in `sw.js`**, or installed copies keep the old app.
- Tests: `node --test tests/engine.test.js` (money math) and
  `NODE_PATH=$(npm root -g) node --test tests/e2e.test.js` (full walkthrough in Chromium via Playwright).
- Try any date: add `?today=2026-10-15` to the URL (for testing only).
- Never put real personal numbers in the code or tests.

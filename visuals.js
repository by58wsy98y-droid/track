/* Harbor Terminal — visuals.js (SPEC §11.4)
 * Pure SVG/HTML string builders for the terminal look, plus the milestone "flash".
 * No network, no frameworks. Browser: window.Visuals. Node: module.exports.
 * Colors come from the §11.2 CSS variables (with dark fallbacks) via v- classes
 * in one injected <style id="harbor-visuals">.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Visuals = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- helpers

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pct(f) { return Math.round(clamp(num(f), 0, 1) * 100); }

  function defaultMoney(n) {
    n = num(n);
    const cents = Math.abs(Math.round(n * 100)) % 100 !== 0;
    const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    return (n < 0 ? '-' : '') + '$' + s;
  }
  function moneyFn(money) { return typeof money === 'function' ? money : defaultMoney; }
  // Terminal numbers: 1,152.00 (no symbol).
  function fig(n) {
    return Math.abs(num(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function whole(n) { return Math.round(Math.abs(num(n))).toLocaleString('en-US'); }

  function dayNum(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
  }
  function monthTag(iso) {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? MONTHS[+m[2] - 1] : '';
  }
  function monthYear(iso) {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }

  function reducedMotion() {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- chart

  // Debt (red) and savings (green) over time; the projection is dotted.
  // opts: { compact, width, height }
  function chart(series, opts) {
    opts = opts || {};
    const compact = !!opts.compact;
    const W = Math.max(200, num(opts.width, 340));
    const H = num(opts.height, compact ? 56 : 200);
    const past = (series && Array.isArray(series.past) ? series.past : []).filter(function (p) { return isFinite(dayNum(p.date)); });
    const future = (series && Array.isArray(series.future) ? series.future : []).filter(function (p) { return isFinite(dayNum(p.date)); });
    const all = past.concat(future);
    const padL = compact ? 2 : 6, padR = compact ? 2 : 6, padT = compact ? 4 : 18, padB = compact ? 4 : 22;
    const cls = 'v-svg v-chart' + (compact ? ' is-compact' : '');
    const label = chartLabel(series);
    let out = '<svg class="' + cls + '" viewBox="0 0 ' + W + ' ' + H + '" width="100%"' +
      (compact ? ' preserveAspectRatio="none" height="' + H + '"' : '') + ' role="img" aria-label="' + esc(label) + '">';
    if (!all.length) {
      out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '" class="v-axis"/>';
      if (!compact) out += '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" class="v-ch-empty">NO HISTORY YET</text>';
      return out + '</svg>';
    }
    const x0 = dayNum(all[0].date), x1 = Math.max(x0 + 1, dayNum(all[all.length - 1].date));
    let maxY = 0;
    all.forEach(function (p) { maxY = Math.max(maxY, num(p.debt), num(p.savings)); });
    maxY = maxY > 0 ? maxY * 1.08 : 1;
    const X = function (iso) { return r1(padL + (dayNum(iso) - x0) / (x1 - x0) * (W - padL - padR)); };
    const Y = function (v) { return r1(padT + (1 - Math.max(0, num(v)) / maxY) * (H - padT - padB)); };
    const hasDebt = all.some(function (p) { return num(p.debt) > 0.005; });

    if (!compact) {
      // Faint grid: three levels with values on the left.
      for (let i = 1; i <= 3; i++) {
        const v = maxY / 1.08 * i / 3;
        const y = Y(v);
        out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" class="v-grid"/>';
        out += '<text x="' + (padL + 2) + '" y="' + (y - 4) + '" class="v-ch-tick">' + esc(shortK(v)) + '</text>';
      }
      out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '" class="v-axis"/>';
      // Month ticks along the bottom, thinned to fit.
      const months = monthStarts(all[0].date, all[all.length - 1].date);
      const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(W / 64))));
      months.forEach(function (iso, i) {
        if (i % every) return;
        const x = X(iso);
        if (x < padL + 12 || x > W - padR - 12) return;
        out += '<line x1="' + x + '" x2="' + x + '" y1="' + (H - padB) + '" y2="' + (H - padB + 4) + '" class="v-axis"/>';
        out += '<text x="' + x + '" y="' + (H - 6) + '" text-anchor="middle" class="v-ch-tick">' + monthTag(iso) + '</text>';
      });
    }

    const line = function (pts, key, dotted) {
      if (!pts.length) return '';
      if (pts.length === 1) {
        return '<circle cx="' + X(pts[0].date) + '" cy="' + Y(pts[0][key]) + '" r="' + (compact ? 2 : 3) + '" class="v-dot v-' + key + '"/>';
      }
      const d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.date) + ' ' + Y(p[key]); }).join(' ');
      return '<path d="' + d + '" class="v-line v-' + key + (dotted ? ' is-proj' : '') + '" vector-effect="non-scaling-stroke"/>';
    };
    // The projection starts where the past ends, so the two lines join up.
    const join = past.length ? [past[past.length - 1]].concat(future) : future;

    // "Today" marker.
    if (past.length && future.length) {
      const tx = X(past[past.length - 1].date);
      out += '<line x1="' + tx + '" x2="' + tx + '" y1="' + padT + '" y2="' + (H - padB) + '" class="v-today" vector-effect="non-scaling-stroke"/>';
      if (!compact) out += '<text x="' + (tx + 4) + '" y="' + (padT - 6) + '" class="v-ch-tick v-ch-today">TODAY</text>';
    }
    if (hasDebt) out += line(past, 'debt', false) + (future.length ? line(join, 'debt', true) : '');
    out += line(past, 'savings', false) + (future.length ? line(join, 'savings', true) : '');

    // Debt-free target on the axis.
    if (!compact && hasDebt && series.debtFree && future.length) {
      const dx = X(series.debtFree);
      if (dx >= padL && dx <= W - padR) {
        const y = H - padB;
        out += '<path d="M' + dx + ' ' + (y - 5) + ' L' + (dx + 5) + ' ' + y + ' L' + dx + ' ' + (y + 5) + ' L' + (dx - 5) + ' ' + y + ' Z" class="v-target"/>';
        const anchor = dx > W - 90 ? 'end' : dx < 90 ? 'start' : 'middle';
        out += '<text x="' + dx + '" y="' + (y - 10) + '" text-anchor="' + anchor + '" class="v-ch-tick v-ch-target">DEBT-FREE ' + esc(monthYear(series.debtFree)) + '</text>';
      }
    }
    return out + '</svg>';
  }

  function chartLabel(series) {
    const past = series && series.past || [];
    const last = past[past.length - 1];
    if (!last) return 'Chart of your debt and savings. No history yet.';
    let t = 'Chart of your debt and savings. Now: debt ' + defaultMoney(Math.round(num(last.debt))) +
      ', savings ' + defaultMoney(Math.round(num(last.savings))) + '.';
    if (series.debtFree) t += ' Debt-free target ' + monthYear(series.debtFree) + '.';
    return t;
  }
  function shortK(v) {
    v = Math.abs(num(v));
    if (v >= 1e6) return (Math.round(v / 1e5) / 10) + 'M';
    if (v >= 1000) return (Math.round(v / 100) / 10) + 'K';
    return String(Math.round(v));
  }
  function monthStarts(fromIso, toIso) {
    const out = [];
    const a = /^(\d{4})-(\d{2})/.exec(fromIso), b = /^(\d{4})-(\d{2})/.exec(toIso);
    if (!a || !b) return out;
    let y = +a[1], m = +a[2] + 1;
    if (m > 12) { m = 1; y++; }
    const endKey = (+b[1]) * 12 + (+b[2]);
    for (let guard = 0; y * 12 + m <= endKey && guard < 400; guard++) {
      out.push(y + '-' + (m < 10 ? '0' : '') + m + '-01');
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  // ---------------------------------------------------------------- stageBar

  // info = { stage, cushionFrac, debtFrac, safetyFrac }
  function stageBar(info) {
    info = info || {};
    const stage = clamp(Math.round(num(info.stage, 1)), 1, 4);
    const fr = [num(info.cushionFrac), num(info.debtFrac), num(info.safetyFrac)].map(function (f) { return clamp(f, 0, 1); });
    const names = ['CUSHION', 'DEBT', 'SAFETY NET'];
    // Which segment is "now": stage 1 → cushion, 2 → debt, 3 → safety net, 4 → all done.
    const nowIdx = stage === 4 ? 3 : stage - 1;
    const segs = names.map(function (name, i) {
      const done = i < nowIdx || (i === 1 && stage === 1 && fr[1] >= 1);
      const now = i === nowIdx;
      const w = done ? 100 : now ? Math.max(2, pct(fr[i])) : 0;
      const cap = done ? name + ' ✓' : now ? name + ' ' + pct(fr[i]) + '%' : name;
      return { cls: done ? 'is-done' : now ? 'is-now' : '', w: w, cap: cap };
    });
    const aria = stage === 4 ? 'All three stages done.' :
      'Stage ' + stage + ' of 3: ' + ['starter cushion', 'crush the debt', 'full safety net'][stage - 1] + ', ' + pct(fr[nowIdx]) + '% there.';
    return '<div class="v-stage" role="img" aria-label="' + esc(aria) + '">' +
      '<div class="v-stage-bars">' + segs.map(function (s) {
        return '<span class="v-seg ' + s.cls + '"><i style="width:' + s.w + '%"></i></span>';
      }).join('') + '</div>' +
      '<div class="v-stage-caps">' + segs.map(function (s) {
        return '<span class="' + s.cls + '">' + esc(s.cap) + '</span>';
      }).join('') + '</div></div>';
  }

  // ---------------------------------------------------------------- meter

  // jar = { amount, target, fraction, label }; opts.cushion draws a tick where the starter cushion sits.
  function meter(jar, money, opts) {
    jar = jar || {};
    opts = opts || {};
    const m = moneyFn(money);
    const target = Math.max(0, num(jar.target));
    const amount = Math.max(0, num(jar.amount));
    const f = target > 0 ? clamp(amount / target, 0, 1) : 1;
    const tick = num(opts.cushion) > 0 && target > num(opts.cushion) ? clamp(num(opts.cushion) / target, 0, 1) : null;
    return '<div class="v-meter" role="img" aria-label="' + esc((jar.label || 'Savings') + ': ' + m(amount) + ' of ' + m(target) + ', ' + pct(f) + '%') + '">' +
      '<div class="v-meter-top"><span class="v-meter-amt">' + esc(m(amount)) + '</span>' +
      '<span class="v-meter-of">/ ' + esc(m(target)) + ' · ' + pct(f) + '%</span></div>' +
      '<div class="v-meter-track"><i style="width:' + Math.max(f > 0 ? 1.5 : 0, pct(f)) + '%"></i>' +
      (tick != null ? '<b class="v-meter-tick" style="left:' + r1(tick * 100) + '%"></b>' : '') + '</div>' +
      '<div class="v-meter-cap"><span>' + esc(String(jar.label || 'Savings').toUpperCase()) + '</span>' +
      (tick != null ? '<span>▏CUSHION ' + esc(m(num(opts.cushion))) + '</span>' : '') + '</div></div>';
  }

  // ---------------------------------------------------------------- debtTable

  function debtTable(debts, money) {
    const m = moneyFn(money);
    const list = Array.isArray(debts) ? debts.filter(Boolean) : [];
    if (!list.length) return '';
    let out = '<div class="v-dt" role="table" aria-label="Your debts">' +
      '<div class="v-dt-row v-dt-head" role="row"><span role="columnheader">NAME</span><span role="columnheader">BALANCE</span><span role="columnheader">PAID</span></div>';
    list.forEach(function (d) {
      const start = Math.max(0, num(d.start));
      const bal = Math.max(0, num(d.balance));
      const paid = d.open === false || bal <= 0.005;
      const base = Math.max(start, bal);
      const f = paid ? 1 : base > 0 ? clamp(1 - bal / base, 0, 1) : 0;
      const tag = paid ? '<span class="v-tag is-good">PAID ✓</span>' : d.isTarget ? '<span class="v-tag is-next">NEXT</span>' : '';
      out += '<div class="v-dt-row' + (paid ? ' is-paid' : '') + '" role="row">' +
        '<span role="cell" class="v-dt-name"><span class="v-dt-n">' + esc(d.name || 'Debt') + '</span>' + tag + '</span>' +
        '<span role="cell" class="v-dt-bal">' + esc(paid ? m(0) : m(bal)) + '</span>' +
        '<span role="cell" class="v-dt-paid"><span class="v-mini"><i style="width:' + pct(f) + '%"></i></span><span class="v-dt-pct">' + pct(f) + '%</span></span>' +
        '</div>';
    });
    return out + '</div>';
  }

  // ---------------------------------------------------------------- splitBar

  function splitBar(plan, money) {
    const m = moneyFn(money);
    if (!plan) return '';
    const items = Array.isArray(plan.items) ? plan.items : null;
    let bills = 0, spend = 0, goals = 0;
    if (items && items.length) {
      items.forEach(function (it) {
        const a = Math.max(0, num(it.amount));
        if (it.kind === 'bills') bills += a;
        else if (it.kind === 'spend') spend += a;
        else if (it.kind === 'debt' || it.kind === 'save') goals += a;
      });
    } else {
      bills = Math.max(0, num(plan.billsKeep));
      spend = Math.max(0, num(plan.spend && plan.spend.amount));
      goals = Math.max(0, num(plan.goals && plan.goals.total));
    }
    const short = plan.status === 'short' ? Math.max(0, num(plan.shortBy)) : 0;
    const segs = [
      { k: 'bills', label: 'BILLS', v: bills },
      { k: 'spend', label: 'SPENDING', v: spend },
      { k: 'goals', label: 'GOALS', v: goals },
      { k: 'short', label: 'SHORT', v: short },
    ].filter(function (s) { return s.v > 0.004; });
    if (!segs.length) return '';
    const total = segs.reduce(function (a, s) { return a + s.v; }, 0);
    let widths = segs.map(function (s) { return Math.max(7, s.v / total * 100); });
    const k = 100 / widths.reduce(function (a, w) { return a + w; }, 0);
    widths = widths.map(function (w) { return r1(w * k); });
    const aria = segs.map(function (s) { return s.label.toLowerCase() + ' ' + m(s.v); }).join(', ');
    return '<div class="v-split" role="img" aria-label="' + esc('Your paycheck: ' + aria) + '">' +
      '<div class="v-split-bar">' + segs.map(function (s, i) {
        const txt = widths[i] >= 13 ? whole(s.v) : '';
        return '<span class="v-sp v-sp-' + s.k + '" style="width:' + widths[i] + '%">' + esc(txt) + '</span>';
      }).join('') + '</div>' +
      '<div class="v-split-leg">' + segs.map(function (s) {
        return '<span><i class="v-sp-' + s.k + '"></i>' + s.label + ' <b>' + esc(m(s.v)) + '</b></span>';
      }).join('') + '</div></div>';
  }

  // ---------------------------------------------------------------- ticker

  // items = [{ key, label, value, change, good }]
  function ticker(items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return '';
    const one = list.map(function (t) {
      const c = num(t.change);
      const flat = Math.abs(c) < 0.005;
      const arrow = flat ? '' : c < 0 ? '▼' : '▲';
      const cls = flat ? 'is-flat' : t.good ? 'is-good' : 'is-bad';
      return '<span class="v-tk"><b>' + esc(t.label) + '</b> <span class="v-tk-v">' + fig(t.value) + '</span> ' +
        '<span class="v-tk-c ' + cls + '">' + (flat ? '0.00' : arrow + fig(c)) + '</span></span>';
    }).join('');
    const aria = list.map(function (t) {
      const c = num(t.change);
      return t.label + ' ' + fig(t.value) + (Math.abs(c) < 0.005 ? ', no change' : ', ' + (c < 0 ? 'down ' : 'up ') + fig(c));
    }).join('; ');
    const secs = Math.max(14, list.length * 7);
    return '<div class="v-ticker" role="marquee" aria-label="' + esc(aria) + '">' +
      '<div class="v-ticker-track" style="animation-duration:' + secs + 's" aria-hidden="true">' +
      '<span class="v-tk-set">' + one + '</span><span class="v-tk-set">' + one + '</span></div></div>';
  }

  // ---------------------------------------------------------------- flash (milestones)

  // A ~1s burst of small amber and green squares and a brief green edge glow.
  // Resolves true when shown, false when skipped (reduced motion / no DOM).
  function flash(opts) {
    opts = opts || {};
    if (typeof document === 'undefined' || typeof window === 'undefined' || !document.body) return Promise.resolve(false);
    if (reducedMotion()) return Promise.resolve(false);
    return new Promise(function (resolve) {
      const glow = document.createElement('div');
      glow.className = 'v-glow';
      glow.setAttribute('aria-hidden', 'true');
      document.body.appendChild(glow);
      const canvas = document.createElement('canvas');
      canvas.className = 'v-sparks';
      canvas.setAttribute('aria-hidden', 'true');
      const w = window.innerWidth, h = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      document.body.appendChild(canvas);
      const ctx = canvas.getContext && canvas.getContext('2d');
      const done = function () {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (glow.parentNode) glow.parentNode.removeChild(glow);
        resolve(true);
      };
      if (!ctx) { setTimeout(done, 900); return; }
      ctx.scale(dpr, dpr);
      const colors = ['#FFA028', '#2BD47D', '#FFC266', '#7CF0B0'];
      const ox = num(opts.x, w * 0.5), oy = num(opts.y, h * 0.28);
      const parts = [];
      const n = Math.round(clamp(w / 6, 50, 110));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 3 + Math.random() * 7;
        parts.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, s: 2 + Math.random() * 4, c: colors[i % colors.length], life: 1 });
      }
      const t0 = Date.now();
      (function frame() {
        const t = (Date.now() - t0) / 1000;
        ctx.clearRect(0, 0, w, h);
        parts.forEach(function (p) {
          p.vy += 0.22; p.vx *= 0.985; p.x += p.vx; p.y += p.vy;
          p.life = Math.max(0, 1 - t / 1.1);
          ctx.globalAlpha = p.life;
          ctx.fillStyle = p.c;
          ctx.fillRect(p.x, p.y, p.s, p.s);
        });
        if (t < 1.1) requestAnimationFrame(frame); else done();
      })();
    });
  }

  // ---------------------------------------------------------------- styles

  const MONO = 'var(--mono, "SF Mono", ui-monospace, Menlo, Consolas, monospace)';
  const CSS = [
    '.v-svg{display:block;max-width:100%;height:auto;overflow:visible}',
    '.v-chart.is-compact{height:56px}',
    '.v-grid{stroke:var(--line,#1E2228);stroke-width:1}',
    '.v-axis{stroke:var(--gray,#4A505A);stroke-width:1}',
    '.v-ch-tick{font:600 9.5px ' + MONO + ';fill:var(--muted,#868C96);letter-spacing:.6px;paint-order:stroke;stroke:var(--panel,#0C0D0F);stroke-width:4px;stroke-linejoin:round}',
    '.v-ch-today{fill:var(--muted,#868C96)}',
    '.v-ch-target{fill:var(--amber,#FFA028)}',
    '.v-ch-empty{font:600 11px ' + MONO + ';fill:var(--muted,#868C96);letter-spacing:1.2px}',
    '.v-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}',
    '.v-line.v-debt{stroke:var(--red,#FF5B53)}',
    '.v-line.v-savings{stroke:var(--green,#2BD47D)}',
    '.v-line.is-proj{stroke-dasharray:2 5;opacity:.75}',
    '.v-dot.v-debt{fill:var(--red,#FF5B53)}.v-dot.v-savings{fill:var(--green,#2BD47D)}',
    '.v-today{stroke:var(--gray,#4A505A);stroke-width:1;stroke-dasharray:3 3}',
    '.v-target{fill:var(--amber,#FFA028)}',

    '.v-stage{font-family:' + MONO + '}',
    '.v-stage-bars{display:flex;gap:4px}',
    '.v-seg{flex:1;height:6px;border-radius:2px;background:var(--panel-3,#1B1E23);overflow:hidden}',
    '.v-seg i{display:block;height:100%;background:var(--amber,#FFA028)}',
    '.v-seg.is-done i{background:var(--green,#2BD47D)}',
    '.v-stage-caps{display:flex;gap:4px;margin-top:6px;font-size:10px;font-weight:700;letter-spacing:.8px;color:var(--muted,#868C96)}',
    '.v-stage-caps span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.v-stage-caps span:nth-child(2){text-align:center}.v-stage-caps span:nth-child(3){text-align:right}',
    '.v-stage-caps .is-done{color:var(--green,#2BD47D)}.v-stage-caps .is-now{color:var(--amber,#FFA028)}',

    '.v-meter{font-family:' + MONO + '}',
    '.v-meter-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
    '.v-meter-amt{font-size:26px;font-weight:700;color:var(--green,#2BD47D);font-variant-numeric:tabular-nums}',
    '.v-meter-of{font-size:13px;font-weight:600;color:var(--muted,#868C96)}',
    '.v-meter-track{position:relative;height:8px;border-radius:2px;background:var(--panel-3,#1B1E23);margin-top:10px;overflow:visible}',
    '.v-meter-track i{display:block;height:100%;border-radius:2px;background:var(--green,#2BD47D)}',
    '.v-meter-tick{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;background:var(--amber,#FFA028)}',
    '.v-meter-cap{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:10.5px;font-weight:700;letter-spacing:1px;color:var(--muted,#868C96)}',

    '.v-dt{font-family:' + MONO + ';font-variant-numeric:tabular-nums}',
    '.v-dt-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:center;padding:11px 0;border-top:1px solid var(--line,#1E2228);font-size:14px;font-weight:600}',
    '.v-dt-row:first-child{border-top:0}',
    '.v-dt-head{font-size:10px;letter-spacing:1.2px;color:var(--muted,#868C96);padding:0 0 6px}',
    '.v-dt-head span:nth-child(2){text-align:right}',
    '.v-dt-name{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.v-dt-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:uppercase;letter-spacing:.4px}',
    '.v-dt-bal{text-align:right}',
    '.v-dt-row.is-paid .v-dt-n,.v-dt-row.is-paid .v-dt-bal{color:var(--muted,#868C96)}',
    '.v-dt-paid{display:flex;align-items:center;gap:8px}',
    '.v-mini{flex:1;height:6px;border-radius:2px;background:var(--panel-3,#1B1E23);overflow:hidden}',
    '.v-mini i{display:block;height:100%;background:var(--green,#2BD47D)}',
    '.v-dt-pct{font-size:11.5px;color:var(--muted,#868C96);min-width:34px;text-align:right}',
    '.v-tag{align-self:flex-start;font:800 9.5px ' + MONO + ';letter-spacing:1px;padding:2px 6px;border-radius:3px}',
    '.v-tag.is-next{color:var(--amber,#FFA028);background:var(--amber-bg,#2A1C08)}',
    '.v-tag.is-good{color:var(--green,#2BD47D);background:var(--green-bg,#0B2A1A)}',

    '.v-split{font-family:' + MONO + '}',
    '.v-split-bar{display:flex;gap:2px;height:24px;border-radius:3px;overflow:hidden}',
    '.v-sp{display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:#0B0B0B;white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}',
    '.v-sp-bills{background:var(--bills,#6B7380)}.v-sp-spend{background:var(--amber,#FFA028)}',
    '.v-sp-goals{background:var(--green,#2BD47D)}.v-sp-short{background:repeating-linear-gradient(45deg,#3A2A12 0 5px,#2A1C08 5px 10px);color:var(--amber,#FFA028)}',
    '.v-split-leg{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:9px;font-size:11px;font-weight:600;letter-spacing:.6px;color:var(--muted,#868C96)}',
    '.v-split-leg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:0}',
    '.v-split-leg b{color:var(--text,#E9E7E3);font-weight:700;margin-left:2px}',

    '.v-ticker{overflow:hidden;white-space:nowrap;border-top:1px solid var(--line,#1E2228);border-bottom:1px solid var(--line,#1E2228);padding:8px 0;font:600 12.5px ' + MONO + ';letter-spacing:.3px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent);mask-image:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent)}',
    '.v-ticker-track{display:inline-flex;animation:v-tick linear infinite}',
    '.v-tk-set{display:inline-flex}',
    '.v-tk{margin-right:22px;color:var(--muted,#868C96)}',
    '.v-tk b{color:var(--text,#E9E7E3);font-weight:700}',
    '.v-tk-v{color:var(--text,#E9E7E3)}',
    '.v-tk-c.is-good{color:var(--green,#2BD47D)}.v-tk-c.is-bad{color:var(--red,#FF5B53)}.v-tk-c.is-flat{color:var(--muted,#868C96)}',
    '@keyframes v-tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}',

    '.v-sparks{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999}',
    '.v-glow{position:fixed;inset:0;pointer-events:none;z-index:9998;box-shadow:inset 0 0 0 2px rgba(43,212,125,.9),inset 0 0 60px rgba(43,212,125,.35);animation:v-glow 1.1s ease-out forwards}',
    '@keyframes v-glow{0%{opacity:0}15%{opacity:1}100%{opacity:0}}',

    '@media (prefers-reduced-motion: reduce){.v-ticker{overflow-x:auto;-webkit-mask-image:none;mask-image:none}.v-ticker-track{animation:none}.v-tk-set+.v-tk-set{display:none}}',
  ].join('\n');

  function injectStyles() {
    if (typeof document === 'undefined' || !document.createElement) return false;
    if (document.getElementById('harbor-visuals')) return true;
    const el = document.createElement('style');
    el.id = 'harbor-visuals';
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
    return true;
  }
  injectStyles();

  return {
    chart: chart,
    stageBar: stageBar,
    meter: meter,
    debtTable: debtTable,
    splitBar: splitBar,
    ticker: ticker,
    flash: flash,
    injectStyles: injectStyles,
    css: CSS,
    _esc: esc,
  };
});

/* Harbor — visuals.js
 * Pure SVG/HTML string builders for progress visuals, plus a canvas confetti burst.
 * No network, no frameworks. Browser: window.Visuals. Node: module.exports.
 * All themed colors come from the §7 CSS variables (with light fallbacks) via v- classes
 * in one injected <style id="harbor-visuals">. Illustration details (sand, palms, sails)
 * use fixed colors that read well on both light and dark seas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Visuals = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- helpers

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(v, d) {
    const n = Number(v);
    return isFinite(n) ? n : (d || 0);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function r1(v) { return Math.round(v * 10) / 10; }

  function defaultMoney(n) {
    n = num(n);
    const cents = Math.abs(Math.round(n * 100)) % 100 !== 0;
    const s = Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
    return (n < 0 ? '-' : '') + '$' + s;
  }

  function moneyFn(money) {
    return typeof money === 'function' ? money : defaultMoney;
  }

  function fmtShort(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    return MONTHS[+m[2] - 1] + ' ' + (+m[3]);
  }

  let seq = 0;
  function uid(p) { seq += 1; return 'v' + p + seq; }

  // Rough text width estimate (no DOM), in the same units as px.
  function textW(s, px, bold) {
    let w = 0;
    for (const ch of String(s)) {
      let k;
      if (ch === ' ') k = 0.28;
      else if ('iljI.,:;!|\'`'.indexOf(ch) >= 0) k = 0.3;
      else if ('ftr()[]-'.indexOf(ch) >= 0) k = 0.4;
      else if ('mwMW@%'.indexOf(ch) >= 0) k = 0.98;
      else if (/[A-Z]/.test(ch)) k = 0.68;
      else if (/[0-9$]/.test(ch)) k = 0.6;
      else if (/[a-z]/.test(ch)) k = 0.56;
      else if (ch.charCodeAt(0) > 0x2000) k = 1.1; // emoji / symbols
      else k = 0.6;
      w += k;
    }
    return w * px * (bold ? 1.18 : 1.08); // generous: wide fallback fonts must still fit
  }

  function truncate(s, maxW, px, bold) {
    s = String(s == null ? '' : s).trim();
    if (textW(s, px, bold) <= maxW) return s;
    const chars = Array.from(s);
    while (chars.length > 1) {
      chars.pop();
      const t = chars.join('').replace(/[\s,.\-·]+$/, '') + '…';
      if (textW(t, px, bold) <= maxW) return t;
    }
    return '…';
  }

  // ------------------------------------------------------------- bezier math

  function cubAt(c, t) {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return {
      x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
      y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
    };
  }

  function lerp(p, q, t) { return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }

  function splitCub(c, t) {
    const p01 = lerp(c[0], c[1], t), p12 = lerp(c[1], c[2], t), p23 = lerp(c[2], c[3], t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    const m = lerp(p012, p123, t);
    return [[c[0], p01, p012, m], [m, p123, p23, c[3]]];
  }

  function cubLen(c) {
    const N = 48;
    const lens = [0];
    let prev = c[0], L = 0;
    for (let i = 1; i <= N; i++) {
      const p = cubAt(c, i / N);
      L += Math.hypot(p.x - prev.x, p.y - prev.y);
      lens.push(L);
      prev = p;
    }
    return { L, lens, N };
  }

  function tAtLen(info, target) {
    const { lens, N } = info;
    if (target <= 0) return 0;
    if (target >= info.L) return 1;
    for (let i = 1; i <= N; i++) {
      if (lens[i] >= target) {
        const f = (target - lens[i - 1]) / ((lens[i] - lens[i - 1]) || 1);
        return (i - 1 + f) / N;
      }
    }
    return 1;
  }

  function P(p) { return r1(p.x) + ' ' + r1(p.y); }
  function cubPath(c, move) {
    return (move ? 'M' + P(c[0]) + ' ' : '') + 'C' + P(c[1]) + ' ' + P(c[2]) + ' ' + P(c[3]);
  }

  // ------------------------------------------------------------ SVG pieces

  const CHECK_PATH = 'M-3.6 0.2 L-1 2.8 L3.8 -2.4';

  function checkBadge(x, y, r) {
    r = r || 9;
    const s = r / 9;
    return '<g transform="translate(' + r1(x) + ' ' + r1(y) + ')">' +
      '<circle r="' + (r + 2) + '" class="v-fill-card"/>' +
      '<circle r="' + r + '" class="v-fill-teal"/>' +
      '<path d="' + CHECK_PATH + '" transform="scale(' + r1(s * 1.15) + ')" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</g>';
  }

  // Sailboat facing right, hull bottom at y≈6, mast top at y≈-27.
  function boatShape() {
    return '' +
      '<ellipse cx="0" cy="7" rx="17" ry="3" fill="#0B2545" opacity=".14"/>' +
      '<path d="M-24 4 q4 -3 8 0" class="v-wake"/>' +
      '<path d="M-30 1 q4 -3 8 0" class="v-wake" opacity=".6"/>' +
      '<path d="M-15 -1 L17 -1 Q13 6.5 8 6.5 L-10 6.5 Q-13.5 4.5 -15 -1 Z" fill="#E07A5F"/>' +
      '<path d="M-15 -1 L17 -1 L16.2 0.8 L-14.5 0.8 Z" fill="#fff" opacity=".55"/>' +
      '<line x1="0" y1="-1" x2="0" y2="-28" stroke="#5B4636" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M1.6 -26 L1.6 -4 Q9 -9 15 -4 Q10 -15 1.6 -26 Z" fill="#FFFFFF" stroke="#B9CBDB" stroke-width=".8"/>' +
      '<path d="M-1.6 -22 L-1.6 -4 L-12 -4 Q-6 -12 -1.6 -22 Z" fill="#F3F7FB" stroke="#B9CBDB" stroke-width=".8"/>' +
      '<path d="M0 -28 L7 -26 L0 -24 Z" fill="#E9A23B"/>';
  }

  function boat(x, y, facingLeft, scale) {
    const s = scale || 1;
    return '<g class="v-boat" transform="translate(' + r1(x) + ' ' + r1(y) + ') scale(' + (facingLeft ? -s : s) + ' ' + s + ')">' +
      '<g class="v-bob">' + boatShape() + '</g></g>';
  }

  function iconAnchor() {
    return '<g class="v-stroke-sea" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="0" cy="-9" r="3"/>' +
      '<path d="M0 -6 L0 10"/><path d="M-6 -2 L6 -2"/>' +
      '<path d="M-10 3 Q-9 10.5 0 10.5 Q9 10.5 10 3"/>' +
      '<path d="M-12 5.5 L-10 2.5 L-7.5 5"/><path d="M12 5.5 L10 2.5 L7.5 5"/>' +
      '</g>';
  }

  function iconLifebuoy() {
    const r = 8.5, c = 2 * Math.PI * r, d = r1(c / 8);
    return '<circle r="12" fill="#E07A5F" opacity=".15"/>' +
      '<circle r="' + r + '" fill="none" stroke="#FFFFFF" stroke-width="6.5"/>' +
      '<circle r="' + r + '" fill="none" stroke="#E07A5F" stroke-width="6.5" stroke-dasharray="' + d + ' ' + d + '" transform="rotate(-11)"/>' +
      '<circle r="11.9" fill="none" stroke="#C4604A" stroke-width=".8" opacity=".6"/>' +
      '<circle r="5.1" fill="none" stroke="#C4604A" stroke-width=".8" opacity=".6"/>';
  }

  function iconIsland() {
    return '<path d="M-13 8 Q-11 2 -3 1.5 Q8 1 13 8 Z" fill="#EFCF8F"/>' +
      '<path d="M-14 8.5 q3.5 -2.4 7 0 t7 0 t7 0 t7 0" fill="none" class="v-stroke-sea" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>' +
      '<path d="M1.5 3 Q2.5 -4 -0.5 -10" fill="none" stroke="#8B5E34" stroke-width="2.2" stroke-linecap="round"/>' +
      '<g fill="none" stroke="#2E9E6A" stroke-width="2.4" stroke-linecap="round">' +
      '<path d="M-0.5 -10 Q-6 -13 -10 -8"/><path d="M-0.5 -10 Q5 -14 9.5 -9"/>' +
      '<path d="M-0.5 -10 Q-3 -15.5 -7.5 -15"/><path d="M-0.5 -10 Q3.5 -16 7.5 -15"/>' +
      '</g>' +
      '<circle cx="0.6" cy="-8.4" r="1.3" fill="#8B5E34"/>';
  }

  function iconFlagIsland() {
    let checks = '';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        if ((r + c) % 2 === 0) checks += '<rect x="' + r1(1 + c * 2.6) + '" y="' + r1(-15 + r * 2.6) + '" width="2.6" height="2.6" fill="#0B2545"/>';
      }
    }
    return '<path d="M-14 9 Q-11 2.5 -2 2 Q9 1.5 14 9 Z" fill="#EFCF8F"/>' +
      '<path d="M-15 9.5 q3.75 -2.4 7.5 0 t7.5 0 t7.5 0 t7.5 0" fill="none" class="v-stroke-sea" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>' +
      '<line x1="0" y1="4" x2="0" y2="-16" stroke="#5B4636" stroke-width="1.8" stroke-linecap="round"/>' +
      '<rect x="1" y="-15" width="10.4" height="7.8" fill="#FFFFFF" stroke="#0B2545" stroke-width=".6"/>' + checks;
  }

  function iconLighthouse() {
    return '<path d="M-3 -12 L-17 -17 L-17 -9 Z" fill="#F2B94F" opacity=".55"/>' +
      '<path d="M3 -12 L17 -17 L17 -9 Z" fill="#F2B94F" opacity=".55"/>' +
      '<path d="M-5.5 11 L-3.8 -7 L3.8 -7 L5.5 11 Z" fill="#FFFFFF" stroke="#C9D6E2" stroke-width=".6"/>' +
      '<path d="M-5 5 L5 5 L5.3 8 L-5.3 8 Z" fill="#E07A5F"/>' +
      '<path d="M-4.4 -1 L4.4 -1 L4.7 2 L-4.7 2 Z" fill="#E07A5F"/>' +
      '<rect x="-4.6" y="-8.5" width="9.2" height="2" rx=".6" fill="#0B2545"/>' +
      '<rect x="-3" y="-14" width="6" height="5.5" rx="1" fill="#F2B94F"/>' +
      '<path d="M-4 -14 L0 -18 L4 -14 Z" fill="#E07A5F"/>' +
      '<path d="M-11 12 Q-6 8 0 9 Q7 8 11 12 Z" fill="#8FA3B5"/>';
  }

  function stopIcon(kind) {
    switch (kind) {
      case 'start': return iconAnchor();
      case 'cushion': return iconLifebuoy();
      case 'debtfree': return iconFlagIsland();
      case 'harbor': return iconLighthouse();
      default: return iconIsland();
    }
  }

  function compass(x, y) {
    return '<g class="v-compass" transform="translate(' + x + ' ' + y + ')">' +
      '<circle r="15" class="v-compass-ring"/>' +
      '<path d="M0 -12 L3 0 L0 12 L-3 0 Z" class="v-compass-ns"/>' +
      '<path d="M-12 0 L0 -3 L12 0 L0 3 Z" class="v-compass-ew"/>' +
      '<path d="M0 -12 L3 0 L-3 0 Z" fill="#E07A5F"/>' +
      '<circle r="1.6" class="v-fill-card"/>' +
      '</g>';
  }

  function gull(x, y, s) {
    return '<path d="M' + r1(x - 6 * s) + ' ' + r1(y) + ' q' + r1(3 * s) + ' ' + r1(-4 * s) + ' ' + r1(6 * s) + ' 0 q' +
      r1(3 * s) + ' ' + r1(-4 * s) + ' ' + r1(6 * s) + ' 0" class="v-gull"/>';
  }

  function stopCurrentIndex(stops) {
    for (let i = 0; i < stops.length; i++) if (!stops[i] || !stops[i].done) return i;
    return -1;
  }

  function voyageAria(stops, cur) {
    const done = stops.filter(function (s) { return s && s.done; }).length;
    let t = 'Your voyage: ' + done + ' of ' + stops.length + ' stops reached.';
    if (cur >= 0 && stops[cur]) t += ' Next stop: ' + (stops[cur].label || '') + (stops[cur].sub && stops[cur].kind === 'debtfree' ? ' (' + stops[cur].sub + ')' : '') + '.';
    else t += ' You made it to Safe Harbor!';
    return t;
  }

  // ---------------------------------------------------------------- routeMap

  function routeMap(voyage, opts) {
    opts = opts || {};
    const stops = voyage && Array.isArray(voyage.stops) ? voyage.stops.filter(Boolean) : [];
    const n = stops.length;
    if (!n) return '';
    const W = Math.max(280, Math.round(num(opts.width, 340)) || 340);
    const id = uid('rm');
    const S = n > 7 ? 122 : 132;             // vertical gap between stops
    const TOP = 74, BOTTOM = 108;
    const H = TOP + (n - 1) * S + BOTTOM;
    const xL = Math.round(Math.max(58, W * 0.2)), xR = W - xL;
    const pts = stops.map(function (s, i) { return { x: n === 1 ? W / 2 : (i % 2 === 0 ? xL : xR), y: TOP + i * S }; });
    const radius = function (st) { return st && (st.kind === 'debtfree' || st.kind === 'harbor') ? 25 : 22; };
    const segs = [];
    for (let i = 0; i < n - 1; i++) {
      // Vertical tangents at the stops: the route drops away below a stop before it
      // crosses the chart, which keeps the side labels clear of the route and the boat.
      const a = pts[i], b = pts[i + 1], k = S * 0.9;
      segs.push([a, { x: a.x, y: a.y + k }, { x: b.x, y: b.y - k }, b]);
    }
    const cur = stopCurrentIndex(stops);

    // Boat placement. The boat (about 31 tall above its hull, 7 below) only sails the part of
    // a segment where it can't cover a stop disc or a label: below the stop it left, above the next.
    const pos = clamp(num(voyage.position, 0), 0, n - 1);
    let bx, by, facingLeft = false, doneD = '', aheadD = '';
    const BOAT_UP = 31, BOAT_DOWN = 8;
    if (n === 1) {
      bx = pts[0].x; by = pts[0].y + radius(stops[0]) + BOAT_UP + 3;
    } else if (pos >= n - 1) {
      // Arrived: moored just below the final stop, route fully sailed.
      const last = pts[n - 1];
      bx = last.x; by = last.y + radius(stops[n - 1]) + BOAT_UP + 3;
      facingLeft = last.x > W / 2;
      segs.forEach(function (sg, i) { doneD += cubPath(sg, i === 0); });
    } else {
      const s = Math.floor(pos), f = pos - s;
      const seg = segs[s];
      const yMin = seg[0].y + radius(stops[s]) + BOAT_UP + 3;
      const yMax = seg[3].y - radius(stops[s + 1]) - BOAT_DOWN - 3;
      const info = cubLen(seg);
      let t0 = 0, t1 = 1;
      for (let i = 0; i <= 200; i++) { if (cubAt(seg, i / 200).y >= yMin) { t0 = i / 200; break; } }
      for (let i = 200; i >= 0; i--) { if (cubAt(seg, i / 200).y <= yMax) { t1 = i / 200; break; } }
      if (t1 <= t0) { t0 = 0.5; t1 = 0.5; }
      const L0 = info.lens[Math.round(t0 * info.N)], L1 = info.lens[Math.round(t1 * info.N)];
      const t = tAtLen(info, L0 + f * (L1 - L0));
      const bp = cubAt(seg, t);
      bx = bp.x; by = bp.y;
      facingLeft = seg[3].x < seg[0].x;
      const parts = splitCub(seg, t);
      for (let i = 0; i < s; i++) doneD += cubPath(segs[i], i === 0);
      doneD += (s === 0 ? 'M' + P(parts[0][0]) + ' ' : '') + cubPath(parts[0], false);
      aheadD = 'M' + P(parts[1][0]) + ' ' + cubPath(parts[1], false);
      for (let i = s + 1; i < n - 1; i++) aheadD += cubPath(segs[i], false);
    }

    // Background, waves, shore, compass, gulls.
    let out = '<svg class="v-svg v-route" viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMin meet" role="img" aria-label="' + esc(voyageAria(stops, cur)) + '" xmlns="http://www.w3.org/2000/svg">';
    out += '<defs>' +
      '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" class="v-stop-sea"/><stop offset="1" class="v-stop-teal"/></linearGradient>' +
      '<pattern id="' + id + 'w" width="72" height="46" patternUnits="userSpaceOnUse">' +
      '<path d="M6 14 q5 -4.5 10 0 t10 0" class="v-wave-stroke"/>' +
      '<path d="M42 36 q5 -4.5 10 0 t10 0" class="v-wave-stroke"/>' +
      '</pattern>' +
      '<clipPath id="' + id + 'c"><rect width="' + W + '" height="' + H + '" rx="20"/></clipPath>' +
      '</defs>';
    out += '<g clip-path="url(#' + id + 'c)">';
    out += '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + 'g)"/>';
    out += '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + 'w)"/>';
    // Shore at the bottom.
    const sy = H - 22;
    let shore = 'M0 ' + (sy + 4);
    for (let x = 0; x < W; x += 40) shore += ' q10 -7 20 0 t20 0';
    out += '<path d="' + shore + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" class="v-shore"/>';
    out += '<path d="' + shore.replace('M0 ' + (sy + 4), 'M0 ' + (sy + 1)) + '" class="v-surf"/>';
    out += compass(W - 34, 34);
    out += gull(W * 0.46, 26, 1) + gull(W * 0.53, 36, 0.8);
    out += '</g>';

    // Route: soft lane, then done (solid) and ahead (dotted).
    if (n > 1) {
      let full = '';
      segs.forEach(function (sg, i) { full += cubPath(sg, i === 0); });
      out += '<path d="' + full + '" class="v-lane"/>';
      if (aheadD) out += '<path d="' + aheadD + '" class="v-route-ahead"/>';
      if (doneD) out += '<path d="' + doneD + '" class="v-route-done"/>';
    }

    // Stops + labels.
    const labelPx = 16, subPx = 13.5;
    stops.forEach(function (st, i) {
      const p = pts[i];
      const big = st.kind === 'debtfree' || st.kind === 'harbor';
      const R = radius(st);
      const isCur = i === cur;
      let g = '<g class="v-stop' + (st.done ? ' is-done' : '') + (isCur ? ' is-now' : '') + '">';
      if (isCur) g += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (R + 7) + '" class="v-pulse"/>';
      g += '<circle cx="' + p.x + '" cy="' + (p.y + 2.5) + '" r="' + R + '" fill="#0B2545" opacity=".13"/>';
      g += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + R + '" class="v-stop-disc"/>';
      g += '<g transform="translate(' + p.x + ' ' + p.y + ')' + (big ? ' scale(1.08)' : '') + '">' + stopIcon(st.kind) + '</g>';
      if (st.done) g += checkBadge(p.x + R * 0.72, p.y - R * 0.72, 8.5);
      g += '</g>';

      // Label: to the right of left-side stops, to the left of right-side stops.
      const leftSide = n === 1 ? true : (i % 2 === 0);
      const gap = R + 12;
      const lx = leftSide ? p.x + gap : p.x - gap;
      const maxW = leftSide ? (W - 12 - lx) : (lx - 12);
      const anchor = leftSide ? 'start' : 'end';
      const label = truncate(st.label || '', maxW, labelPx, true);
      const sub = truncate(st.sub || '', maxW, subPx, false);
      const full = (st.label || '') + (st.sub ? ' — ' + st.sub : '');
      const ly = sub ? p.y - 2 : p.y + 5.5;
      // Halo tint follows the sea gradient (top sea-soft to bottom teal-soft).
      const mixPct = Math.round(clamp(1 - p.y / H, 0, 1) * 100);
      const halo = ' style="stroke:color-mix(in srgb,var(--sea-soft,#DCEBF6) ' + mixPct + '%,var(--teal-soft,#D8F2EE))"';
      g += '<g class="v-label' + (isCur ? ' is-now' : '') + '"><title>' + esc(full) + '</title>';
      g += '<text x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '" class="v-t-label v-halo"' + halo + '>' + esc(label) + '</text>';
      if (sub) g += '<text x="' + lx + '" y="' + (p.y + 16) + '" text-anchor="' + anchor + '" class="v-t-sub v-halo"' + halo + '>' + esc(sub) + '</text>';
      g += '</g>';
      out += g;
    });

    out += boat(bx, by, facingLeft, 1.05);
    out += '</svg>';
    return out;
  }

  // --------------------------------------------------------------- miniRoute

  function miniRoute(voyage, opts) {
    opts = opts || {};
    const stops = voyage && Array.isArray(voyage.stops) ? voyage.stops.filter(Boolean) : [];
    const n = stops.length;
    if (!n) return '';
    const W = 340, H = 82, Y = 44, M = 22;
    const xs = stops.map(function (s, i) { return n === 1 ? W / 2 : M + i * (W - 2 * M) / (n - 1); });
    const cur = stopCurrentIndex(stops);
    const pos = clamp(num(voyage.position, 0), 0, n - 1);

    // Quadratic segments with a gentle alternating swell.
    const segs = [];
    for (let i = 0; i < n - 1; i++) {
      const a = { x: xs[i], y: Y }, b = { x: xs[i + 1], y: Y };
      segs.push([a, { x: (a.x + b.x) / 2, y: Y + (i % 2 ? 6 : -6) }, b]);
    }
    function qAt(q, t) { const u = 1 - t; return { x: u * u * q[0].x + 2 * u * t * q[1].x + t * t * q[2].x, y: u * u * q[0].y + 2 * u * t * q[1].y + t * t * q[2].y }; }
    function qSplit(q, t) { const a = lerp(q[0], q[1], t), b = lerp(q[1], q[2], t), m = lerp(a, b, t); return [[q[0], a, m], [m, b, q[2]]]; }
    function qd(q, move) { return (move ? 'M' + P(q[0]) + ' ' : '') + 'Q' + P(q[1]) + ' ' + P(q[2]); }

    let bx = xs[0], by = Y, doneD = '', aheadD = '';
    if (n > 1) {
      let s = Math.floor(pos), f = pos - s;
      if (s >= n - 1) { s = n - 2; f = 1; }
      const bp = qAt(segs[s], f);
      bx = bp.x; by = bp.y;
      const parts = qSplit(segs[s], f);
      for (let i = 0; i < s; i++) doneD += qd(segs[i], i === 0);
      doneD += (s === 0 ? 'M' + P(parts[0][0]) + ' ' : '') + qd(parts[0], false);
      aheadD = 'M' + P(parts[1][0]) + ' ' + qd(parts[1], false);
      for (let i = s + 1; i < n - 1; i++) aheadD += qd(segs[i], false);
    }

    let out = '<svg class="v-svg v-mini" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(voyageAria(stops, cur)) + '" xmlns="http://www.w3.org/2000/svg">';
    if (n > 1) {
      out += '<path d="' + aheadD + '" class="v-mini-ahead"/>';
      out += '<path d="' + doneD + '" class="v-mini-done"/>';
    }
    stops.forEach(function (st, i) {
      const x = xs[i];
      const last = i === n - 1;
      if (i === cur) {
        out += '<circle cx="' + r1(x) + '" cy="' + Y + '" r="8" class="v-mini-now"/>';
      } else if (st.done) {
        out += '<circle cx="' + r1(x) + '" cy="' + Y + '" r="' + (last ? 7.5 : 6) + '" class="v-fill-teal"/>';
        if (last) out += '<path d="' + CHECK_PATH + '" transform="translate(' + r1(x) + ' ' + Y + ') scale(1.1)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      } else {
        out += '<circle cx="' + r1(x) + '" cy="' + Y + '" r="' + (last ? 7 : 5.5) + '" class="' + (last ? 'v-mini-goal' : 'v-mini-future') + '"/>';
      }
    });
    out += boat(bx, by - 3, false, 0.95);

    // Labels: first, current (bold), last — dropped rather than overlapped.
    const px = 13.5, ly = H - 6, pad = 10;
    const want = [];
    const curIdx = cur < 0 ? n - 1 : cur;
    want.push({ i: curIdx, bold: true });
    if (curIdx !== n - 1) want.push({ i: n - 1, bold: false });
    if (curIdx !== 0) want.push({ i: 0, bold: false });
    const placed = [];
    const EST = 1.02; // be generous: real fonts are often wider than the estimate
    want.forEach(function (w) {
      const st = stops[w.i];
      const text = truncate(st.label || (w.i === n - 1 ? 'Safe Harbor' : ''), w.bold ? 170 : 104, px * EST, w.bold);
      if (!text) return;
      const tw = textW(text, px, w.bold) * EST;
      let x, anchor, box;
      if (n > 1 && w.i === 0) { x = 4; anchor = 'start'; box = [x, x + tw]; }
      else if (n > 1 && w.i === n - 1) { x = W - 4; anchor = 'end'; box = [x - tw, x]; }
      else {
        x = clamp(xs[w.i], 4 + tw / 2, W - 4 - tw / 2);
        anchor = 'middle'; box = [x - tw / 2, x + tw / 2];
      }
      const hit = placed.some(function (b) { return box[0] < b[1] + pad && box[1] > b[0] - pad; });
      if (hit) return;
      placed.push(box);
      out += '<text x="' + r1(x) + '" y="' + ly + '" text-anchor="' + anchor + '" class="' + (w.bold ? 'v-mini-label is-now' : 'v-mini-label') + '">' + esc(text) + '</text>';
    });
    out += '</svg>';
    return out;
  }

  // --------------------------------------------------------------------- jar

  function jar(j, opts) {
    opts = opts || {};
    j = j || {};
    const size = opts.size === 'small' ? 'small' : 'large';
    let f = clamp(num(j.fraction, 0), 0, 1);
    const id = uid('jar');
    const TOP = 50, BOT = 142;
    const visF = f > 0 ? Math.max(f, 0.04) : 0;
    const level = BOT - visF * (BOT - TOP);
    const pct = Math.round(f * 100);
    const body = 'M36 30 L36 35 C36 42 14 43 14 58 L14 126 Q14 142 30 142 L90 142 Q106 142 106 126 L106 58 C106 43 84 42 84 35 L84 30 Z';

    function wave(y, amp, cls) {
      let d = 'M-48 ' + r1(y);
      for (let x = -48; x < 168; x += 24) d += ' q6 ' + (-amp) + ' 12 0 t12 0';
      d += ' L168 150 L-48 150 Z';
      return '<path d="' + d + '" class="' + cls + '"/>';
    }

    let out = '<svg class="v-svg v-jar v-jar-' + size + '" viewBox="0 0 120 150" width="100%" role="img" aria-label="' +
      esc((j.label || 'Savings') + ': ' + pct + '% full') + '" xmlns="http://www.w3.org/2000/svg">';
    out += '<defs><clipPath id="' + id + 'b"><path d="' + body + '"/></clipPath>' +
      '<clipPath id="' + id + 'w"><rect x="0" y="' + r1(level) + '" width="120" height="' + r1(150 - level) + '"/></clipPath>' +
      '<clipPath id="' + id + 'a"><rect x="0" y="0" width="120" height="' + r1(level) + '"/></clipPath>' +
      '</defs>';
    // Glass body.
    out += '<path d="' + body + '" class="v-jar-glass"/>';
    // Water.
    if (visF > 0) {
      out += '<g clip-path="url(#' + id + 'b)">';
      out += '<g class="v-anim v-wave-b">' + wave(level - 1.5, 3, 'v-water-back') + '</g>';
      out += '<g class="v-anim v-wave-f">' + wave(level, 3.5, 'v-water') + '</g>';
      if (visF > 0.12) {
        out += '<g class="v-bubbles">' +
          '<circle cx="36" cy="134" r="2.2" class="v-anim v-bub v-bub1"/>' +
          '<circle cx="70" cy="136" r="1.6" class="v-anim v-bub v-bub2"/>' +
          '<circle cx="88" cy="132" r="2.6" class="v-anim v-bub v-bub3"/>' +
          '</g>';
      }
      out += '</g>';
    }
    // Measure ticks.
    [0.25, 0.5, 0.75].forEach(function (t) {
      const y = r1(BOT - t * (BOT - TOP));
      out += '<line x1="94" x2="' + (t === 0.5 ? 102 : 99) + '" y1="' + y + '" y2="' + y + '" class="v-jar-tick"/>';
    });
    // Glass outline + shine.
    out += '<path d="' + body + '" class="v-jar-outline"/>';
    out += '<path d="M22 64 L22 118" class="v-jar-shine"/>';
    out += '<path d="M22 126 L22 129" class="v-jar-shine"/>';
    // Lid.
    out += '<rect x="31" y="14" width="58" height="18" rx="5" class="v-jar-lid"/>';
    out += '<rect x="31" y="14" width="58" height="5" rx="2.5" fill="#fff" opacity=".35"/>';
    for (let x = 38; x <= 82; x += 7) out += '<line x1="' + x + '" x2="' + x + '" y1="21" y2="29" class="v-jar-ridge"/>';
    if (f >= 1) {
      out += '<path d="M102 10 l2.2 5.2 5.2 2.2 -5.2 2.2 -2.2 5.2 -2.2 -5.2 -5.2 -2.2 5.2 -2.2 Z" fill="#F2B94F"/>' +
        '<path d="M14 18 l1.4 3.3 3.3 1.4 -3.3 1.4 -1.4 3.3 -1.4 -3.3 -3.3 -1.4 3.3 -1.4 Z" fill="#F2B94F"/>';
    }
    if (size === 'large') {
      const ty = 102;
      const txt = pct + '%';
      const fs = txt.length > 3 ? 23 : 27;
      out += '<text x="60" y="' + ty + '" text-anchor="middle" font-size="' + fs + '" class="v-jar-pct" clip-path="url(#' + id + 'a)">' + esc(txt) + '</text>';
      out += '<text x="60" y="' + ty + '" text-anchor="middle" font-size="' + fs + '" class="v-jar-pct is-wet" clip-path="url(#' + id + 'w)">' + esc(txt) + '</text>';
    }
    out += '</svg>';
    return out;
  }

  // ---------------------------------------------------------------- debtBars

  function debtBars(debts, money) {
    const m = moneyFn(money);
    const list = Array.isArray(debts) ? debts.filter(Boolean) : [];
    if (!list.length) return '';
    let out = '<div class="v-debts">';
    list.forEach(function (d) {
      const start = Math.max(0, num(d.start, 0));
      const bal = Math.max(0, num(d.balance, 0));
      const paid = d.open === false || bal <= 0.005;
      const base = Math.max(start, bal);
      const frac = paid ? 0 : (base > 0 ? bal / base : 1);
      const pctW = paid ? 0 : Math.max(2.5, Math.round(frac * 1000) / 10);
      const next = !paid && !!d.isTarget;
      const cls = 'v-debt' + (paid ? ' is-paid' : '') + (next ? ' is-next' : '');
      let amt;
      if (paid) {
        amt = '<span class="v-nw">All ' + esc(m(start)) + ' paid off</span>' + (d.paidOffOn && fmtShort(d.paidOffOn) ? ' <span class="v-nw">on ' + esc(fmtShort(d.paidOffOn)) + '</span>' : '');
      } else {
        amt = '<strong>' + esc(m(bal)) + '</strong> left of ' + esc(m(base));
      }
      out += '<div class="' + cls + '">' +
        '<div class="v-debt-head"><span class="v-debt-name">' + esc(d.name || 'Debt') + '</span>' +
        (next ? '<span class="v-tag">Up next</span>' : '') + '</div>' +
        (paid ? '' : '<div class="v-debt-bar" role="img" aria-label="' + esc(paid ? 'Paid off' : Math.round(frac * 100) + '% left') + '">' +
        '<div class="v-debt-fill" style="width:' + pctW + '%"></div></div>') +
        '<div class="v-debt-amt">' + amt + '</div>' +
        (paid ? '<div class="v-stamp" aria-hidden="true"><span>PAID OFF</span></div>' : '') +
        '</div>';
    });
    out += '</div>';
    return out;
  }

  // ---------------------------------------------------------------- splitBar

  function splitBar(plan, money) {
    const m = moneyFn(money);
    if (!plan) return '';
    const items = Array.isArray(plan.items) ? plan.items : null;
    let bills, spend, goals;
    if (items && items.length) {
      bills = 0; spend = 0; goals = 0;
      items.forEach(function (it) {
        const a = Math.max(0, num(it.amount, 0));
        if (it.kind === 'bills') bills += a;
        else if (it.kind === 'spend') spend += a;
        else if (it.kind === 'debt' || it.kind === 'save') goals += a;
      });
    } else {
      bills = Math.max(0, num(plan.billsKeep, 0));
      spend = Math.max(0, num(plan.spend && plan.spend.amount, 0));
      goals = Math.max(0, num(plan.goals && plan.goals.total, 0));
    }
    const short = plan.status === 'short' ? Math.max(0, num(plan.shortBy, 0)) : 0;
    const segs = [
      { k: 'bills', label: 'Bills', v: bills },
      { k: 'spend', label: 'Spending', v: spend },
      { k: 'goals', label: 'Goals', v: goals },
      { k: 'short', label: 'Short', v: short },
    ].filter(function (s) { return s.v > 0.004; });
    if (!segs.length) return '';
    const total = segs.reduce(function (a, s) { return a + s.v; }, 0);
    // Give tiny parts a visible minimum width, then renormalise.
    let widths = segs.map(function (s) { return Math.max(6, (s.v / total) * 100); });
    const wsum = widths.reduce(function (a, b) { return a + b; }, 0);
    widths = widths.map(function (w) { return Math.round((w / wsum) * 1000) / 10; });

    const aria = segs.map(function (s) { return (s.k === 'short' ? 'short by ' : s.label + ' ') + m(s.v); }).join(', ');
    let out = '<div class="v-split v-split-' + esc(plan.status || 'ok') + '" role="img" aria-label="' + esc(aria) + '">';
    out += '<div class="v-split-bar">';
    segs.forEach(function (s, i) {
      out += '<span class="v-seg v-seg-' + s.k + '" style="width:' + widths[i] + '%"></span>';
    });
    out += '</div><ul class="v-legend" aria-hidden="true">';
    segs.forEach(function (s) {
      out += '<li><i class="v-dot v-dot-' + s.k + '"></i>' + (s.k === 'short' ? 'Short by' : s.label) + ' <b>' + esc(m(s.v)) + '</b></li>';
    });
    out += '</ul></div>';
    return out;
  }

  // --------------------------------------------------------------- stagePath

  function stagePath(stage) {
    const st = clamp(Math.round(num(stage, 1)) || 1, 1, 4);
    const names = ['Starter cushion', 'Crush the debt', 'Full safety net'];
    const check = '<svg viewBox="-6 -6 12 12" width="16" height="16" aria-hidden="true"><path d="' + CHECK_PATH + '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const aria = st === 4 ? 'All 3 steps done — you made it to Safe Harbor!' : 'Your plan: step ' + st + ' of 3, ' + names[st - 1];
    let out = '<ol class="v-stages" aria-label="' + esc(aria) + '">';
    names.forEach(function (nm, i) {
      const n = i + 1;
      const done = n < st;
      const now = n === st;
      out += '<li class="v-step' + (done ? ' is-done' : '') + (now ? ' is-now' : '') + '"' + (now ? ' aria-current="step"' : '') + '>' +
        '<span class="v-step-dot">' + (done ? check : n) + '</span>' +
        '<span class="v-step-name">' + esc(nm) + '</span>' +
        (now ? '<span class="v-step-here">You’re here</span>' : '') +
        '</li>';
    });
    out += '</ol>';
    return out;
  }

  // ---------------------------------------------------------------- confetti

  function reducedMotion() {
    try {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function confetti(opts) {
    opts = opts || {};
    if (typeof document === 'undefined' || typeof window === 'undefined') return Promise.resolve(false);
    if (reducedMotion()) return Promise.resolve(false);
    const duration = clamp(num(opts.duration, 2500), 600, 6000);
    const count = clamp(Math.round(num(opts.count, 140)), 10, 400);
    const colors = Array.isArray(opts.colors) && opts.colors.length ? opts.colors :
      ['#1E6FA8', '#4BA3E3', '#1B998B', '#3CC5B3', '#E9A23B', '#F2B94F', '#E07A5F', '#FFFFFF'];
    const origin = opts.origin || { x: 0.5, y: 0.35 };

    const canvas = document.createElement('canvas');
    canvas.className = 'v-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return Promise.resolve(false);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let Wd = window.innerWidth, Hd = window.innerHeight;
    canvas.width = Math.round(Wd * dpr);
    canvas.height = Math.round(Hd * dpr);
    (document.body || document.documentElement).appendChild(canvas);
    ctx.scale(dpr, dpr);

    const ox = clamp(num(origin.x, 0.5), 0, 1) * Wd;
    const oy = clamp(num(origin.y, 0.35), 0, 1) * Hd;
    const scale = Math.max(0.8, Math.min(1.5, Math.min(Wd, Hd) / 420));
    const parts = [];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const sp = (7 + Math.random() * 9) * scale;
      parts.push({
        x: ox + (Math.random() - 0.5) * 30, y: oy + (Math.random() - 0.5) * 16,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2 * scale,
        w: (6 + Math.random() * 6) * scale, h: (9 + Math.random() * 8) * scale,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        tilt: Math.random() * Math.PI * 2, vt: 0.08 + Math.random() * 0.12,
        shape: Math.random() < 0.28 ? 'c' : 'r',
        color: colors[i % colors.length],
      });
    }

    return new Promise(function (resolve) {
      let startT = null, raf = 0, done = false;
      function finish() {
        if (done) return;
        done = true;
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        resolve(true);
      }
      function frame(ts) {
        if (done) return;
        if (startT === null) startT = ts;
        const el = ts - startT;
        const life = el / duration;
        ctx.clearRect(0, 0, Wd, Hd);
        const fade = life > 0.7 ? Math.max(0, 1 - (life - 0.7) / 0.3) : 1;
        ctx.globalAlpha = fade;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.32 * scale;
          p.x += p.vx + Math.sin(p.tilt) * 0.6; p.y += p.vy;
          p.rot += p.vr; p.tilt += p.vt;
          if (p.y > Hd + 30) continue;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.shape === 'c') {
            ctx.beginPath();
            ctx.arc(0, 0, p.w * 0.42, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const sy = Math.abs(Math.cos(p.tilt));
            ctx.fillRect(-p.w / 2, -p.h * sy / 2, p.w, Math.max(1, p.h * sy));
          }
          ctx.restore();
        }
        if (el >= duration) finish();
        else raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      setTimeout(finish, duration + 800); // safety net if frames stall (background tab)
    });
  }

  // -------------------------------------------------------------------- CSS

  const CSS = [
    '.v-svg{display:block;width:100%;height:auto;max-width:100%;font-family:inherit;-webkit-user-select:none;user-select:none}',
    '.v-svg text{font-family:inherit}',
    '.v-fill-card{fill:var(--card,#FFFFFF)}',
    '.v-fill-teal{fill:var(--teal,#1B998B)}',
    '.v-stroke-sea{stroke:var(--sea,#1E6FA8)}',
    // route map
    '.v-route{border-radius:20px}',
    '.v-stop-sea{stop-color:var(--sea-soft,#DCEBF6)}',
    '.v-stop-teal{stop-color:var(--teal-soft,#D8F2EE)}',
    '.v-wave-stroke{fill:none;stroke:var(--sea,#1E6FA8);stroke-width:1.6;stroke-linecap:round;opacity:.18}',
    '.v-shore{fill:var(--sand,#F6ECD9)}',
    '.v-surf{fill:none;stroke:var(--card,#FFFFFF);stroke-width:2;opacity:.7}',
    '.v-compass-ring{fill:var(--card,#FFFFFF);fill-opacity:.55;stroke:var(--sea,#1E6FA8);stroke-opacity:.35;stroke-width:1.2}',
    '.v-compass-ns{fill:var(--sea,#1E6FA8);opacity:.55}',
    '.v-compass-ew{fill:var(--sea,#1E6FA8);opacity:.3}',
    '.v-gull{fill:none;stroke:var(--muted,#5B6B7F);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;opacity:.6}',
    '.v-lane{fill:none;stroke:var(--card,#FFFFFF);stroke-opacity:.5;stroke-width:12;stroke-linecap:round}',
    '.v-route-done{fill:none;stroke:var(--sea,#1E6FA8);stroke-width:4.5;stroke-linecap:round}',
    '.v-route-ahead{fill:none;stroke:var(--sea,#1E6FA8);stroke-opacity:.55;stroke-width:3.5;stroke-linecap:round;stroke-dasharray:.5 9}',
    '.v-stop-disc{fill:var(--card,#FFFFFF);stroke:var(--line,#DDE6EE);stroke-width:2}',
    '.v-stop.is-done .v-stop-disc{stroke:var(--teal,#1B998B);stroke-width:2.5}',
    '.v-stop.is-now .v-stop-disc{stroke:var(--sea,#1E6FA8);stroke-width:3}',
    '.v-pulse{fill:var(--sea,#1E6FA8);opacity:.16;transform-box:fill-box;transform-origin:center;animation:v-pulse 2.4s ease-in-out infinite}',
    '.v-t-label{fill:var(--ink,#0B2545);font-weight:700;font-size:16px}',
    '.v-t-sub{fill:var(--muted,#5B6B7F);font-size:13.5px;font-weight:500}',
    '.v-label.is-now .v-t-label{fill:var(--sea,#1E6FA8)}',
    '.v-halo{paint-order:stroke fill;stroke:var(--sea-soft,#DCEBF6);stroke-width:5px;stroke-linejoin:round;stroke-opacity:.75}',
    '.v-wake{fill:none;stroke:var(--card,#FFFFFF);stroke-width:1.8;stroke-linecap:round;opacity:.9}',
    '.v-bob{animation:v-bob 3.2s ease-in-out infinite}',
    // mini route
    '.v-mini-done{fill:none;stroke:var(--sea,#1E6FA8);stroke-width:4;stroke-linecap:round}',
    '.v-mini-ahead{fill:none;stroke:var(--muted,#5B6B7F);stroke-opacity:.55;stroke-width:3;stroke-linecap:round;stroke-dasharray:.5 7}',
    '.v-mini-now{fill:var(--card,#FFFFFF);stroke:var(--sea,#1E6FA8);stroke-width:3.5}',
    '.v-mini-future{fill:var(--card,#FFFFFF);stroke:var(--muted,#5B6B7F);stroke-opacity:.6;stroke-width:2}',
    '.v-mini-goal{fill:var(--card,#FFFFFF);stroke:var(--gold,#E9A23B);stroke-width:3}',
    '.v-mini-label{fill:var(--muted,#5B6B7F);font-size:13.5px;font-weight:600}',
    '.v-mini-label.is-now{fill:var(--ink,#0B2545);font-weight:800}',
    '.v-mini .v-wake{stroke:var(--sea,#1E6FA8);opacity:.35}',
    // jar
    '.v-jar{margin:0 auto}',
    '.v-jar-small{max-width:64px}',
    '.v-jar-large{max-width:176px}',
    '.v-jar-glass{fill:var(--sea-soft,#DCEBF6);fill-opacity:.45}',
    '.v-jar-outline{fill:none;stroke:var(--sea,#1E6FA8);stroke-opacity:.55;stroke-width:3;stroke-linejoin:round}',
    '.v-jar-shine{fill:none;stroke:#FFFFFF;stroke-opacity:.75;stroke-width:4;stroke-linecap:round}',
    '.v-jar-tick{stroke:var(--sea,#1E6FA8);stroke-opacity:.45;stroke-width:2;stroke-linecap:round}',
    '.v-jar-lid{fill:var(--gold,#E9A23B)}',
    '.v-jar-ridge{stroke:#000;stroke-opacity:.14;stroke-width:1.6;stroke-linecap:round}',
    '.v-water{fill:var(--teal,#1B998B)}',
    '.v-water-back{fill:var(--teal,#1B998B);opacity:.45}',
    '.v-wave-f{animation:v-wave 3.6s linear infinite}',
    '.v-wave-b{animation:v-wave 5.8s linear infinite reverse}',
    '.v-bub{fill:#FFFFFF;opacity:0;animation:v-bub 4.5s ease-in infinite}',
    '.v-bub2{animation-delay:1.5s}.v-bub3{animation-delay:3s}',
    '.v-jar-pct{font-weight:800;fill:var(--ink,#0B2545)}',
    '.v-jar-pct.is-wet{fill:var(--card,#FFFFFF)}',
    // debt bars
    '.v-debts{display:flex;flex-direction:column;gap:12px}',
    '.v-debt{position:relative;padding:14px 16px 13px;border-radius:16px;background:var(--card,#FFFFFF);border:1.5px solid var(--line,#DDE6EE);overflow:hidden}',
    '.v-debt.is-next{border-color:var(--gold,#E9A23B);box-shadow:0 0 0 3px color-mix(in srgb,var(--gold,#E9A23B) 18%,transparent)}',
    '.v-debt-head{display:flex;align-items:center;gap:10px;min-width:0}',
    '.v-debt-name{flex:1 1 auto;min-width:0;font-weight:700;font-size:18px;line-height:1.25;color:var(--ink,#0B2545);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.v-tag{flex:0 0 auto;font-size:13px;font-weight:800;letter-spacing:.02em;padding:4px 10px;border-radius:999px;background:var(--sand,#F6ECD9);color:var(--ink,#0B2545);border:1.5px solid var(--gold,#E9A23B)}',
    '.v-debt-bar{margin:10px 0 8px;height:14px;border-radius:999px;background:var(--sea-soft,#DCEBF6);overflow:hidden}',
    '.v-debt-fill{height:100%;border-radius:999px;background:var(--sea,#1E6FA8);transition:width .6s ease}',
    '.v-debt.is-next .v-debt-fill{background:linear-gradient(90deg,var(--sea,#1E6FA8),var(--teal,#1B998B))}',
    '.v-debt-amt{font-size:16px;color:var(--muted,#5B6B7F);line-height:1.3}',
    '.v-nw{white-space:nowrap}',
    '.v-debt-amt strong{color:var(--ink,#0B2545);font-weight:800}',
    '.v-debt.is-paid{background:var(--teal-soft,#D8F2EE);border-color:transparent}',
    '.v-debt.is-paid{padding-top:16px;padding-bottom:16px}',
    '.v-debt.is-paid .v-debt-name{padding-right:136px;color:var(--ink,#0B2545);opacity:.8}',
    '.v-debt.is-paid .v-debt-amt{margin-top:4px;padding-right:136px;color:var(--ink,#0B2545);opacity:.8;font-weight:600}',
    '.v-stamp{position:absolute;top:50%;right:14px;transform:translateY(-50%) rotate(-10deg);pointer-events:none}',
    '.v-stamp span{position:relative;display:block;font-size:17px;font-weight:900;letter-spacing:.08em;line-height:1;color:var(--teal,#1B998B);padding:7px 10px 6px 12px;border:3px solid currentColor;border-radius:8px;box-shadow:inset 0 0 0 2px var(--teal-soft,#D8F2EE),inset 0 0 0 3.5px currentColor;opacity:.92;white-space:nowrap;animation:v-stamp .45s cubic-bezier(.2,1.6,.4,1) both}',
    '.v-stamp span::after{content:"";position:absolute;inset:0;border-radius:6px;background:radial-gradient(circle at 18% 30%,var(--teal-soft,#D8F2EE) 0 1.2px,transparent 1.6px) 0 0/13px 11px,radial-gradient(circle at 70% 60%,var(--teal-soft,#D8F2EE) 0 1px,transparent 1.4px) 0 0/9px 13px;opacity:.85}',
    // split bar
    '.v-split{margin:4px 0 2px}',
    '.v-split-bar{display:flex;gap:3px;height:18px;border-radius:999px;overflow:hidden;background:var(--line,#DDE6EE)}',
    '.v-seg{display:block;height:100%;min-width:6px}',
    '.v-seg-bills,.v-dot-bills{background:var(--muted,#5B6B7F)}',
    '.v-seg-spend,.v-dot-spend{background:var(--gold,#E9A23B)}',
    '.v-seg-goals,.v-dot-goals{background:var(--teal,#1B998B)}',
    '.v-seg-short{background:var(--coral,#E07A5F);opacity:.9;background:repeating-linear-gradient(-45deg,var(--coral-soft,#FBE4DD) 0 5px,color-mix(in srgb,var(--coral,#E07A5F) 55%,transparent) 5px 8px)}',
    '.v-dot-short{background:var(--coral,#E07A5F)}',
    '.v-legend{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:15px;color:var(--muted,#5B6B7F)}',
    '.v-legend li{display:flex;align-items:center;gap:6px;white-space:nowrap}',
    '.v-legend b{color:var(--ink,#0B2545);font-weight:800}',
    '.v-dot{display:inline-block;width:11px;height:11px;border-radius:50%}',
    // stage path
    '.v-stages{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:0;counter-reset:none}',
    '.v-step{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 4px;min-width:0}',
    '.v-step::before{content:"";position:absolute;top:21px;right:50%;width:100%;height:4px;margin-top:-2px;border-radius:2px;background:var(--line,#DDE6EE);z-index:0}',
    '.v-step:first-child::before{display:none}',
    '.v-step.is-done::before,.v-step.is-now::before{background:var(--teal,#1B998B)}',
    '.v-step-dot{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;font-weight:800;font-size:18px;background:var(--card,#FFFFFF);color:var(--muted,#5B6B7F);border:3px solid var(--line,#DDE6EE);box-sizing:border-box}',
    '.v-step.is-done .v-step-dot{background:var(--teal,#1B998B);border-color:var(--teal,#1B998B);color:#FFFFFF}',
    '.v-step.is-now .v-step-dot{background:var(--sea,#1E6FA8);border-color:var(--sea,#1E6FA8);color:#FFFFFF;box-shadow:0 0 0 5px color-mix(in srgb,var(--sea,#1E6FA8) 22%,transparent)}',
    '.v-step-name{margin-top:8px;font-size:15px;font-weight:600;line-height:1.25;color:var(--muted,#5B6B7F)}',
    '.v-step.is-done .v-step-name{color:var(--ink,#0B2545)}',
    '.v-step.is-now .v-step-name{color:var(--ink,#0B2545);font-weight:800}',
    '.v-step-here{margin-top:3px;font-size:13.5px;font-weight:700;color:var(--sea,#1E6FA8);white-space:nowrap}',
    // confetti
    '.v-confetti{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000}',
    // motion
    '@keyframes v-wave{from{transform:translateX(0)}to{transform:translateX(24px)}}',
    '@keyframes v-bob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-1.6px) rotate(-1.5deg)}}',
    '@keyframes v-pulse{0%,100%{transform:scale(.92);opacity:.22}50%{transform:scale(1.08);opacity:.08}}',
    '@keyframes v-bub{0%{transform:translateY(0);opacity:0}15%{opacity:.7}80%{opacity:.5}100%{transform:translateY(-40px);opacity:0}}',
    '@keyframes v-stamp{0%{transform:scale(1.6);opacity:0}100%{transform:scale(1);opacity:.92}}',
    '@media (prefers-reduced-motion: reduce){.v-anim,.v-bob,.v-pulse,.v-stamp span,.v-debt-fill{animation:none!important;transition:none!important}.v-bub{display:none}}',
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
    routeMap: routeMap,
    miniRoute: miniRoute,
    jar: jar,
    debtBars: debtBars,
    splitBar: splitBar,
    stagePath: stagePath,
    confetti: confetti,
    injectStyles: injectStyles,
    css: CSS,
    _esc: esc,
    _truncate: truncate,
  };
});

// Thunder Hunter Sebastian — the SCATTER symbol, "Storm Seal" (assets/symbols/scatter.png).
//
// A forged gold medallion (coarse milled rim, polished raised lip) holding a recessed dusk-storm enamel field:
// one irregular storm-cloud bank across the top, its belly lit hot where a cast-gold bolt tears down through it.
// The bolt lies on top of the coin and breaks out over the rim at the upper right, so the outline is never a
// plain disc. A ruby lacquer ribbon with gold piping, wider than the coin, crosses the lower third with a gentle
// sag and carries SCATTER in raised cream Cinzel Black with a heavy dark outline; its swallow-tailed ends hang
// into the bottom corners.
//
// Drawn with Canvas 2D at 1024x1024 in headless Chromium, downsampled 1024 -> 512 -> 256.
// Deterministic: no Math.random (cloud lobes and forks use a seeded generator).
//
// An authoring tool, like render-sfx.js: the game only loads the PNG it writes. Needs Playwright's Chromium.
//
//   node tools/draw-scatter.js [out.png]        (default: assets/symbols/scatter.png)
//   MASTER=1 node tools/draw-scatter.js         also writes the 1024 px master next to it (<out>_1024.png)
//   ONLY=sky,clouds node tools/draw-scatter.js  draws only the named layers (tails, coin, sky, clouds, recess, bolt, ribbon, word)
//   PLATE=parchment node tools/draw-scatter.js  light plate with dark letters (legibility comparison)
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'symbols', 'scatter.png'));
const FONT = path.join(__dirname, '..', 'assets', 'fonts', 'cinzel-latin-900-normal.woff2');

// ---------------------------------------------------------------- parameters
// All lengths in pixels of the 1024 master unless noted.
const P = {
  S: 1024,
  coin: { cx: 512, cy: 516, R: 480, teeth: 40, toothDepth: 12, knurl: 30, lip: 50, wall: 10 },
  field: {
    // top -> bottom of the recessed field
    sky: [[0, '#151a3c'], [0.2, '#3a2a5e'], [0.3, '#7c3462'], [0.41, '#c45a3c'], [0.53, '#f08c32'], [0.67, '#ffc25a'], [1, '#ffd98a']],
    bloom: { u: -0.15, v: 0.4, r: 0.95, a: 0.5 },
  },
  // one storm-cloud bank: a flat top and a belly of seeded lobes (u, v, r in units of the field radius)
  cloud: {
    seed: +(process.env.CSEED || 1), from: -1.12, to: 1.12, base: -0.62, tilt: -0.04, jitter: 0.12, rMin: 0.11, rMax: 0.27, backRows: 1,
    top: '#15112c', dark: '#2e2554', mid: '#4a3a72', lit: '#b0708e', litA: 0.6, crescent: 0.24,
    under: '#ff9a52', underA: 0.6, hot: '#ffe8a0', hotA: 0.95, hotR: 0.42, hotV: 0.12,
  },
  // the bolt: a classic zigzag in an affine box, o + u*U + v*V (u across, v down its length)
  bolt: {
    pts: [[0.5, 0], [0.04, 0.6], [0.4, 0.6], [0.16, 1], [0.96, 0.34], [0.58, 0.34], [0.92, 0]],
    o: [457, 4], U: [405, 52], V: [-130, 790],
    bevel: 26, outline: 10, glow: 56,
    shadow: { blur: 14, d: 20, color: 'rgba(40,6,14,.78)' },
    // optional glowing side forks: { a: [u, v], b: [u, v], seed, w } in the bolt's box, jagged by a seeded walk.
    // None by default: anything thinner than ~10 px read as cracks at 256 and vanished at board size.
    forks: [],
  },
  ribbon: {
    x0: 27, x1: 997, y0: 606, y1: 822, sag: 11,  // the front face (flat), bowed down by `sag` at its centre
    pipe: 16,
    // hanging swallow tails in the bottom corners: outer/inner edge x at top and bottom, the notch depth
    tail: { top: 740, bottom: 994, outer: [30, 25], inner: [250, 208], notch: 72 },
  },
  ruby: { hi: '#ff9a8a', lit: '#e2364a', mid: '#b5172c', body: '#8c0d22', shade: '#6a0718', deep: '#3a030e' },
  plate: process.env.PLATE || 'ruby',
  word: {
    text: 'SCATTER', cap: 150, maxW: 910, condense: 0.87, pairGap: { TT: 22, AT: 4, TE: 4 },
    fill: ['#fffaf0', '#fff0cc', '#f6d58e'], thicken: 8,
    outline: '#250406', outlineW: 18,
    edge: 7, edgeLit: 'rgba(255,255,255,.85)', edgeShade: 'rgba(168,92,14,.7)',
    cast: { blur: 10, d: 9, color: 'rgba(18,0,4,.8)' },
  },
  // PLATE=parchment: the light-plate / dark-letter variant, kept for comparison (ruby read as well at 800x450 under
  // the 0.72 squash and keeps the red-band identity, so it stays the default)
  parchment: { face: ['#fff5d8', '#f3dfae', '#e2c283'], ink: ['#4a0c12', '#2a0408'] },
  only: process.env.ONLY ? process.env.ONLY.split(',') : null,
};

// ---------------------------------------------------------------- drawing (runs in the page)
function sealLib() {
  const TAU = Math.PI * 2;
  const GOLD = { hi: '#fff4c2', lit: '#f2c95a', mid: '#e6b648', shade: '#9a6614', deep: '#5e3a08', edge: '#2a1404' };
  const LIGHT = { x: -0.57, y: -0.82 };                       // towards the key light
  const stops = (g, list) => { list.forEach(s => g.addColorStop(s[0], s[1])); return g; };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  // the gold ramp as a function: 0 = edge, 1 = highlight
  const RAMP = [GOLD.edge, GOLD.deep, GOLD.shade, GOLD.mid, GOLD.lit, GOLD.hi];
  const goldAt = t => { t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(t)); return mix(RAMP[i], RAMP[i + 1], t - i); };

  const circle = (cx, cy, r) => { const p = new Path2D(); p.arc(cx, cy, r, 0, TAU); return p; };
  const ring = (cx, cy, r0, r1) => { const p = new Path2D(); p.arc(cx, cy, r1, 0, TAU); p.arc(cx, cy, r0, 0, TAU, true); return p; };
  const poly = pts => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; };
  // a linear gradient across a disc along the light: lit side first (reverse: far side first)
  const lightGrad = (x, cx, cy, r, list, reverse) => {
    const a = [cx + LIGHT.x * r, cy + LIGHT.y * r], b = [cx - LIGHT.x * r, cy - LIGHT.y * r];
    return stops(reverse ? x.createLinearGradient(b[0], b[1], a[0], a[1]) : x.createLinearGradient(a[0], a[1], b[0], b[1]), list);
  };
  // shadow of whatever draw() paints, without the paint itself
  const shadowOnly = (x, draw, blur, ox, oy, color) => {
    const far = 5000;
    x.save(); x.translate(-far, 0);
    x.shadowColor = color; x.shadowBlur = blur; x.shadowOffsetX = far + ox; x.shadowOffsetY = oy;
    draw(x); x.restore();
  };
  // shadow cast into a shape from its own edges (a recess)
  const innerShadow = (x, shape, blur, ox, oy, color) => {
    const inv = new Path2D(); inv.rect(-3000, -3000, 7000, 7000); inv.addPath(shape);
    x.save(); x.clip(shape);
    x.shadowColor = color; x.shadowBlur = blur; x.shadowOffsetX = ox; x.shadowOffsetY = oy;
    x.fillStyle = '#000'; x.fill(inv, 'evenodd'); x.restore();
  };
  // polygon shrunk by d (mitred), for bevels
  const inset = (pts, d) => {
    const n = pts.length; let area = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1;
    const lines = pts.map((a, i) => {
      const b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      const nx = -dy / l * sgn, ny = dx / l * sgn;  // inward normal
      return { p: [a[0] + nx * d, a[1] + ny * d], u: [dx, dy] };
    });
    return pts.map((_, i) => {
      const A = lines[(i - 1 + n) % n], B = lines[i];
      const den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
      const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den;
      return [A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t];
    });
  };
  const outwardNormal = (pts, i) => {
    const n = pts.length; let area = 0;
    for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1, a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    return [dy / l * sgn, -dx / l * sgn];
  };

  const mulberry = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // a jagged lightning path from a to b: midpoint displacement, deterministic per seed
  const jag = (a, b, seed) => {
    const r = mulberry(seed); let pts = [a, b];
    for (let lvl = 0, amp = 0.2; lvl < 3; lvl++, amp *= 0.55) {
      const nx = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy), o = (r() - 0.5) * 2 * amp * l;
        nx.push(p, [(p[0] + q[0]) / 2 - dy / l * o, (p[1] + q[1]) / 2 + dx / l * o]);
      }
      nx.push(pts[pts.length - 1]); pts = nx;
    }
    return pts;
  };
  // an offscreen layer the size of the master
  const layer = (S, fn) => { const c = document.createElement('canvas'); c.width = c.height = S; fn(c.getContext('2d')); return c; };
  // light cast into a masked shape from its edges on the side (dx, dy) points away from
  const innerGlow = (S, mask, dx, dy, blur, color) => layer(S, m => {
    m.fillStyle = color; m.fillRect(0, 0, S, S);
    m.globalCompositeOperation = 'destination-out'; m.filter = `blur(${blur}px)`; m.drawImage(mask, dx, dy); m.filter = 'none';
    m.globalCompositeOperation = 'destination-in'; m.drawImage(mask, 0, 0);
  });

  // ---------------- geometry shared by the layers
  function geom(P) {
    const C = P.coin, rf = C.R - C.knurl - C.lip - C.wall, r = P.ribbon, T = r.tail, B = P.bolt;
    const box = (u, v) => [B.o[0] + u * B.U[0] + v * B.V[0], B.o[1] + u * B.U[1] + v * B.V[1]];
    const tailL = [[T.outer[0], T.top], [T.outer[1], T.bottom], [(T.outer[1] + T.inner[1]) / 2, T.bottom - T.notch], [T.inner[1], T.bottom], [T.inner[0], T.top]];
    const tailR = tailL.map(([px, py]) => [P.S - px, py]).reverse();
    return {
      C, rf, coin: circle(C.cx, C.cy, C.R), field: circle(C.cx, C.cy, rf),
      tails: [tailL, tailR],
      bolt: B.pts.map(p => box(p[0], p[1])),
      forks: (B.forks || []).map(f => ({ w: f.w, pts: jag(box(...f.a), box(...f.b), f.seed) })),
      box,
    };
  }

  // ---------------- layer 1: the hanging ribbon tails, behind the coin
  function ribbonTails(x, P, g) {
    const r = P.ribbon, T = r.tail, Ru = P.ruby, parch = P.plate === 'parchment';
    g.tails.forEach((pts, side) => {
      const t = poly(pts);
      x.save();
      x.fillStyle = stops(x.createLinearGradient(0, r.y1 - 20, 0, T.bottom), parch
        ? [[0, '#3a1a08'], [0.25, '#8a5a2a'], [1, '#5a3412']]
        : [[0, Ru.deep], [0.22, Ru.shade], [0.5, Ru.mid], [1, Ru.shade]]);
      x.fill(t);
      x.clip(t);
      // a soft fold shade down the middle, so the tail reads as cloth
      const mx = (T.outer[0] + T.inner[0]) / 2, X = side ? P.S - mx : mx;
      const fg = x.createLinearGradient(X - 90, 0, X + 90, 0);
      stops(fg, side ? [[0, 'rgba(255,170,150,.0)'], [0.55, 'rgba(255,170,150,.0)'], [1, 'rgba(255,190,170,.18)']]
        : [[0, 'rgba(255,190,170,.22)'], [0.45, 'rgba(255,170,150,0)'], [1, 'rgba(40,0,8,.25)']]);
      x.fillStyle = fg; x.fillRect(0, T.top, P.S, T.bottom - T.top);
      // gold piping along the two long edges
      x.lineCap = 'butt';
      [[pts[0], pts[1]], [pts[3], pts[4]]].forEach(([a, b]) => {
        x.lineWidth = r.pipe * 1.7;
        const gx = x.createLinearGradient(a[0] - 14, 0, a[0] + 14, 0);
        stops(gx, [[0, GOLD.shade], [0.35, GOLD.hi], [0.6, GOLD.lit], [1, GOLD.deep]]);
        x.strokeStyle = gx; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
      });
      x.restore();
      x.save(); x.lineWidth = 5; x.strokeStyle = GOLD.edge; x.lineJoin = 'round'; x.stroke(t); x.restore();
    });
    // the coin shades the tails where they pass behind it
    x.save();
    const both = new Path2D(); g.tails.forEach(t => both.addPath(poly(t))); x.clip(both);
    shadowOnly(x, s => { s.fillStyle = '#000'; s.fill(g.coin); }, 28, -LIGHT.x * 12, -LIGHT.y * 12, 'rgba(12,2,6,.7)');
    x.restore();
  }

  // ---------------- layer 2: the coin body (coarse milled edge, polished lip, recess wall)
  function coinBody(x, P, g) {
    const C = g.C, { cx, cy, R } = C;
    // milled silhouette: flat-topped teeth
    const sil = new Path2D(), N = C.teeth, st = TAU / N;
    for (let k = 0; k < N; k++) {
      const a = k * st - Math.PI / 2;
      [[0, R - C.toothDepth], [0.1, R], [0.5, R], [0.6, R - C.toothDepth]].forEach(([f, rr], j) => {
        const aa = a + f * st, px = cx + Math.cos(aa) * rr, py = cy + Math.sin(aa) * rr;
        (k === 0 && j === 0) ? sil.moveTo(px, py) : sil.lineTo(px, py);
      });
    }
    sil.closePath();
    x.save();
    x.fillStyle = lightGrad(x, cx, cy, R, [[0, GOLD.hi], [0.22, GOLD.lit], [0.5, GOLD.mid], [0.78, GOLD.shade], [1, GOLD.deep]]);
    x.fill(sil);
    // one soft groove and one highlight per tooth across the milled band
    x.clip(sil);
    const r0 = R - C.knurl;
    for (let k = 0; k < N; k++) {
      const a = k * st - Math.PI / 2 + 0.8 * st, c = Math.cos(a), s = Math.sin(a);
      const lit = c * LIGHT.x + s * LIGHT.y;             // > 0 on the side facing the light
      x.strokeStyle = `rgba(42,20,4,${0.5 - lit * 0.18})`; x.lineWidth = 12;
      x.beginPath(); x.moveTo(cx + c * (r0 + 2), cy + s * (r0 + 2)); x.lineTo(cx + c * (R + 4), cy + s * (R + 4)); x.stroke();
      const a2 = a - 0.5 * st, c2 = Math.cos(a2), s2 = Math.sin(a2);
      x.strokeStyle = `rgba(255,244,194,${0.2 + lit * 0.18})`; x.lineWidth = 7;
      x.beginPath(); x.moveTo(cx + c2 * (r0 + 4), cy + s2 * (r0 + 4)); x.lineTo(cx + c2 * (R - 2), cy + s2 * (R - 2)); x.stroke();
    }
    x.restore();
    x.save(); x.lineWidth = 6; x.strokeStyle = rgba(GOLD.edge, 0.85); x.stroke(sil); x.restore();
    // groove between the milled band and the lip
    x.save(); x.lineWidth = 7; x.strokeStyle = rgba(GOLD.edge, 0.9); x.stroke(circle(cx, cy, r0)); x.restore();

    // polished raised lip: outer flank lit towards the light, inner flank lit on the far side
    const lo = r0 - 3, lr = r0 - C.lip * 0.45, li = r0 - C.lip;
    x.fillStyle = lightGrad(x, cx, cy, lo, [[0, GOLD.hi], [0.3, GOLD.lit], [0.62, GOLD.shade], [1, GOLD.deep]]);
    x.fill(ring(cx, cy, lr, lo));
    x.fillStyle = lightGrad(x, cx, cy, lr, [[0, GOLD.deep], [0.35, GOLD.shade], [0.72, GOLD.mid], [1, GOLD.hi]]);
    x.fill(ring(cx, cy, li, lr));
    // roundness across the lip and the polished ridge line
    x.save(); x.globalCompositeOperation = 'soft-light';
    const rg = x.createRadialGradient(cx, cy, li, cx, cy, lo);
    stops(rg, [[0, 'rgba(0,0,0,.5)'], [0.5, 'rgba(255,255,255,.55)'], [1, 'rgba(0,0,0,.45)']]);
    x.fillStyle = rg; x.fill(ring(cx, cy, li, lo)); x.restore();
    x.save(); x.lineWidth = 4;
    x.strokeStyle = lightGrad(x, cx, cy, lr, [[0, 'rgba(255,250,225,.95)'], [0.5, 'rgba(255,240,190,.25)'], [1, 'rgba(255,240,190,.55)']]);
    x.stroke(circle(cx, cy, lr)); x.restore();

    // recess wall down to the field: the far wall catches the light
    const wo = li, wi = g.rf;
    x.fillStyle = lightGrad(x, cx, cy, wo, [[0, GOLD.edge], [0.4, GOLD.deep], [0.8, GOLD.shade], [1, GOLD.mid]]);
    x.fill(ring(cx, cy, wi, wo));
    x.save(); x.lineWidth = 3; x.strokeStyle = rgba(GOLD.edge, 0.9); x.stroke(circle(cx, cy, wo)); x.restore();
  }

  // ---------------- layer 3: storm-sky enamel in the recess
  function stormField(x, P, g) {
    const { cx, cy } = g.C, rf = g.rf, F = P.field;
    x.save(); x.clip(g.field);
    x.fillStyle = stops(x.createLinearGradient(0, cy - rf, 0, cy + rf), F.sky);
    x.fillRect(cx - rf, cy - rf, rf * 2, rf * 2);
    // a soft warm horizon bloom behind where the ribbon will sit
    const bx = cx + F.bloom.u * rf, by = cy + F.bloom.v * rf;
    const hb = x.createRadialGradient(bx, by, 0, bx, by, rf * F.bloom.r);
    stops(hb, [[0, `rgba(255,190,90,${F.bloom.a})`], [0.5, 'rgba(255,140,50,.16)'], [1, 'rgba(255,120,40,0)']]);
    x.globalCompositeOperation = 'screen'; x.fillStyle = hb; x.fillRect(cx - rf, cy - rf, rf * 2, rf * 2);
    x.restore();
  }

  // ---------------- layer 4: one irregular storm-cloud bank, its belly lit hot where the bolt tears through
  function cloudLobes(Cl) {
    const r = mulberry(Cl.seed), front = [], back = [];
    for (let u = Cl.from; u < Cl.to;) {
      const rad = Cl.rMin + r() * (Cl.rMax - Cl.rMin), v = Cl.base + Cl.tilt * u + (r() - 0.5) * Cl.jitter;
      front.push([u + rad * 0.4, v, rad]);
      u += rad * (1.05 + r() * 0.55);
    }
    for (let row = 0; row < Cl.backRows; row++)
      for (let u = Cl.from - 0.1; u < Cl.to;) {
        const rad = Cl.rMax * (1 + r() * 0.5), v = Cl.base - 0.16 - row * 0.16 + Cl.tilt * u + (r() - 0.5) * Cl.jitter;
        back.push([u + rad * 0.5, v, rad]);
        u += rad * (1.1 + r() * 0.5);
      }
    return { front, back };
  }
  function clouds(x, P, g) {
    const { cx, cy } = g.C, rf = g.rf, S = P.S, Cl = P.cloud, L = cloudLobes(Cl);
    const top = cy - rf, baseY = cy + Cl.base * rf;
    const shape = new Path2D(); shape.rect(cx - rf, top, rf * 2, baseY - top);
    [...L.back, ...L.front].forEach(([u, v, r]) => shape.addPath(circle(cx + u * rf, cy + v * rf, r * rf)));
    const low = cy + Math.max(...L.front.map(l => l[1] + l[2])) * rf;
    const mask = layer(S, m => { m.fillStyle = '#fff'; m.fill(shape); });
    // where the strike leaves the cloud: the bolt's centre line at the belly
    const hy = cy + (Cl.base + Cl.hotV) * rf, ha = g.box(0.71, 0), hb = g.box(0.28, 0.6), ht = (hy - ha[1]) / (hb[1] - ha[1]);
    const hot = [ha[0] + (hb[0] - ha[0]) * ht, hy];
    const body = layer(S, m => {
      // the mass: near-black ink at the top of the field, mid-violet down at the belly
      m.fillStyle = stops(m.createLinearGradient(0, top, 0, low), [[0, Cl.dark], [1, Cl.mid]]);
      m.fill(shape);
      m.globalCompositeOperation = 'source-atop';
      // opaque puffs drawn back to front, each dark on top and lit warm along its lower edge by the dusk, so the
      // front ones occlude the back ones and the bank reads as one rolling body
      const puff = ([u, v, r], k) => {
        const X = cx + u * rf, Y = cy + v * rf, rr = r * rf;
        const pg = m.createLinearGradient(0, Y - rr, 0, Y + rr);
        stops(pg, [[0, Cl.dark], [0.55, mix(Cl.dark, Cl.mid, k)], [0.8, Cl.mid], [0.93, mix(Cl.mid, Cl.lit, 0.55 * k)], [1, mix(Cl.mid, Cl.lit, k)]]);
        m.fillStyle = pg; m.beginPath(); m.arc(X, Y, rr, 0, TAU); m.fill();
      };
      [...L.back].sort((p, q) => p[1] - q[1]).forEach(l => puff(l, 0.5));
      [...L.front].sort((p, q) => p[1] - q[1]).forEach(l => puff(l, 1));
      // darker towards the top of the field
      m.fillStyle = stops(m.createLinearGradient(0, top, 0, low), [[0, 'rgba(10,8,30,.7)'], [0.5, 'rgba(10,8,30,.25)'], [1, 'rgba(10,8,30,0)']]);
      m.fillRect(cx - rf, top, rf * 2, low - top);
      // the belly lit from below by the dusk: a thin warm rim
      m.globalCompositeOperation = 'source-over';
      m.drawImage(innerGlow(S, mask, 0, -0.035 * rf, 0.02 * rf, rgba(Cl.under, Cl.underA)), 0, 0);
      // hot gold where the bolt leaves the cloud: the puffs around it glow, and their underside burns brightest
      m.globalCompositeOperation = 'source-atop';
      const hg = m.createRadialGradient(hot[0], hot[1], 0, hot[0], hot[1], rf * Cl.hotR);
      stops(hg, [[0, rgba(Cl.hot, Cl.hotA)], [0.35, rgba('#ffb456', 0.5)], [1, 'rgba(255,150,60,0)']]);
      m.fillStyle = hg; m.fillRect(0, 0, S, S);
      const rim = innerGlow(S, mask, 0, -0.06 * rf, 0.03 * rf, rgba(Cl.hot, 1));
      const rx = rim.getContext('2d'); rx.globalCompositeOperation = 'destination-in';
      const rg = rx.createRadialGradient(hot[0], hot[1], 0, hot[0], hot[1], rf * Cl.hotR * 1.3);
      stops(rg, [[0, 'rgba(0,0,0,1)'], [0.5, 'rgba(0,0,0,.6)'], [1, 'rgba(0,0,0,0)']]);
      rx.fillStyle = rg; rx.fillRect(0, 0, S, S);
      m.globalCompositeOperation = 'source-over'; m.drawImage(rim, 0, 0);
    });
    x.save(); x.clip(g.field); x.drawImage(body, 0, 0); x.restore();
  }

  // ---------------- layer 5: the bolt, faceted cast gold with a white-hot face, lying over the coin
  function bolt(x, P, g) {
    const B = P.bolt, pts = g.bolt, outer = poly(pts);
    // its shadow on the coin, away from the light
    x.save(); x.clip(g.coin);
    shadowOnly(x, s => { s.fillStyle = '#000'; s.fill(outer); }, B.shadow.blur, -LIGHT.x * B.shadow.d, -LIGHT.y * B.shadow.d, B.shadow.color);
    x.restore();
    // the strike lights the enamel around it (kept inside the field)
    x.save(); x.clip(g.field); x.globalCompositeOperation = 'screen';
    shadowOnly(x, s => { s.fillStyle = '#000'; s.fill(outer); }, B.glow * 2, -10, -10, 'rgba(255,170,70,.7)');
    x.restore();
    // side forks crackling off the strike
    x.save(); x.clip(g.field);
    g.forks.forEach(f => {
      if (!f.w) return;
      const p = f.pts;
      x.save(); x.lineJoin = 'round'; x.lineCap = 'round';
      [[1.9, 'rgba(255,180,90,.5)', 26], [1, '#ffe39a', 0], [0.42, '#fffdf4', 0]].forEach(([wk, col, blur]) => {
        x.strokeStyle = col; x.shadowColor = 'rgba(255,180,90,.9)'; x.shadowBlur = blur;
        for (let i = 0; i < p.length - 1; i++) {
          const t = i / (p.length - 1);
          x.lineWidth = Math.max(2, f.w * wk * (1 - t * 0.8));
          x.beginPath(); x.moveTo(p[i][0], p[i][1]); x.lineTo(p[i + 1][0], p[i + 1][1]); x.stroke();
        }
      });
      x.restore();
    });
    x.restore();
    // dark outline, then the bevel facets, then the face
    x.save(); x.lineJoin = 'round'; x.lineWidth = B.outline * 2; x.strokeStyle = GOLD.edge; x.stroke(outer); x.restore();
    const inn = inset(pts, B.bevel);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length, n = outwardNormal(pts, i), lit = n[0] * LIGHT.x + n[1] * LIGHT.y;
      x.fillStyle = goldAt(0.34 + 0.66 * (0.5 + lit * 0.5));
      const q = poly([pts[i], pts[j], inn[j], inn[i]]); x.fill(q);
      x.lineWidth = 1.5; x.strokeStyle = x.fillStyle; x.stroke(q);      // close hairline gaps
    }
    // facet seams
    x.save(); x.strokeStyle = rgba(GOLD.edge, 0.35); x.lineWidth = 2;
    for (let i = 0; i < pts.length; i++) { x.beginPath(); x.moveTo(pts[i][0], pts[i][1]); x.lineTo(inn[i][0], inn[i][1]); x.stroke(); }
    x.restore();
    const face = poly(inn);
    const yTop = Math.min(...inn.map(p => p[1])), yBot = Math.max(...inn.map(p => p[1]));
    x.fillStyle = stops(x.createLinearGradient(0, yTop, 0, yBot), [[0, '#fffdf2'], [0.35, '#fff1b8'], [0.68, '#ffd866'], [1, '#f0ac3a']]);
    x.fill(face);
    // a hot core streak down the face, along the strike
    x.save(); x.clip(face); x.globalCompositeOperation = 'screen';
    const a = g.box(0.62, 0), b = g.box(0.3, 1), nx = -(b[1] - a[1]), ny = b[0] - a[0], nl = Math.hypot(nx, ny);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hg = x.createLinearGradient(mid[0] - nx / nl * 130, mid[1] - ny / nl * 130, mid[0] + nx / nl * 130, mid[1] + ny / nl * 130);
    stops(hg, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]);
    x.fillStyle = hg; x.fill(face); x.restore();
    x.save(); x.lineWidth = 3; x.strokeStyle = 'rgba(160,96,10,.55)'; x.lineJoin = 'round'; x.stroke(face); x.restore();
  }

  // ---------------- polished highlights on the lip, towards the key light
  function lipGlint(x, P, g) {
    const C = g.C, r = C.R - C.knurl - C.lip * 0.45, a0 = Math.atan2(LIGHT.y, LIGHT.x);
    x.save(); x.lineCap = 'round'; x.globalCompositeOperation = 'screen';
    [[0.5, 12, 0.55], [0.28, 7, 0.9]].forEach(([span, w, a]) => {
      for (let k = -8; k <= 8; k++) {           // tapered: brightest in the middle of the arc
        const t = k / 8, f = 1 - t * t;
        x.strokeStyle = `rgba(255,250,228,${a * f})`; x.lineWidth = w * (0.4 + 0.6 * f);
        x.beginPath(); x.arc(C.cx, C.cy, r, a0 + t * span - span / 16, a0 + t * span + span / 16); x.stroke();
      }
    });
    x.restore();
  }

  // ---------------- layer 6: the ribbon face (drawn flat, with the word, then bowed by the sag)
  function ribbonFlat(P, on) {
    const r = P.ribbon, Ru = P.ruby, S = P.S, parch = P.plate === 'parchment';
    return layer(S, x => {
      const face = new Path2D(); face.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      const h = r.y1 - r.y0;
      x.save();
      x.fillStyle = stops(x.createLinearGradient(0, r.y0, 0, r.y1), parch
        ? [[0, P.parchment.face[0]], [0.5, P.parchment.face[1]], [1, P.parchment.face[2]]]
        // lacquer ruby: lit just under the top piping, darkest behind the letters, a little reflected light low down
        : [[0, Ru.lit], [0.16, Ru.mid], [0.3, Ru.body], [0.72, Ru.shade], [0.9, Ru.body], [1, Ru.mid]]);
      x.fill(face);
      x.clip(face);
      const ends = x.createLinearGradient(r.x0, 0, r.x1, 0);
      stops(ends, [[0, 'rgba(30,0,6,.6)'], [0.07, 'rgba(30,0,6,0)'], [0.93, 'rgba(30,0,6,0)'], [1, 'rgba(30,0,6,.65)']]);
      x.fillStyle = ends; x.fillRect(r.x0, r.y0, r.x1 - r.x0, h);
      // lacquer gloss: a soft band high on the face, brighter towards the light
      const gl = x.createLinearGradient(r.x0, 0, r.x1, 0);
      stops(gl, [[0, 'rgba(255,200,190,0)'], [0.16, 'rgba(255,214,200,.55)'], [0.55, 'rgba(255,214,200,.25)'], [1, 'rgba(255,214,200,.06)']]);
      x.globalCompositeOperation = 'screen'; x.fillStyle = gl;
      x.fillRect(r.x0, r.y0 + r.pipe + 3, r.x1 - r.x0, h * 0.11);
      x.globalCompositeOperation = 'source-over';
      // gold piping along the long edges: round bars, lit flank up
      const pipe = (y, ph, flip) => {
        const gr = x.createLinearGradient(0, y, 0, y + ph);
        stops(gr, flip ? [[0, GOLD.deep], [0.3, GOLD.shade], [0.62, GOLD.lit], [0.8, GOLD.hi], [1, GOLD.shade]]
          : [[0, GOLD.shade], [0.25, GOLD.hi], [0.45, GOLD.lit], [0.75, GOLD.shade], [1, GOLD.deep]]);
        x.fillStyle = gr; x.fillRect(r.x0, y, r.x1 - r.x0, ph);
      };
      pipe(r.y0, r.pipe, false); pipe(r.y1 - r.pipe, r.pipe, true);
      x.fillStyle = ends; x.fillRect(r.x0, r.y0, r.x1 - r.x0, h);
      // the enamel sits a hair below the piping
      x.fillStyle = 'rgba(30,0,6,.5)'; x.fillRect(r.x0, r.y0 + r.pipe, r.x1 - r.x0, 3); x.fillRect(r.x0, r.y1 - r.pipe - 3, r.x1 - r.x0, 3);
      x.restore();
      x.save(); x.lineWidth = 6; x.strokeStyle = GOLD.edge; x.lineJoin = 'round'; x.stroke(face); x.restore();
      if (on('word')) word(x, P);
    });
  }
  // bow a flat layer down by the sag: each 2 px column shifted by 4*sag*t*(1-t) across the face
  function bowed(P, src) {
    const r = P.ribbon;
    return layer(P.S, x => {
      for (let X = 0; X < P.S; X += 2) {
        const t = Math.max(0, Math.min(1, (X + 1 - r.x0) / (r.x1 - r.x0))), dy = 4 * r.sag * t * (1 - t);
        x.drawImage(src, X, 0, 2, P.S, X, dy, 2, P.S);
      }
    });
  }
  function ribbonFace(x, P, g, on) {
    const flat = ribbonFlat(P, on), face = bowed(P, flat);
    // its shadow on the coin and the tails, away from the light
    x.save();
    const under = new Path2D(); under.addPath(g.coin); g.tails.forEach(t => under.addPath(poly(t))); x.clip(under);
    shadowOnly(x, s => s.drawImage(face, 0, 0), 26, -LIGHT.x * 16, -LIGHT.y * 16, 'rgba(14,2,8,.62)');
    x.restore();
    x.drawImage(face, 0, 0);
  }

  // ---------------- the word: raised cream letters with a heavy dark outline, condensed to the band
  function word(x, P) {
    const W = P.word, r = P.ribbon, S = P.S, parch = P.plate === 'parchment';
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = '100px "Cinzel"';
    const size = 100 * W.cap / probe.measureText(W.text).actualBoundingBoxAscent;
    probe.font = `${size}px "Cinzel"`;
    // letter positions from the kerned prefix widths, plus extra room for crowded pairs (the TT crossbars)
    const xs = []; let extra = 0;
    for (let i = 0; i < W.text.length; i++) {
      if (i) extra += (W.pairGap[W.text.slice(i - 1, i + 1)] || 0);
      xs.push(probe.measureText(W.text.slice(0, i)).width + extra);
    }
    const mm = probe.measureText(W.text), last = probe.measureText(W.text.slice(-1));
    const left = -mm.actualBoundingBoxLeft, right = xs[xs.length - 1] + last.actualBoundingBoxRight, wNat = right - left;
    const hs = Math.min(W.condense, W.maxW / wNat);
    const base = (r.y0 + r.y1) / 2 + W.cap / 2;
    const ox = S / 2 - (left + wNat / 2) * hs;
    // run fn(ctx, ch, x, y) for every letter in the condensed text frame
    const letters = (c, fn) => { c.save(); c.translate(ox, base); c.scale(hs, 1); c.font = `${size}px "Cinzel"`; c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.lineJoin = 'round'; for (let i = 0; i < W.text.length; i++) fn(c, W.text[i], xs[i], 0); c.restore(); };
    const fillCols = parch ? P.parchment.ink : W.fill;
    // the letter shapes (thickened by a stroke in the fill colour, which keeps Cinzel's hairlines at board size)
    const L = layer(S, c => letters(c, (k, ch, X, Y) => { k.fillStyle = '#fff'; k.strokeStyle = '#fff'; k.lineWidth = W.thicken / Math.sqrt(hs); k.fillText(ch, X, Y); k.strokeText(ch, X, Y); }));
    if (!parch) {
      // shadow cast into the lacquer, down and right, from the outlined letters
      shadowOnly(x, s => letters(s, (k, ch, X, Y) => { k.strokeStyle = '#000'; k.lineWidth = W.outlineW / Math.sqrt(hs); k.strokeText(ch, X, Y); k.fillText(ch, X, Y); }),
        W.cast.blur, -LIGHT.x * W.cast.d, -LIGHT.y * W.cast.d, W.cast.color);
      // heavy dark outline
      letters(x, (k, ch, X, Y) => { k.strokeStyle = W.outline; k.lineWidth = (W.outlineW + W.thicken) / Math.sqrt(hs); k.strokeText(ch, X, Y); });
    } else {
      // engraved: a light lip below-right, a soft dark cast above-left (cut into the plate)
      shadowOnly(x, s => s.drawImage(L, 0, 0), 2, -LIGHT.x * 4, -LIGHT.y * 4, 'rgba(255,255,240,.9)');
    }
    // the fill, then raised edges: lit towards the key light, amber on the far side
    const F = layer(S, c => {
      c.drawImage(L, 0, 0); c.globalCompositeOperation = 'source-in';
      c.fillStyle = (() => { const g = c.createLinearGradient(0, base - W.cap, 0, base); fillCols.forEach((col, i) => g.addColorStop(i / (fillCols.length - 1), col)); return g; })();
      c.fillRect(0, 0, S, S);
      const edgeLayer = (dx, dy, color) => layer(S, e => {
        e.drawImage(L, 0, 0); e.globalCompositeOperation = 'destination-out'; e.drawImage(L, dx, dy);
        e.globalCompositeOperation = 'source-in'; e.fillStyle = color; e.fillRect(0, 0, S, S);
      });
      c.globalCompositeOperation = 'source-atop';
      if (!parch) {
        c.drawImage(edgeLayer(LIGHT.x * W.edge, LIGHT.y * W.edge, W.edgeShade), 0, 0);       // far edges
        c.drawImage(edgeLayer(-LIGHT.x * W.edge * 0.8, -LIGHT.y * W.edge * 0.8, W.edgeLit), 0, 0);   // near edges
      }
    });
    x.drawImage(F, 0, 0);
    window.__word = { size, hs, wNat: wNat * hs, cap: W.cap };
  }

  window.drawSeal = (x, P) => {
    const g = geom(P), on = k => !P.only || P.only.includes(k);   // P.only: draw just these layers (debugging)
    if (on('tails')) ribbonTails(x, P, g);
    if (on('coin')) coinBody(x, P, g);
    if (on('sky')) stormField(x, P, g);
    if (on('clouds')) clouds(x, P, g);
    if (on('recess')) innerShadow(x, g.field, 30, -LIGHT.x * 18, -LIGHT.y * 18, 'rgba(6,2,14,.8)');
    if (on('coin')) lipGlint(x, P, g);
    if (on('bolt')) bolt(x, P, g);
    if (on('ribbon')) ribbonFace(x, P, g, on);
    return window.__word || null;
  };
}

// ---------------------------------------------------------------- lossless PNG re-encode
// Chromium's toDataURL compresses fast and large; the same RGBA pixels with per-row adaptive filtering and zlib
// level 9 come out about a quarter smaller. The runner checks the pixels against the toDataURL file's.
function encodePNG(w, h, px) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h), cur = Buffer.alloc(stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    let best = null, bestSum = Infinity, bestF = 0;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const v = px[y * stride + i], a = i >= 4 ? px[y * stride + i - 4] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = (y && i >= 4) ? px[(y - 1) * stride + i - 4] : 0;
        const o = (v - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
        cur[i] = o; sum += o < 128 ? o : 256 - o;
      }
      if (sum < bestSum) { bestSum = sum; bestF = f; best = Buffer.from(cur); }
    }
    raw[y * (stride + 1)] = bestF; best.copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- runner
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body style="margin:0;background:transparent"></body>');
  await page.addScriptTag({ content: `(${sealLib.toString()})();` });
  const res = await page.evaluate(async ({ P, font }) => {
    const ff = new FontFace('Cinzel', `url(data:font/woff2;base64,${font})`, { weight: '900' });
    await ff.load(); document.fonts.add(ff); await document.fonts.ready;
    const big = document.createElement('canvas'); big.width = big.height = P.S;
    const info = window.drawSeal(big.getContext('2d'), P);
    // downsample in halving steps
    let src = big;
    while (src.width > 256) {
      const c = document.createElement('canvas'); c.width = c.height = src.width / 2;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(src, 0, 0, c.width, c.height); src = c;
    }
    // bounding box of the art at 256
    const d = src.getContext('2d').getImageData(0, 0, 256, 256).data; let x0 = 256, y0 = 256, x1 = -1, y1 = -1;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (d[(y * 256 + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // the same pixels as toDataURL writes (it un-premultiplies the same way), for the smaller encode
    const rgba = Array.from(d);
    return { png: src.toDataURL('image/png'), big: big.toDataURL('image/png'), info, bbox: [x0, y0, x1, y1], rgba };
  }, { P, font: fs.readFileSync(FONT).toString('base64') });
  const small = encodePNG(256, 256, Buffer.from(res.rgba));
  // verify: decode toDataURL's file in the page and compare every byte before using the smaller one
  const same = await page.evaluate(async ({ a, b }) => {
    const px = async src => { const im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d', { colorSpace: 'srgb' }); x.drawImage(im, 0, 0); return x.getImageData(0, 0, 256, 256).data; };
    const A = await px(a), B = await px(b); for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false; return true;
  }, { a: res.png, b: 'data:image/png;base64,' + small.toString('base64') });
  fs.writeFileSync(OUT, same ? small : Buffer.from(res.png.split(',')[1], 'base64'));
  console.log(same ? 're-encoded losslessly' : 'pixel mismatch: kept the toDataURL encode');
  if (process.env.MASTER) fs.writeFileSync(OUT.replace(/\.png$/, '_1024.png'), Buffer.from(res.big.split(',')[1], 'base64'));
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes', JSON.stringify(res.info), 'bbox', res.bbox.join(','));
  await browser.close();
})();

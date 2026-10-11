/* Thunder Hunter Sebastian — scene: the world behind the board.
 *
 * Static layers are painted once per layout into two offscreen canvases (the
 * violet dusk of the base game and the golden free-spins storm) and
 * cross-faded by S.mood: a dithered sky, stratified ridges lit from the upper
 * left with storm-lit pines along their crests, the storm hunter's
 * lightning-rod lookout on the summit and, where the layout leaves room,
 * carved timber lodge posts with brass bands at the screen edges.
 * Live layers on top: twinkling stars, a slowly turning light fan, drifting
 * clouds, sky lightning (caught by the rod, rim-lighting crests and pines),
 * swaying storm lanterns, the storm's rain and rising motes.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX;
  const Scene = G.Scene = {};

  function mulberry(seed) {
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // shared seeded PRNG: other modules bake stable wear and noise with it
  G.mulberry = G.mulberry || mulberry;

  // the one key light (upper left), shared with the frame and HUD
  const KEY = { x: -0.57, y: -0.82 };
  // the frame's gold ramp: hi, lit, mid, shade, deep, edge
  const GOLD = ['#fff4c2', '#f2c95a', '#e6b648', '#9a6614', '#5e3a08', '#2a1404'];

  const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => {
    const A = rgbOf(a), B = rgbOf(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };

  const MOODS = [
    { sky: ['#0b0520', '#24104d', '#5a2687', '#b2478d', '#f08a7a'], sun: 'rgba(255,140,190,', nebula: ['#7a3cff', '#ff4fa8', '#3a6bff'],
      m: ['#5a3790', '#341c5e', '#1c0d35'], rim: 'rgba(255,170,220,.55)', cloud: '#e6c8ff',
      lit: '#ffc4ec', shade: '#0b0418', beacon: '#ffd77a', window: '#ffcf70', tower: '#170a2e', towerLit: '#ff9ed8',
      wood: ['#120811', '#7c5868', '#4a2c3e', '#2a1724'], ambient: '#3a1e5c', iron: '#150d1d', ironLit: '#a08cc0' },
    { sky: ['#140502', '#3c1206', '#8a360c', '#de7d1e', '#ffd47a'], sun: 'rgba(255,200,90,', nebula: ['#ff7a1a', '#ffcf4a', '#c2361a'],
      m: ['#6e3a16', '#40200b', '#200d04'], rim: 'rgba(255,220,140,.7)', cloud: '#ffd9a0',
      lit: '#ffd88a', shade: '#120501', beacon: '#fff0b0', window: '#fff0b8', tower: '#250d03', towerLit: '#ffd27a',
      wood: ['#180a03', '#b47c48', '#6e4220', '#3e220e'], ambient: null, iron: '#1c0e06', ironLit: '#d8aa76' },
  ];
  // brass shares the frame's gold; at dusk it sits in violet ambient light
  MOODS.forEach(M => { M.brass = GOLD.map(c => M.ambient ? mix(c, M.ambient, 0.24) : c); });

  let layers = [null, null], rays = null, raysSize = 0, cloudSprites = [[], []], rimMask = null, rimTop = 0, lantern = null, flashRamps = null;
  let dirty = true, lastBuild = -1, layerDpr = 1, geo = null;
  let stars = [], clouds = [], lanterns = [], shafts = [], rod = null;
  let lightningT = 4, skyFlash = 0, rodK = 0, suspenseK = 0, stormK = 0;
  // free-spins storm intensity: grows with the total multiplier (x1 -> 0, x127+ -> 1)
  Scene.storm = () => stormK;
  // sky-flash intensity 0..1 (a strong strike is 1), for relighting the frame and chrome
  Scene.skyFlash = () => Math.min(1, skyFlash / 0.5);

  Scene.invalidate = () => { dirty = true; };

  function build() {
    const W = G.W, H = G.H;
    layerDpr = G.DPR;
    geo = geometry(W, H);
    layers = [paint(0, W, H), paint(1, W, H)];
    rimMask = G.Q.level > 0 ? paintRimMask(W, H) : null;     // lean devices keep the plain sky flash
    raysSize = Math.max(W, H) * 1.9;
    rays = paintRays(raysSize);
    cloudSprites = [[0, 1, 2].map(v => paintCloud(v, MOODS[0].cloud)), [0, 1, 2].map(v => paintCloud(v, MOODS[1].cloud))];
    lantern = geo.posts.length ? paintLantern(geo.cw) : null;
    flashRamps = flashRamps || ['170,200,255', '255,220,150'].map(paintFlashRamp);
    lanterns = geo.posts.map((p, i) => ({ x: p.hook.x, y: p.hook.y, ph: i * 2.1 }));
    shafts = geo.posts.map(p => p.shaft);
    rod = { x: geo.tower.x, y: geo.tower.tipY, s: geo.tower.ts };
    const r = mulberry(7), far = geo.ridges[0];
    // stars only in open sky, never over the mountains
    const nStars = Math.round(W * H / 9000 * G.Q.fx);
    stars = [];
    for (let k = 0; k < nStars * 3 && stars.length < nStars; k++) {
      const s = { x: r() * W, y: Math.pow(r(), 1.6) * H * 0.6, s: 0.6 + r() * 1.8, p: r() * 7, f: 0.6 + r() * 2.2 };
      if (s.y < yAt(far, s.x) - 6) stars.push(s);
    }
    clouds = Array.from({ length: Math.max(4, Math.round(9 * G.Q.fx)) }, (_, i) => ({ v: i % 3, x: r() * (W + 600) - 300, y: H * (0.12 + r() * 0.42), s: 0.5 + r() * 0.9, d: 0.3 + r() * 0.7, a: 0.25 + r() * 0.3 }));
    dirty = false; lastBuild = G.clock.real;
  }
  Scene.build = build;
  const colW = () => G.clamp(G.W * 0.045, 30, 84);
  const capY = () => G.H * 0.16;
  // lodge posts + lanterns only where the layout leaves room for them (wide screens)
  const hasPosts = () => !G.L.portrait && G.L.left && G.L.left.x > colW() * 1.9 + G.W * 0.008;

  // ---------------- geometry (shared by both moods, deterministic per layout) ----------------
  function ridge(W, base, amp, peak, rough, seed) {
    const rr = mulberry(seed), pts = [], n = 64;
    let h = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      h = h * 0.6 + (rr() - 0.5) * rough;
      const env = peak ? Math.exp(-Math.pow((t - 0.5) / 0.16, 2)) : 0;
      const wav = Math.sin(t * Math.PI * (2 + seed % 3) + seed) * 0.35 + 0.35;
      pts.push([t * W, base - amp * (env * 1.0 + wav * (peak ? 0.35 : 1) + h)]);
    }
    return pts;
  }
  // crest height at x (the points are evenly spaced across the width)
  function yAt(pts, px) {
    const n = pts.length - 1, f = G.clamp(px / pts[n][0], 0, 1) * n, i = Math.min(n - 1, f | 0), k = f - i;
    return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
  }

  function geometry(W, H) {
    const far = ridge(W, H * 0.74, H * 0.3, true, 0.18, 11);
    const mid = ridge(W, H * 0.84, H * 0.1, false, 0.25, 23);
    const near = ridge(W, H * 0.95, H * 0.07, false, 0.3, 37);
    let peak = far[0];
    far.forEach(p => { if (p[1] < peak[1]) peak = p; });
    // the beacon keeps its old size and place; the tower itself stays in scale with the mountain,
    // which narrows on tall screens (there it would otherwise peek over the board like a hut on the frame)
    const s = H * 0.06, ts = s * G.clamp(W / H / 1.4, 0.45, 1);
    const tower = { x: peak[0], y: peak[1], s, ts, tipY: peak[1] - ts * 2.9 };
    // the lookout stands on a levelled summit, not astride a needle of rock
    far.forEach(p => { const w = G.clamp(1 - (Math.abs(p[0] - peak[0]) - ts * 0.7) / (ts * 0.9), 0, 1); p[1] += (peak[1] - p[1]) * w * w; });
    const ridges = [far, mid, near];
    const pines = ridges.map((pts, k) => plant(pts, k, W, H, k === 0 ? tower : null));
    // two hunting cabins on the middle slopes, out in the margins beside the board
    const rc = mulberry(77), cabins = [0.1, 0.76].map(u => {
      const cx = W * (u + (rc() - 0.5) * 0.04), c = H * 0.018;
      return { x: cx, y: yAt(mid, cx) + c * 0.9, c, flip: rc() < 0.5 };
    });
    const cw = colW(), cy = capY(), posts = [];
    if (hasPosts()) {
      [[W * 0.008, 1], [W - W * 0.008 - cw, -1]].forEach(([x0, dir], i) => {
        const st = cy + cw * 0.44, ay = st + cw * 0.5;
        const ax1 = (dir > 0 ? x0 + cw : x0) + dir * cw * 0.68;
        posts.push({ x: x0, y: cy, w: cw, dir, seed: 300 + i * 17, st, ay, ax1,
          hook: { x: ax1 - dir * cw * 0.05, y: ay + cw * 0.13 }, shaft: { x: x0, y: st, w: cw, h: H - st } });
      });
    }
    return { ridges, pines, tower, cabins, posts, cw };
  }

  // pines along a crest: seeded groves, spaced in pixels, so a layout always grows the same forest
  function plant(pts, k, W, H, tower) {
    const r = mulberry(501 + k * 97), out = [];
    const h0 = H * [0.016, 0.026, 0.04][k], hv = H * [0.014, 0.022, 0.035][k];
    const ph1 = r() * 6.3, ph2 = r() * 6.3;
    let px = -h0 * r();
    while (px < W + h0) {
      const u = px / W, dens = 0.45 + 0.35 * Math.sin(u * 8.2 + ph1) + 0.25 * Math.sin(u * 19.7 + ph2);
      // fixed draws per step keep the forest stable whatever gets skipped
      const take = r(), hr = r(), wr = r(), lr = r(), tr = r(), sr = r();
      if (take < dens * dens * 1.4 && !(tower && Math.abs(px - tower.x) < tower.ts * 1.6)) {
        const h = (h0 + hv * hr) * (0.75 + 0.35 * G.clamp(dens, 0, 1));
        out.push({ x: px, y: yAt(pts, px) + h * 0.14, h, w: h * (0.3 + wr * 0.1), lean: (lr - 0.5) * 0.08, tiers: 4 + (tr * 3 | 0), seed: (sr * 1e9) | 0 });
      }
      px += h0 * (0.32 + r() * 0.5);
    }
    return out.sort((a, b) => a.y - b.y);     // higher roots first: nearer trees overlap them
  }

  // ---------------- painting one mood ----------------
  function paint(mi, W, H) {
    const M = MOODS[mi], o = G.offscreen(W, H), x = o.x, r = mulberry(1234);
    // sky
    const g = x.createLinearGradient(0, 0, 0, H);
    M.sky.forEach((c, i) => g.addColorStop([0, 0.3, 0.55, 0.74, 0.86][i], c));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // nebula wisps
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const cx = r() * W, cy = r() * H * 0.5, rr = (0.25 + r() * 0.35) * Math.max(W, H);
      const ng = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      ng.addColorStop(0, FX.hexA(M.nebula[i % 3], 0.12)); ng.addColorStop(1, FX.hexA(M.nebula[i % 3], 0));
      x.fillStyle = ng; x.beginPath(); x.ellipse(cx, cy, rr, rr * 0.45, r() * 3, 0, 7); x.fill();
    }
    // sun glow behind the summit
    const sx = W / 2, sy = H * 0.6;
    const sg = x.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.6);
    sg.addColorStop(0, M.sun + '.55)'); sg.addColorStop(0.25, M.sun + '.22)'); sg.addColorStop(1, M.sun + '0)');
    x.fillStyle = sg; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over';

    // mountains: far (with the summit lookout), mid (with the cabins), near
    const [far, mid, near] = geo.ridges;
    const haze = (y0, a) => { const hg = x.createLinearGradient(0, y0 - H * 0.25, 0, y0 + H * 0.1); hg.addColorStop(0, FX.hexA(M.sky[3], 0)); hg.addColorStop(1, FX.hexA(M.sky[3], a)); x.fillStyle = hg; x.fillRect(0, y0 - H * 0.25, W, H * 0.35); };
    // the beacon in two passes that add up to its old strength in the sky: most of it behind the
    // ridge, so the summit stands dark against it, a little spilling over the rock
    drawBeacon(x, geo.tower, M, 0.6);
    drawRidge(x, 0, far, W, H, M);
    drawBeacon(x, geo.tower, M, 0.4);
    drawTower(x, geo.tower, far, M);
    haze(H * 0.8, 0.35);
    drawRidge(x, 1, mid, W, H, M);
    geo.cabins.forEach(c => drawCabin(x, c, M));
    haze(H * 0.9, 0.25);
    drawRidge(x, 2, near, W, H, M);

    // carved lodge posts at the edges
    geo.posts.forEach(p => drawPost(x, p, H, M));

    // vignette
    const vg = x.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
    dither(x, o.c);
    return o.c;
  }

  // ---------------- dither grain ----------------
  // 8-bit gradients band on dark skies; a fixed triangular noise of 0..9 levels (3.5% peak
  // to peak) breaks the steps up. Baked once, in device pixels, never animated.
  let grain = null;
  function grainTile() {
    if (grain) return grain;
    const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'), id = x.createImageData(s, s), d = id.data, r = mulberry(4242);
    for (let i = 0; i < d.length; i += 4) { const v = Math.round((r() + r()) * 4.5); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(id, 0, 0);
    return (grain = c);
  }
  function dither(x, c) {
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'difference';
    if (x.globalCompositeOperation !== 'difference') { x.restore(); return; }   // no blend modes: skip rather than brighten
    // add 0..9 levels, then take 4 back off: the mean moves half a level, so the palette does not lift
    x.globalCompositeOperation = 'lighter';
    x.fillStyle = x.createPattern(grainTile(), 'repeat'); x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'difference';
    x.fillStyle = 'rgb(4,4,4)'; x.fillRect(0, 0, c.width, c.height);
    x.restore();
  }

  // ---------------- ridges ----------------
  // closed ridge shape, optionally shifted; it runs past both screen edges so a
  // shifted copy still covers the corners
  function ridgePath(x, pts, W, H, dx, dy) {
    const e = Math.abs(dx) + 4, b = H + e + Math.abs(dy);
    x.moveTo(-e, b); x.lineTo(-e, pts[0][1] + dy);
    for (const p of pts) x.lineTo(p[0] + dx, p[1] + dy);
    x.lineTo(W + e, pts[pts.length - 1][1] + dy); x.lineTo(W + e, b); x.closePath();
  }

  function drawRidge(x, k, pts, W, H, M) {
    const body = M.m[k], dpr = layerDpr;
    // pines stand just behind the crest, rim-lit on the side facing the key light
    const pineBody = mix(body, M.shade, 0.2 + k * 0.08), pineRim = FX.hexA(M.lit, [0.4, 0.5, 0.6][k]);
    for (const p of geo.pines[k]) {
      const fine = p.h * dpr >= 22, o = G.clamp(p.h * 0.05, 0.6, 2);
      x.beginPath(); pinePath(x, p, 0, 0, fine); x.fillStyle = pineRim; x.fill();
      x.beginPath(); pinePath(x, p, -KEY.x * o, -KEY.y * o, fine); x.fillStyle = pineBody; x.fill();
    }
    let top = H;
    pts.forEach(p => { if (p[1] < top) top = p[1]; });
    const g = x.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, body); g.addColorStop(1, mix(body, M.shade, 0.5));
    x.beginPath(); ridgePath(x, pts, W, H, 0, 0); x.fillStyle = g; x.fill();

    x.save();
    x.beginPath(); ridgePath(x, pts, W, H, 0, 0); x.clip();
    // slopes turned to the key light catch a soft band under the crest (the crest
    // minus a copy of itself shifted away from the light), slopes turned away fall into shade
    const D = H * [0.032, 0.028, 0.026][k];
    const steps = G.Q.level > 0 ? 9 : 5;
    x.fillStyle = FX.hexA(M.lit, [0.22, 0.28, 0.32][k] / steps);
    for (let i = 1; i <= steps; i++) {
      const d = D * Math.pow(i / steps, 1.4);
      x.beginPath(); ridgePath(x, pts, W, H, 0, 0); ridgePath(x, pts, W, H, -KEY.x * d, -KEY.y * d); x.fill('evenodd');
    }
    x.fillStyle = FX.hexA(M.shade, 0.27 / steps);
    for (let i = 1; i <= steps; i++) {
      const d = D * 1.3 * Math.pow(i / steps, 1.2);
      x.beginPath(); ridgePath(x, pts, W, H, 0, 0); ridgePath(x, pts, W, H, -d, d * 0.3); x.fill('evenodd');
    }
    strata(x, pts, k, W, H, M, top);
    x.restore();

    // crest rim: back-lit by the sky, brighter where the slope faces the key light
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.globalAlpha = [1, 0.45, 0.35][k]; x.lineWidth = [1.5, 1.2, 1.2][k]; x.strokeStyle = M.rim;
    x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.stroke();
    x.globalAlpha = 1; x.lineWidth = [1.1, 1.3, 1.5][k];
    // runs of equal brightness share one path (no beads where segments meet)
    let run = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const lit = Math.max(0, (dy * KEY.x - dx * KEY.y) / len);
      const q = Math.round(Math.pow(lit, 3) * [0.6, 0.65, 0.65][k] * 14);
      if (q !== run) {
        if (run > 0) x.stroke();
        run = q;
        if (q > 0) { x.strokeStyle = FX.hexA(M.lit, q / 14); x.beginPath(); x.moveTo(a[0], a[1]); }
      }
      if (q > 0) x.lineTo(b[0], b[1]);
    }
    if (run > 0) x.stroke();
  }

  // rock bedding: ledges that follow the crest near the top and flatten with depth,
  // each a lit lip over its own shadow, alternate beds a shade darker
  function strata(x, pts, k, W, H, M, top) {
    const r = mulberry(900 + k * 31), n = [6, 4, 3][k], depth = (H - top) * 0.6;
    const dip = (r() - 0.5) * 0.08, base = top + depth * 0.4, lines = [];
    for (let i = 1; i <= n; i++) {
      const f = i / (n + 1), off = depth * Math.pow(f, 1.2) * 0.7, flat = Math.min(0.85, f * 1.1);
      const ph = r() * 6.3, amp = H * 0.003 * (1 + r()), fr = 10 + r() * 14;
      lines.push(pts.map(p => [p[0], p[1] + (base - p[1]) * flat + off + (p[0] - W / 2) * dip + Math.sin(p[0] / W * fr + ph) * amp]));
    }
    x.fillStyle = FX.hexA(M.shade, 0.07);
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const a = lines[i], b = lines[i + 1];
      x.beginPath(); a.forEach((p, j) => j ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]));
      for (let j = b.length - 1; j >= 0; j--) x.lineTo(b[j][0], b[j][1]);
      x.closePath(); x.fill();
    }
    // each ledge comes and goes along the ridge, as outcrops do
    const fade = (col, a) => {
      const g = x.createLinearGradient(0, 0, W, 0);
      for (let j = 0; j <= 6; j++) g.addColorStop(j / 6, FX.hexA(col, a * Math.pow(r(), 0.7)));
      return g;
    };
    lines.forEach((line, i) => {
      const f = (i + 1) / (n + 1);
      const path = dy => { x.beginPath(); line.forEach((p, j) => j ? x.lineTo(p[0], p[1] + dy) : x.moveTo(p[0], p[1] + dy)); };
      path(1.1); x.strokeStyle = fade(M.shade, 0.3); x.lineWidth = 1.4; x.stroke();
      path(0); x.strokeStyle = fade(M.lit, 0.12 * (1 - f * 0.5)); x.lineWidth = 0.9; x.stroke();
    });
  }

  // a pine: trunk plus overlapping drooping tiers; ragged boughs when there are pixels for them
  function pinePath(x, p, ox, oy, fine) {
    const h = p.h, bx = p.x + ox, by = p.y + oy, n = p.tiers;
    const X = (dx, up) => bx + dx + p.lean * up;            // the wind leans the crown
    const tw = Math.max(0.5, h * 0.035);
    x.moveTo(X(-tw, 0), by); x.lineTo(X(-tw, h * 0.3), by - h * 0.3); x.lineTo(X(tw, h * 0.3), by - h * 0.3); x.lineTo(X(tw, 0), by); x.closePath();
    for (let i = 0; i < n; i++) {
      const ub = h * (0.16 + 0.74 * i / n), ut = h * (0.16 + 0.84 * Math.min(1, (i + 1.6) / n));
      const yb = by - ub, yt = by - ut, droop = h * 0.035;
      const hw = p.w * (1 - 0.78 * i / n) * (0.9 + 0.2 * ((p.seed >> i) & 1));
      const y5 = yt + (yb + droop - yt) * 0.5, um = (ub + ut) / 2;
      x.moveTo(X(0, ut), yt);
      if (fine) { x.lineTo(X(hw * 0.5, um), y5); x.lineTo(X(hw * 0.36, um), y5 + h * 0.022); }
      x.lineTo(X(hw, ub), yb + droop);
      x.lineTo(X(hw * 0.35, ub), yb - h * 0.025);
      x.lineTo(X(-hw * 0.35, ub), yb - h * 0.025);
      x.lineTo(X(-hw, ub), yb + droop);
      if (fine) { x.lineTo(X(-hw * 0.36, um), y5 + h * 0.022); x.lineTo(X(-hw * 0.5, um), y5); }
      x.closePath();
    }
  }

  // ---------------- the lookout on the summit ----------------
  // the beacon: same beam and glow as ever, so the storm still rises from the summit
  function drawBeacon(x, T, M, k) {
    const px = T.x, py = T.y, s = T.s;
    x.save();
    x.globalCompositeOperation = 'lighter';
    const bg = x.createLinearGradient(px, py - s * 6, px, py);
    bg.addColorStop(0, FX.hexA(M.beacon, 0)); bg.addColorStop(1, FX.hexA(M.beacon, 0.35 * k));
    x.fillStyle = bg; x.beginPath(); x.moveTo(px - s * 0.25, py - s * 6); x.lineTo(px + s * 0.25, py - s * 6); x.lineTo(px + s * 0.7, py); x.lineTo(px - s * 0.7, py); x.fill();
    const gl = x.createRadialGradient(px, py - s * 0.4, 0, px, py - s * 0.4, s * 2.4);
    gl.addColorStop(0, FX.hexA(M.beacon, 0.75 * k)); gl.addColorStop(1, FX.hexA(M.beacon, 0));
    x.fillStyle = gl; x.beginPath(); x.arc(px, py - s * 0.4, s * 2.4, 0, 7); x.fill();
    x.restore();
  }

  function drawTower(x, T, far, M) {
    const px = T.x, py = T.y, s = T.ts;
    // timber-and-iron fire lookout: splayed legs, braced bays, a catwalk, a cabin and the rod
    const gL = yAt(far, px - s * 0.56) + s * 0.05, gR = yAt(far, px + s * 0.56) + s * 0.05;
    const fl = py - s * 1.28, ct = fl - s * 0.46, ap = ct - s * 0.3, tip = T.tipY;
    const lw = Math.max(1, s * 0.05), bw = Math.max(0.6, s * 0.02), o = Math.max(0.5, s * 0.014);
    const legX = (sd, f) => px + sd * s * (0.56 - 0.28 * f);
    const legY = (sd, f) => { const g0 = sd < 0 ? gL : gR; return g0 + (fl - g0) * f; };
    const parts = (ox, oy, col) => {
      x.save(); x.translate(ox, oy);
      x.strokeStyle = x.fillStyle = col; x.lineCap = 'round'; x.lineJoin = 'round';
      // back legs, thinner, for depth
      x.lineWidth = lw * 0.7; x.beginPath();
      [-1, 1].forEach(sd => { x.moveTo(px + sd * s * 0.3, (sd < 0 ? gL : gR) - s * 0.06); x.lineTo(px + sd * s * 0.15, fl); });
      x.stroke();
      x.lineWidth = lw; x.beginPath();
      [-1, 1].forEach(sd => { x.moveTo(legX(sd, 0), legY(sd, 0)); x.lineTo(legX(sd, 1), legY(sd, 1)); });
      x.stroke();
      // iron tie rods: X braces in three bays, struts between them
      const fs = [0, 0.38, 0.7, 1];
      x.lineWidth = bw; x.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = fs[i], b = fs[i + 1];
        x.moveTo(legX(-1, a), legY(-1, a)); x.lineTo(legX(1, b), legY(1, b));
        x.moveTo(legX(1, a), legY(1, a)); x.lineTo(legX(-1, b), legY(-1, b));
        if (i) { x.moveTo(legX(-1, a), legY(-1, a)); x.lineTo(legX(1, a), legY(1, a)); }
      }
      // catwalk railing
      x.moveTo(px - s * 0.5, fl - s * 0.2); x.lineTo(px + s * 0.5, fl - s * 0.2);
      for (let i = 0; i <= 4; i++) { const rx = px - s * 0.5 + i * s * 0.25; x.moveTo(rx, fl - s * 0.2); x.lineTo(rx, fl); }
      x.stroke();
      x.fillRect(px - s * 0.52, fl - s * 0.03, s * 1.04, Math.max(1, s * 0.06));
      // cabin and its hipped roof
      x.fillRect(px - s * 0.34, ct, s * 0.68, fl - ct);
      x.beginPath(); x.moveTo(px - s * 0.47, ct + s * 0.03); x.lineTo(px - s * 0.08, ap + s * 0.02);
      x.lineTo(px + s * 0.08, ap + s * 0.02); x.lineTo(px + s * 0.47, ct + s * 0.03); x.closePath(); x.fill();
      // the lightning rod: a tapered spike on a glass insulator, a storm ball and the hunter's pennant
      const rw = Math.max(0.8, s * 0.03);
      x.beginPath(); x.moveTo(px - rw / 2, ap + s * 0.02); x.lineTo(px - rw * 0.15, tip + s * 0.08); x.lineTo(px, tip);
      x.lineTo(px + rw * 0.15, tip + s * 0.08); x.lineTo(px + rw / 2, ap + s * 0.02); x.closePath(); x.fill();
      x.beginPath(); x.ellipse(px, ap - s * 0.05, Math.max(0.9, s * 0.055), Math.max(0.7, s * 0.04), 0, 0, 7); x.fill();
      x.beginPath(); x.arc(px, tip + (ap - tip) * 0.3, Math.max(0.8, s * 0.042), 0, 7); x.fill();
      x.beginPath(); x.moveTo(px, ap - s * 0.42); x.quadraticCurveTo(px + s * 0.14, ap - s * 0.4, px + s * 0.26, ap - s * 0.36);
      x.quadraticCurveTo(px + s * 0.12, ap - s * 0.33, px, ap - s * 0.3); x.fill();
      // down conductor to the rock
      x.lineWidth = Math.max(0.5, s * 0.012); x.beginPath();
      x.moveTo(px + s * 0.05, ap + s * 0.06); x.quadraticCurveTo(px + s * 0.66, (ct + gR) / 2, px + s * 0.68, gR + s * 0.02); x.stroke();
      x.restore();
    };
    parts(0, 0, FX.hexA(M.towerLit, 0.7));               // key-light rim on the upper-left edges
    parts(-KEY.x * o, -KEY.y * o, M.tower);               // the body, shifted away from the light
    // the lookout's lamp-lit windows: warm panes, brightest low where the lamp sits, a mullion each
    const ww = s * 0.15, wh = s * 0.16, wy = ct + s * 0.11 - KEY.y * o;
    const wgr = x.createLinearGradient(0, wy, 0, wy + wh);
    wgr.addColorStop(0, mix(M.window, M.tower, 0.35)); wgr.addColorStop(1, M.window);
    x.fillStyle = wgr;
    for (let i = -1; i <= 1; i++) x.fillRect(px + i * s * 0.205 - ww / 2 - KEY.x * o, wy, ww, wh);
    if (s * layerDpr >= 40) {
      x.fillStyle = M.tower;
      for (let i = -1; i <= 1; i++) x.fillRect(px + i * s * 0.205 - KEY.x * o - s * 0.008, wy, s * 0.016, wh);
      x.fillRect(px - s * 0.3 - KEY.x * o, wy + wh * 0.45, s * 0.6, s * 0.014);
    }
    x.save(); x.globalCompositeOperation = 'lighter';
    const wg = x.createRadialGradient(px, wy + wh / 2, 0, px, wy + wh / 2, s * 0.7);
    wg.addColorStop(0, FX.hexA(M.window, 0.45)); wg.addColorStop(1, FX.hexA(M.window, 0));
    x.fillStyle = wg; x.fillRect(px - s * 0.7, wy + wh / 2 - s * 0.7, s * 1.4, s * 1.4);
    x.restore();
  }

  // a hunting cabin on the slope: one warm window
  function drawCabin(x, C, M) {
    if (C.c * layerDpr < 9) return;
    const c = C.c, cx = C.x, by = C.y, f = C.flip ? -1 : 1, body = mix(M.m[1], M.shade, 0.45);
    x.fillStyle = body;
    x.fillRect(cx - c * 0.7, by - c * 0.8, c * 1.4, c * 0.8);
    x.beginPath(); x.moveTo(cx - c * 0.85, by - c * 0.78); x.lineTo(cx, by - c * 1.35); x.lineTo(cx + c * 0.85, by - c * 0.78); x.closePath(); x.fill();
    x.fillRect(cx + f * c * 0.35, by - c * 1.45, c * 0.18, c * 0.45);       // chimney
    x.strokeStyle = FX.hexA(M.lit, 0.4); x.lineWidth = 0.7;
    x.beginPath(); x.moveTo(cx - c * 0.85, by - c * 0.78); x.lineTo(cx, by - c * 1.35); x.stroke();
    x.fillStyle = M.window; x.fillRect(cx - f * c * 0.3 - c * 0.13, by - c * 0.58, c * 0.26, c * 0.26);
    x.save(); x.globalCompositeOperation = 'lighter';
    const wx = cx - f * c * 0.3, wy = by - c * 0.45, gr = x.createRadialGradient(wx, wy, 0, wx, wy, c * 1.4);
    gr.addColorStop(0, FX.hexA(M.window, 0.35)); gr.addColorStop(1, FX.hexA(M.window, 0));
    x.fillStyle = gr; x.fillRect(wx - c * 1.4, wy - c * 1.4, c * 2.8, c * 2.8);
    x.restore();
  }

  // ---------------- lodge posts ----------------
  // a carved groove lit from the upper left: the far wall catches light, the near wall is in shade
  function engrave(x, path, lw, lit) {
    x.lineWidth = lw; x.lineJoin = 'round'; x.lineCap = 'round';
    x.save(); x.translate(-KEY.x * lw * 0.55, -KEY.y * lw * 0.55); path(); x.strokeStyle = lit; x.stroke(); x.restore();
    path(); x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke();
  }

  // a brass strap around the post: the ramp runs across it, brightest toward the key light
  function strap(x, x0, w, y, h, B, dpr) {
    const bx = x0 - w * 0.05, bw = w * 1.1;
    x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(x0, y + h, w, h * 0.3);          // contact shadow on the wood
    x.fillStyle = 'rgba(0,0,0,.14)'; x.fillRect(x0, y + h * 1.3, w, h * 0.35);
    const g = x.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, B[5]); g.addColorStop(0.07, B[3]); g.addColorStop(0.2, B[1]); g.addColorStop(0.3, B[0]);
    g.addColorStop(0.42, B[2]); g.addColorStop(0.75, B[3]); g.addColorStop(0.93, B[4]); g.addColorStop(1, B[5]);
    x.fillStyle = g; x.fillRect(bx, y, bw, h);
    const lip = Math.max(0.5, h * 0.13);
    x.fillStyle = FX.hexA(B[0], 0.5); x.fillRect(bx, y, bw, lip);                // rolled lip catches the light
    x.fillStyle = 'rgba(20,8,0,.5)'; x.fillRect(bx, y + h - lip, bw, lip);
    for (const f of [0.18, 0.5, 0.82]) {
      const rx = bx + bw * f, ry = y + h / 2, rr = Math.max(0.7, h * 0.17);
      x.fillStyle = 'rgba(30,12,0,.55)'; x.beginPath(); x.arc(rx + rr * 0.3, ry + rr * 0.4, rr, 0, 7); x.fill();
      const rg = x.createRadialGradient(rx - rr * 0.35, ry - rr * 0.45, 0, rx, ry, rr);
      rg.addColorStop(0, B[0]); rg.addColorStop(0.5, B[2]); rg.addColorStop(1, B[4]);
      x.fillStyle = rg; x.beginPath(); x.arc(rx, ry, rr, 0, 7); x.fill();
    }
    // hairline scratches only inside the highlight, and only where there are pixels for them
    if (h * dpr >= 14) {
      x.strokeStyle = 'rgba(255,250,225,.28)'; x.lineWidth = 0.5; x.beginPath();
      for (let i = 0; i < 3; i++) { const sx = bx + bw * (0.24 + i * 0.05), sy = y + h * (0.25 + i * 0.18); x.moveTo(sx, sy); x.lineTo(sx + bw * 0.06, sy + h * 0.12); }
      x.stroke();
    }
  }

  function drawPost(x, P, H, M) {
    const x0 = P.x, w = P.w, top = P.y, st = P.st, dir = P.dir, r = mulberry(P.seed), B = M.brass, Wd = M.wood, dpr = layerDpr;
    x.save();
    // shaft: squared timber with chamfered edges, lit from the left on both sides of the screen (one light)
    const g = x.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, Wd[0]); g.addColorStop(0.04, Wd[1]); g.addColorStop(0.12, mix(Wd[1], Wd[2], 0.3)); g.addColorStop(0.14, Wd[2]);
    g.addColorStop(0.55, mix(Wd[2], Wd[3], 0.45)); g.addColorStop(0.85, Wd[3]); g.addColorStop(0.87, mix(Wd[3], Wd[0], 0.6)); g.addColorStop(1, Wd[0]);
    x.fillStyle = g; x.fillRect(x0, st, w, H - st);
    x.save(); x.beginPath(); x.rect(x0, st, w, H - st); x.clip();
    // grain: fibres running the length of the post, a few catching the light
    const fib = Math.max(8, Math.round(w / 3));
    for (let i = 0; i < fib; i++) {
      const fx = x0 + w * (0.03 + 0.94 * r()), amp = w * (0.006 + r() * 0.02), fr = 0.004 + r() * 0.012, ph = r() * 6.3;
      x.beginPath();
      for (let y = st; y <= H + 10; y += 10) { const xx = fx + Math.sin(y * fr + ph) * amp; y === st ? x.moveTo(xx, y) : x.lineTo(xx, y); }
      x.strokeStyle = r() < 0.72 ? `rgba(0,0,0,${(0.12 + r() * 0.16).toFixed(3)})` : FX.hexA(Wd[1], 0.08 + r() * 0.1);
      x.lineWidth = 0.5 + r() * 0.8; x.stroke();
    }
    // knots, with the grain's rings around them
    for (let i = 0; i < 2; i++) {
      const kx = x0 + w * (0.3 + r() * 0.42), ky = st + (H - st) * (0.3 + r() * 0.6), kr = w * (0.04 + r() * 0.04);
      x.fillStyle = 'rgba(0,0,0,.38)'; x.beginPath(); x.ellipse(kx, ky, kr, kr * 1.7, 0, 0, 7); x.fill();
      x.strokeStyle = FX.hexA(Wd[1], 0.2); x.lineWidth = 0.7;
      x.beginPath(); x.ellipse(kx, ky, kr * 1.7, kr * 3, 0, 0, 7); x.stroke();
    }
    // weather checks: dry cracks along the grain
    for (let i = 0; i < 3; i++) {
      const cx = x0 + w * (0.25 + r() * 0.5), cy = st + (H - st) * r(), cl = (H - st) * (0.05 + r() * 0.1), j = [];
      for (let q = 0; q <= 6; q++) j.push([cx + (r() - 0.5) * w * 0.03, cy + cl * q / 6]);
      engrave(x, () => { x.beginPath(); j.forEach((p, q) => q ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); }, 0.9, FX.hexA(Wd[1], 0.25));
    }
    // shade toward the floor
    const sh = x.createLinearGradient(0, H * 0.55, 0, H);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.6)');
    x.fillStyle = sh; x.fillRect(x0, H * 0.55, w, H * 0.45);
    x.restore();

    // carving: storm chevrons under the collar, the hunter's bolt lower down
    const bh = Math.max(3, w * 0.2), y1 = st + w * 0.14, y2 = top + (H - top) * 0.42, y3 = top + (H - top) * 0.72;
    const cl = FX.hexA(Wd[1], 0.4), cw = Math.max(0.8, w * 0.045);
    for (let cy = y1 + bh + w * 0.35; cy < y2 - w * 0.5; cy += w * 0.42) {
      engrave(x, () => { x.beginPath(); x.moveTo(x0 + w * 0.22, cy); x.lineTo(x0 + w * 0.5, cy + w * 0.2); x.lineTo(x0 + w * 0.78, cy); }, cw, cl);
    }
    const by0 = y2 + bh + w * 0.5, bl = Math.min(y3 - w * 0.5 - by0, w * 2.6);
    if (bl > w * 0.8) {
      const pts = [[0.62, 0], [0.34, 0.48], [0.56, 0.48], [0.38, 1]];
      engrave(x, () => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(x0 + w * p[0], by0 + bl * p[1]) : x.moveTo(x0 + w * p[0], by0 + bl * p[1])); }, cw * 1.2, cl);
    }
    // brass straps
    strap(x, x0, w, y1, bh, B, dpr);
    strap(x, x0, w, y2, bh, B, dpr);
    strap(x, x0, w, y3, bh, B, dpr);

    // cap block, wider than the shaft, with a brass hip roof and a finial
    const kx = x0 - w * 0.12, kw = w * 1.24, ky = top + w * 0.16, kh = w * 0.28;
    x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(x0, ky + kh, w, w * 0.12);
    const cg = x.createLinearGradient(kx, 0, kx + kw, 0);
    cg.addColorStop(0, Wd[0]); cg.addColorStop(0.05, Wd[1]); cg.addColorStop(0.2, Wd[2]); cg.addColorStop(0.85, Wd[3]); cg.addColorStop(1, Wd[0]);
    x.fillStyle = cg; x.fillRect(kx, ky, kw, kh);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(kx, ky + kh - Math.max(0.6, kh * 0.14), kw, Math.max(0.6, kh * 0.14));
    const ax = x0 + w / 2, at = top - w * 0.07;
    x.fillStyle = B[1]; x.beginPath(); x.moveTo(kx - w * 0.04, ky + 0.5); x.lineTo(ax, at); x.lineTo(ax, ky + 0.5); x.closePath(); x.fill();
    x.fillStyle = B[4]; x.beginPath(); x.moveTo(ax, at); x.lineTo(kx + kw + w * 0.04, ky + 0.5); x.lineTo(ax, ky + 0.5); x.closePath(); x.fill();
    x.strokeStyle = FX.hexA(B[0], 0.7); x.lineWidth = Math.max(0.6, w * 0.02); x.beginPath(); x.moveTo(kx - w * 0.04, ky + 0.5); x.lineTo(ax, at); x.stroke();
    const fr = w * 0.085, fg = x.createRadialGradient(ax - fr * 0.35, at - fr * 1.25, 0, ax, at - fr, fr);
    fg.addColorStop(0, B[0]); fg.addColorStop(0.5, B[2]); fg.addColorStop(1, B[4]);
    x.fillStyle = fg; x.beginPath(); x.arc(ax, at - fr, fr, 0, 7); x.fill();

    // iron bracket with a knee brace and a scroll, the lantern hook at its end
    const ay = P.ay, a0 = dir > 0 ? x0 + w : x0, a1 = P.ax1, iw = Math.max(1.2, w * 0.06);
    x.lineCap = 'round'; x.lineJoin = 'round';
    const arm = () => {
      x.beginPath(); x.moveTo(a0, ay); x.lineTo(a1, ay);
      x.moveTo(a0, ay + w * 0.42); x.quadraticCurveTo(a0 + dir * w * 0.1, ay + w * 0.06, a0 + dir * w * 0.44, ay);
      x.moveTo(a1, ay); x.quadraticCurveTo(a1 + dir * w * 0.09, ay - w * 0.02, a1 + dir * w * 0.05, ay - w * 0.1);
      x.quadraticCurveTo(a1, ay - w * 0.14, a1 - dir * w * 0.03, ay - w * 0.08);
    };
    x.save(); x.translate(KEY.x * 0.8, KEY.y * 0.8); x.strokeStyle = FX.hexA(M.ironLit, 0.55); x.lineWidth = iw; arm(); x.stroke(); x.restore();
    x.strokeStyle = M.iron; x.lineWidth = iw; arm(); x.stroke();
    x.fillStyle = B[3]; x.fillRect(a0 - w * 0.04, ay - w * 0.1, w * 0.08, w * 0.58);   // mounting plate
    x.lineWidth = Math.max(0.8, w * 0.03); x.beginPath(); x.moveTo(P.hook.x, ay); x.lineTo(P.hook.x, P.hook.y); x.stroke();

    // the lantern's warm light on the post (its flicker is drawn live): on the cap and the shaft
    // only, never on the sky beside them (two plain rect clips, cheap to bake)
    x.globalCompositeOperation = 'lighter';
    const lx = P.hook.x, ly = P.hook.y + w * 0.55, lr = w * 1.6;
    const lg = x.createRadialGradient(lx, ly, 0, lx, ly, lr);
    lg.addColorStop(0, 'rgba(255,150,60,.42)'); lg.addColorStop(1, 'rgba(255,150,60,0)');
    x.fillStyle = lg;
    [[kx, ky, kw, kh], [x0, st, w, Math.min(H - st, ly + lr - st)]].forEach(([rx, ry, rw, rh]) => {
      x.save(); x.beginPath(); x.rect(rx, ry, rw, rh); x.clip(); x.fillRect(lx - lr, ly - lr, lr * 2, lr * 2); x.restore();
    });
    x.restore();
  }

  // the storm lantern: brass cap and fount, a warm glass globe in a wire guard (one sprite, it sways live)
  function paintLantern(w) {
    const Lw = w * 0.62, Lh = w * 1.08, o = G.offscreen(Lw, Lh), x = o.x, cx = Lw / 2, B = GOLD;
    const gy0 = Lh * 0.25, gy1 = Lh * 0.76, hwAt = y => Lw * (0.29 + 0.09 * Math.sin(Math.PI * G.clamp((y - gy0) / (gy1 - gy0), 0, 1)));
    const lw = Math.max(0.6, Lw * 0.035);
    x.lineCap = 'round'; x.lineJoin = 'round';
    // hook ring and bail
    x.strokeStyle = '#1a1010'; x.lineWidth = lw * 1.2;
    x.beginPath(); x.arc(cx, Lh * 0.05, Lw * 0.06, 0, 7); x.stroke();
    x.beginPath(); x.moveTo(cx - Lw * 0.3, Lh * 0.22); x.quadraticCurveTo(cx, -Lh * 0.02, cx + Lw * 0.3, Lh * 0.22); x.stroke();
    // glass globe, lit from within
    const gg = x.createRadialGradient(cx, Lh * 0.54, 0, cx, Lh * 0.52, Lw * 0.48);
    gg.addColorStop(0, '#fff3c4'); gg.addColorStop(0.3, '#ffbe55'); gg.addColorStop(0.7, '#d9651c'); gg.addColorStop(1, '#6a2808');
    x.fillStyle = gg; x.beginPath();
    for (let y = gy0; y <= gy1; y += (gy1 - gy0) / 12) x.lineTo(cx + hwAt(y), y);
    for (let y = gy1; y >= gy0; y -= (gy1 - gy0) / 12) x.lineTo(cx - hwAt(y), y);
    x.closePath(); x.fill();
    // flame
    x.fillStyle = '#fffbe6'; x.beginPath();
    x.moveTo(cx, Lh * 0.45); x.quadraticCurveTo(cx + Lw * 0.07, Lh * 0.56, cx, Lh * 0.6); x.quadraticCurveTo(cx - Lw * 0.07, Lh * 0.56, cx, Lh * 0.45); x.fill();
    // glass highlight toward the key light
    x.fillStyle = 'rgba(255,255,255,.45)'; x.beginPath(); x.ellipse(cx - Lw * 0.2, Lh * 0.44, Lw * 0.035, Lh * 0.1, 0.12, 0, 7); x.fill();
    // wire guard
    x.strokeStyle = 'rgba(30,14,6,.85)'; x.lineWidth = lw;
    x.beginPath();
    for (const f of [-0.72, -0.26, 0.26, 0.72]) { for (let y = gy0; y <= gy1 + 0.1; y += (gy1 - gy0) / 8) y === gy0 ? x.moveTo(cx + f * hwAt(y), y) : x.lineTo(cx + f * hwAt(y), y); }
    const ym = (gy0 + gy1) / 2; x.moveTo(cx - hwAt(ym), ym); x.lineTo(cx + hwAt(ym), ym);
    x.stroke();
    // brass cap and fount: one ramp across, lit from the left
    const brass = inset => {
      const g = x.createLinearGradient(inset, 0, Lw - inset, 0);
      g.addColorStop(0, B[4]); g.addColorStop(0.22, B[0]); g.addColorStop(0.4, B[2]); g.addColorStop(0.8, B[3]); g.addColorStop(1, B[5]);
      return g;
    };
    x.fillStyle = brass(Lw * 0.14); x.beginPath();
    x.moveTo(cx - Lw * 0.36, gy0 + 0.5); x.lineTo(cx - Lw * 0.16, Lh * 0.13); x.lineTo(cx + Lw * 0.16, Lh * 0.13); x.lineTo(cx + Lw * 0.36, gy0 + 0.5); x.closePath(); x.fill();
    x.fillRect(cx - Lw * 0.09, Lh * 0.09, Lw * 0.18, Lh * 0.05);
    x.fillStyle = brass(Lw * 0.06);
    G.roundRect(x, cx - Lw * 0.4, gy1 - 0.5, Lw * 0.8, Lh * 0.15, Lh * 0.04); x.fill();
    x.fillStyle = 'rgba(40,16,0,.5)'; x.fillRect(cx - Lw * 0.4, gy1 + Lh * 0.12, Lw * 0.8, Math.max(0.5, Lh * 0.02));
    x.fillStyle = FX.hexA(B[0], 0.6); x.fillRect(cx - Lw * 0.38, gy1, Lw * 0.76, Math.max(0.5, Lh * 0.015));
    x.fillStyle = B[3]; x.beginPath(); x.arc(cx, Lh * 0.95, Lw * 0.07, 0, 7); x.fill();
    return { c: o.c, w: Lw, h: Lh, hookY: Lh * 0.05, flameY: Lh * 0.54 };
  }

  // ---------------- lightning rim mask ----------------
  // the crests and pine tops, top-lit, in one alpha mask: a strike adds it for a moment
  function paintRimMask(W, H) {
    let top = H;
    geo.ridges.forEach((pts, k) => {
      pts.forEach(p => { if (p[1] < top) top = p[1]; });
      geo.pines[k].forEach(p => { if (p.y - p.h < top) top = p.y - p.h; });
    });
    rimTop = Math.max(0, Math.floor(top - 4));
    const o = G.offscreen(W, H - rimTop, 1), x = o.x;
    x.translate(0, -rimTop);
    const white = a => `rgba(240,242,255,${a})`;
    geo.ridges.forEach((pts, k) => {
      const a = [0.45, 0.6, 0.72][k], ro = [1.2, 1.5, 1.8][k];
      for (const p of geo.pines[k]) {
        const oo = G.clamp(p.h * 0.08, 0.8, 2.5);
        x.globalCompositeOperation = 'destination-out'; x.beginPath(); pinePath(x, p, 0, 0, false); x.fill();
        x.globalCompositeOperation = 'source-over'; x.fillStyle = white(a); x.beginPath(); pinePath(x, p, 0, 0, false); x.fill();
        x.globalCompositeOperation = 'destination-out'; x.beginPath(); pinePath(x, p, 0, oo, false); x.fill();
      }
      x.globalCompositeOperation = 'destination-out'; x.beginPath(); ridgePath(x, pts, W, H, 0, 0); x.fill();
      x.globalCompositeOperation = 'source-over'; x.fillStyle = white(a); x.beginPath(); ridgePath(x, pts, W, H, 0, 0); x.fill();
      x.globalCompositeOperation = 'destination-out'; x.beginPath(); ridgePath(x, pts, W, H, 0, ro); x.fill();
    });
    // the lodge posts stand in front of the ridges
    x.globalCompositeOperation = 'destination-out';
    geo.posts.forEach(p => x.fillRect(p.x - p.w * 0.16, rimTop, p.w * 1.32, H));
    x.globalCompositeOperation = 'source-over';
    return o.c;
  }

  // the sky flash as a tiny vertical ramp stretched over the screen: it fades out low over the
  // ridges instead of stopping at a hard edge, with no per-frame gradient
  function paintFlashRamp(rgb) {
    const o = G.offscreen(2, 128, 1), x = o.x;
    for (let i = 0; i < 128; i++) {
      const t = (i + 0.5) / 128, a = G.clamp(1 - (t - 0.7) / 0.25, 0, 1);      // full to 0.7H, smooth fade by 0.95H
      x.fillStyle = `rgba(${rgb},${(a * a * (3 - 2 * a)).toFixed(3)})`; x.fillRect(0, i, 2, 1);
    }
    return o.c;
  }

  // baked at 0.35 scale and upscaled when drawn: the fan is soft anyway, and it was the biggest cache
  function paintRays(size) {
    const o = G.offscreen(size, size, 0.35), x = o.x, m = size / 2, n = 14;
    x.translate(m, m);
    for (let i = 0; i < n; i++) {
      x.rotate((Math.PI * 2) / n);
      const g = x.createLinearGradient(0, 0, 0, m);
      g.addColorStop(0, 'rgba(255,240,200,.9)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.lineTo(-m * 0.07, m); x.lineTo(m * 0.07, m); x.fill();
    }
    return o.c;
  }

  function paintCloud(v, color) {
    const r = mulberry(100 + v), o = G.offscreen(360, 150, 1), x = o.x;
    const puff = FX.softSprite(color);
    for (let i = 0; i < 16; i++) {
      const px = 50 + r() * 260, py = 80 + (r() - 0.5) * 50 * (1 - Math.abs(px - 180) / 180), s = 30 + r() * 45;
      x.globalAlpha = 0.45 + r() * 0.4; x.drawImage(puff, px - s, py - s, s * 2, s * 2);
    }
    return o.c;
  }

  // sky lightning — behind the board; free spins storms are far more frequent
  Scene.lightning = (strong) => {
    const W = G.W, H = G.H;
    let x1 = G.rand(W * 0.1, W * 0.9), x2 = x1 + G.rand(-W * 0.15, W * 0.15), y2 = H * G.rand(0.3, 0.55);
    const hit = rod && Math.random() < (strong ? 0.35 : 0.2);
    if (hit) { x2 = rod.x; y2 = rod.y; x1 = rod.x + G.rand(-W * 0.12, W * 0.12); }     // the rod on the summit catches it
    FX.bolt(x1, -10, x2, y2, { layer: -1, width: strong ? 3 : 2, dur: 0.5, color: G.S.mood > 0.5 ? '#ffe7a8' : '#bfe4ff' });
    const calm = G.settings.reducedMotion ? 0.3 : 1, a = (strong ? 0.5 : 0.28) * calm;
    skyFlash = Math.max(skyFlash, FX.flashOk() ? a : Math.min(a, 0.12));
    rodK = Math.max(rodK, (hit ? 1 : 0.55) * calm);
  };

  Scene.draw = (ctx, dt) => {
    const W = G.W, H = G.H, t = G.clock.real, S = G.S;
    if (dirty && (G.clock.real - lastBuild > 0.15 || !layers[0])) build();
    // mood cross-fade
    const mood = S.mood;
    const stormTarget = S.inFS ? G.clamp(Math.log2(1 + S.persistent) / 7, 0, 1) : 0;
    stormK += (stormTarget - stormK) * Math.min(1, dt * 1.5);
    if (G.Music.storm) G.Music.storm(stormK);
    if (mood < 1) { ctx.globalAlpha = 1; ctx.drawImage(layers[0], 0, 0, W, H); }
    if (mood > 0) { ctx.globalAlpha = mood; ctx.drawImage(layers[1], 0, 0, W, H); ctx.globalAlpha = 1; }

    // stars (mostly a dusk thing)
    const sa = 1 - mood * 0.75;
    if (sa > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      const spr = FX.glowSprite('#cfe0ff');
      for (const s of stars) {
        const a = sa * (0.35 + 0.65 * Math.max(0, Math.sin(t * s.f + s.p)));
        ctx.globalAlpha = a; const z = s.s * 3;
        ctx.drawImage(spr, s.x - z, s.y - z, z * 2, z * 2);
      }
    }
    // light fan from above
    if (rays && G.Q.level > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.05 + mood * 0.05 + Math.sin(t * 0.6) * 0.012;
      const rs = raysSize;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H * 0.7); ctx.clip();
      ctx.translate(W / 2, -H * 0.12); ctx.rotate(t * 0.035);
      ctx.drawImage(rays, -rs / 2, -rs / 2, rs, rs); ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    // drifting clouds
    for (const c of clouds) {
      c.x += dt * 9 * c.d * (1 + mood) * (1 + stormK * 2);
      if (c.x > W + 320) c.x = -360;
      const w = 360 * c.s * (W / 1400 + 0.4), h = 150 * c.s * (W / 1400 + 0.4);
      if (mood < 1) { ctx.globalAlpha = c.a * (1 - mood); ctx.drawImage(cloudSprites[0][c.v], c.x, c.y, w, h); }
      if (mood > 0) { ctx.globalAlpha = c.a * mood; ctx.drawImage(cloudSprites[1][c.v], c.x, c.y, w, h); }
    }
    ctx.globalAlpha = 1;
    // the posts stand in front of the sky: copy their shafts back over stars, rays and clouds
    if (shafts.length) {
      const d = layerDpr, lh = layers[0].height;
      for (const p of shafts) {
        const sh = Math.min(p.h * d, lh - p.y * d), dh = sh / d;     // stay inside the layer when H × DPR is fractional
        if (mood < 1) ctx.drawImage(layers[0], p.x * d, p.y * d, p.w * d, sh, p.x, p.y, p.w, dh);
        if (mood > 0) { ctx.globalAlpha = mood; ctx.drawImage(layers[1], p.x * d, p.y * d, p.w * d, sh, p.x, p.y, p.w, dh); ctx.globalAlpha = 1; }
      }
    }

    // random sky lightning
    lightningT -= dt;
    if (lightningT <= 0) {
      Scene.lightning(mood > 0.5);
      if (mood > 0.5 && Math.random() < 0.35) setTimeout(() => Scene.lightning(false), 120);
      lightningT = mood > 0.5 ? G.rand(1.6, 4.5) * (1 - stormK * 0.8) : G.rand(7, 15);
    }
    if (skyFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = skyFlash * 0.35;
      ctx.drawImage(flashRamps[mood > 0.5 ? 1 : 0], 0, 0, W, H);
      // the strike rim-lights every crest and pine top for a moment
      if (rimMask) { ctx.globalAlpha = Math.min(0.85, skyFlash * 1.5); ctx.drawImage(rimMask, 0, rimTop, W, H - rimTop); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      skyFlash = Math.max(0, skyFlash - dt * 2.5);
    }
    // the rod flares and crackles when the sky fires
    if (rod && rodK > 0.01) {
      const s = rod.s, R = s * (0.3 + 0.45 * rodK);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = rodK;
      ctx.drawImage(FX.glowSprite(mood > 0.5 ? '#ffe7a8' : '#bfe4ff'), rod.x - R, rod.y - R, R * 2, R * 2);
      ctx.strokeStyle = mood > 0.5 ? '#fff4d0' : '#e6f4ff'; ctx.lineWidth = Math.max(0.8, s * 0.025); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let j = -1; j <= 1; j += 2) {
        let ax = rod.x + j * s * 0.08, ay = rod.y + s * 0.05; ctx.moveTo(ax, ay);
        for (let q = 0; q < 3; q++) { ax += j * s * G.rand(0.04, 0.13); ay += s * G.rand(-0.1, 0.08); ctx.lineTo(ax, ay); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      rodK = Math.max(0, rodK - dt * 3);
    }

    // storm lanterns: sway harder as the storm builds; the warm edge light flickers with the flame
    if (lantern) {
      const cw = geo.cw, still = G.settings.reducedMotion, L = lantern;
      for (const ln of lanterns) {
        const sway = still ? 0 : (Math.sin(t * 1.3 + ln.ph) * 0.03 + Math.sin(t * 2.9 + ln.ph * 1.7) * 0.012) * (1 + mood * 0.6 + stormK * 2.2);
        ctx.save(); ctx.translate(ln.x, ln.y); ctx.rotate(sway);
        ctx.drawImage(L.c, -L.w / 2, -L.hookY, L.w, L.h);
        ctx.restore();
        const fd = L.flameY - L.hookY, fx = ln.x - Math.sin(sway) * fd, fy = ln.y + Math.cos(sway) * fd;
        const fl = 0.88 + Math.sin(t * 11 + ln.ph) * 0.06 + Math.sin(t * 23.7 + ln.ph * 3) * 0.04 + (still ? 0 : (Math.random() - 0.5) * 0.04);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.36 * fl; const R = cw * 2.5;
        ctx.drawImage(FX.softSprite('#ff9a3a'), fx - R, fy - R, R * 2, R * 2);
        ctx.globalAlpha = 0.7 * fl; const r2 = cw * 0.4;
        ctx.drawImage(FX.glowSprite('#ffc45a'), fx - r2, fy - r2, r2 * 2, r2 * 2);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
    }
    // the storm: a crimson cast over the sky and slanting rain as the multiplier climbs
    if (stormK > 0.02) {
      ctx.fillStyle = `rgba(110,8,30,${0.22 * stormK})`; ctx.fillRect(-W, -H, W * 3, H * 0.8 + H);
      if (G.Q.level > 0) FX.rain(dt * 140 * stormK, 0.22 + stormK * 0.12);
    }
    if (Math.random() < dt * (3 + mood * 6 + stormK * 10)) {
      FX.spawn({ kind: 'ember', layer: -1, x: G.rand(0, W), y: H + 10, vx: G.rand(-12, 12), vy: -G.rand(25, 70), max: G.rand(6, 11), size: G.rand(1.5, 3.2),
        color: mood > 0.5 ? '#ffcf6a' : '#e8b8ff', drag: 0 });
    }
    FX.draw(ctx, -1);
    FX.drawBolts(ctx, -1);
    // the world darkens while the reels tease a feature
    suspenseK += ((S.suspense ? 1 : 0) - suspenseK) * Math.min(1, dt * 3);
    if (suspenseK > 0.01) { ctx.fillStyle = `rgba(4,1,12,${0.38 * suspenseK})`; ctx.fillRect(-W, -H, W * 3, H * 3); }
  };
})();

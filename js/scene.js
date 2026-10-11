/* Gates of Sebastian — scene: the world behind the board.
 *
 * Static layers (sky, nebula, mountains, the golden gates on the summit,
 * marble columns) are painted once per resize into two offscreen canvases —
 * one for the dusk base game, one for the golden free-spins storm — and
 * cross-faded by S.mood. Live layers on top: twinkling stars, a slowly
 * turning light fan, drifting clouds, sky lightning, brazier fire and embers.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX;
  const Scene = G.Scene = {};

  function mulberry(seed) {
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const MOODS = [
    { sky: ['#0b0520', '#24104d', '#5a2687', '#b2478d', '#f08a7a'], sun: 'rgba(255,140,190,', nebula: ['#7a3cff', '#ff4fa8', '#3a6bff'],
      m: ['#5a3790', '#341c5e', '#1c0d35'], rim: 'rgba(255,170,220,.55)', marble: ['#3b2a63', '#d8ccef', '#8e7bb8'], cloud: '#e6c8ff', gate: '#ffd77a' },
    { sky: ['#140502', '#3c1206', '#8a360c', '#de7d1e', '#ffd47a'], sun: 'rgba(255,200,90,', nebula: ['#ff7a1a', '#ffcf4a', '#c2361a'],
      m: ['#6e3a16', '#40200b', '#200d04'], rim: 'rgba(255,220,140,.7)', marble: ['#4a2c12', '#f3dcb0', '#b48a52'], cloud: '#ffd9a0', gate: '#fff0b0' },
  ];

  let layers = [null, null], rays = null, cloudSprites = [[], []];
  let dirty = true, lastBuild = -1;
  let stars = [], clouds = [], braziers = [];
  let lightningT = 4, skyFlash = 0;

  Scene.invalidate = () => { dirty = true; };

  function build() {
    const W = G.W, H = G.H;
    layers = [paint(0, W, H), paint(1, W, H)];
    rays = paintRays(Math.max(W, H) * 1.9);
    cloudSprites = [[0, 1, 2].map(v => paintCloud(v, MOODS[0].cloud)), [0, 1, 2].map(v => paintCloud(v, MOODS[1].cloud))];
    const r = mulberry(7);
    stars = Array.from({ length: Math.round(W * H / 9000) }, () => ({ x: r() * W, y: Math.pow(r(), 1.6) * H * 0.6, s: 0.6 + r() * 1.8, p: r() * 7, f: 0.6 + r() * 2.2 }));
    clouds = Array.from({ length: 9 }, (_, i) => ({ v: i % 3, x: r() * (W + 600) - 300, y: H * (0.12 + r() * 0.42), s: 0.5 + r() * 0.9, d: 0.3 + r() * 0.7, a: 0.25 + r() * 0.3 }));
    const cw = colW();
    braziers = hasColumns() ? [{ x: cw * 0.5 + W * 0.008, y: capY() }, { x: W - W * 0.008 - cw * 0.5, y: capY() }] : [];
    dirty = false; lastBuild = G.clock.real;
  }
  const colW = () => G.clamp(G.W * 0.045, 30, 84);
  const capY = () => G.H * 0.16;
  // marble columns + braziers only where the layout leaves room for them (wide screens)
  const hasColumns = () => !G.L.portrait && G.L.left && G.L.left.x > colW() * 1.9 + G.W * 0.008;

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

    // mountains: far (with the summit + gates), mid, near
    const ridge = (base, amp, peak, rough, seed) => {
      const rr = mulberry(seed), pts = [];
      const n = 64;
      let h = 0;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        h = h * 0.6 + (rr() - 0.5) * rough;
        const env = peak ? Math.exp(-Math.pow((t - 0.5) / 0.16, 2)) : 0;
        const wav = Math.sin(t * Math.PI * (2 + seed % 3) + seed) * 0.35 + 0.35;
        pts.push([t * W, base - amp * (env * 1.0 + wav * (peak ? 0.35 : 1) + h)]);
      }
      return pts;
    };
    const fill = (pts, color, rim) => {
      x.beginPath(); x.moveTo(0, H);
      pts.forEach(p => x.lineTo(p[0], p[1]));
      x.lineTo(W, H); x.closePath();
      x.fillStyle = color; x.fill();
      if (rim) { x.strokeStyle = rim; x.lineWidth = 1.5; x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.stroke(); }
    };
    const far = ridge(H * 0.74, H * 0.3, true, 0.18, 11);
    // atmospheric haze between layers
    const haze = (y0, a) => { const hg = x.createLinearGradient(0, y0 - H * 0.25, 0, y0 + H * 0.1); hg.addColorStop(0, FX.hexA(M.sky[3], 0)); hg.addColorStop(1, FX.hexA(M.sky[3], a)); x.fillStyle = hg; x.fillRect(0, y0 - H * 0.25, W, H * 0.35); };
    fill(far, M.m[0], M.rim);
    // the golden gates on the summit
    let peak = far[0];
    far.forEach(p => { if (p[1] < peak[1]) peak = p; });
    drawGates(x, peak[0], peak[1], H * 0.06, M.gate);
    haze(H * 0.8, 0.35);
    fill(ridge(H * 0.84, H * 0.1, false, 0.25, 23), M.m[1], null);
    haze(H * 0.9, 0.25);
    fill(ridge(H * 0.95, H * 0.07, false, 0.3, 37), M.m[2], null);

    // marble columns at the edges
    if (hasColumns()) {
      const cw = colW(), cy = capY();
      column(x, W * 0.008, cy, cw, H, M);
      column(x, W - W * 0.008 - cw, cy, cw, H, M);
    }

    // vignette
    const vg = x.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
    return o.c;
  }

  function drawGates(x, px, py, s, color) {
    x.save();
    x.globalCompositeOperation = 'lighter';
    const bg = x.createLinearGradient(px, py - s * 6, px, py);
    bg.addColorStop(0, FX.hexA(color, 0)); bg.addColorStop(1, FX.hexA(color, 0.35));
    x.fillStyle = bg; x.beginPath(); x.moveTo(px - s * 0.25, py - s * 6); x.lineTo(px + s * 0.25, py - s * 6); x.lineTo(px + s * 0.7, py); x.lineTo(px - s * 0.7, py); x.fill();
    const gl = x.createRadialGradient(px, py - s * 0.4, 0, px, py - s * 0.4, s * 2.4);
    gl.addColorStop(0, FX.hexA(color, 0.75)); gl.addColorStop(1, FX.hexA(color, 0));
    x.fillStyle = gl; x.beginPath(); x.arc(px, py - s * 0.4, s * 2.4, 0, 7); x.fill();
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = FX.hexA(color, 0.95);
    const w = s * 0.9, h = s * 0.9, y0 = py - h - s * 0.05;
    x.fillRect(px - w / 2 - s * 0.08, y0 - s * 0.14, w + s * 0.16, s * 0.12);      // lintel
    x.beginPath(); x.moveTo(px - w / 2 - s * 0.1, y0 - s * 0.14); x.lineTo(px, y0 - s * 0.42); x.lineTo(px + w / 2 + s * 0.1, y0 - s * 0.14); x.fill(); // pediment
    for (let i = 0; i < 4; i++) x.fillRect(px - w / 2 + i * (w / 3) - s * 0.05, y0, s * 0.1, h);
    x.restore();
  }

  function column(x, cx, top, w, H, M) {
    const g = x.createLinearGradient(cx, 0, cx + w, 0);
    g.addColorStop(0, M.marble[0]); g.addColorStop(0.35, M.marble[1]); g.addColorStop(0.6, M.marble[2]); g.addColorStop(1, M.marble[0]);
    x.save();
    x.globalAlpha = 0.92;
    x.fillStyle = g; x.fillRect(cx, top + w * 0.5, w, H);
    // flutes
    x.globalAlpha = 0.22; x.fillStyle = '#000';
    for (let i = 1; i < 5; i++) x.fillRect(cx + (w * i) / 5 - w * 0.025, top + w * 0.6, w * 0.05, H);
    x.globalAlpha = 0.95;
    // capital + abacus
    x.fillStyle = g; x.fillRect(cx - w * 0.22, top + w * 0.18, w * 1.44, w * 0.34);
    x.fillRect(cx - w * 0.12, top + w * 0.5, w * 1.24, w * 0.12);
    x.fillStyle = M.marble[1];
    [cx - w * 0.12, cx + w * 1.12].forEach(vx => { x.beginPath(); x.arc(vx, top + w * 0.42, w * 0.16, 0, 7); x.fill(); });
    // brazier bowl
    x.fillStyle = '#2a1606';
    x.beginPath(); x.moveTo(cx - w * 0.15, top + w * 0.16); x.lineTo(cx + w * 1.15, top + w * 0.16); x.lineTo(cx + w * 0.85, top - w * 0.16); x.lineTo(cx + w * 0.15, top - w * 0.16); x.closePath(); x.fill();
    x.strokeStyle = '#d9a63a'; x.lineWidth = 2; x.stroke();
    // shade toward the floor
    const sh = x.createLinearGradient(0, H * 0.55, 0, H);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.6)');
    x.globalAlpha = 1; x.fillStyle = sh; x.fillRect(cx - w * 0.3, H * 0.55, w * 1.6, H * 0.45);
    x.restore();
  }

  function paintRays(size) {
    const o = G.offscreen(size, size, 1), x = o.x, m = size / 2, n = 14;
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
    const x1 = G.rand(W * 0.1, W * 0.9), x2 = x1 + G.rand(-W * 0.15, W * 0.15);
    FX.bolt(x1, -10, x2, H * G.rand(0.3, 0.55), { layer: -1, width: strong ? 3 : 2, dur: 0.5, color: G.S.mood > 0.5 ? '#ffe7a8' : '#bfe4ff' });
    skyFlash = Math.max(skyFlash, strong ? 0.5 : 0.28);
  };

  Scene.draw = (ctx, dt) => {
    const W = G.W, H = G.H, t = G.clock.real, S = G.S;
    if (dirty && (G.clock.real - lastBuild > 0.15 || !layers[0])) build();
    // mood cross-fade
    const mood = S.mood;
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
    if (rays) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.05 + mood * 0.05 + Math.sin(t * 0.6) * 0.012;
      const rs = rays.width;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H * 0.7); ctx.clip();
      ctx.translate(W / 2, -H * 0.12); ctx.rotate(t * 0.035);
      ctx.drawImage(rays, -rs / 2, -rs / 2); ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    // drifting clouds, parallax with the pointer
    const px = (G.pointerN ? G.pointerN.x : 0), py = (G.pointerN ? G.pointerN.y : 0);
    for (const c of clouds) {
      c.x += dt * 9 * c.d * (1 + mood);
      if (c.x > W + 320) c.x = -360;
      const w = 360 * c.s * (W / 1400 + 0.4), h = 150 * c.s * (W / 1400 + 0.4);
      const ox = -px * 10 * c.d, oy = -py * 6 * c.d;
      if (mood < 1) { ctx.globalAlpha = c.a * (1 - mood); ctx.drawImage(cloudSprites[0][c.v], c.x + ox, c.y + oy, w, h); }
      if (mood > 0) { ctx.globalAlpha = c.a * mood; ctx.drawImage(cloudSprites[1][c.v], c.x + ox, c.y + oy, w, h); }
    }
    ctx.globalAlpha = 1;

    // random sky lightning
    lightningT -= dt;
    if (lightningT <= 0) {
      Scene.lightning(mood > 0.5);
      if (mood > 0.5 && Math.random() < 0.35) setTimeout(() => Scene.lightning(false), 120);
      lightningT = mood > 0.5 ? G.rand(1.6, 4.5) : G.rand(7, 15);
    }
    if (skyFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = mood > 0.5 ? `rgba(255,220,150,${skyFlash * 0.35})` : `rgba(170,200,255,${skyFlash * 0.35})`;
      ctx.fillRect(0, 0, W, H * 0.8);
      ctx.globalCompositeOperation = 'source-over';
      skyFlash = Math.max(0, skyFlash - dt * 2.5);
    }

    // brazier fire + embers, rising motes
    for (const b of braziers) {
      const cw = colW();
      const n = dt * 60 * 1.6;
      for (let i = 0; i < n; i++) {
        FX.spawn({ kind: 'glow', layer: -1, x: b.x + G.rand(-cw * 0.32, cw * 0.32), y: b.y - cw * 0.12, vx: G.rand(-14, 14), vy: -G.rand(60, 150), drag: 0.8,
          max: G.rand(0.35, 0.75), size: G.rand(cw * 0.22, cw * 0.42), size1: 2, color: Math.random() < 0.3 ? '#ffd27a' : Math.random() < 0.5 ? '#ff7a1a' : '#ff4a12' });
      }
      if (Math.random() < dt * 8) FX.spawn({ kind: 'ember', layer: -1, x: b.x + G.rand(-cw * 0.3, cw * 0.3), y: b.y - cw * 0.5, vx: G.rand(-30, 30), vy: -G.rand(80, 180),
        max: G.rand(1, 2.2), size: G.rand(2, 4), color: '#ffb347', drag: 0.4 });
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + Math.sin(t * 9 + b.x) * 0.08;
      const gs = cw * 2.6;
      ctx.drawImage(FX.glowSprite('#ff8a2a'), b.x - gs, b.y - gs * 0.8, gs * 2, gs * 2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (Math.random() < dt * (3 + mood * 6)) {
      FX.spawn({ kind: 'ember', layer: -1, x: G.rand(0, W), y: H + 10, vx: G.rand(-12, 12), vy: -G.rand(25, 70), max: G.rand(6, 11), size: G.rand(1.5, 3.2),
        color: mood > 0.5 ? '#ffcf6a' : '#e8b8ff', drag: 0 });
    }
    FX.draw(ctx, -1);
    FX.drawBolts(ctx, -1);
  };
})();

/* Gates of Sebastian — the board: symbol sprites, tumble physics, frame, orbs.
 *
 * Cell positions are stored in ROW units (0 = top row, 4 = bottom) and only
 * mapped to pixels when drawn, so a resize mid-tumble never breaks anything.
 * Physics runs on the game clock: gravity, a damped bounce and a squash on
 * landing. The frame is pre-rendered per layout into a back panel (under the
 * symbols) and a front border (over them, so drops slide in from behind it).
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX, E = G.E;
  const { COLS, ROWS, CELLS, SCATTER } = E;
  const B = G.Board = {};

  /* ===================================================================
   * SYMBOL IMAGES — swap any PNG for your own art (square, transparent
   * background looks best). Set a path to '' to use the built-in vector gem.
   * =================================================================== */
  const SYMBOL_IMAGES = {
    crown: 'assets/symbols/crown.png', ring: 'assets/symbols/ring.png', glass: 'assets/symbols/glass.png',
    chalice: 'assets/symbols/chalice.png', red: 'assets/symbols/red.png', purple: 'assets/symbols/purple.png',
    green: 'assets/symbols/green.png', blue: 'assets/symbols/blue.png', gold: 'assets/symbols/gold.png',
    scatter: 'assets/symbols/scatter.png',
  };
  const SEB_IMAGE = 'assets/sebastian.png';

  const SPR = 200, SHINE = 120, SHINE_FRAMES = 10;
  B.spr = {}; B.glow = {}; B.lit = {}; B.shine = {};
  B.seb = null;

  function loadImg(src) {
    return new Promise(res => {
      if (!src) return res(null);
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => res(null);
      img.src = src;
    });
  }
  function svgImg(svg) { return loadImg('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))); }
  function fit(img, size, pad) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    if (img && img.width) {
      const s = Math.min((size - pad * 2) / img.width, (size - pad * 2) / img.height);
      const w = img.width * s, h = img.height * s;
      c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    }
    return c;
  }
  // colored halo only (the shadow is cast from an image drawn off-canvas)
  function halo(src, color, size, blur) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'), off = size * 4, inset = (size - src.width) / 2;
    x.shadowColor = color; x.shadowBlur = blur; x.shadowOffsetX = off;
    x.drawImage(src, inset - off, inset); x.drawImage(src, inset - off, inset);
    return c;
  }
  function silhouette(src, color) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // a diagonal band of light sweeping across the gem, masked to its shape
  function shineFrames(src) {
    const frames = [];
    for (let k = 0; k < SHINE_FRAMES; k++) {
      const c = document.createElement('canvas'); c.width = c.height = SHINE;
      const x = c.getContext('2d'), bx = (-0.45 + (k / (SHINE_FRAMES - 1)) * 1.9) * SHINE;
      const g = x.createLinearGradient(bx - SHINE * 0.22, bx * 0.4 - SHINE * 0.1, bx + SHINE * 0.22, bx * 0.4 + SHINE * 0.1);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,252,235,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, SHINE, SHINE);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0, SHINE, SHINE);
      frames.push(c);
    }
    return frames;
  }

  B.loadAssets = async onProgress => {
    const ids = Object.keys(SYMBOL_IMAGES);
    let done = 0;
    const total = ids.length + 1;
    const tick = () => onProgress && onProgress(++done / total);
    await Promise.all(ids.map(async id => {
      let img = await loadImg(SYMBOL_IMAGES[id]);
      if (!img && window.SYMBOL_SVG && window.SYMBOL_SVG[id]) img = await svgImg(window.SYMBOL_SVG[id]);
      B.spr[id] = fit(img, SPR, 4);
      B.glow[id] = halo(B.spr[id], G.SYMBOL_COLORS[id], SPR + 80, 26);
      B.lit[id] = silhouette(B.spr[id], '#ffffff');
      B.shine[id] = shineFrames(B.spr[id]);
      tick();
    }));
    const seb = await loadImg(SEB_IMAGE);
    if (seb) B.seb = cropToAlpha(seb);
    tick();
    buildOrbSprites();
  };

  // trim transparent margins so the figure scales by its real height
  function cropToAlpha(img) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    let d;
    const plain = { img, c: null, w: img.width, h: img.height, tip: [0.05, 0.82], ox: 0, oy: 0, srcW: img.width, srcH: img.height };
    try { d = x.getImageData(0, 0, c.width, c.height).data; } catch (e) { return plain; }   // file:// taints the canvas
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
      if (d[(y * c.width + xx) * 4 + 3] > 40) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 <= x0) return plain;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    o.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
    // find the left-most opaque pixel = muzzle of the shotgun (bolts fire from it)
    let tip = [0, 0.8];
    for (let xx = x0; xx <= x1 && !tip.found; xx++) for (let y = y0; y <= y1; y++) {
      if (d[(y * c.width + xx) * 4 + 3] > 120) { tip = [(xx - x0) / w, (y - y0) / h]; tip.found = true; break; }
    }
    return { img: o, w, h, tip, ox: x0, oy: y0, srcW: img.width, srcH: img.height, glowB: halo2(o, '#7fd4ff'), glowF: halo2(o, '#ffc04a') };
  }
  function halo2(src, color) {
    const pad = 40, c = document.createElement('canvas'); c.width = src.width + pad * 2; c.height = src.height + pad * 2;
    const x = c.getContext('2d'), off = c.width * 2;
    x.shadowColor = color; x.shadowBlur = 28; x.shadowOffsetX = off;
    x.drawImage(src, pad - off, pad); x.drawImage(src, pad - off, pad);
    return { c, pad };
  }

  // ---------------- orb sprites (one per value tier) ----------------
  const orbSpr = [];
  function buildOrbSprites() {
    G.ORB_COLORS.forEach((col, i) => {
      const s = 160, c = document.createElement('canvas'); c.width = c.height = s;
      const x = c.getContext('2d'), m = s / 2, r = s * 0.36;
      const halo = x.createRadialGradient(m, m, r * 0.6, m, m, m);
      halo.addColorStop(0, FX.hexA(col[3], 0.75)); halo.addColorStop(1, FX.hexA(col[3], 0));
      x.fillStyle = halo; x.fillRect(0, 0, s, s);
      const g = x.createRadialGradient(m - r * 0.35, m - r * 0.4, r * 0.05, m, m, r);
      g.addColorStop(0, col[0]); g.addColorStop(0.45, col[1]); g.addColorStop(1, col[2]);
      x.fillStyle = g; x.beginPath(); x.arc(m, m, r, 0, 7); x.fill();
      x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,.85)'; x.stroke();
      x.fillStyle = 'rgba(255,255,255,.6)'; x.beginPath(); x.ellipse(m - r * 0.35, m - r * 0.45, r * 0.38, r * 0.2, -0.5, 0, 7); x.fill();
      orbSpr[i] = c;
    });
  }
  B.drawOrb = (ctx, x, y, r, value, alpha, spin) => {
    const tier = G.orbTier(value), s = orbSpr[tier];
    if (!s) return;
    ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
    const d = r * 2 / 0.72;
    ctx.drawImage(s, x - d / 2, y - d / 2, d, d);
    // crackling energy arcs
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = G.ORB_COLORS[tier][3]; ctx.lineWidth = Math.max(1.5, r * 0.06);
    const t = G.clock.real * 3 + (spin || 0);
    for (let k = 0; k < 3; k++) {
      const a0 = t * (1 + k * 0.3) + k * 2.1;
      ctx.globalAlpha = (alpha == null ? 1 : alpha) * (0.45 + 0.4 * Math.sin(t * 5 + k));
      ctx.beginPath(); ctx.arc(x, y, r * (1.12 + k * 0.07), a0, a0 + 1.1); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha == null ? 1 : alpha;
    const label = value + 'x';
    G.goldText(ctx, label, x, y + r * 0.05, r * (label.length > 3 ? 0.62 : 0.78), { colors: ['#ffffff', '#ffffff', '#fff3c4'], strokeColor: '#1a0730', stroke: 0.22 });
    ctx.restore();
  };

  // ---------------- cells ----------------
  // shineT / flipT: < 0 waiting (delay), 0..1 playing, null idle
  B.cells = Array.from({ length: CELLS }, () => ({ id: 'gold', y: 0, vy: 0, falling: false, delay: 0, squash: 0, win: false, dim: false,
    pop: -1, flash: 0, landed: true, shineT: null, flipT: null }));
  B.exiting = [];
  B.colAntic = new Array(COLS).fill(0);   // > 0 while a column is held back for anticipation
  B.orbs = [];
  B.onLand = null;                          // (i, cell) callback for sounds/FX
  B.highlightT = 0;

  B.setBoard = board => {
    for (let i = 0; i < CELLS; i++) Object.assign(B.cells[i], { id: board[i], y: Math.floor(i / COLS), vy: 0, falling: false, delay: 0, squash: 0, win: false, dim: false, pop: -1, landed: true });
  };

  const GRAV = 46, BOUNCE = 0.2, STOPV = 1.2;
  let settleRes = null;
  const anyFalling = () => B.cells.some(c => c.falling) || B.exiting.length > 0;
  B.settled = () => new Promise(res => { if (!anyFalling()) res(); else settleRes = res; });

  B.update = dt => {
    for (let i = 0; i < CELLS; i++) {
      const c = B.cells[i];
      c.squash = Math.max(0, c.squash - dt * 6);
      c.flash = Math.max(0, c.flash - dt * 4);
      if (c.shineT != null) { c.shineT += dt / 0.55; if (c.shineT > 1) c.shineT = null; }
      if (c.flipT != null) { c.flipT += dt / 0.75; if (c.flipT > 1) c.flipT = null; }
      if (!c.falling) continue;
      if (c.delay > 0) { c.delay -= dt; continue; }
      const target = Math.floor(i / COLS);
      c.vy += GRAV * dt; c.y += c.vy * dt;
      if (c.y >= target) {
        c.y = target;
        const impact = c.vy;
        if (impact > STOPV) {
          c.vy = -impact * BOUNCE;
          c.squash = Math.min(1, impact / 22);
          if (!c.landed) { c.landed = true; if (B.onLand) B.onLand(i, c); }
        } else { c.vy = 0; c.falling = false; }
      }
    }
    for (let k = B.exiting.length - 1; k >= 0; k--) {
      const e = B.exiting[k];
      if (e.delay > 0) { e.delay -= dt; continue; }
      e.vy += GRAV * dt; e.y += e.vy * dt;
      if (e.y > ROWS + 1) B.exiting.splice(k, 1);
    }
    // a held-back column stops teasing the moment it starts to drop
    for (let c = 0; c < COLS; c++) if (B.colAntic[c] > 0) { if (B.cells[c].delay <= 0) B.colAntic[c] = 0; else B.colAntic[c] += dt; }
    if (settleRes && !anyFalling()) { const r = settleRes; settleRes = null; r(); }
    B.highlightT += dt;
  };

  /* New spin: old symbols fall out, the new board drops in column by column.
   * plan.colDelay[c] = seconds before column c drops; plan.antic = columns that
   * get the anticipation treatment while they wait. */
  B.dropIn = (board, plan) => {
    for (let i = 0; i < CELLS; i++) {
      const c = B.cells[i], col = i % COLS;
      B.exiting.push({ id: c.id, col, y: c.y, vy: G.rand(-1.5, 0), delay: col * 0.025 + (ROWS - 1 - Math.floor(i / COLS)) * 0.008 });
    }
    for (let i = 0; i < CELLS; i++) {
      const c = B.cells[i], col = i % COLS, r = Math.floor(i / COLS);
      Object.assign(c, { id: board[i], y: r - ROWS - 0.8, vy: 4, falling: true, delay: plan.colDelay[col], squash: 0, win: false, dim: false, pop: -1, landed: false, fresh: true, shineT: null, flipT: null });
    }
    plan.antic.forEach(col => { B.colAntic[col] = 0.0001; });
    return B.settled();
  };
  B.stopAntic = col => { B.colAntic[col] = 0; };
  // one diagonal sweep of light across the whole board
  B.sweep = () => {
    B.cells.forEach((c, i) => { if (!c.falling && c.pop < 0) c.shineT = -((i % COLS) + Math.floor(i / COLS)) * 0.05; });
  };
  // slam stop: everything still waiting drops right now
  B.hurry = () => { B.cells.forEach(c => { if (c.falling && c.delay > 0.05) c.delay = 0.05 * Math.random(); }); B.exiting.length = 0; };

  B.highlight = (cellSet, on) => {
    B.highlightT = 0;
    let k = 0;
    for (let i = 0; i < CELLS; i++) {
      const c = B.cells[i];
      c.win = on && cellSet.has(i);
      c.dim = on && !cellSet.has(i);
      if (c.win) { c.flash = 1; c.shineT = -0.15 - (k++ % 6) * 0.12; }    // a staggered sweep of light across the winners
    }
  };

  B.explode = async removeSet => {
    removeSet.forEach(i => { B.cells[i].pop = 0; });
    const start = G.clock.game;
    await new Promise(res => {
      const step = () => {
        const p = (G.clock.game - start) / 0.34;
        removeSet.forEach(i => { B.cells[i].pop = Math.min(1, p); });
        if (p >= 1) res(); else requestAnimationFrame(step);
      };
      step();
    });
  };

  // after a win: survivors slide down to their new rows, new symbols fall in
  B.tumble = (removeSet, after) => {
    const set = removeSet instanceof Set ? removeSet : new Set(removeSet);
    for (let c = 0; c < COLS; c++) {
      let missing = 0; const survBottomUp = [];
      for (let r = ROWS - 1; r >= 0; r--) { if (set.has(r * COLS + c)) missing++; else survBottomUp.push(r); }
      const oldY = survBottomUp.map(r => B.cells[r * COLS + c].y);
      for (let r = 0; r < ROWS; r++) {
        const i = r * COLS + c, cell = B.cells[i];
        Object.assign(cell, { id: after[i], win: false, dim: false, pop: -1, squash: 0, flash: 0, shineT: null, flipT: null });
        if (r < missing) {
          Object.assign(cell, { y: r - missing - 0.6, vy: 2, falling: true, delay: c * 0.03 + 0.05, landed: false, fresh: true });
        } else {
          const k = ROWS - 1 - r, from = oldY[k];
          if (from === r) { cell.y = r; cell.vy = 0; cell.falling = false; cell.landed = true; cell.fresh = false; }
          else Object.assign(cell, { y: from, vy: 0, falling: true, delay: c * 0.03, landed: false, fresh: false });
        }
      }
    }
    return B.settled();
  };

  // ---------------- frame (pre-rendered per layout) ----------------
  let frameBack = null, frameFront = null, frameM = 0;
  B.invalidate = () => { frameBack = frameFront = null; };
  function buildFrame() {
    const L = G.L, r = L.reel, fp = L.fp;
    frameM = Math.round(fp * 1.4);
    const W = r.w + frameM * 2, H = r.h + frameM * 2, ox = frameM, oy = frameM;
    const rad = fp * 1.1;
    // --- back panel
    const b = G.offscreen(W, H), x = b.x;
    const pg = x.createLinearGradient(0, oy, 0, oy + r.h);
    pg.addColorStop(0, 'rgba(32,12,64,.88)'); pg.addColorStop(0.5, 'rgba(18,7,40,.9)'); pg.addColorStop(1, 'rgba(10,3,22,.94)');
    G.roundRect(x, ox, oy, r.w, r.h, rad); x.fillStyle = pg; x.fill();
    // soft top light
    const tl = x.createRadialGradient(ox + r.w / 2, oy, 0, ox + r.w / 2, oy, r.h * 0.9);
    tl.addColorStop(0, 'rgba(160,110,255,.18)'); tl.addColorStop(1, 'rgba(160,110,255,0)');
    x.fillStyle = tl; x.fill();
    // slots
    for (let i = 0; i < CELLS; i++) {
      const cx = ox + fp + (i % COLS) * (L.cell + L.gap), cy = oy + fp + Math.floor(i / COLS) * (L.cell + L.gap);
      G.roundRect(x, cx + 1, cy + 1, L.cell - 2, L.cell - 2, L.cell * 0.14);
      const sg = x.createRadialGradient(cx + L.cell / 2, cy + L.cell / 2, L.cell * 0.1, cx + L.cell / 2, cy + L.cell / 2, L.cell * 0.7);
      sg.addColorStop(0, 'rgba(120,80,200,.10)'); sg.addColorStop(1, 'rgba(255,255,255,.02)');
      x.fillStyle = sg; x.fill();
    }
    // column dividers
    for (let c = 1; c < COLS; c++) {
      const dx = ox + fp + c * (L.cell + L.gap) - L.gap / 2;
      const dg = x.createLinearGradient(0, oy, 0, oy + r.h);
      dg.addColorStop(0, 'rgba(255,215,120,0)'); dg.addColorStop(0.5, 'rgba(255,215,120,.16)'); dg.addColorStop(1, 'rgba(255,215,120,0)');
      x.fillStyle = dg; x.fillRect(dx - 0.5, oy + fp * 0.5, 1, r.h - fp);
    }
    frameBack = b.c;

    // --- front border
    const f = G.offscreen(W, H), y = f.x;
    const bw = Math.max(4, fp * 0.55);
    const gold = (y0, y1) => {
      const g = y.createLinearGradient(0, y0, 0, y1);
      ['#fff4c2', '#e6b648', '#8a5a10', '#f2c95a', '#9a6614', '#ffe9a0'].forEach((c, i) => g.addColorStop(i / 5, c));
      return g;
    };
    // drop shadow + outer dark line
    y.save(); y.shadowColor = 'rgba(0,0,0,.6)'; y.shadowBlur = fp; y.shadowOffsetY = fp * 0.3;
    G.roundRect(y, ox, oy, r.w, r.h, rad); y.lineWidth = bw + 3; y.strokeStyle = '#2a1404'; y.stroke(); y.restore();
    G.roundRect(y, ox, oy, r.w, r.h, rad); y.lineWidth = bw; y.strokeStyle = gold(oy, oy + r.h); y.stroke();
    G.roundRect(y, ox + bw * 0.5 + 1, oy + bw * 0.5 + 1, r.w - bw - 2, r.h - bw - 2, rad * 0.8); y.lineWidth = 1.5; y.strokeStyle = 'rgba(40,16,2,.9)'; y.stroke();
    // meander lintels top + bottom
    const lh = Math.max(10, fp * 0.95);
    [[oy - lh * 0.45], [oy + r.h - lh * 0.55]].forEach(([ly]) => meander(y, ox + rad * 0.6, ly, r.w - rad * 1.2, lh, gold));
    // corner rosettes
    const rr = Math.max(7, fp * 0.7);
    [[ox, oy], [ox + r.w, oy], [ox, oy + r.h], [ox + r.w, oy + r.h]].forEach(([cx, cy]) => rosette(y, cx, cy, rr));
    frameFront = f.c;
  }
  function meander(x, lx, ly, lw, lh, gold) {
    x.save();
    G.roundRect(x, lx, ly, lw, lh, lh * 0.2);
    x.fillStyle = gold(ly, ly + lh); x.fill();
    const inset = lh * 0.16;
    x.fillStyle = '#3b1605'; x.fillRect(lx + inset, ly + inset, lw - inset * 2, lh - inset * 2);
    // key pattern
    const ih = lh - inset * 2.6, iy = ly + inset * 1.3, u = ih * 1.25;
    const n = Math.floor((lw - inset * 2) / u), sx = lx + (lw - n * u) / 2;
    x.strokeStyle = '#f0c45a'; x.lineWidth = Math.max(1, ih * 0.16); x.lineJoin = 'miter'; x.lineCap = 'square';
    x.beginPath();
    for (let k = 0; k < n; k++) {
      const X = v => sx + k * u + v * u * 0.9, Y = v => iy + v * ih;
      x.moveTo(X(0), Y(1)); x.lineTo(X(0), Y(0)); x.lineTo(X(0.75), Y(0)); x.lineTo(X(0.75), Y(0.7)); x.lineTo(X(0.36), Y(0.7)); x.lineTo(X(0.36), Y(0.36));
      x.moveTo(X(0), Y(1)); x.lineTo(X(1.11), Y(1));
    }
    x.stroke();
    x.restore();
  }
  function rosette(x, cx, cy, r) {
    const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#fff6c8'); g.addColorStop(0.5, '#e2ad3a'); g.addColorStop(1, '#6e4508');
    x.fillStyle = g; x.beginPath();
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, rr = k % 2 ? r * 0.78 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    x.closePath(); x.fill(); x.lineWidth = 1.2; x.strokeStyle = '#4a2a04'; x.stroke();
    const gg = x.createRadialGradient(cx - r * 0.12, cy - r * 0.15, 0, cx, cy, r * 0.42);
    gg.addColorStop(0, '#ffd0e0'); gg.addColorStop(0.5, '#e0204a'); gg.addColorStop(1, '#5a0414');
    x.fillStyle = gg; x.beginPath(); x.arc(cx, cy, r * 0.42, 0, 7); x.fill();
  }

  // ---------------- drawing ----------------
  B.drawBack = ctx => {
    if (!frameBack) buildFrame();
    const r = G.L.reel;
    ctx.drawImage(frameBack, r.x - frameM, r.y - frameM, frameBack.width / G.DPR, frameBack.height / G.DPR);
    if (G.S.mood > 0) {
      ctx.save(); G.roundRect(ctx, r.x, r.y, r.w, r.h, G.L.fp * 1.1);
      ctx.fillStyle = `rgba(255,170,60,${0.07 * G.S.mood})`; ctx.fill(); ctx.restore();
    }
  };
  B.drawFront = ctx => {
    if (!frameFront) buildFrame();
    const r = G.L.reel;
    ctx.drawImage(frameFront, r.x - frameM, r.y - frameM, frameFront.width / G.DPR, frameFront.height / G.DPR);
  };

  let glintT = 0, shineIdleT = 1, flipIdleT = 2;
  B.drawCells = (ctx, dt) => {
    const L = G.L, r = L.reel, t = G.clock.real, cs = L.cell;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x + L.fp * 0.4, r.y + L.fp * 0.55, r.w - L.fp * 0.8, r.h - L.fp * 1.1); ctx.clip();

    // anticipation columns: golden light + a blurred "spinning" strip
    for (let c = 0; c < COLS; c++) {
      const a = B.colAntic[c];
      if (!a) continue;
      const x = G.cellX(c), y0 = L.gy, h = L.gridH;
      const pulse = 0.6 + 0.4 * Math.sin(t * 12);
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createLinearGradient(x, 0, x + cs, 0);
      lg.addColorStop(0, 'rgba(255,190,60,0)'); lg.addColorStop(0.5, `rgba(255,200,80,${0.35 * pulse})`); lg.addColorStop(1, 'rgba(255,190,60,0)');
      ctx.fillStyle = lg; ctx.fillRect(x - cs * 0.3, y0 - L.fp, cs * 1.6, h + L.fp * 2);
      ctx.globalCompositeOperation = 'source-over';
      const speed = 22, off = (G.clock.game * speed) % 1;
      ctx.globalAlpha = 0.55;
      for (let k = -1; k < ROWS + 1; k++) {
        const id = E.PAY_ORDER[(Math.abs(k * 7 + Math.floor(G.clock.game * speed)) % 9)];
        const yy = G.cellY(k + off);
        ctx.drawImage(B.spr[id], x + cs * 0.1, yy - cs * 0.35, cs * 0.8, cs * 1.7);   // vertical stretch = motion blur
      }
      ctx.globalAlpha = 1;
      if (Math.random() < dt * 20) FX.spawn({ kind: 'glow', x: x + G.rand(0, cs), y: y0 + h, vy: -G.rand(200, 420), max: 0.8, size: G.rand(3, 7), color: '#ffd27a' });
    }

    // old symbols falling out
    for (const e of B.exiting) {
      const x = G.cellX(e.col), y = G.cellY(e.y);
      ctx.globalAlpha = G.clamp(1 - (e.y - ROWS + 1) * 0.8, 0, 1);
      ctx.drawImage(B.spr[e.id], x + cs * 0.04, y + cs * 0.04, cs * 0.92, cs * 0.92);
    }
    ctx.globalAlpha = 1;

    const hl = B.highlightT;
    for (let i = 0; i < CELLS; i++) {
      const c = B.cells[i];
      if (c.falling && c.delay > 0) continue;
      const col = i % COLS, x = G.cellX(col), y = G.cellY(c.y);
      let s = 0.92, sx = 1, sy = 1, rot = 0, alpha = 1;
      if (c.pop >= 0) {
        const p = c.pop;
        s *= p < 0.35 ? 1 + 0.28 * G.ease.outBack(p / 0.35) : (1.28) * (1 - G.ease.inCubic((p - 0.35) / 0.65));
        alpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      } else if (c.win) {
        s *= 1.06 + 0.06 * Math.sin(hl * 11);
        rot = Math.sin(hl * 9 + i) * 0.05;
      }
      if (c.squash > 0) { sx = 1 + 0.16 * c.squash; sy = 1 - 0.16 * c.squash; }
      if (c.id === SCATTER && c.pop < 0) { rot += Math.sin(t * 2 + i) * 0.06; s *= 1 + 0.04 * Math.sin(t * 4 + i); sx *= 0.86 + 0.14 * Math.cos(t * 1.7 + i); }
      let edge = 0;
      if (c.flipT != null && c.flipT >= 0 && c.pop < 0) {          // a full turn around the vertical axis
        const k = Math.cos(c.flipT * Math.PI * 2);
        sx *= Math.max(0.06, Math.abs(k)); edge = Math.max(0, 1 - Math.abs(k) / 0.35);
      }
      const size = cs * s, cx = x + cs / 2, by = y + cs / 2 + (size * (1 - sy)) / 2;
      ctx.save();
      ctx.translate(cx, by); if (rot) ctx.rotate(rot); ctx.scale(sx, sy);
      if ((c.win || c.id === SCATTER) && c.pop < 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = c.win ? 0.75 + 0.25 * Math.sin(hl * 11) : 0.45 + 0.2 * Math.sin(t * 3 + i);
        const gs = size * ((SPR + 80) / SPR);
        ctx.drawImage(B.glow[c.id], -gs / 2, -gs / 2, gs, gs);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = alpha * (c.dim ? 0.32 : 1);
      ctx.drawImage(B.spr[c.id], -size / 2, -size / 2, size, size);
      if (c.flash > 0 || edge > 0 || (c.pop >= 0 && c.pop < 0.5)) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(c.flash * 0.7, edge * 0.55, c.pop >= 0 ? (0.5 - c.pop) * 1.6 : 0);
        ctx.drawImage(B.lit[c.id], -size / 2, -size / 2, size, size);
      }
      if (c.shineT != null && c.shineT >= 0 && c.pop < 0) {
        const fr = B.shine[c.id][Math.min(SHINE_FRAMES - 1, Math.floor(c.shineT * SHINE_FRAMES))];
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = c.dim ? 0.25 : 0.8;
        ctx.drawImage(fr, -size / 2, -size / 2, size, size);
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // the board breathes: glints, light sweeps and the odd gem turning over
    glintT -= dt; shineIdleT -= dt; flipIdleT -= dt;
    const idle = i => { const c = B.cells[i]; return !c.falling && c.pop < 0 && !c.win && !c.dim; };
    if (glintT <= 0) {
      glintT = G.rand(0.12, 0.35) / G.Q.fx;
      const i = (Math.random() * CELLS) | 0, c = B.cells[i];
      if (!c.falling && c.pop < 0) {
        const x = G.cellX(i % COLS), y = G.cellY(c.y);
        FX.star(x + cs * G.rand(0.25, 0.6), y + cs * G.rand(0.2, 0.5), cs * G.rand(0.18, 0.3), G.rand(0.4, 0.7));
      }
    }
    if (shineIdleT <= 0) {
      shineIdleT = G.rand(0.25, 0.7) / G.Q.fx;
      const i = (Math.random() * CELLS) | 0;
      if (idle(i) && B.cells[i].shineT == null) B.cells[i].shineT = 0;
    }
    if (flipIdleT <= 0) {
      flipIdleT = G.rand(1.6, 3.4) / G.Q.fx;
      const i = (Math.random() * CELLS) | 0;
      if (idle(i) && B.cells[i].flipT == null && B.cells[i].id !== SCATTER && !G.settings.reducedMotion) B.cells[i].flipT = 0;
    }
  };

  // ---------------- grid orbs ----------------
  B.addOrb = (value, i) => {
    const p = G.cellCenter(i);
    const o = { value, x: p.x, y: p.y, t: 0, state: 'appear', scale: 0, trail: [] };
    B.orbs.push(o);
    return o;
  };
  B.updateOrbs = dt => {
    for (let k = B.orbs.length - 1; k >= 0; k--) {
      const o = B.orbs[k]; o.t += dt;
      if (o.state === 'appear') { o.scale = G.ease.outBack(Math.min(1, o.t / 0.35)); }
      else if (o.state === 'fly') {
        const p = Math.min(1, o.t / o.dur), e = G.ease.inOutSine(p);
        o.x = G.lerp(o.x0, o.tx, e) + Math.sin(p * Math.PI) * o.arcX;
        o.y = G.lerp(o.y0, o.ty, e) - Math.sin(p * Math.PI) * o.arcY;
        o.scale = 1 - p * 0.45;
        o.trail.push([o.x, o.y]); if (o.trail.length > 14) o.trail.shift();
        if (p >= 1) { B.orbs.splice(k, 1); if (o.onArrive) o.onArrive(); }
      }
    }
  };
  B.flyOrb = (o, tx, ty, dur) => new Promise(res => {
    Object.assign(o, { state: 'fly', t: 0, x0: o.x, y0: o.y, tx, ty, dur, onArrive: res,
      arcX: (tx - o.x) * 0.0, arcY: Math.max(60, Math.abs(tx - o.x) * 0.25) });
  });
  B.drawOrbs = ctx => {
    const r = G.L.cell * 0.36;
    for (const o of B.orbs) {
      if (o.trail.length > 1) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const col = G.ORB_COLORS[G.orbTier(o.value)][3];
        o.trail.forEach((p, i) => {
          const a = i / o.trail.length;
          ctx.globalAlpha = a * 0.6; const s = r * (0.4 + a * 0.9);
          ctx.drawImage(FX.glowSprite(col), p[0] - s, p[1] - s, s * 2, s * 2);
        });
        ctx.restore();
      }
      B.drawOrb(ctx, o.x, o.y, r * o.scale, o.value, 1, o.value);
    }
  };
})();

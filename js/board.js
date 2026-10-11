/* Thunder Hunter Sebastian — the board: symbol sprites, tumble physics, frame, orbs.
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
  // Sebastian's two clips as sprite sheets (frame data: js/seb-frames.js)
  const SEB_SHEETS = { idle: 'assets/sebastian/idle.webp', shoot: 'assets/sebastian/shoot.webp' };

  const SPR = 200, SHINE = 120, SHINE_FRAMES = 10;
  B.spr = {}; B.glow = {}; B.lit = {}; B.shine = {}; B.shadow = {}; B.dim = {};
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

  /* Material pass on the symbol art: a lit edge towards the key light, the far
   * edge falling into shade, a brushed finish on the worked-gold high pays
   * and a seeded star glint or two near the top of each gem. */
  const METAL = { crown: 1, ring: 1, chalice: 1, glass: 1 };
  function edge(sil, dx, dy) {
    const c = document.createElement('canvas'); c.width = c.height = SPR; const x = c.getContext('2d');
    x.drawImage(sil, 0, 0); x.globalCompositeOperation = 'destination-out'; x.drawImage(sil, dx, dy);
    return c;
  }
  function gemPass(c, id) {
    const M = G.Mat, x = c.getContext('2d'), sil = silhouette(c, '#ffffff'), d = 2.6;
    const lx = -M.LIGHT.x * d, ly = -M.LIGHT.y * d;            // away from the light
    x.save();
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.3; x.drawImage(edge(sil, lx, ly), 0, 0);
    const far = silhouette(edge(sil, -lx, -ly), '#000000');
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 0.28; x.drawImage(far, 0, 0);
    x.restore();
    if (METAL[id]) M.texture(x, 'brushed', 0.06, 'overlay', true);    // cut stones stay smooth
    if (id !== SCATTER) {
      const r = M.mulberry(id.length * 131 + id.charCodeAt(0));
      x.save(); x.globalCompositeOperation = 'source-atop';
      for (let k = 0; k < 2; k++) {
        const gx = SPR * (0.32 + r() * 0.36), gy = SPR * (0.2 + r() * 0.2), gs = SPR * (0.022 + r() * 0.014), a = 0.28 + r() * 0.17;
        const g = x.createRadialGradient(gx, gy, 0, gx, gy, gs * 2.2);
        g.addColorStop(0, `rgba(255,255,250,${a})`); g.addColorStop(1, 'rgba(255,255,250,0)');
        x.fillStyle = g; x.fillRect(gx - gs * 3, gy - gs * 3, gs * 6, gs * 6);
        x.strokeStyle = `rgba(255,255,250,${a * 0.7})`; x.lineWidth = 1;
        x.beginPath(); x.moveTo(gx - gs * 1.8, gy); x.lineTo(gx + gs * 1.8, gy); x.moveTo(gx, gy - gs * 1.8); x.lineTo(gx, gy + gs * 1.8); x.stroke();
      }
      x.restore();
    }
    return c;
  }
  // a loser out of the light: darker and greyer, still solid
  function dimmed(src) {
    const c = document.createElement('canvas'); c.width = c.height = SPR; const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'saturation'; x.globalAlpha = 0.6; x.fillStyle = '#808080'; x.fillRect(0, 0, SPR, SPR);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.fillStyle = 'rgba(16,7,34,.52)'; x.fillRect(0, 0, SPR, SPR);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0);
    return c;
  }

  B.loadAssets = async onProgress => {
    const ids = Object.keys(SYMBOL_IMAGES);
    let done = 0;
    const total = ids.length + 1;
    const tick = () => onProgress && onProgress(++done / total);
    await Promise.all(ids.map(async id => {
      let img = await loadImg(SYMBOL_IMAGES[id]);
      if (!img && window.SYMBOL_SVG && window.SYMBOL_SVG[id]) img = await svgImg(window.SYMBOL_SVG[id]);
      B.spr[id] = gemPass(fit(img, SPR, 4), id);
      B.shadow[id] = halo(B.spr[id], 'rgba(6,2,16,.8)', SPR + 40, 12);
      B.dim[id] = dimmed(B.spr[id]);
      B.glow[id] = halo(B.spr[id], G.SYMBOL_COLORS[id], SPR + 80, 26);
      B.lit[id] = silhouette(B.spr[id], '#ffffff');
      B.shine[id] = shineFrames(B.spr[id]);
      tick();
    }));
    const [idle, shoot] = await Promise.all([loadImg(SEB_SHEETS.idle), loadImg(SEB_SHEETS.shoot)]);
    if (idle && shoot && window.SEB_FRAMES) B.seb = { idle, shoot };
    tick();
    buildOrbSprites();
  };

  // ---------------- orb sprites (one per value tier) ----------------
  /* Storm glass: a glass body in the tier colour with a fresnel rim (instead
   * of a hard white outline), light bending through it into a crescent on the
   * far side, a softbox highlight towards the key light and a caustic pooled
   * under it. A plasma core turns inside (two noise discs drawn live), and
   * the 100x+ tier sits in a gold filigree cage. */
  const orbSpr = [], orbCore = [];
  function buildOrbSprites() {
    const M = G.Mat;
    G.ORB_COLORS.forEach((col, i) => {
      const s = 160, c = document.createElement('canvas'); c.width = c.height = s;
      const x = c.getContext('2d'), m = s / 2, r = s * 0.36;
      const halo = x.createRadialGradient(m, m, r * 0.6, m, m, m);
      halo.addColorStop(0, FX.hexA(col[3], 0.6)); halo.addColorStop(1, FX.hexA(col[3], 0));
      x.fillStyle = halo; x.fillRect(0, 0, s, s);
      // caustic: light focused through the glass onto the floor below it
      const ca = x.createRadialGradient(m + r * 0.18, m + r * 0.9, 0, m + r * 0.18, m + r * 0.9, r * 0.55);
      ca.addColorStop(0, FX.hexA(col[0], 0.5)); ca.addColorStop(1, FX.hexA(col[0], 0));
      x.save(); x.translate(0, 0); x.fillStyle = ca; x.beginPath(); x.ellipse(m + r * 0.18, m + r * 0.9, r * 0.55, r * 0.2, 0, 0, 7); x.fill(); x.restore();
      // the glass body
      const g = x.createRadialGradient(m - r * 0.3, m - r * 0.35, r * 0.05, m, m, r);
      g.addColorStop(0, FX.hexA(col[0], 0.95)); g.addColorStop(0.4, FX.hexA(col[1], 0.9)); g.addColorStop(0.85, FX.hexA(col[2], 0.95)); g.addColorStop(1, col[2]);
      x.fillStyle = g; x.beginPath(); x.arc(m, m, r, 0, 7); x.fill();
      // refraction: the light comes back out through the far side
      x.save(); x.beginPath(); x.arc(m, m, r, 0, 7); x.clip();
      const cr = x.createRadialGradient(m + r * 0.42, m + r * 0.48, r * 0.1, m + r * 0.42, m + r * 0.48, r * 0.75);
      cr.addColorStop(0, FX.hexA(col[3], 0.55)); cr.addColorStop(1, FX.hexA(col[3], 0));
      x.globalCompositeOperation = 'lighter'; x.fillStyle = cr; x.fillRect(0, 0, s, s);
      x.restore();
      // fresnel rim: the edge of a glass ball goes bright, its centre stays clear
      const fr = x.createRadialGradient(m, m, r * 0.62, m, m, r);
      fr.addColorStop(0, FX.hexA(col[0], 0)); fr.addColorStop(0.85, FX.hexA(col[0], 0.4)); fr.addColorStop(0.97, FX.hexA('#ffffff', 0.55)); fr.addColorStop(1, FX.hexA(col[2], 0.9));
      x.fillStyle = fr; x.beginPath(); x.arc(m, m, r, 0, 7); x.fill();
      // softbox highlight and a pinpoint, towards the key light
      x.save(); x.translate(m - r * 0.38, m - r * 0.46); x.rotate(-0.6);
      const sb = x.createLinearGradient(0, -r * 0.14, 0, r * 0.14);
      sb.addColorStop(0, 'rgba(255,255,255,.75)'); sb.addColorStop(1, 'rgba(255,255,255,.12)');
      x.fillStyle = sb; G.roundRect(x, -r * 0.3, -r * 0.13, r * 0.6, r * 0.26, r * 0.1); x.fill();
      x.restore();
      x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.arc(m - r * 0.55, m - r * 0.22, r * 0.055, 0, 7); x.fill();
      orbSpr[i] = c;
      // plasma core: streaky noise in the glow colour, drawn turning in two layers
      const k = 96, pc = document.createElement('canvas'); pc.width = pc.height = k;
      const px = pc.getContext('2d'), rnd = M.mulberry(900 + i), h = k / 2;
      px.globalCompositeOperation = 'lighter'; px.lineCap = 'round';
      for (let n = 0; n < 26; n++) {
        const a0 = rnd() * 6.283, len = 0.6 + rnd() * 1.4, rr = h * (0.15 + rnd() * 0.6);
        px.strokeStyle = FX.hexA(n % 3 ? col[3] : '#ffffff', 0.18 + rnd() * 0.25); px.lineWidth = 1 + rnd() * 2.5;
        px.beginPath(); px.arc(h, h, rr, a0, a0 + len); px.stroke();
      }
      px.globalCompositeOperation = 'destination-in';
      const mk = px.createRadialGradient(h, h, 0, h, h, h); mk.addColorStop(0, 'rgba(0,0,0,1)'); mk.addColorStop(0.7, 'rgba(0,0,0,.6)'); mk.addColorStop(1, 'rgba(0,0,0,0)');
      px.fillStyle = mk; px.fillRect(0, 0, k, k);
      orbCore[i] = pc;
    });
  }
  B.drawOrb = (ctx, x, y, r, value, alpha, spin) => {
    const tier = G.orbTier(value), s = orbSpr[tier];
    if (!s) return;
    const A = alpha == null ? 1 : alpha, t = G.clock.real + (spin || 0);
    ctx.save(); ctx.globalAlpha = A;
    const d = r * 2 / 0.72;
    ctx.drawImage(s, x - d / 2, y - d / 2, d, d);
    // the plasma core turning inside the glass
    ctx.globalCompositeOperation = 'lighter';
    const core = orbCore[tier], cd = r * 1.5;
    for (let k = 0; k < 2; k++) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(k ? -t * 0.9 : t * 1.4); ctx.globalAlpha = A * (k ? 0.55 : 0.75);
      ctx.drawImage(core, -cd / 2, -cd / 2, cd, cd); ctx.restore();
    }
    // crackling energy arcs
    ctx.strokeStyle = G.ORB_COLORS[tier][3]; ctx.lineWidth = Math.max(1.5, r * 0.06);
    const ta = t * 3;
    for (let k = 0; k < 3; k++) {
      const a0 = ta * (1 + k * 0.3) + k * 2.1;
      ctx.globalAlpha = A * (0.45 + 0.4 * Math.sin(ta * 5 + k));
      ctx.beginPath(); ctx.arc(x, y, r * (1.12 + k * 0.07), a0, a0 + 1.1); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A;
    // the top tier sits in a gold filigree cage
    if (tier === 3) {
      ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.strokeStyle = G.Mat.goldRound(ctx, -r, -r, r, r);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.02, 0, 7); ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const w = Math.abs(Math.cos(t * 0.6 + k * 1.047)) * r;
        ctx.beginPath(); ctx.ellipse(0, 0, w, r * 1.02, 0, 0, 7); ctx.stroke();
      }
      ctx.restore();
    }
    const label = value + 'x';
    G.goldText(ctx, label, x, y + r * 0.05, r * (label.length > 3 ? 0.62 : 0.78), { colors: ['#fffaf0', '#fff3d6', '#f3dfb0'], strokeColor: '#1a0730', stroke: 0.22 });
    ctx.restore();
  };

  // ---------------- cells ----------------
  // shineT / flipT: < 0 waiting (delay), 0..1 playing, null idle
  B.cells = Array.from({ length: CELLS }, () => ({ id: 'gold', y: 0, vy: 0, falling: false, delay: 0, squash: 0, win: false, dim: false,
    pop: -1, flash: 0, landed: true, shineT: null, flipT: null, dimK: 0 }));
  B.exiting = [];
  B.colAntic = new Array(COLS).fill(0);   // > 0 while a column is held back for anticipation
  B.orbs = [];
  B.onLand = null;                          // (i, cell) callback for sounds/FX
  B.highlightT = 0;

  B.setBoard = board => {
    for (let i = 0; i < CELLS; i++) Object.assign(B.cells[i], { id: board[i], y: Math.floor(i / COLS), vy: 0, falling: false, delay: 0, squash: 0, win: false, dim: false, dimK: 0, pop: -1, landed: true });
  };

  const GRAV = 46, BOUNCE = 0.2, STOPV = 1.2;
  let settleRes = null;
  const anyFalling = () => B.cells.some(c => c.falling) || B.exiting.length > 0;
  B.settled = () => new Promise(res => { if (!anyFalling()) res(); else settleRes = res; });

  /* The drop physics runs in steps of at most 1/120 s of game time. With longer
   * steps (slam-stop's 3.5x pace at 60 Hz, or a slow device) a landed cell's
   * smallest bounce stays above STOPV, so it would bounce forever and the round
   * would never settle. */
  B.update = dt => {
    const n = Math.max(1, Math.ceil(dt * 120 - 1e-9));
    for (let k = 0; k < n; k++) step(dt / n);
  };
  function step(dt) {
    for (let i = 0; i < CELLS; i++) {
      const c = B.cells[i];
      c.squash = Math.max(0, c.squash - dt * 6);
      c.flash = Math.max(0, c.flash - dt * 4);
      c.dimK = c.dim ? Math.min(1, c.dimK + dt / 0.15) : Math.max(0, c.dimK - dt / 0.15);
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
          if (!c.landed) { c.landed = true; lintGlint[i % COLS] = 1; if (B.onLand) B.onLand(i, c); }
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
    for (let c = 0; c < COLS; c++) if (lintGlint[c] > 0) lintGlint[c] = Math.max(0, lintGlint[c] - dt / 0.14);
    B.highlightT += dt;
  }

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
      Object.assign(c, { id: board[i], y: r - ROWS - 0.8, vy: 4, falling: true, delay: plan.colDelay[col], squash: 0, win: false, dim: false, dimK: 0, pop: -1, landed: false, fresh: true, shineT: null, flipT: null });
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
        Object.assign(cell, { id: after[i], win: false, dim: false, dimK: 0, pop: -1, squash: 0, flash: 0, shineT: null, flipT: null });
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

  // ---------------- frame (baked per layout) ----------------
  /* The back panel is a velvet tray with glass wells under the symbols. The
   * front frame (over the symbols, so drops slide in from behind it) is cast
   * and polished gold baked in parts: four corner arcs, two round rails, the
   * two forged Greek-key lintels and four jewelled rosettes. Every part also
   * carries two light layers baked with it (the mood fill from below and the
   * lightning specular from above), so the frame answers the storm without
   * being repainted. Parts are small strips, not one board-sized canvas. */
  let back = null, parts = null, topLintel = null, frameM = 0, bakedBack = false, prev = null;
  const lintGlint = new Array(COLS).fill(0);
  // the two bakes land on separate frames; in between, the old parts are drawn stretched to the new board
  B.invalidate = () => {
    if (parts && G.L.reel) prev = { parts, w: prevReel.w, h: prevReel.h };
    back = parts = topLintel = null;
  };
  let prevReel = { w: 1, h: 1 };
  const roundRectPath = (x, y, w, h, r) => {
    const p = new Path2D(); r = Math.max(0, Math.min(r, w / 2, h / 2));
    p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath();
    return p;
  };
  const FILLS = () => [G.Mat.fillRGB(0), G.Mat.fillRGB(1)];

  function bakeBack() {
    const M = G.Mat, L = G.L, r = L.reel, fp = L.fp, s = G.DPR;
    frameM = Math.round(fp * 1.4);
    const W = r.w + frameM * 2, H = r.h + frameM * 2, ox = frameM, oy = frameM, rad = fp * 1.1;
    const o = G.offscreen(W, H), x = o.x, cs = L.cell, gap = L.gap;
    const tray = roundRectPath(ox, oy, r.w, r.h, rad);
    // the frame's shadow on the world around the board
    M.lowres(x, [0, 0, W, H], 0.25, k => M.shadowOnly(k, c => { c.lineWidth = Math.max(4, fp * 0.55) + 3; c.strokeStyle = '#000'; c.stroke(tray); }, fp, fp * 0.12, fp * 0.3, 'rgba(0,0,0,.6)'), frameM + fp * 1.6);
    // violet velvet, lit from the upper left
    const vg = x.createLinearGradient(0, oy, 0, oy + r.h);
    vg.addColorStop(0, 'rgba(36,16,63,.95)'); vg.addColorStop(0.5, 'rgba(23,10,44,.95)'); vg.addColorStop(1, 'rgba(12,5,24,.97)');
    x.fillStyle = vg; x.fill(tray);
    x.save(); x.clip(tray);
    const kl = x.createRadialGradient(ox + r.w * 0.28, oy, 0, ox + r.w * 0.28, oy, r.h * 1.05);
    kl.addColorStop(0, 'rgba(190,150,255,.16)'); kl.addColorStop(1, 'rgba(190,150,255,0)');
    x.fillStyle = kl; x.fillRect(ox, oy, r.w, r.h);
    if (cs * s >= 40) M.texture(x, 'velvet', 0.05, 'fast', false, [ox, oy, r.w, r.h]);
    x.restore();
    // glass wells sunk into the velvet, lit along their lower lip (one baked well, stamped)
    const wr = cs * 0.14, wp = Math.ceil(cs * 0.05), ws = G.offscreen(cs + wp * 2, cs + wp * 2), wx = ws.x;
    const well = roundRectPath(wp + 1, wp + 1, cs - 2, cs - 2, wr);
    const wg = wx.createLinearGradient(0, wp, 0, wp + cs);
    wg.addColorStop(0, 'rgba(6,2,16,.40)'); wg.addColorStop(0.6, 'rgba(14,6,32,.22)'); wg.addColorStop(1, 'rgba(40,20,80,.20)');
    wx.fillStyle = wg; wx.fill(well);
    M.innerShadow(wx, well, cs * 0.07, cs * 0.01, cs * 0.028, 'rgba(0,0,0,.6)', [wp, wp, cs, cs]);
    wx.save(); wx.clip(well);
    const lip = wx.createLinearGradient(0, wp + cs * 0.5, 0, wp + cs);
    lip.addColorStop(0, 'rgba(200,170,255,0)'); lip.addColorStop(1, 'rgba(200,170,255,.2)');
    wx.translate(0, -1 / s); wx.lineWidth = 2.4 / s; wx.strokeStyle = lip; wx.stroke(well);
    wx.restore();
    for (let i = 0; i < CELLS; i++) {
      const cx = ox + fp + (i % COLS) * (cs + gap), cy = oy + fp + Math.floor(i / COLS) * (cs + gap);
      x.drawImage(ws.c, cx - wp, cy - wp, cs + wp * 2, cs + wp * 2);
    }
    // engraved column grooves with gold pins where the rows meet
    for (let c = 1; c < COLS; c++) {
      const dx = ox + fp + c * (cs + gap) - gap / 2, y0 = oy + fp * 0.6, y1 = oy + r.h - fp * 0.6;
      const p = new Path2D(); p.moveTo(dx, y0); p.lineTo(dx, y1);
      const fade = (rgb, a) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.5, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); return g; };
      M.engrave(x, p, Math.max(1 / s, gap * 0.16), fade('0,0,0', 0.6), fade('255,215,140', 0.24));
    }
    const pr = gap * 0.42;
    if (pr * s >= 2) {
      const pp = Math.ceil(pr * 2), pz = pr * 2 + pp * 2, pin = G.offscreen(pz, pz), px0 = pz / 2;
      M.shadowOnly(pin.x, k => { k.beginPath(); k.arc(px0, px0, pr, 0, 7); k.fill(); }, pr * 0.9, pr * 0.25, pr * 0.45, 'rgba(0,0,0,.7)');
      pin.x.fillStyle = M.goldDome(pin.x, px0, px0, pr); pin.x.beginPath(); pin.x.arc(px0, px0, pr, 0, 7); pin.x.fill();
      for (let c = 1; c < COLS; c++) for (let rr = 1; rr < ROWS; rr++) {
        const px = ox + fp + c * (cs + gap) - gap / 2, py = oy + fp + rr * (cs + gap) - gap / 2;
        x.drawImage(pin.c, px - px0, py - px0, pz, pz);
      }
    }
    // the frame overhang shades the tray's edge (deepest at the top left, away from the key light)
    M.lowres(x, [ox, oy, r.w, r.h], 0.35, k => M.innerShadow(k, tray, fp * 0.9, fp * 0.12, fp * 0.24, 'rgba(0,0,0,.72)', [ox, oy, r.w, r.h]), fp * 2.4);
    back = o.c;
  }

  // ---- parts: each returns { base, fill: [dusk, storm], spec, w, h, ox, oy } (ox/oy = its origin inside the canvas)
  // small parts bake at a higher resolution and are drawn scaled down, so the key rhythm stays crisp at 400×225
  const bakeDPR = (size, want) => Math.max(G.DPR, Math.min(3, want / size));

  function bakeLintel(lw, lh) {
    const M = G.Mat, dpr = bakeDPR(lh, 30), pad = Math.ceil(lh * 0.5);
    const W = lw + pad * 2, H = lh + pad * 2, lx = pad, ly = pad;
    const o = G.offscreen(W, H, dpr), x = o.x, d = 1 / dpr;
    const inset = lh * 0.16, ih = lh - inset * 2.6, iy = ly + inset * 1.3, u = ih * 1.25;
    const n = Math.floor((lw - inset * 2) / u), sx = lx + (lw - n * u) / 2;
    const body = roundRectPath(lx, ly, lw, lh, lh * 0.2);
    const rec = new Path2D(); rec.rect(lx + inset, ly + inset, lw - inset * 2, lh - inset * 2);
    // its shadow on the board and the sky below
    M.shadowOnly(x, c => c.fill(body), lh * 0.35, lh * 0.06, lh * 0.2, 'rgba(0,0,0,.55)');
    // polished lips: the frame's own ramp, brushed along the part
    x.fillStyle = M.goldBar(x, ly, ly + lh); x.fill(body);
    x.save(); x.clip(body);
    if (M.lod.grain(lh * dpr)) M.texture(x, 'brushed', 0.07, 'overlay', false, [lx, ly, lw, lh]);
    x.fillStyle = 'rgba(255,252,228,.75)'; x.fillRect(lx, ly, lw, d * 1.2);                 // lit top chamfer
    x.fillStyle = 'rgba(42,20,4,.85)'; x.fillRect(lx, ly + lh - d * 1.2, lw, d * 1.2);       // dark bottom chamfer
    // a narrow polished streak along the top lip, fading towards the ends
    const st = x.createLinearGradient(lx, 0, lx + lw, 0);
    [[0, 0], [0.12, 0.32], [0.5, 0.4], [0.88, 0.32], [1, 0]].forEach(([k, a]) => st.addColorStop(k, `rgba(255,255,236,${a})`));
    x.globalCompositeOperation = 'lighter'; x.fillStyle = st;
    x.fillRect(lx, ly + inset * 0.28, lw, Math.max(d, inset * 0.24));
    x.restore();
    x.lineWidth = d * 1.2; x.strokeStyle = 'rgba(42,20,4,.9)'; x.stroke(body);
    // the bronze channel: darker under the top lip, grime gathering towards the ends
    const rg = x.createLinearGradient(0, ly + inset, 0, ly + lh - inset);
    rg.addColorStop(0, '#1c0902'); rg.addColorStop(0.45, '#3b1605'); rg.addColorStop(1, '#4a1d07');
    x.fillStyle = rg; x.fill(rec);
    x.save(); x.clip(rec);
    if (M.lod.grain(ih * dpr)) M.texture(x, 'pitting', 0.04, 'overlay', false, [lx, ly, lw, lh]);
    const gg = x.createLinearGradient(lx, 0, lx + lw, 0);
    [[0, 0.55], [0.1, 0], [0.9, 0], [1, 0.55]].forEach(([k, a]) => gg.addColorStop(k, `rgba(8,2,0,${a})`));
    x.fillStyle = gg; x.fillRect(lx, ly, lw, lh);
    x.fillStyle = 'rgba(255,214,140,.45)'; x.fillRect(lx + inset, ly + lh - inset - d, lw - inset * 2, d);   // lit lower wall
    x.restore();
    M.innerShadow(x, rec, inset * 0.9, 0, inset * 0.5, 'rgba(0,0,0,.85)', [lx, ly, lw, lh]);
    // the key: the same path and rhythm as always, now raised cast bars
    const keys = new Path2D(), units = [];
    for (let k = 0; k < n; k++) {
      const X = v => sx + k * u + v * u * 0.9, Y = v => iy + v * ih, p = new Path2D();
      p.moveTo(X(0), Y(1)); p.lineTo(X(0), Y(0)); p.lineTo(X(0.75), Y(0)); p.lineTo(X(0.75), Y(0.7)); p.lineTo(X(0.36), Y(0.7)); p.lineTo(X(0.36), Y(0.36));
      p.moveTo(X(0), Y(1)); p.lineTo(X(1.11), Y(1));
      keys.addPath(p); units.push(p);
    }
    const kw = Math.max(1, ih * 0.16);
    const bev = M.lod.bevel(kw * dpr) ? Math.max(0.7 * d, kw * 0.2) : 0;
    const K = M.raisedStroke(W, H, dpr, keys, kw, c => M.goldCast(c, iy, iy + ih), { bevel: bev, light: '#fff6d4', dark: '#6e430c' }), kx = K.x;
    // every unit cast a touch differently (±4%), rubbed brighter towards the rosettes
    const rnd = M.mulberry(500);
    kx.save(); kx.globalCompositeOperation = 'source-atop'; kx.lineWidth = kw * 1.6;
    units.forEach(p => { const v = (rnd() - 0.5) * 0.08; kx.strokeStyle = v > 0 ? `rgba(255,248,220,${v})` : `rgba(40,16,0,${-v})`; kx.stroke(p); });
    const rub = kx.createLinearGradient(lx, 0, lx + lw, 0);
    [[0, 0.2], [0.09, 0], [0.91, 0], [1, 0.2]].forEach(([k, a]) => rub.addColorStop(k, `rgba(255,250,226,${a})`));
    kx.fillStyle = rub; kx.fillRect(0, 0, W, H);
    M.wearSpots(77, 3).forEach(w => {
      const wx = lx + lw * (0.15 + w.u * 0.7), g = kx.createRadialGradient(wx, iy + ih * 0.3, 0, wx, iy + ih * 0.3, ih * (0.8 + w.s));
      g.addColorStop(0, 'rgba(255,250,226,.12)'); g.addColorStop(1, 'rgba(255,250,226,0)');
      kx.fillStyle = g; kx.fillRect(0, 0, W, H);
    });
    kx.restore();
    if (M.lod.grain(ih * dpr)) M.texture(kx, 'grain', 0.05, 'overlay', true);
    M.shadowOnly(x, c => c.drawImage(K.c, 0, 0, W, H), kw * 0.9, kw * 0.18, kw * 0.45, 'rgba(10,3,0,.95)');
    x.drawImage(K.c, 0, 0, W, H);
    // light layers
    const keyShape = c => c.drawImage(K.c, 0, 0, W, H);
    const spec = M.lightLayer(W, H, dpr, c => { keyShape(c); c.save(); c.clip(body); c.fillRect(lx, ly, lw, inset * 0.9); c.restore(); }, '255,246,222', ly, 1, iy + ih, 0.12);
    const fill = FILLS().map(rgb => M.lightLayer(W, H, dpr, c => { keyShape(c); c.save(); c.clip(body); c.fillRect(lx, ly + lh - inset * 1.1, lw, inset * 1.1); c.restore(); }, rgb, iy + ih * 0.45, 0, ly + lh, 1));
    return { base: o.c, fill: fill.map(f => f.c), spec: spec.c, w: W, h: H, ox: lx, oy: ly, dpr };
  }

  /* One side of the frame: a round bar that bends round both corners. Local
   * x = 0 is the board edge (the board lies at +x for the left side, -x for
   * the right); y runs from the top of the board (0) to its bottom (rh). The
   * key light falls from the left, so every straight run is lit on its left
   * flank: the outside of the bend on the left, the inside on the right. */
  function bakeSide(left, rh, rad, bw) {
    const M = G.Mat, dpr = bakeDPR(rad, 24), d = 1 / dpr, pad = Math.ceil(bw * 0.9) + 2, half = bw / 2 + 1.2, dir = left ? 1 : -1;
    const ox = left ? half + pad : rad + pad, oy = pad, W = rad + half + pad * 2, H = rh + pad * 2;
    const path = k => {                         // k = offset of a line parallel to the bar's centre, towards +x
      const P = new Path2D(), PI = Math.PI;
      if (left) { P.arc(rad, rad, rad - k, PI * 1.5, PI, true); P.lineTo(k, rh - rad); P.arc(rad, rh - rad, rad - k, PI, PI * 0.5, true); }
      else { P.arc(-rad, rad, rad + k, PI * 1.5, PI * 2); P.lineTo(k, rh - rad); P.arc(-rad, rh - rad, rad + k, 0, PI * 0.5); }
      return P;
    };
    const bar = path(0), streak = path(-bw * 0.23);
    // the bar on its own layer: radial ramps round the bends, a straight ramp between them
    const B = G.offscreen(W, H, dpr), bx = B.x;
    bx.translate(ox, oy); bx.lineCap = 'butt'; bx.lineWidth = bw;
    const band = (y0, y1, style) => { bx.save(); bx.beginPath(); bx.rect(-W, y0, W * 2, y1 - y0); bx.clip(); bx.strokeStyle = style; bx.stroke(bar); bx.restore(); };
    band(-pad, rad + 0.5, M.goldRoundRadial(bx, dir * rad, rad, rad - bw / 2, rad + bw / 2, left));
    band(rh - rad - 0.5, rh + pad, M.goldRoundRadial(bx, dir * rad, rh - rad, rad - bw / 2, rad + bw / 2, left));
    band(rad - 0.5, rh - rad + 0.5, M.goldRound(bx, -bw / 2, 0, bw / 2, 0));
    bx.setTransform(1, 0, 0, 1, 0, 0);
    if (M.lod.grain(bw * dpr)) M.texture(bx, 'brushedV', 0.06, 'overlay', true);
    const o = G.offscreen(W, H, dpr), x = o.x;
    x.translate(ox, oy); x.lineCap = 'butt';
    M.shadowOnly(x, c => { c.lineWidth = bw + 2.4; c.stroke(bar); }, bw * 0.7, bw * 0.15, bw * 0.3, 'rgba(0,0,0,.5)');
    x.lineWidth = bw + 2.4; x.strokeStyle = '#2a1404'; x.stroke(bar);
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(B.c, 0, 0);
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.translate(ox, oy);
    x.globalCompositeOperation = 'lighter'; x.lineWidth = Math.max(d, bw * 0.07); x.strokeStyle = 'rgba(255,255,236,.3)'; x.stroke(streak);
    // light layers
    const shape = c => { c.save(); c.translate(ox, oy); c.lineCap = 'butt'; c.lineWidth = bw; c.stroke(bar); c.restore(); };
    const spec = M.lightLayer(W, H, dpr, shape, '255,246,222', oy, 0.3, oy + rh, 0.2);
    spec.x.translate(ox, oy); spec.x.lineCap = 'butt'; spec.x.lineWidth = bw * 0.36; spec.x.strokeStyle = 'rgba(255,246,222,.9)'; spec.x.stroke(streak);
    const fill = FILLS().map(rgb => M.lightLayer(W, H, dpr, shape, rgb, oy, 0.3, oy + rh, 0.75));
    return { base: o.c, fill: fill.map(f => f.c), spec: spec.c, w: W, h: H, ox, oy, dpr };
  }

  // a jewelled rosette: grooved cast petals, a milgrain bezel and a faceted ruby
  function bakeRosette(rr) {
    const M = G.Mat, dpr = bakeDPR(rr, 30), d = 1 / dpr, pad = Math.ceil(rr * 0.6);
    const S = rr * 2 + pad * 2, c = S / 2;
    const o = G.offscreen(S, S, dpr), x = o.x;
    const petals = new Path2D(), P = (a, r) => [c + Math.cos(a) * r * rr, c + Math.sin(a) * r * rr];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 - Math.PI / 2, p0 = P(a - Math.PI / 8, 0.62), q = P(a, 1.25), p2 = P(a + Math.PI / 8, 0.62);
      if (!k) petals.moveTo(p0[0], p0[1]);
      petals.quadraticCurveTo(q[0], q[1], p2[0], p2[1]);
    }
    petals.closePath();
    M.shadowOnly(x, k => k.fill(petals), rr * 0.35, rr * 0.1, rr * 0.2, 'rgba(0,0,0,.6)');
    x.fillStyle = M.goldDome(x, c, c, rr); x.fill(petals);
    if (rr * dpr >= 14) {
      const veins = new Path2D();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 - Math.PI / 2, p = P(a, 0.56), q = P(a, 0.84); veins.moveTo(p[0], p[1]); veins.lineTo(q[0], q[1]); }
      M.engrave(x, veins, Math.max(0.7 * d, rr * 0.05), 'rgba(60,30,4,.75)', 'rgba(255,240,190,.45)');
    }
    x.lineWidth = d * 1.2; x.strokeStyle = '#4a2a04'; x.stroke(petals);
    // bezel: milgrain beads when there is room, a plain gold ring otherwise
    const br = rr * 0.5;
    if (M.lod.facets(rr * dpr)) {
      const n = Math.max(12, Math.round((Math.PI * 2 * br) / (rr * 0.12))), bead = rr * 0.05;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, bx = c + Math.cos(a) * br, by = c + Math.sin(a) * br;
        x.fillStyle = M.goldDome(x, bx, by, bead); x.beginPath(); x.arc(bx, by, bead, 0, 7); x.fill();
      }
    } else { x.lineWidth = rr * 0.08; x.strokeStyle = M.goldRound(x, c - br, c - br, c + br, c + br); x.beginPath(); x.arc(c, c, br, 0, 7); x.stroke(); }
    // the ruby
    const rb = rr * 0.4;
    x.fillStyle = '#3a020c'; x.beginPath(); x.arc(c, c, rb, 0, 7); x.fill();
    if (M.lod.facets(rb * 2 * dpr)) {
      const oct = (r, i) => P((i / 8) * Math.PI * 2 + Math.PI / 8, r / rr);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 4, lit = 0.5 + 0.5 * (Math.cos(a) * M.LIGHT.x + Math.sin(a) * M.LIGHT.y);
        const p = [oct(rb * 0.9, i), oct(rb * 0.9, i + 1), oct(rb * 0.48, i + 1), oct(rb * 0.48, i)];
        x.fillStyle = `rgb(${Math.round(90 + 165 * lit)},${Math.round(8 + 70 * lit * lit)},${Math.round(26 + 90 * lit * lit)})`;
        x.beginPath(); p.forEach(q => x.lineTo(q[0], q[1])); x.closePath(); x.fill();
      }
      const tg = x.createRadialGradient(c - rb * 0.15, c - rb * 0.2, 0, c, c, rb * 0.5);
      tg.addColorStop(0, '#ff7090'); tg.addColorStop(1, '#b0102e');
      x.fillStyle = tg; x.beginPath(); for (let i = 0; i < 8; i++) { const q = oct(rb * 0.48, i); x.lineTo(q[0], q[1]); } x.closePath(); x.fill();
    } else {
      const gg = x.createRadialGradient(c - rb * 0.3, c - rb * 0.37, rb * 0.05, c, c, rb);
      gg.addColorStop(0, '#ffd0e0'); gg.addColorStop(0.5, '#e0204a'); gg.addColorStop(1, '#5a0414');
      x.fillStyle = gg; x.beginPath(); x.arc(c, c, rb * 0.92, 0, 7); x.fill();
    }
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(c - rb * 0.36, c - rb * 0.42, Math.max(d, rb * 0.15), 0, 7); x.fill();
    x.fillStyle = 'rgba(255,170,190,.35)'; x.beginPath(); x.arc(c + rb * 0.35, c + rb * 0.38, Math.max(d, rb * 0.12), 0, 7); x.fill();
    const disc = k => { k.beginPath(); k.arc(c, c, rr, 0, 7); k.fill(); };
    const spec = M.lightLayer(S, S, dpr, k => k.fill(petals), '255,246,222', c - rr, 0.9, c + rr * 0.3, 0);
    const fill = FILLS().map(rgb => M.lightLayer(S, S, dpr, disc, rgb, c, 0, c + rr, 0.8));
    return { base: o.c, fill: fill.map(f => f.c), spec: spec.c, w: S, h: S, ox: c, oy: c, dpr };
  }

  function bakeParts() {
    const L = G.L, r = L.reel, fp = L.fp;
    const rad = fp * 1.1, bw = Math.max(4, fp * 0.55), lh = Math.max(10, fp * 0.95), rr = Math.max(7, fp * 0.7);
    const at = (it, x, y) => ({ it, x: x - it.ox, y: y - it.oy });
    const out = [];
    out.push(at(bakeSide(true, r.h, rad, bw), 0, 0), at(bakeSide(false, r.h, rad, bw), r.w, 0));
    const lint = bakeLintel(r.w - rad * 1.2, lh);
    topLintel = at(lint, rad * 0.6, -lh * 0.45);
    out.push(topLintel, at(lint, rad * 0.6, r.h - lh * 0.55));
    const ros = bakeRosette(rr);
    [[0, 0], [r.w, 0], [0, r.h], [r.w, r.h]].forEach(([cx, cy]) => out.push(at(ros, cx, cy)));
    parts = out;
  }

  // ---------------- drawing ----------------
  B.drawBack = ctx => {
    if (!back) { bakeBack(); bakedBack = true; }
    const r = G.L.reel;
    ctx.drawImage(back, r.x - frameM, r.y - frameM, back.width / G.DPR, back.height / G.DPR);
    if (G.S.mood > 0) {
      ctx.save(); G.roundRect(ctx, r.x, r.y, r.w, r.h, G.L.fp * 1.1);
      ctx.fillStyle = `rgba(255,170,60,${0.07 * G.S.mood})`; ctx.fill(); ctx.restore();
    }
  };
  B.drawFront = ctx => {
    const r = G.L.reel;
    if (!parts && bakedBack && prev) {
      bakedBack = false;
      ctx.save(); ctx.translate(r.x, r.y); ctx.scale(r.w / prev.w, r.h / prev.h);
      for (const p of prev.parts) ctx.drawImage(p.it.base, p.x, p.y, p.it.w, p.it.h);
      ctx.restore();
      return;
    }
    bakedBack = false;
    if (!parts) { bakeParts(); prevReel = { w: r.w, h: r.h }; prev = null; }
    const mood = G.S.mood, fk = G.Mat.LIGHT.fillK;
    for (const p of parts) ctx.drawImage(p.it.base, r.x + p.x, r.y + p.y, p.it.w, p.it.h);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // the mood fill from below: violet at dusk, amber in the storm
    for (let k = 0; k < 2; k++) {
      const a = fk * (k ? mood : 1 - mood);
      if (a < 0.005) continue;
      ctx.globalAlpha = a;
      for (const p of parts) ctx.drawImage(p.it.fill[k], r.x + p.x, r.y + p.y, p.it.w, p.it.h);
    }
    // lightning catches every polished edge at once (skyFlash is already limited for reduced motion and flashes)
    const fl = G.Scene && G.Scene.skyFlash ? G.Scene.skyFlash() : 0;
    if (fl > 0.02) {
      ctx.globalAlpha = Math.min(0.6, fl * 0.8);
      for (const p of parts) ctx.drawImage(p.it.spec, r.x + p.x, r.y + p.y, p.it.w, p.it.h);
    }
    // a column that just landed glints the lintel above it
    const t = topLintel;
    if (t) {
      const sk = t.it.spec.width / t.it.w;
      for (let c = 0; c < COLS; c++) {
        const g = lintGlint[c];
        if (g <= 0) continue;
        const x0 = Math.max(0, G.cellX(c) - r.x - t.x - G.L.gap / 2), w = Math.min(t.it.w - x0, G.L.cell + G.L.gap);
        if (w <= 0) continue;
        ctx.globalAlpha = 0.55 * g * g;
        ctx.drawImage(t.it.spec, x0 * sk, 0, w * sk, t.it.spec.height, r.x + t.x + x0, r.y + t.y, w, t.it.h);
      }
    }
    ctx.restore();
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

    // contact shadows on the tray: soft while a symbol is still above its well,
    // tight once it sits in it; winners lift off a little (lean quality: winners only)
    const allShadows = G.Q.level > 0, shs = (SPR + 40) / SPR;
    for (let i = 0; i < CELLS; i++) {
      const c = B.cells[i];
      if ((c.falling && c.delay > 0) || c.pop >= 0.4 || (!allShadows && !c.win)) continue;
      const tr = Math.floor(i / COLS), dist = Math.max(0, tr - c.y) + (c.win ? 0.22 : 0), k = 1 - dist / 1.6;
      if (k <= 0) continue;
      const sz = cs * 0.92 * shs * (1 + dist * 0.14), sx = G.cellX(i % COLS) + cs * (0.5 + 0.035 * (1 + dist * 1.5)), sy = G.cellY(tr) + cs * (0.5 + 0.06 * (1 + dist * 1.5));
      ctx.globalAlpha = 0.5 * k * (1 - c.dimK * 0.4) * (c.pop >= 0 ? 1 - c.pop / 0.4 : 1);
      ctx.drawImage(B.shadow[c.id], sx - sz / 2, sy - sz / 2, sz, sz);
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
      const dk = c.dimK;
      ctx.globalAlpha = alpha * (1 - dk * 0.12);
      ctx.drawImage(B.spr[c.id], -size / 2, -size / 2, size, size);
      if (dk > 0) { ctx.globalAlpha = alpha * dk; ctx.drawImage(B.dim[c.id], -size / 2, -size / 2, size, size); }
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
      if (!c.falling && c.pop < 0 && !c.dim) {
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

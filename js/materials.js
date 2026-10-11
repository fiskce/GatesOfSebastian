/* Thunder Hunter Sebastian — the material library ("Forged Storm").
 *
 * One gold, one light and a handful of micro-surfaces shared by everything
 * that is drawn as an object: the frame, the tray, the orbs and the chrome.
 * All of it runs at bake time (once per layout), so per-frame code only draws
 * caches. Detail is decided in DEVICE pixels: small parts get fewer, larger
 * cues instead of shrunken noise.
 *
 * Light: one warm key from the upper left, a mood fill from below (violet at
 * dusk, amber in the storm). Only the storm moves the light.
 *
 * Wear is a cared-for heirloom: polished raised edges, rubbed contact points,
 * darker recesses. Grain stays at or under 6%.
 */
(() => {
  'use strict';
  const G = window.GOS;
  const M = G.Mat = {};

  M.GOLD = { hi: '#fff4c2', lit: '#f2c95a', mid: '#e6b648', shade: '#9a6614', deep: '#5e3a08', edge: '#2a1404', key: '#f0c45a' };
  // key light direction (towards the light), colour, and the mood fill from below
  M.LIGHT = { x: -0.57, y: -0.82, key: '#fff1d6', fill: [[122, 60, 255], [255, 122, 26]], fillK: 0.22 };
  M.fillRGB = mood => M.LIGHT.fill[0].map((v, i) => Math.round(v + (M.LIGHT.fill[1][i] - v) * mood)).join(',');

  M.mulberry = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // device pixels per CSS pixel of a context (the offscreen helper bakes at DPR)
  M.scale = ctx => (ctx.getTransform ? ctx.getTransform().a : G.DPR) || 1;
  // level of detail, all thresholds in device pixels
  M.lod = {
    grain: px => px >= 14,          // micro-surface only on surfaces this tall
    bevel: px => px >= 3,           // 4-pass bevel only when the stroke is this wide
    facets: px => px >= 18,         // faceted rubies
    knurl: px => px >= 60,          // knurled rings
  };

  // ---------------- ramps ----------------
  const stops = (g, list) => { list.forEach(s => g.addColorStop(s[0], s[1])); return g; };
  // the lintel's own ramp (the look the frame is known for), across a horizontal part
  M.goldBar = (ctx, y0, y1) => stops(ctx.createLinearGradient(0, y0, 0, y1),
    [[0, '#fff4c2'], [0.2, '#e6b648'], [0.4, '#8a5a10'], [0.6, '#f2c95a'], [0.8, '#9a6614'], [1, '#ffe9a0']]);
  // a round bar seen side-on, from its lit flank (x0,y0) to its far flank (x1,y1)
  M.goldRound = (ctx, x0, y0, x1, y1) => stops(ctx.createLinearGradient(x0, y0, x1, y1),
    [[0, '#7a4c0c'], [0.1, '#c08a2c'], [0.27, '#fff4c2'], [0.37, '#f2c95a'], [0.58, '#d6a23e'], [0.8, '#9a6614'], [0.93, '#5e3a08'], [1, '#2a1404']]);
  M.goldRoundRadial = (ctx, cx, cy, r0, r1, litOuter) => {
    const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    const s = [[0, '#7a4c0c'], [0.1, '#c08a2c'], [0.27, '#fff4c2'], [0.37, '#f2c95a'], [0.58, '#d6a23e'], [0.8, '#9a6614'], [0.93, '#5e3a08'], [1, '#2a1404']];
    return stops(g, litOuter ? s.map(p => [1 - p[0], p[1]]).reverse() : s);
  };
  // cast gold face (keys, bosses): the key light falls off down the part
  M.goldCast = (ctx, y0, y1) => stops(ctx.createLinearGradient(0, y0, 0, y1),
    [[0, '#ffeaa8'], [0.3, '#f3c95c'], [0.7, '#cf9834'], [1, '#93621a']]);
  // a dome lit from the upper left
  M.goldDome = (ctx, cx, cy, r) => stops(ctx.createRadialGradient(cx + M.LIGHT.x * r * 0.42, cy + M.LIGHT.y * r * 0.42, r * 0.04, cx, cy, r),
    [[0, '#fff6cf'], [0.25, '#f6d06a'], [0.6, '#d29c38'], [0.85, '#8a5a12'], [1, '#4a2a06']]);

  // ---------------- micro-surface tiles ----------------
  // Grey tiles centred on 50% so 'overlay' leaves the base untouched on average.
  const SEEDS = { grain: 11, brushed: 23, brushedV: 23, pitting: 37, velvet: 41 };
  const tiles = {};
  M.tile = kind => tiles[kind] || (tiles[kind] = makeTile(kind));
  function makeTile(kind) {
    if (kind.endsWith('±')) {               // the same surface as white/black alpha, for plain source-over
      const src = M.tile(kind.slice(0, -1)), W = src.width, H = src.height, c = document.createElement('canvas');
      c.width = W; c.height = H;
      const sx = src.getContext('2d'), x = c.getContext('2d'), a = sx.getImageData(0, 0, W, H).data, img = x.createImageData(W, H), d = img.data;
      for (let i = 0; i < a.length; i += 4) { const v = (a[i] - 128) / 128; d[i] = d[i + 1] = d[i + 2] = v > 0 ? 255 : 0; d[i + 3] = Math.min(255, Math.abs(v) * 255); }
      x.putImageData(img, 0, 0);
      return c;
    }
    if (kind === 'brushedV') {             // the brushed tile turned on its side
      const src = M.tile('brushed'), c = document.createElement('canvas');
      c.width = src.height; c.height = src.width;
      const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0);
      return c;
    }
    const W = kind === 'brushed' ? 256 : 128, H = 128, n = W * H, r = M.mulberry(SEEDS[kind] || 1);
    let v = new Float32Array(n);
    const gauss = () => (r() + r() + r() - 1.5) / 0.5;
    if (kind === 'grain') for (let i = 0; i < n; i++) v[i] = gauss();
    else if (kind === 'brushed') {
      // long horizontal streaks: every row has its own level plus a slow wave
      for (let y = 0; y < H; y++) {
        const base = gauss() * 0.9, k = 1 + ((r() * 3) | 0), ph = r() * 6.283, a = r() * 0.6;
        for (let x = 0; x < W; x++) v[y * W + x] = base + a * Math.sin((x / W) * 6.283 * k + ph) + gauss() * 0.18;
      }
      v = blur(v, W, H, 0, 1);              // streaks two pixels wide
    } else if (kind === 'pitting') {
      for (let i = 0; i < n; i++) v[i] = gauss() * 0.3;
      for (let k = 0; k < 90; k++) {        // pits: a dark hole with a lit far rim
        const cx = r() * W, cy = r() * H, rad = 0.6 + r() * 1.2;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dy) / rad, i = ((Math.floor(cy + dy) + H) % H) * W + ((Math.floor(cx + dx) + W) % W);
          if (d < 1) v[i] -= 2.2 * (1 - d);
          else if (d < 1.7 && dx + dy > 0) v[i] += 0.9 * (1.7 - d);
        }
      }
    } else if (kind === 'velvet') {
      for (let i = 0; i < n; i++) v[i] = gauss();
      v = blur(v, W, H, 1, 1);
      const fine = new Float32Array(n); for (let i = 0; i < n; i++) fine[i] = gauss();
      normalise(v); for (let i = 0; i < n; i++) v[i] += fine[i] * 0.6;
    }
    normalise(v);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < n; i++) {
      const g = Math.max(0, Math.min(255, Math.round(128 + v[i] * 42)));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; d[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  function normalise(v) {
    let m = 0, s = 0; for (let i = 0; i < v.length; i++) m += v[i]; m /= v.length;
    for (let i = 0; i < v.length; i++) s += (v[i] - m) * (v[i] - m); s = Math.sqrt(s / v.length) || 1;
    for (let i = 0; i < v.length; i++) v[i] = (v[i] - m) / s;
  }
  // wrap-around box blur (rx, ry in pixels)
  function blur(v, W, H, rx, ry) {
    const o = new Float32Array(v.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, k = 0;
      for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) { s += v[((y + dy + H) % H) * W + ((x + dx + W) % W)]; k++; }
      o[y * W + x] = s / k;
    }
    return o;
  }

  // patterns may belong to the context that made them, so cache per context
  const patCache = new WeakMap();
  M.pattern = (ctx, kind) => {
    let m = patCache.get(ctx); if (!m) patCache.set(ctx, m = {});
    return m[kind] || (m[kind] = ctx.createPattern(M.tile(kind), 'repeat'));
  };

  /* Lay a micro-surface over the current clip, fixed in device pixels.
   * amount = luminance swing (0.06 = ±6%). With self = true the texture is
   * trimmed back to what is already on the canvas (for parts baked on their
   * own layer), otherwise the caller clips. blend 'fast' lays a signed
   * white/black tile with plain source-over: cheaper on large dark areas. */
  M.texture = (ctx, kind, amount, blend, self, box) => {
    const c = ctx.canvas, keep = self ? copy(c) : null, s = M.scale(ctx);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fast = blend === 'fast';
    ctx.globalCompositeOperation = fast ? 'source-over' : blend || 'overlay';
    ctx.globalAlpha = Math.min(1, fast ? amount * 1.5 : amount / 0.16);
    ctx.fillStyle = M.pattern(ctx, fast ? kind + '±' : kind);
    if (box) ctx.fillRect(Math.floor(box[0] * s), Math.floor(box[1] * s), Math.ceil(box[2] * s) + 2, Math.ceil(box[3] * s) + 2);
    else ctx.fillRect(0, 0, c.width, c.height);
    if (keep) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(keep, 0, 0); }
    ctx.restore();
  };
  function copy(src) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0); return c;
  }

  // ---------------- relief ----------------
  // a shadow cast INTO a shape from its edges (recesses, wells, overhangs); bake time only.
  // box = the shape's bounds [x, y, w, h], so the blur only works on the area around it
  M.innerShadow = (ctx, path, blur, ox, oy, color, box) => {
    const s = M.scale(ctx), m = blur * 2 + Math.abs(ox) + Math.abs(oy) + 2, inv = new Path2D();
    if (box) inv.rect(box[0] - m, box[1] - m, box[2] + m * 2, box[3] + m * 2); else inv.rect(-1e4, -1e4, 2e4, 2e4);
    inv.addPath(path);
    ctx.save(); ctx.clip(path);
    ctx.shadowColor = color; ctx.shadowBlur = blur * s; ctx.shadowOffsetX = ox * s; ctx.shadowOffsetY = oy * s;
    ctx.fillStyle = '#000'; ctx.fill(inv, 'evenodd');
    ctx.restore();
  };
  // only the shadow of whatever draw(ctx) paints (cast shadows, contact occlusion)
  M.shadowOnly = (ctx, draw, blur, ox, oy, color) => {
    const s = M.scale(ctx), far = 4000;
    ctx.save(); ctx.translate(-far, 0);
    ctx.shadowColor = color; ctx.shadowBlur = blur * s; ctx.shadowOffsetX = (far + ox) * s; ctx.shadowOffsetY = oy * s;
    draw(ctx); ctx.restore();
  };
  /* Run fn on a low-resolution layer covering box and draw it back scaled up.
   * For wide soft shadows: the blur is low-frequency, so a quarter of the
   * pixels look the same and cost a fraction. Note: fn works in the same
   * CSS-pixel coordinates as ctx (without ctx's current transform offsets). */
  M.lowres = (ctx, box, k, fn, ring) => {
    const d = Math.max(0.2, M.scale(ctx) * k), t = G.offscreen(box[2], box[3], d), [bx, by, bw, bh] = box;
    t.x.translate(-bx, -by); fn(t.x);
    if (!ring || ring * 2 >= Math.min(bw, bh)) { ctx.drawImage(t.c, bx, by, bw, bh); return; }
    // only the bands along the edges carry anything worth copying
    const band = (x, y, w, h) => ctx.drawImage(t.c, (x - bx) * d, (y - by) * d, w * d, h * d, x, y, w, h);
    band(bx, by, bw, ring); band(bx, by + bh - ring, bw, ring);
    band(bx, by + ring, ring, bh - ring * 2); band(bx + bw - ring, by + ring, ring, bh - ring * 2);
  };
  // a groove cut into the surface: dark wall towards the light, lit wall away from it
  M.engrave = (ctx, path, w, dark, light) => {
    const d = 1 / M.scale(ctx);
    ctx.save(); ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.strokeStyle = light || 'rgba(255,236,190,.35)'; ctx.translate(d * 0.6, d * 0.85); ctx.stroke(path);
    ctx.strokeStyle = dark || 'rgba(20,6,0,.8)'; ctx.translate(-d * 0.6, -d * 0.85); ctx.stroke(path);
    ctx.restore();
  };
  // a raised ridge: lit edge towards the light, dark edge away from it
  M.emboss = (ctx, path, w, light, dark) => {
    const d = 1 / M.scale(ctx);
    ctx.save(); ctx.lineWidth = w;
    ctx.strokeStyle = dark || 'rgba(30,10,0,.7)'; ctx.translate(d * 0.6, d * 0.85); ctx.stroke(path);
    ctx.strokeStyle = light || 'rgba(255,246,214,.6)'; ctx.translate(-d * 1.2, -d * 1.7); ctx.stroke(path);
    ctx.restore();
  };

  /* A raised bar stroked along `path`, chamfered on every side (light edge
   * towards the key light, dark edge away), trimmed to the bar, on its own
   * layer so callers can texture it and cast its shadow. */
  M.raisedStroke = (w, h, dpr, path, lw, body, opt) => {
    opt = opt || {};
    const L = G.offscreen(w, h, dpr), x = L.x;
    x.lineJoin = opt.join || 'miter'; x.lineCap = opt.cap || 'square'; x.miterLimit = 4;
    const b = opt.bevel || 0;
    x.lineWidth = lw;
    if (b > 0) {
      x.save(); x.translate(-b, -b); x.strokeStyle = opt.light || M.GOLD.hi; x.stroke(path); x.restore();
      x.save(); x.translate(b, b); x.strokeStyle = opt.dark || '#6b420a'; x.stroke(path); x.restore();
      x.lineWidth = Math.max(lw * 0.3, lw - b * 2);
    }
    x.strokeStyle = typeof body === 'function' ? body(x) : body; x.stroke(path);
    if (b > 0) { x.globalCompositeOperation = 'destination-in'; x.lineWidth = lw; x.strokeStyle = '#000'; x.stroke(path); x.globalCompositeOperation = 'source-over'; }
    return L;
  };

  // rubbed, polished spots where hands and cloths touch (stable per seed)
  M.wearSpots = (seed, n) => { const r = M.mulberry(seed); return Array.from({ length: n }, () => ({ u: r(), v: r(), s: 0.5 + r() * 0.5 })); };

  /* A light layer: the silhouette drawn by shape(ctx), recoloured to one
   * colour with a vertical alpha ramp (fill light from below, lightning from
   * above). Parts draw these additively over their base each frame. */
  M.lightLayer = (w, h, dpr, shape, rgb, y0, a0, y1, a1) => {
    const L = G.offscreen(w, h, dpr), x = L.x;
    x.fillStyle = '#fff'; x.strokeStyle = '#fff'; shape(x);
    x.globalCompositeOperation = 'source-in';
    const g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, `rgba(${rgb},${a0})`); g.addColorStop(1, `rgba(${rgb},${a1})`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return L;
  };
})();

/* Gates of Sebastian — effects: particles, lightning, floating text, camera.
 * Particles are drawn from small pre-rendered sprites (no per-particle
 * gradients) and advance with the real frame delta, so they look the same at
 * 30, 60 or 144 Hz.
 */
(() => {
  'use strict';
  const G = window.GOS;
  const FX = G.FX = {};

  // ---------------- sprite caches ----------------
  const glowCache = {};
  FX.glowSprite = color => {
    if (glowCache[color]) return glowCache[color];
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, color); g.addColorStop(0.5, hexA(color, 0.35)); g.addColorStop(1, hexA(color, 0));
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    return (glowCache[color] = c);
  };
  const softCache = {};
  FX.softSprite = color => {      // soft disc without the white core (smoke, cloud puffs, halos)
    if (softCache[color]) return softCache[color];
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, hexA(color, 1)); g.addColorStop(0.5, hexA(color, 0.45)); g.addColorStop(1, hexA(color, 0));
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    return (softCache[color] = c);
  };
  let starSprite = null;
  FX.starSprite = () => {
    if (starSprite) return starSprite;
    const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'), m = s / 2;
    x.globalCompositeOperation = 'lighter';
    const ray = (w, h, a) => {
      const g = x.createLinearGradient(m - w, 0, m + w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,250,220,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.moveTo(m - w, m); x.lineTo(m, m - h); x.lineTo(m + w, m); x.lineTo(m, m + h); x.fill();
    };
    ray(m, 3, 1); x.save(); x.translate(m, m); x.rotate(Math.PI / 2); x.translate(-m, -m); ray(m, 3, 1); x.restore();
    x.drawImage(FX.glowSprite('#fff3b0'), m - 18, m - 18, 36, 36);
    return (starSprite = c);
  };
  let coinSprite = null;
  FX.coinSprite = () => {
    if (coinSprite) return coinSprite;
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'), m = s / 2;
    let g = x.createRadialGradient(m - 8, m - 10, 2, m, m, m);
    g.addColorStop(0, '#fff6c2'); g.addColorStop(0.45, '#ffcf3a'); g.addColorStop(0.85, '#c88a0c'); g.addColorStop(1, '#7a4e05');
    x.fillStyle = g; x.beginPath(); x.arc(m, m, m - 1, 0, 7); x.fill();
    x.lineWidth = 3; x.strokeStyle = '#8a5a07'; x.beginPath(); x.arc(m, m, m * 0.7, 0, 7); x.stroke();
    x.fillStyle = '#9a6508'; x.font = `900 ${m}px ${G.FONT_DISPLAY}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('S', m, m + 2);
    x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.ellipse(m - 9, m - 12, 9, 5, -0.6, 0, 7); x.fill();
    return (coinSprite = c);
  };
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  FX.hexA = hexA;

  // ---------------- particles ----------------
  const P = [];
  const MAX = 1400;                 // scaled down by the adaptive quality level
  FX.count = () => P.length;
  const budget = n => Math.max(1, Math.round(n * G.Q.fx));
  // kinds: glow, ember, shard, coin, star, ring, text, smoke
  FX.spawn = o => {
    const full = P.length >= MAX * G.Q.fx;      // at the budget: the new particle is simply not shown
    const p = Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, life: 0, max: 1, size: 6, size1: null,
      rot: 0, vr: 0, color: '#ffd84a', alpha: 1, add: true, layer: 0 }, o);
    if (!full) P.push(p);
    return p;
  };
  FX.clear = () => { P.length = 0; };

  FX.burst = (x, y, color, n, speed, opts) => {
    opts = opts || {};
    n = budget(n);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.35 + Math.random() * 0.75);
      FX.spawn({ kind: opts.kind || 'glow', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.lift || 0), ay: opts.gravity || 0,
        drag: opts.drag != null ? opts.drag : 2.2, max: G.rand(0.45, 0.9) * (opts.life || 1), size: G.rand(0.6, 1.2) * (opts.size || 10),
        size1: 0, color, rot: Math.random() * 7, vr: G.rand(-12, 12), layer: opts.layer || 0 });
    }
  };
  FX.shards = (x, y, color, n, size) => {
    n = budget(n);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = G.rand(160, 520);
      FX.spawn({ kind: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 140, ay: 900, drag: 0.8, max: G.rand(0.5, 0.85),
        size: G.rand(0.35, 0.8) * size, color, rot: Math.random() * 7, vr: G.rand(-14, 14), add: false });
    }
  };
  FX.ring = (x, y, color, r0, r1, dur, width) => FX.spawn({ kind: 'ring', x, y, size: r0, size1: r1, max: dur || 0.5, color, lw: width || 4 });
  FX.star = (x, y, size, dur) => FX.spawn({ kind: 'star', x, y, size: 0, peak: size, max: dur || 0.6, rot: Math.random() * 3 });
  FX.coins = (x, y, n, spread, up) => {
    n = budget(n);
    for (let k = 0; k < n; k++) {
      FX.spawn({ kind: 'coin', x: x + G.rand(-spread, spread), y, vx: G.rand(-260, 260), vy: -G.rand(up * 0.55, up), ay: 1300,
        max: G.rand(1.6, 2.6), size: G.rand(13, 22), rot: Math.random() * 7, vr: G.rand(6, 14), add: false, layer: 2 });
    }
  };
  // a spark that arcs from (x,y) into a target and calls onArrive when it lands
  FX.home = (x, y, tx, ty, color, dur, onArrive) => {
    const mx = (x + tx) / 2 + G.rand(-1, 1) * Math.abs(tx - x) * 0.4, my = Math.min(y, ty) - G.rand(40, 160);
    return FX.spawn({ kind: 'home', x, y, x0: x, y0: y, cx: mx, cy: my, tx, ty, max: dur, size: G.rand(5, 9), color, layer: 1, onArrive });
  };
  // slanted rain streaks for the free-spins storm (background layer)
  FX.rain = (rate, wind) => {          // rate may be fractional: spawn that many on average
    const r = rate * G.Q.fx, n = Math.floor(r) + (Math.random() < r % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const vy = G.rand(900, 1300);
      FX.spawn({ kind: 'rain', x: G.rand(-G.W * 0.2, G.W * 1.1), y: G.rand(-60, G.H * 0.3), vx: vy * wind, vy, max: G.rand(0.5, 1.1),
        size: G.rand(0.8, 1.6), color: 'rgba(210,225,255,', alpha: G.rand(0.25, 0.55), layer: -1, add: false });
    }
  };
  FX.text = (x, y, text, size, color, opts) => FX.spawn(Object.assign({ kind: 'text', x, y, vy: -46, drag: 1.2, max: 1.3, size, text,
    color, add: false, layer: 1 }, opts || {}));

  const drop = k => { P[k] = P[P.length - 1]; P.pop(); };
  FX.update = dt => {
    for (let k = P.length - 1; k >= 0; k--) {
      const p = P[k];
      p.life += dt;
      if (p.life >= p.max) { drop(k); if (p.onArrive) p.onArrive(p); continue; }
      if (p.kind === 'home') {
        const t = G.ease.inOutSine(p.life / p.max), u = 1 - t;
        p.x = u * u * p.x0 + 2 * u * t * p.cx + t * t * p.tx;
        p.y = u * u * p.y0 + 2 * u * t * p.cy + t * t * p.ty;
        continue;
      }
      if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
      p.vx += p.ax * dt; p.vy += p.ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'coin' && p.y > G.H + 40) drop(k);
    }
  };

  FX.draw = (ctx, layer) => {
    for (const p of P) {
      if ((p.layer || 0) !== layer) continue;
      const t = p.life / p.max, a = p.alpha * (1 - t);
      switch (p.kind) {
        case 'glow': case 'ember': {
          const s = p.size1 == null ? p.size : G.lerp(p.size, p.size1, t);
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          ctx.drawImage(FX.glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'home': {
          const s = p.size * (1 - t * 0.4);
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9;
          ctx.drawImage(FX.glowSprite(p.color), p.x - s * 2, p.y - s * 2, s * 4, s * 4);
          break;
        }
        case 'rain': {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = p.color + (p.alpha * (1 - t)) + ')'; ctx.lineWidth = p.size;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028); ctx.stroke();
          break;
        }
        case 'smoke': {
          const s = G.lerp(p.size, p.size1 || p.size * 2, t);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a * 0.5;
          ctx.drawImage(FX.softSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'shard': {
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, a * 1.6);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          const s = p.size;
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.6); ctx.lineTo(-s * 0.6, s * 0.4); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.25, 0); ctx.lineTo(-s * 0.3, 0); ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        case 'coin': {
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, (1 - t) * 3);
          const sx = Math.abs(Math.cos(p.rot)) * 0.9 + 0.1, s = p.size;
          ctx.save(); ctx.translate(p.x, p.y); ctx.scale(sx, 1);
          ctx.drawImage(FX.coinSprite(), -s, -s, s * 2, s * 2); ctx.restore();
          break;
        }
        case 'star': {
          const k = Math.sin(t * Math.PI), s = p.peak * k;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, k * 1.2);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + t * 1.2);
          ctx.drawImage(FX.starSprite(), -s, -s, s * 2, s * 2); ctx.restore();
          break;
        }
        case 'ring': {
          const r = G.lerp(p.size, p.size1, G.ease.outCubic(t));
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.lw * (1 - t) + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'text': {
          ctx.globalCompositeOperation = 'source-over';
          const pop = t < 0.15 ? G.ease.outBack(t / 0.15) : 1;
          ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
          ctx.save(); ctx.translate(p.x, p.y); ctx.scale(pop, pop);
          G.goldText(ctx, p.text, 0, 0, p.size, { display: p.display !== false, colors: p.colors, glow: p.glow, maxW: p.maxW });
          ctx.restore();
          break;
        }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ---------------- lightning ----------------
  const bolts = [];
  // jagged bolt with branches; points regenerated a few times per bolt for flicker
  function boltPath(x1, y1, x2, y2, rough, depth) {
    const pts = [[x1, y1]];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const segs = Math.max(6, Math.round(len / 26));
    for (let s = 1; s < segs; s++) {
      const t = s / segs, off = (Math.random() - 0.5) * rough * Math.sin(t * Math.PI) * 2;
      pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
    }
    pts.push([x2, y2]);
    const branches = [];
    if (depth > 0) {
      for (let b = 0; b < 3; b++) {
        if (Math.random() < 0.6) {
          const i = 2 + ((Math.random() * (pts.length - 4)) | 0), p = pts[i];
          const ang = Math.atan2(dy, dx) + G.rand(-0.9, 0.9), bl = len * G.rand(0.12, 0.28);
          branches.push(boltPath(p[0], p[1], p[0] + Math.cos(ang) * bl, p[1] + Math.sin(ang) * bl, rough * 0.5, depth - 1));
        }
      }
    }
    return { pts, branches };
  }
  FX.bolt = (x1, y1, x2, y2, opts) => {
    opts = opts || {};
    const rough = opts.rough || Math.hypot(x2 - x1, y2 - y1) * 0.09;
    const depth = opts.depth != null ? opts.depth : G.Q.level >= 1 ? 2 : 1;
    bolts.push({ x1, y1, x2, y2, rough, depth, life: 0, max: opts.dur || 0.42, color: opts.color || '#9fe6ff', width: opts.width || 3.2,
      path: boltPath(x1, y1, x2, y2, rough, depth), regen: 0, layer: opts.layer || 0 });
  };
  FX.updateBolts = dt => {
    for (let k = bolts.length - 1; k >= 0; k--) {
      const b = bolts[k]; b.life += dt; b.regen -= dt;
      if (b.life >= b.max) { bolts.splice(k, 1); continue; }
      if (b.regen <= 0) { b.path = boltPath(b.x1, b.y1, b.x2, b.y2, b.rough, b.depth); b.regen = 0.06; }
    }
  };
  function strokePath(ctx, path, w) {
    ctx.lineWidth = w; ctx.beginPath();
    path.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
    path.branches.forEach(br => strokePath(ctx, br, w * 0.55));
  }
  FX.drawBolts = (ctx, layer) => {
    if (!bolts.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const b of bolts) {
      if (b.layer !== layer) continue;
      const t = b.life / b.max, a = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      ctx.globalAlpha = a * 0.45; ctx.strokeStyle = b.color; strokePath(ctx, b.path, b.width * 4.5);
      ctx.globalAlpha = a; ctx.strokeStyle = b.color; strokePath(ctx, b.path, b.width * 1.6);
      ctx.strokeStyle = '#ffffff'; strokePath(ctx, b.path, b.width * 0.6);
    }
    ctx.restore();
  };

  // ---------------- camera: shake, zoom punch, flash ----------------
  // zoom = punch spring; push = slow push-in (anticipation) toward `focus`; tilt = pointer/device parallax
  const cam = FX.cam = { shake: 0, mag: 0, zoom: 0, zoomV: 0, flash: 0, flashColor: '255,255,255', ox: 0, oy: 0,
    push: 0, pushTarget: 0, focus: null, focusTo: null, tilt: { x: 0, y: 0 }, tiltTarget: { x: 0, y: 0 } };
  FX.pushIn = (amount, focus) => {
    if (G.settings.reducedMotion) return;
    cam.pushTarget = amount; if (focus) cam.focusTo = focus;
  };
  FX.release = () => { cam.pushTarget = 0; };
  FX.shake = mag => { if (G.settings.reducedMotion) return; cam.shake = 1; cam.mag = Math.max(cam.mag * cam.shake, mag); };
  FX.punch = amt => { if (G.settings.reducedMotion) return; cam.zoomV += amt * 14; };
  // photosensitivity guard (WCAG 2.3.1): at most 3 strong flashes in any second, the rest are muted
  const flashTimes = [];
  FX.flashOk = () => {
    const now = G.clock.real;
    while (flashTimes.length && now - flashTimes[0] > 1) flashTimes.shift();
    if (flashTimes.length >= 3) return false;
    flashTimes.push(now); return true;
  };
  FX.flash = (a, rgb) => {
    if (G.settings.reducedMotion) a *= 0.3;
    if (a > 0.15 && !FX.flashOk()) a = 0.12;
    cam.flash = Math.max(cam.flash, a); if (rgb) cam.flashColor = rgb;
  };
  FX.updateCam = dt => {
    cam.ox = cam.oy = 0;
    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt * 2.4);
      const m = cam.mag * cam.shake * cam.shake;
      cam.ox = (Math.random() - 0.5) * m; cam.oy = (Math.random() - 0.5) * m;
    }
    // damped spring back to 0 zoom
    cam.zoomV += (-cam.zoom * 120 - cam.zoomV * 14) * dt;
    cam.zoom += cam.zoomV * dt;
    cam.flash = Math.max(0, cam.flash - dt * 3.2);
    // ease the push-in and its focus point; snap back fast when released
    cam.push += (cam.pushTarget - cam.push) * Math.min(1, dt * (cam.pushTarget > cam.push ? 1.6 : 5));
    if (cam.focusTo) {
      if (!cam.focus) cam.focus = { x: cam.focusTo.x, y: cam.focusTo.y };
      cam.focus.x += (cam.focusTo.x - cam.focus.x) * Math.min(1, dt * 3);
      cam.focus.y += (cam.focusTo.y - cam.focus.y) * Math.min(1, dt * 3);
    }
    if (cam.pushTarget === 0 && cam.push < 0.002) { cam.push = 0; cam.focus = cam.focusTo = null; }
    const on = G.settings.tilt && !G.settings.reducedMotion;
    cam.tilt.x += ((on ? cam.tiltTarget.x : 0) - cam.tilt.x) * Math.min(1, dt * 4);
    cam.tilt.y += ((on ? cam.tiltTarget.y : 0) - cam.tilt.y) * Math.min(1, dt * 4);
  };
})();

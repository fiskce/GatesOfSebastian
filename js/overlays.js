/* Thunder Hunter Sebastian — overlays: big-win count-up, free-spins intro/outro,
 * banners, the multiplier slam and small win pops. Each overlay is an item
 * with update/draw; game.js awaits the promise each show* call returns.
 * Tap / click / Space calls G.skip(), which fast-forwards whatever is showing.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX, B = G.Board;
  const O = G.Overlay = { items: [] };
  const S = G.S;

  const TIERS = [[15, 'tierBig'], [40, 'tierMega'], [100, 'tierEpic'], [500, 'tierLegend'], [5000, 'tierMax']];
  const tierName = i => G.T(TIERS[i][1]);
  // overlays run on a presentation clock: turbo and slam-stop speed them up, at most 2x
  O.rate = () => Math.min(2, Math.max(1, G.clock.pace));
  // ...but an amount stays on screen for at least 600 ms of real time
  const legible = ms => Math.max(ms, 600 * O.rate());
  O.tierFor = x => { let t = -1; TIERS.forEach((tt, i) => { if (x >= tt[0]) t = i; }); return t; };
  O.blocking = () => O.items.some(i => i.block);
  // an amount being counted up on screen right now (big win, feature total): { shown, to }
  O.counting = () => {
    const it = O.items.find(i => i.block && (i.amount != null || i.total != null) && i.shown != null);
    return it ? { shown: it.shown, to: it.amount != null ? it.amount : it.total, big: it.amount != null } : null;
  };

  let raysC = null;
  function rays() {
    if (raysC) return raysC;
    const s = 900, o = G.offscreen(s, s, 1), x = o.x, m = s / 2;
    x.translate(m, m);
    for (let i = 0; i < 18; i++) {
      x.rotate((Math.PI * 2) / 18);
      const g = x.createLinearGradient(0, 0, 0, m);
      g.addColorStop(0, 'rgba(255,215,110,.85)'); g.addColorStop(1, 'rgba(255,180,60,0)');
      x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.lineTo(-m * 0.11, m); x.lineTo(m * 0.11, m); x.fill();
    }
    return (raysC = o.c);
  }
  // ---------------- enamel plates: the tiers and the free-spins cartouche ----------------
  /* A cartouche in coloured enamel inside a polished gold bezel, with a storm
   * bolt at each end: the game's own ornament (the lintel keeps the Greek key). */
  const ENAMEL = [['#8f55e6', '#3a1478'], ['#3f86e8', '#0f2c6e'], ['#b02a40', '#3A0710'], ['#22a273', '#06352a'], ['#6a5020', '#120a02']];
  const plateCache = new Map();
  function cartouche(w, h, n) {
    const p = new Path2D();
    p.moveTo(n, 0); p.lineTo(w - n, 0); p.arc(w, 0, n, Math.PI, Math.PI * 0.5, true); p.lineTo(w, h - n); p.arc(w, h, n, Math.PI * 1.5, Math.PI, true);
    p.lineTo(n, h); p.arc(0, h, n, 0, -Math.PI * 0.5, true); p.lineTo(0, n); p.arc(0, 0, n, Math.PI * 0.5, 0, true); p.closePath();
    return p;
  }
  function enamelPlate(kind, w, h) {          // kind: a tier index, or 'fs'
    const key = kind + '|' + Math.round(w) + 'x' + Math.round(h) + '|' + G.DPR;
    let c = plateCache.get(key);
    if (c) return c;
    if (plateCache.size > 24) plateCache.clear();
    const M = G.Mat, pad = Math.ceil(h * 0.3), o = G.offscreen(w + pad * 2, h + pad * 2), x = o.x;
    x.translate(pad, pad);
    const col = kind === 'fs' ? ['#c8681e', '#3a1404'] : ENAMEL[kind], n = Math.min(h * 0.3, w * 0.08), p = cartouche(w, h, n);
    M.shadowOnly(x, k => k.fill(p), h * 0.25, 0, h * 0.08, 'rgba(0,0,0,.6)');
    const g = x.createRadialGradient(w * 0.35, h * 0.15, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.62);
    g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
    x.fillStyle = g; x.fill(p);
    x.save(); x.clip(p);
    M.texture(x, 'grain', 0.03, 'overlay', false, [0, 0, w, h]);
    x.globalCompositeOperation = 'lighter';
    const wr = x.createLinearGradient(0, 0, 0, h * 0.5); wr.addColorStop(0, 'rgba(255,255,255,.2)'); wr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = wr; x.fillRect(0, 0, w, h * 0.5);
    x.restore();
    x.lineWidth = Math.max(2, Math.min(h * 0.07, 8)); x.strokeStyle = M.goldBar(x, 0, h); x.stroke(p);
    x.lineWidth = 1 / G.DPR; x.strokeStyle = 'rgba(42,20,4,.9)'; x.stroke(p);
    const r = Math.min(h * 0.2, w * 0.05), by = kind === 'fs' ? h * 0.18 : h / 2;
    [n * 1.4 + r, w - n * 1.4 - r].forEach(bx => {
      const b = new Path2D();
      b.moveTo(bx + r * 0.2, by - r); b.lineTo(bx - r * 0.6, by + r * 0.12); b.lineTo(bx - r * 0.02, by + r * 0.12); b.lineTo(bx - r * 0.25, by + r); b.lineTo(bx + r * 0.62, by - r * 0.18); b.lineTo(bx + r * 0.04, by - r * 0.18); b.closePath();
      x.fillStyle = M.goldDome(x, bx, by, r); x.fill(b); x.lineWidth = 1 / G.DPR; x.strokeStyle = 'rgba(42,20,4,.8)'; x.stroke(b);
    });
    c = { c: o.c, pad }; plateCache.set(key, c);
    return c;
  }
  function drawPlate(ctx, kind, cx, cy, w, h, scale) {
    const pl = enamelPlate(kind, w, h);
    ctx.save(); ctx.translate(cx, cy); if (scale !== 1) ctx.scale(scale, scale);
    ctx.drawImage(pl.c, -w / 2 - pl.pad, -h / 2 - pl.pad, w + pl.pad * 2, h + pl.pad * 2);
    ctx.restore();
  }
  // the escalation ladder under a big win: the tiers passed and the one it stands on
  function ladder(ctx, cur, top, cx, y, m) {
    const n = top >= 4 ? 5 : 4, size = Math.max(11, m * 0.022), gap = size * 0.5;
    ctx.font = G.font(size, 800);
    const names = []; for (let i = 0; i < n; i++) names.push(tierName(i));
    const widths = names.map(t => ctx.measureText(t).width + size * 1.4), total = widths.reduce((a, b) => a + b, 0) + gap * (n - 1);
    if (total > G.W * 0.94) return;
    let x = cx - total / 2;
    names.forEach((t, i) => {
      const w = widths[i], on = i <= cur, now = i === cur;
      G.roundRect(ctx, x, y - size * 0.85, w, size * 1.7, size * 0.85); ctx.fillStyle = on ? '#272C4D' : 'rgba(18,21,42,.8)'; ctx.fill();
      if (now) { ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(242,201,90,.85)'; ctx.stroke(); }
      G.text(ctx, t, x + w / 2, y, size, on ? (now ? '#ffd36b' : '#F4F1EA') : 'rgba(185,182,211,.55)', { weight: 800 });
      x += w + gap;
    });
  }

  function backdrop(ctx, a) {
    ctx.fillStyle = `rgba(10,3,24,${0.8 * a})`; ctx.fillRect(0, 0, G.W, G.H);
  }
  function drawRays(ctx, cx, cy, size, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
    ctx.translate(cx, cy); ctx.rotate(G.clock.real * 0.35);
    ctx.drawImage(rays(), -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  const fadeIn = (t, d) => G.clamp(t / (d || 0.3), 0, 1);
  const pulse = k => 1 + Math.sin(G.clock.real * k) * 0.04;

  O.update = dt => {
    for (let k = O.items.length - 1; k >= 0; k--) {
      const it = O.items[k];
      it.t += dt;
      if (it.update) it.update(dt);
      if (it.dead) O.items.splice(k, 1);
    }
  };
  O.draw = ctx => { O.items.forEach(it => it.draw(ctx)); };

  // ---------------- big win ----------------
  // counts up through the tiers; a tap jumps to the final amount, a second tap closes
  O.bigWin = (amount, bet, autoMs) => new Promise(res => {
    const x = amount / bet, top = Math.max(0, O.tierFor(x));
    const dur = 2.4 + top * 1.6, hold = (autoMs || 2600) / 1000;
    const it = { block: true, t: 0, shown: 0, tier: 0, tickT: 0, phase: 'count', closeT: 0, tierT: 0, amount };
    // the music steps back (about -8 dB) under a bed for the tier, rather than dropping out
    AudioEngine.duck(0.4, (dur + hold) / O.rate()); it.bed = AudioEngine.play('tier.0');
    G.Seb.cut = it; G.Seb.cheer(1); G.Seb.say('big');
    const finish = () => {
      if (top > it.tier) it.tierT = it.t;      // jumping ahead still stamps the final tier
      it.shown = amount; it.tier = top; it.phase = 'hold'; it.closeT = it.t;
      AudioEngine.play(top >= 4 ? 'maxwin' : 'slam', { variant: Math.min(3, top) }); FX.shake(14); FX.flash(0.7, '255,240,190');
      for (let k = 0; k < 40; k++) FX.coins(G.W / 2, G.H * 0.62, 1, 60, G.H * 1.1, 3);
    };
    it.update = dt => {
      if (it.phase === 'count') {
        const p = Math.min(1, it.t / dur);
        it.shown = amount * (1 - Math.pow(1 - p, 1.7));
        const reached = Math.max(0, O.tierFor(it.shown / bet));
        if (reached > it.tier) {
          it.tier = reached; it.tierT = it.t; G.Seb.cheer(1 + reached * 0.4); G.Seb.say(reached >= 2 ? 'epic' : 'mega');
          G.haptic([50, 40, 50]);
          it.bed.stop(0.3); it.bed = AudioEngine.play('tier.' + Math.min(3, reached)); FX.flash(0.6, '255,230,160'); FX.shake(10 + reached * 4); FX.punch(0.03);
        }
        it.tickT -= dt;
        if (it.tickT <= 0) { it.tickT = 0.07; AudioEngine.play('count.tick', { gain: 0.8 }); }
        if (Math.random() < dt * (18 + it.tier * 10)) FX.coins(G.W / 2 + G.rand(-G.W * 0.2, G.W * 0.2), G.H + 20, 1, 40, G.H * 1.25, 3);
        if (p >= 1) finish();
      } else if (it.phase === 'hold' && it.t - it.closeT > hold) out();
      else if (it.phase === 'out' && it.t - it.closeT > 0.35) { it.dead = true; G.Seb.cut = null; res(); }
    };
    // leaving gives the music back straight away, however early the tap came
    const out = () => { it.phase = 'out'; it.closeT = it.t; AudioEngine.unduck(0.5); };
    it.skip = () => {
      if (it.phase === 'count') finish();
      else if (it.phase === 'hold' && it.t - it.closeT > 0.25) out();
    };
    it.draw = ctx => {
      const a = it.phase === 'out' ? 1 - (it.t - it.closeT) / 0.35 : fadeIn(it.t);
      const cx = G.W / 2, cy = G.H * 0.46, m = Math.min(G.W, G.H);
      ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1);
      backdrop(ctx, 1);
      drawRays(ctx, cx, cy, m * 1.5 * (1 + it.tier * 0.12), 0.35 + it.tier * 0.08);
      FX.draw(ctx, 3);               // the coins fly behind the plate and the amount
      ctx.globalAlpha = G.clamp(a, 0, 1); ctx.globalCompositeOperation = 'source-over';
      // Sebastian slides in to celebrate (he would be hidden behind the backdrop otherwise)
      const slide = it.phase === 'out' ? 1 - (it.t - it.closeT) / 0.35 : it.t / 0.45;
      G.Seb.drawCutIn(ctx, G.clamp(a, 0, 1), slide);
      // the tier on its own enamel plate, stamped in each time it climbs
      const st = it.t - it.tierT, stamp = st < 0.35 ? 1.3 - 0.3 * G.ease.outBack(st / 0.35) : 1;
      const pw = Math.min(G.W * 0.86, m * 1.0), ph = m * 0.16;
      drawPlate(ctx, Math.min(4, it.tier), cx, cy - m * 0.13, pw, ph, stamp);
      ctx.save(); ctx.translate(cx, cy - m * 0.13); ctx.scale(stamp, stamp);
      G.goldText(ctx, tierName(it.tier), 0, 0, m * 0.09, { maxW: pw - ph * 1.8 });
      ctx.restore();
      ctx.save(); ctx.translate(cx, cy + m * 0.04);
      const s2 = it.phase === 'count' ? 1 : 1 + Math.max(0, 1 - (it.t - it.closeT) / 0.3) * 0.15;
      ctx.scale(s2, s2);
      G.goldText(ctx, G.countMoney(it.shown, it.amount), 0, 0, m * 0.13, { display: false, weight: 800, tabular: true, maxW: G.W * 0.92, glow: 'rgba(255,190,60,.8)',
        colors: ['#ffffff', '#fff1a8', '#ffcf3a', '#e08a12', '#ffe58a'] });
      ctx.restore();
      G.text(ctx, G.xfmt(Math.round(it.shown / bet * 100) / 100), cx, cy + m * 0.15, Math.max(11, m * 0.032), '#F4F1EA', { weight: 800, shadow: 'rgba(0,0,0,.8)', tabular: true });
      ladder(ctx, it.tier, top, cx, cy + m * 0.215, m);
      if (it.phase !== 'count') G.text(ctx, G.T('tapContinue'), cx, cy + m * 0.29, Math.max(11, m * 0.026), `rgba(244,241,234,${0.5 + 0.5 * Math.sin(G.clock.real * 4)})`, { weight: 700 });
      G.Seb.drawCutBubble(ctx);
      ctx.restore();
    };
    O.items.push(it);
  });

  // ---------------- free spins intro ----------------
  O.fsIntro = (award, autoMs) => new Promise(res => {
    const it = { block: true, t: 0, phase: 'in', closeT: 0 };
    // the award counts in on brass shell clicks (32nds at the feature's 128 BPM), climbing the F pentatonic;
    // the card runs on the presentation clock, so under turbo the clicks keep pace with the digits
    const r = O.rate(), t0 = AudioEngine.now() + 0.25 / r, LADDER = [0, 2, 4, 7, 9, 12];
    for (let k = 0; k < award; k++) AudioEngine.play('fs.award.click', { when: t0 + k * 0.0586 / r, rate: Math.pow(2, LADDER[Math.floor(k * LADDER.length / award)] / 12) });
    const close = () => { if (it.phase === 'in') { it.phase = 'out'; it.closeT = it.t; AudioEngine.play('ui.close'); } };
    it.skip = () => { if (it.t > 0.5) close(); };
    it.update = () => {
      if (it.phase === 'in' && it.t > autoMs / 1000) close();
      if (it.phase === 'out' && it.t - it.closeT > 0.45) { it.dead = true; res(); }
    };
    /* The award on an amber enamel cartouche; when it closes, the card
     * shrinks into the Spin button, which carries the count from there. */
    it.draw = ctx => {
      const out = it.phase === 'out', q = out ? G.clamp((it.t - it.closeT) / 0.45, 0, 1) : 0, e = G.ease.inCubic(q);
      const a = out ? 1 - q : fadeIn(it.t, 0.4), m = Math.min(G.W, G.H);
      const c0 = { x: G.W / 2, y: G.H * 0.47 }, sp = (G.HUD && G.HUD.spinC) || c0;
      const cx = G.lerp(c0.x, sp.x, e), cy = G.lerp(c0.y, sp.y, e), k = G.lerp(1, 0.08, e);
      const shown = Math.min(award, Math.floor(Math.max(0, it.t - 0.25) / 0.0586) + 1);
      ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1);
      backdrop(ctx, 0.85);
      drawRays(ctx, c0.x, c0.y, m * 1.6, 0.4 * (1 - e));
      if (!out) {           // four scatters orbit the card
        const n = 4, rx = Math.min(G.W * 0.44, m * 0.66), ry = m * 0.33;
        for (let j = 0; j < n; j++) {
          const ang = G.clock.real * 0.6 + (j / n) * Math.PI * 2, sx = c0.x + Math.cos(ang) * rx, sy = c0.y + Math.sin(ang) * ry - m * 0.02;
          const ss = m * 0.11 * (0.85 + 0.15 * Math.sin(ang));
          ctx.drawImage(B.spr.scatter, sx - ss / 2, sy - ss / 2, ss, ss);
        }
      }
      const pop = G.ease.outBack(G.clamp(it.t / 0.5, 0, 1));
      const pw = Math.min(G.W * 0.86, m * 1.1), ph = m * 0.5;
      ctx.translate(cx, cy); ctx.scale(k * pop, k * pop);
      drawPlate(ctx, 'fs', 0, 0, pw, ph, 1);
      G.text(ctx, G.T('congrats'), 0, -ph * 0.3, Math.max(11, m * 0.036), '#F4F1EA', { weight: 800, display: true, shadow: 'rgba(0,0,0,.8)', maxW: pw * 0.7 });
      G.goldText(ctx, String(shown), 0, -ph * 0.04, m * 0.2, { glow: 'rgba(255,140,30,.9)', tabular: true });
      G.goldText(ctx, G.T('fsAwarded'), 0, ph * 0.26, m * 0.075, { maxW: pw * 0.8 });
      ctx.restore();
      if (!out) {
        ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1);
        G.text(ctx, G.T('fsSaved'), c0.x, c0.y + ph * 0.66, Math.max(11, m * 0.026), '#F4F1EA', { weight: 600, maxW: G.W * 0.9, shadow: 'rgba(0,0,0,.8)' });
        if (it.t > 0.8) G.text(ctx, G.T('tapStart'), c0.x, c0.y + ph * 0.82, Math.max(11, m * 0.03), `rgba(244,241,234,${0.5 + 0.5 * Math.sin(G.clock.real * 4)})`, { weight: 800 });
        ctx.restore();
      }
    };
    O.items.push(it);
  });

  // ---------------- free spins outro ----------------
  O.fsOutro = (total, spins, bet, autoMs) => new Promise(res => {
    const it = { block: true, t: 0, phase: 'in', closeT: 0, shown: 0, total };
    AudioEngine.duck(0.4, 4 / O.rate()); AudioEngine.play('fs.outro');
    if (total / bet >= 15) G.Seb.cheer(1.2);
    const countDur = total > 0 ? 1.8 : 0.01;
    let ticked = 0;
    const close = () => { if (it.phase === 'in') { it.phase = 'out'; it.closeT = it.t; AudioEngine.unduck(0.5); } };
    it.skip = () => { if (it.t > 0.6) close(); };
    it.update = () => {
      if (it.phase === 'in' && it.t > 0.4 + autoMs / 1000) close();
      const p = G.clamp((it.t - 0.3) / countDur, 0, 1);
      it.shown = total * G.ease.outCubic(p);
      if (p < 1 && it.t - ticked > 0.07) { ticked = it.t; AudioEngine.play('count.tick'); }
      if (Math.random() < 0.3 && total > 0 && it.phase !== 'out') FX.coins(G.W / 2 + G.rand(-G.W * 0.25, G.W * 0.25), G.H + 20, 1, 30, G.H * 1.1);
      if (it.phase === 'out' && it.t - it.closeT > 0.45) { it.dead = true; res(); }
    };
    it.draw = ctx => {
      const a = it.phase === 'out' ? 1 - (it.t - it.closeT) / 0.45 : fadeIn(it.t, 0.4);
      const cx = G.W / 2, cy = G.H * 0.46, m = Math.min(G.W, G.H);
      ctx.save(); ctx.globalAlpha = a;
      backdrop(ctx, 1);
      drawRays(ctx, cx, cy, m * 1.5, 0.4);
      G.goldText(ctx, G.T('fsComplete'), cx, cy - m * 0.18, m * 0.07, { maxW: G.W * 0.9, glow: 'rgba(255,140,30,.8)' });
      G.text(ctx, G.T('youWon'), cx, cy - m * 0.07, m * 0.04, '#f6e3ff', { weight: 800, display: true, shadow: 'rgba(0,0,0,.8)' });
      ctx.save(); ctx.translate(cx, cy + m * 0.05); ctx.scale(pulse(4), pulse(4));
      G.goldText(ctx, G.countMoney(it.shown, it.total), 0, 0, m * 0.12, { display: false, weight: 800, tabular: true, maxW: G.W * 0.9, glow: 'rgba(255,190,60,.8)' });
      ctx.restore();
      G.text(ctx, G.T('inSpins', { n: spins }), cx, cy + m * 0.16, m * 0.032, '#ffe9b0', { weight: 800, shadow: 'rgba(0,0,0,.8)' });
      if (it.t > 1) G.text(ctx, G.T('tapContinue'), cx, cy + m * 0.26, m * 0.026, `rgba(255,236,190,${0.5 + 0.5 * Math.sin(G.clock.real * 4)})`, { weight: 700 });
      ctx.restore();
    };
    O.items.push(it);
  });

  // ---------------- lightning wipe: dusk turns to storm behind a band of light ----------------
  O.wipe = () => {
    if (G.settings.reducedMotion || !FX.flashOk()) return;
    const it = { t: 0 }, dur = 0.38;
    it.update = () => { if (it.t >= dur) it.dead = true; };
    it.draw = ctx => {
      const p = it.t / dur, x = G.lerp(-G.W * 0.3, G.W * 1.3, G.ease.inOutSine(p)), w = G.W * 0.28;
      const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,226,170,0)'); g.addColorStop(0.5, `rgba(255,236,200,${0.32 * Math.sin(p * Math.PI)})`); g.addColorStop(1, 'rgba(255,226,170,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 0, G.W, G.H); ctx.restore();
    };
    O.items.push(it);
  };

  // ---------------- banner over the board ----------------
  O.banner = (big, sub, ms) => new Promise(res => {
    const dur = legible(ms) / 1000;
    const it = { t: 0 };
    it.update = () => { if (it.t >= dur) { it.dead = true; res(); } };
    it.draw = ctx => {
      const r = G.L.reel, a = it.t < 0.2 ? it.t / 0.2 : it.t > dur - 0.25 ? (dur - it.t) / 0.25 : 1;
      const k = G.ease.outBack(G.clamp(it.t / 0.35, 0, 1));
      ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1);
      ctx.fillStyle = 'rgba(8,2,20,.6)'; G.roundRect(ctx, r.x, r.y, r.w, r.h, G.L.fp); ctx.fill();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(k, k);
      G.goldText(ctx, big, 0, -r.h * 0.05, r.h * 0.16, { maxW: r.w * 0.9, glow: 'rgba(255,140,30,.9)' });
      if (sub) G.text(ctx, sub, 0, r.h * 0.1, r.h * 0.05, '#ffffff', { weight: 800, maxW: r.w * 0.9, shadow: 'rgba(0,0,0,.9)' });
      ctx.restore();
    };
    O.items.push(it);
  });

  // ---------------- milestone: non-blocking headline over the board ----------------
  O.milestone = (big, sub) => {
    const it = { t: 0 }, dur = 1.8;
    it.update = () => { if (it.t >= dur) it.dead = true; };
    it.draw = ctx => {
      const r = G.L.reel, a = it.t < 0.15 ? it.t / 0.15 : it.t > dur - 0.35 ? (dur - it.t) / 0.35 : 1;
      const k = G.ease.outElastic(G.clamp(it.t / 0.6, 0, 1));
      ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1);
      ctx.translate(r.x + r.w / 2, r.y + r.h * 0.3); ctx.scale(k, k);
      G.goldText(ctx, big, 0, 0, r.h * 0.13, { maxW: r.w * 0.9, glow: 'rgba(255,60,30,.9)', colors: ['#ffffff', '#ffe0a0', '#ff9a3a', '#c8300e', '#ffd36b'] });
      if (sub) G.text(ctx, sub, 0, r.h * 0.09, r.h * 0.04, '#ffffff', { weight: 800, maxW: r.w * 0.9, shadow: 'rgba(0,0,0,.9)', display: true });
      ctx.restore();
    };
    O.items.push(it);
  };

  // ---------------- win pop over the board (wins under the big-win line) ----------------
  O.winPop = (amount, ms) => new Promise(res => {
    const dur = legible(ms) / 1000, it = { t: 0 };
    it.update = () => { if (it.t >= dur) { it.dead = true; res(); } };
    it.draw = ctx => {
      const r = G.L.reel, a = it.t > dur - 0.25 ? (dur - it.t) / 0.25 : 1;
      const k = G.ease.outBack(G.clamp(it.t / 0.3, 0, 1));
      ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1);
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(k, k);
      G.goldText(ctx, G.money(amount), 0, 0, r.h * 0.13, { display: false, weight: 800, maxW: r.w * 0.85, glow: 'rgba(255,170,40,.9)' });
      ctx.restore();
    };
    O.items.push(it);
  });

  // ---------------- multiplier slam: collector value -> board ----------------
  O.slam = (value, from) => new Promise(res => {
    const it = { t: 0 }, fly = 0.45, hold = 0.9;
    let slammed = false;
    it.update = () => {
      if (!slammed && it.t >= fly) {
        slammed = true;
        AudioEngine.play('slam', { variant: G.orbTier(value) });
        FX.shake(8 + Math.min(14, value / 10)); FX.punch(0.04); FX.flash(0.4, '255,220,150');
        const c = { x: G.L.reel.x + G.L.reel.w / 2, y: G.L.reel.y + G.L.reel.h / 2 };
        FX.ring(c.x, c.y, '#ffd27a', 10, G.L.reel.w * 0.45, 0.6, 8);
        FX.burst(c.x, c.y, '#ffb02e', 30, 700, { size: 14, layer: 1 });
        res();
      }
      if (it.t >= fly + hold) it.dead = true;
    };
    it.draw = ctx => {
      const r = G.L.reel, tx = r.x + r.w / 2, ty = r.y + r.h / 2;
      let x, y, s, a = 1;
      if (it.t < fly) { const p = G.ease.inOutSine(it.t / fly); x = G.lerp(from.x, tx, p); y = G.lerp(from.y, ty, p) - Math.sin(p * Math.PI) * r.h * 0.2; s = G.lerp(0.4, 1.3, p); }
      else { const p = (it.t - fly) / hold; x = tx; y = ty; s = 1 + (1 - G.ease.outCubic(Math.min(1, p * 3))) * 0.3; a = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1; }
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(s, s);
      G.goldText(ctx, 'x' + value, 0, 0, r.h * 0.26, { maxW: r.w * 0.9, glow: 'rgba(255,90,20,.95)', colors: ['#ffffff', '#ffeaa0', '#ffb03a', '#e0560e', '#ffd36b'] });
      ctx.restore();
    };
    O.items.push(it);
  });

  // a tap/space during a blocking overlay fast-forwards it
  O.skip = () => { const top = O.items.filter(i => i.block).pop(); if (top && top.skip) top.skip(); };
})();

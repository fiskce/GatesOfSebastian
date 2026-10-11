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
    AudioEngine.duck(0.2, dur + hold); AudioEngine.play('bigwin');
    G.Seb.cut = it; G.Seb.cheer(1); G.Seb.say('big');
    const finish = () => {
      it.shown = amount; it.tier = top; it.phase = 'hold'; it.closeT = it.t;
      AudioEngine.play('slam'); FX.shake(14); FX.flash(0.7, '255,240,190');
      for (let k = 0; k < 40; k++) FX.coins(G.W / 2, G.H * 0.62, 1, 60, G.H * 1.1);
    };
    it.update = dt => {
      if (it.phase === 'count') {
        const p = Math.min(1, it.t / dur);
        it.shown = amount * (1 - Math.pow(1 - p, 1.7));
        const reached = Math.max(0, O.tierFor(it.shown / bet));
        if (reached > it.tier) {
          it.tier = reached; it.tierT = it.t; G.Seb.cheer(1 + reached * 0.4); G.Seb.say(reached >= 2 ? 'epic' : 'mega');
          G.haptic([50, 40, 50]);
          AudioEngine.play('tierUp', { rate: 1 + reached * 0.06 }); FX.flash(0.6, '255,230,160'); FX.shake(10 + reached * 4); FX.punch(0.03);
        }
        it.tickT -= dt;
        if (it.tickT <= 0) { it.tickT = 0.07; AudioEngine.play('tick', { rate: 0.9 + p * 0.9, gain: 0.8 }); }
        if (Math.random() < dt * (18 + it.tier * 10)) FX.coins(G.W / 2 + G.rand(-G.W * 0.2, G.W * 0.2), G.H + 20, 1, 40, G.H * 1.25);
        if (p >= 1) finish();
      } else if (it.phase === 'hold' && it.t - it.closeT > hold) { it.phase = 'out'; it.closeT = it.t; }
      else if (it.phase === 'out' && it.t - it.closeT > 0.35) { it.dead = true; G.Seb.cut = null; res(); }
    };
    it.skip = () => {
      if (it.phase === 'count') finish();
      else if (it.phase === 'hold' && it.t - it.closeT > 0.25) { it.phase = 'out'; it.closeT = it.t; }
    };
    it.draw = ctx => {
      const a = it.phase === 'out' ? 1 - (it.t - it.closeT) / 0.35 : fadeIn(it.t);
      const cx = G.W / 2, cy = G.H * 0.46, m = Math.min(G.W, G.H);
      ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1);
      backdrop(ctx, 1);
      drawRays(ctx, cx, cy, m * 1.5 * (1 + it.tier * 0.12), 0.35 + it.tier * 0.08);
      // Sebastian slides in to celebrate (he would be hidden behind the backdrop otherwise)
      const slide = it.phase === 'out' ? 1 - (it.t - it.closeT) / 0.35 : it.t / 0.45;
      G.Seb.drawCutIn(ctx, G.clamp(a, 0, 1), slide);
      const tb = Math.max(0, 1 - (it.t - it.tierT) / 0.45);
      ctx.save(); ctx.translate(cx, cy - m * 0.13); const sc = (1 + tb * 0.35) * pulse(5); ctx.scale(sc, sc);
      G.goldText(ctx, tierName(it.tier), 0, 0, m * 0.12, { maxW: G.W * 0.9, glow: 'rgba(255,140,30,.9)' });
      ctx.restore();
      ctx.save(); ctx.translate(cx, cy + m * 0.04);
      const s2 = it.phase === 'count' ? 1 : 1 + Math.max(0, 1 - (it.t - it.closeT) / 0.3) * 0.15;
      ctx.scale(s2, s2);
      G.goldText(ctx, G.money(it.shown, G.countPlaces(it.amount)), 0, 0, m * 0.13, { display: false, weight: 800, maxW: G.W * 0.92, glow: 'rgba(255,190,60,.8)',
        colors: ['#ffffff', '#fff1a8', '#ffcf3a', '#e08a12', '#ffe58a'] });
      ctx.restore();
      G.text(ctx, G.xfmt(Math.round(it.shown / bet * 100) / 100), cx, cy + m * 0.15, m * 0.032, '#f6e3ff', { weight: 800, shadow: 'rgba(0,0,0,.8)' });
      if (it.phase !== 'count') G.text(ctx, G.T('tapContinue'), cx, cy + m * 0.26, m * 0.026, `rgba(255,236,190,${0.5 + 0.5 * Math.sin(G.clock.real * 4)})`, { weight: 700 });
      G.Seb.drawCutBubble(ctx);
      ctx.restore();
    };
    O.items.push(it);
  });

  // ---------------- free spins intro ----------------
  O.fsIntro = (award, autoMs) => new Promise(res => {
    const it = { block: true, t: 0, phase: 'in', closeT: 0 };
    AudioEngine.duck(0.3, 2.5); AudioEngine.play('freespins');
    const close = () => { if (it.phase === 'in') { it.phase = 'out'; it.closeT = it.t; AudioEngine.play('whoosh'); } };
    it.skip = () => { if (it.t > 0.5) close(); };
    it.update = () => {
      if (it.phase === 'in' && it.t > autoMs / 1000) close();
      if (it.phase === 'out' && it.t - it.closeT > 0.45) { it.dead = true; res(); }
    };
    it.draw = ctx => {
      const a = it.phase === 'out' ? 1 - (it.t - it.closeT) / 0.45 : fadeIn(it.t, 0.4);
      const cx = G.W / 2, cy = G.H * 0.47, m = Math.min(G.W, G.H);
      ctx.save(); ctx.globalAlpha = a;
      backdrop(ctx, 1);
      drawRays(ctx, cx, cy, m * 1.6, 0.45);
      // four scatters orbiting
      const n = 4, rx = Math.min(G.W * 0.42, m * 0.62), ry = m * 0.3;
      for (let k = 0; k < n; k++) {
        const ang = G.clock.real * 0.6 + (k / n) * Math.PI * 2, sx = cx + Math.cos(ang) * rx, sy = cy + Math.sin(ang) * ry - m * 0.02;
        const s = m * 0.11 * (0.85 + 0.15 * Math.sin(ang));
        ctx.drawImage(B.spr.scatter, sx - s / 2, sy - s / 2, s, s);
      }
      const k = G.ease.outBack(G.clamp(it.t / 0.6, 0, 1));
      ctx.save(); ctx.translate(cx, cy); ctx.scale(k * pulse(4), k * pulse(4));
      G.text(ctx, G.T('congrats'), 0, -m * 0.2, m * 0.04, '#f6e3ff', { weight: 800, display: true, shadow: 'rgba(0,0,0,.8)' });
      G.goldText(ctx, String(award), 0, -m * 0.06, m * 0.2, { glow: 'rgba(255,140,30,.9)' });
      G.goldText(ctx, G.T('fsAwarded'), 0, m * 0.08, m * 0.085, { maxW: G.W * 0.9 });
      ctx.restore();
      G.text(ctx, 'Every multiplier is saved and stacks for the whole feature', cx, cy + m * 0.19, m * 0.026, '#ffe9b0', { weight: 600, maxW: G.W * 0.9, shadow: 'rgba(0,0,0,.8)' });
      if (it.t > 0.8) G.text(ctx, G.T('tapStart'), cx, cy + m * 0.28, m * 0.03, `rgba(255,236,190,${0.5 + 0.5 * Math.sin(G.clock.real * 4)})`, { weight: 800 });
      ctx.restore();
    };
    O.items.push(it);
  });

  // ---------------- free spins outro ----------------
  O.fsOutro = (total, spins, bet, autoMs) => new Promise(res => {
    const it = { block: true, t: 0, phase: 'in', closeT: 0, shown: 0, total };
    AudioEngine.duck(0.25, 4); AudioEngine.play(total / bet >= 15 ? 'bigwin' : 'win');
    if (total / bet >= 15) G.Seb.cheer(1.2);
    const countDur = total > 0 ? 1.8 : 0.01;
    let ticked = 0;
    const close = () => { if (it.phase === 'in') { it.phase = 'out'; it.closeT = it.t; } };
    it.skip = () => { if (it.t > 0.6) close(); };
    it.update = () => {
      if (it.phase === 'in' && it.t > 0.4 + autoMs / 1000) close();
      const p = G.clamp((it.t - 0.3) / countDur, 0, 1);
      it.shown = total * G.ease.outCubic(p);
      if (p < 1 && it.t - ticked > 0.07) { ticked = it.t; AudioEngine.play('tick', { rate: 1 + p }); }
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
      G.goldText(ctx, G.money(it.shown, G.countPlaces(it.total)), 0, 0, m * 0.12, { display: false, weight: 800, maxW: G.W * 0.9, glow: 'rgba(255,190,60,.8)' });
      ctx.restore();
      G.text(ctx, G.T('inSpins', { n: spins }), cx, cy + m * 0.16, m * 0.032, '#ffe9b0', { weight: 800, shadow: 'rgba(0,0,0,.8)' });
      if (it.t > 1) G.text(ctx, G.T('tapContinue'), cx, cy + m * 0.26, m * 0.026, `rgba(255,236,190,${0.5 + 0.5 * Math.sin(G.clock.real * 4)})`, { weight: 700 });
      ctx.restore();
    };
    O.items.push(it);
  });

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
        AudioEngine.play('slam', { rate: 1 + Math.min(0.5, value / 400) });
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

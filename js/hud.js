/* Thunder Hunter Sebastian — HUD: side panels, logo, Sebastian, plaque, bottom bar.
 * Everything is drawn on the canvas and registered as a hit region each frame
 * (G.button); input.js hit-tests the pointer against those regions.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX, B = G.Board, E = G.E;
  const H = G.HUD = {};
  const S = G.S, T = G.T;

  // ---------------- buttons ----------------
  const anim = {};   // per-button smoothed hover/press values
  G.button = (id, x, y, w, h, onClick, opts) => {
    opts = opts || {};
    const m = G.ctx.getTransform();
    const plain = m.a === G.DPR && m.d === G.DPR && !m.b && !m.c && !m.e && !m.f;
    G.L.buttons.push({ id, x, y, w, h, onClick, shape: opts.shape, disabled: !!opts.disabled, label: opts.label || id, inv: plain ? null : m.inverse() });
    const a = anim[id] || (anim[id] = { h: 0, p: 0, hs: { x: 0, v: 0 }, ps: { x: 0, v: 0 }, t: G.clock.real });
    const hov = G.hoverId === id && !opts.disabled, pr = G.pressId === id && !opts.disabled;
    const dt = G.clamp(G.clock.real - a.t, 0, 0.05); a.t = G.clock.real;
    a.h = G.clamp(G.spring(a.hs, hov ? 1 : 0, dt, G.SPRING.HOVER), 0, 1);
    a.p = G.spring(a.ps, pr ? 1 : 0, dt, pr ? G.SPRING.PRESS : G.SPRING.RELEASE);   // springs back past rest a little
    return a;
  };

  // ---------------- icons (vector, no emoji) ----------------
  H.icon = (ctx, name, cx, cy, s, color) => {
    ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = ctx.fillStyle = color || '#f3d27a';
    ctx.lineWidth = Math.max(1.6, s * 0.11); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const r = s / 2;
    switch (name) {
      case 'info':
        ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -r * 0.05); ctx.lineTo(0, r * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -r * 0.42, s * 0.07, 0, 7); ctx.fill(); break;
      case 'settings': {
        ctx.beginPath();
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2 + 0.2, rr = k % 2 ? r * 0.68 : r * 0.95; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 7); ctx.stroke(); break;
      }
      case 'sound': case 'mute':
        ctx.beginPath(); ctx.moveTo(-r * 0.85, -r * 0.3); ctx.lineTo(-r * 0.4, -r * 0.3); ctx.lineTo(r * 0.1, -r * 0.75); ctx.lineTo(r * 0.1, r * 0.75); ctx.lineTo(-r * 0.4, r * 0.3); ctx.lineTo(-r * 0.85, r * 0.3); ctx.closePath(); ctx.fill();
        if (name === 'sound') { ctx.beginPath(); ctx.arc(r * 0.1, 0, r * 0.45, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(r * 0.1, 0, r * 0.82, -0.8, 0.8); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(r * 0.38, -r * 0.35); ctx.lineTo(r * 0.95, r * 0.35); ctx.moveTo(r * 0.95, -r * 0.35); ctx.lineTo(r * 0.38, r * 0.35); ctx.stroke(); }
        break;
      case 'history':
        ctx.beginPath(); ctx.arc(0, 0, r * 0.9, -Math.PI * 0.85, Math.PI * 0.95); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.95, -r * 0.75); ctx.lineTo(-r * 0.62, -r * 0.4); ctx.lineTo(-r * 0.25, -r * 0.72); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, 0); ctx.lineTo(r * 0.38, r * 0.25); ctx.stroke(); break;
      case 'full':
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { ctx.beginPath(); ctx.moveTo(sx * r * 0.85, sy * r * 0.3); ctx.lineTo(sx * r * 0.85, sy * r * 0.85); ctx.lineTo(sx * r * 0.3, sy * r * 0.85); ctx.stroke(); });
        break;
      case 'menu':
        [-0.55, 0, 0.55].forEach(v => { ctx.beginPath(); ctx.moveTo(-r * 0.8, v * r); ctx.lineTo(r * 0.8, v * r); ctx.stroke(); }); break;
      case 'bolt':
        ctx.beginPath(); ctx.moveTo(r * 0.2, -r); ctx.lineTo(-r * 0.6, r * 0.12); ctx.lineTo(-r * 0.02, r * 0.12); ctx.lineTo(-r * 0.25, r); ctx.lineTo(r * 0.62, -r * 0.18); ctx.lineTo(r * 0.04, -r * 0.18); ctx.closePath(); ctx.fill(); break;
      case 'auto':
        ctx.beginPath(); ctx.arc(0, 0, r * 0.72, Math.PI * 0.15, Math.PI * 0.95); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.72, Math.PI * 1.15, Math.PI * 1.95); ctx.stroke();
        [[0.95, -1], [1.95, 1]].forEach(([a, d]) => { const ax = Math.cos(a * Math.PI) * r * 0.72, ay = Math.sin(a * Math.PI) * r * 0.72;
          ctx.beginPath(); ctx.moveTo(ax - r * 0.32, ay + d * r * 0.05); ctx.lineTo(ax, ay); ctx.lineTo(ax + r * 0.05 * d, ay - d * r * 0.34); ctx.stroke(); });
        break;
      case 'plus': ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0); ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55); ctx.stroke(); break;
      case 'minus': ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0); ctx.stroke(); break;
      case 'stop': G.roundRect(ctx, -r * 0.42, -r * 0.42, r * 0.84, r * 0.84, r * 0.12); ctx.fill(); break;
      case 'trophy':
        ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.8); ctx.lineTo(r * 0.55, -r * 0.8); ctx.lineTo(r * 0.45, -r * 0.05);
        ctx.quadraticCurveTo(0, r * 0.35, -r * 0.45, -r * 0.05); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(-r * 0.62, -r * 0.45, r * 0.26, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(r * 0.62, -r * 0.45, r * 0.26, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
        ctx.fillRect(-r * 0.09, r * 0.15, r * 0.18, r * 0.4); ctx.fillRect(-r * 0.45, r * 0.55, r * 0.9, r * 0.22); break;
    }
    ctx.restore();
  };

  // ---------------- logo (pre-rendered per layout) ----------------
  let logoC = null;
  H.invalidate = () => { logoC = null; };
  function buildLogo() {
    const b = G.L.logo, o = G.offscreen(b.w, b.h), x = o.x;
    const big = Math.min(b.h * 0.5, b.w * 0.16);
    x.save();
    G.text(x, 'FISKCE PRESENTS', b.w / 2, b.h * 0.14, big * 0.26, '#e9d7ff', { weight: 700, display: true, shadow: 'rgba(0,0,0,.7)' });
    G.goldText(x, T('titleTop'), b.w / 2, b.h * 0.36, big * 0.5, { maxW: b.w * 0.9, glow: 'rgba(255,150,40,.55)' });
    G.goldText(x, T('titleMain'), b.w / 2, b.h * 0.72, big, { maxW: b.w * 0.98, glow: 'rgba(255,150,40,.7)' });
    x.restore();
    logoC = o.c;
  }
  H.drawLogo = ctx => {
    if (G.L.noLogo) return;
    if (!logoC) buildLogo();
    const b = G.L.logo, t = G.clock.real;
    ctx.drawImage(logoC, b.x, b.y, b.w, b.h);
    // a glint sweeping across the title every few seconds
    const p = (t % 5) / 1.2;
    if (p < 1) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
      const gx = b.x + b.w * (p * 1.2 - 0.1);
      ctx.drawImage(FX.starSprite(), gx - b.h * 0.25, b.y + b.h * 0.55 - b.h * 0.25, b.h * 0.5, b.h * 0.5);
      ctx.restore();
    }
  };

  // ---------------- left column: buy / ante / multiplier ----------------
  function panel(ctx, r, top, bot, border, radius) {
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    G.roundRect(ctx, r.x, r.y, r.w, r.h, radius); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = border; ctx.stroke();
    G.roundRect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h * 0.45, radius * 0.8);
    const sh = ctx.createLinearGradient(0, r.y, 0, r.y + r.h * 0.45);
    sh.addColorStop(0, 'rgba(255,255,255,.16)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh; ctx.fill();
  }
  function hoverGlow(ctx, r, a, radius, color) {
    if (a.h < 0.02) return;
    ctx.save(); ctx.globalAlpha = a.h; ctx.shadowColor = color || 'rgba(255,210,120,.9)'; ctx.shadowBlur = 22;
    G.roundRect(ctx, r.x, r.y, r.w, r.h, radius); ctx.strokeStyle = 'rgba(255,236,170,.9)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
  function pressScale(ctx, r, a) {
    const s = 1 - a.p * 0.04 + a.h * 0.015;
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(s, s); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }

  H.drawLeft = ctx => {
    const L = G.L, P = L.portrait, rad = Math.min(16, L.buy.h * 0.18);
    // BUY FREE SPINS
    const br = L.buy;
    if (!G.allow('buy')) { drawBetPanel(ctx, L, P, rad); drawWell(ctx); return; }
    // pressable whenever no round is running: it says why when it can't (double chance on, balance too low)
    const buyIdle = !S.busy && !S.inFS, buyOk = buyIdle && !S.ante && G.Game.canAfford('bonus');
    const a = G.button('buy', br.x, br.y, br.w, br.h, () => G.Game.askBuy(), { disabled: !buyIdle, label: T('buyTitle') });
    ctx.save(); pressScale(ctx, br, a);
    ctx.globalAlpha = buyOk ? 1 : 0.5;
    panel(ctx, br, '#c4253b', '#5c0a18', '#f2c45a', rad);
    if (buyOk) { // slow shimmer across the button
      const p = (G.clock.real % 3.2) / 3.2;
      ctx.save(); G.roundRect(ctx, br.x, br.y, br.w, br.h, rad); ctx.clip();
      const sx = br.x - br.w * 0.5 + p * br.w * 2;
      const sg = ctx.createLinearGradient(sx - br.w * 0.25, 0, sx + br.w * 0.25, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,240,200,.22)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg; ctx.fillRect(br.x, br.y, br.w, br.h); ctx.restore();
    }
    const fs = P ? Math.min(br.h * 0.22, br.w * 0.1) : Math.min(br.h * 0.16, br.w * 0.12);
    G.text(ctx, T('buy'), br.x + br.w / 2, br.y + br.h * (P ? 0.24 : 0.24), fs * 0.9, '#ffe6b0', { weight: 800, maxW: br.w * 0.9 });
    G.goldText(ctx, T('freeSpins'), br.x + br.w / 2, br.y + br.h * (P ? 0.5 : 0.48), fs * 1.15, { maxW: br.w * 0.88 });
    G.text(ctx, G.money(G.buyCost()), br.x + br.w / 2, br.y + br.h * (P ? 0.78 : 0.76), fs * 1.15, '#ffffff', { weight: 800, maxW: br.w * 0.9, shadow: 'rgba(0,0,0,.6)' });
    ctx.restore();
    hoverGlow(ctx, br, a, rad);
    drawBetPanel(ctx, L, P, rad);
    drawWell(ctx);
  };

  // BET + DOUBLE CHANCE (ante). BET is the bet level; the ante's extra 25% is shown on its own line.
  function drawBetPanel(ctx, L, P, rad) {
    const bt = L.bet, anteOk = !S.busy && !S.inFS && G.allow('ante');
    panel(ctx, bt, 'rgba(40,18,74,.92)', 'rgba(14,6,30,.95)', '#b8892e', rad);
    const fb = P ? Math.min(bt.h * 0.2, bt.w * 0.085) : Math.min(bt.h * 0.11, bt.w * 0.1);
    if (G.mode === 'replay') {      // a replay shows its bet and nothing to change
      G.text(ctx, T('replay'), bt.x + bt.w / 2, bt.y + bt.h * 0.3, fb * 1.1, '#ffd36b', { weight: 800, maxW: bt.w * 0.9 });
      G.text(ctx, T('bet') + ' ' + G.money(G.baseBet()), bt.x + bt.w / 2, bt.y + bt.h * 0.62, fb * 1.05, '#ffffff', { weight: 800, maxW: bt.w * 0.9 });
      return;
    }
    if (!P) {
      G.text(ctx, T('bet'), bt.x + bt.w / 2, bt.y + bt.h * 0.13, fb * 0.85, '#c9b6ee', { weight: 700 });
      G.text(ctx, G.money(G.baseBet()), bt.x + bt.w / 2, bt.y + bt.h * 0.28, fb * 1.45, '#ffffff', { weight: 800, maxW: bt.w * 0.9 });
      G.text(ctx, T('doubleChance'), bt.x + bt.w / 2, bt.y + bt.h * 0.47, fb * 0.78, '#ffd36b', { weight: 800, maxW: bt.w * 0.9 });
      G.text(ctx, T('doubleChanceSub'), bt.x + bt.w / 2, bt.y + bt.h * 0.57, fb * 0.66, '#c9b6ee', { weight: 700, maxW: bt.w * 0.9 });
    } else {
      G.text(ctx, T('bet') + ' ' + G.money(G.baseBet()), bt.x + bt.w / 2, bt.y + bt.h * 0.24, fb * 1.15, '#ffffff', { weight: 800, maxW: bt.w * 0.92 });
      G.text(ctx, T('doubleChance'), bt.x + bt.w / 2, bt.y + bt.h * 0.5, fb * 0.8, '#ffd36b', { weight: 800, maxW: bt.w * 0.9 });
    }
    // toggle switch
    const tw = Math.min(bt.w * 0.62, (P ? bt.h * 0.34 : bt.h * 0.2) * 2.6), th = tw / 2.6;
    const tx = bt.x + (bt.w - tw) / 2, ty = bt.y + bt.h * (P ? 0.64 : 0.66);
    const ta = G.button('ante', tx - 6, ty - 6, tw + 12, th + 12, () => G.Game.toggleAnte(), { disabled: !anteOk, label: T('doubleChance') });
    H.anteK = (H.anteK || 0) + ((S.ante ? 1 : 0) - (H.anteK || 0)) * 0.25;
    const k = H.anteK;
    ctx.save(); ctx.globalAlpha = anteOk ? 1 : 0.55;
    G.roundRect(ctx, tx, ty, tw, th, th / 2);
    ctx.fillStyle = k > 0.5 ? '#1f8a4c' : '#3a2350'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#f2c45a'; ctx.stroke();
    G.text(ctx, S.ante ? T('on') : T('off'), tx + (S.ante ? tw * 0.32 : tw * 0.68), ty + th / 2, th * 0.48, '#ffffff', { weight: 800 });
    const kx = tx + th / 2 + k * (tw - th);
    const kg = ctx.createRadialGradient(kx - th * 0.15, ty + th * 0.35, 1, kx, ty + th / 2, th / 2);
    kg.addColorStop(0, '#fff7d6'); kg.addColorStop(1, '#d19a2a');
    ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ty + th / 2, th / 2 - 2, 0, 7); ctx.fill();
    ctx.restore();
    if (ta.h > 0.02) { ctx.save(); ctx.globalAlpha = ta.h; ctx.shadowColor = '#ffd27a'; ctx.shadowBlur = 14; G.roundRect(ctx, tx, ty, tw, th, th / 2); ctx.strokeStyle = '#fff1c0'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
    if (!P) G.text(ctx, S.ante ? T('antePlus') + ' · ' + G.money(G.spinCost()) : T('antePlus'), bt.x + bt.w / 2, Math.min(ty + th + fb * 0.95, bt.y + bt.h - fb * 0.7), fb * 0.62, S.ante ? '#ffd36b' : '#9a86c8', { weight: 700, maxW: bt.w * 0.92 });
  }

  // the multiplier collector: orbs fly into it, its value slams into wins
  H.wellCenter = () => {
    const w = G.L.well;
    return G.L.portrait ? { x: w.x + w.w / 2, y: w.y + w.h * 0.6 } : { x: w.x + w.w / 2, y: w.y + w.h * 0.58 };
  };
  function drawWell(ctx) {
    const L = G.L, w = L.well, P = L.portrait, t = G.clock.real;
    const val = S.inFS ? S.persistent : S.spinMult;
    const active = val > 0;
    const rad = Math.min(16, w.h * 0.18);
    panel(ctx, w, 'rgba(30,12,58,.92)', 'rgba(8,3,18,.96)', S.inFS ? '#ffd36b' : '#7a5a1e', rad);
    const label = S.inFS ? T('totalMulti') : T('multiplier');
    G.text(ctx, label, w.x + w.w / 2, w.y + w.h * (P ? 0.2 : 0.14), Math.min(w.w * 0.1, w.h * (P ? 0.17 : 0.09)), active ? '#ffd36b' : '#9a86c8', { weight: 800, maxW: w.w * 0.9 });
    const c = H.wellCenter(), R = Math.min(w.w * 0.36, w.h * (P ? 0.34 : 0.3));
    // socket
    const sg = ctx.createRadialGradient(c.x, c.y - R * 0.3, R * 0.1, c.x, c.y, R);
    sg.addColorStop(0, active ? '#5a2a9a' : '#2a1648'); sg.addColorStop(1, '#0a0418');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, 7); ctx.fill();
    ctx.lineWidth = Math.max(2, R * 0.08); ctx.strokeStyle = '#d9a63a'; ctx.stroke();
    // swirling energy when charged
    if (active) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const col = G.ORB_COLORS[G.orbTier(val)][3];
      for (let k = 0; k < 4; k++) {
        const a0 = t * (2 + k * 0.6) + k * 1.6;
        ctx.strokeStyle = col; ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 4 + k); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, R * (0.72 + k * 0.08), a0, a0 + 1.3); ctx.stroke();
      }
      ctx.globalAlpha = 0.5; const gs = R * 2.2;
      ctx.drawImage(FX.glowSprite(col), c.x - gs, c.y - gs, gs * 2, gs * 2);
      ctx.restore();
    }
    const pulse = Math.max(0, 1 - (G.clock.real - (S.wellPulseT || -9)) / 0.5);
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1 + pulse * 0.45, 1 + pulse * 0.45);
    const txt = 'x' + val;
    if (active) G.goldText(ctx, txt, 0, R * 0.04, R * (txt.length > 4 ? 0.62 : 0.8), { maxW: R * 1.8, glow: 'rgba(255,170,60,.8)' });
    else G.text(ctx, txt, 0, R * 0.04, R * 0.7, 'rgba(200,180,240,.45)', { weight: 800, display: true });
    ctx.restore();
  }

  // the tumble win counts up toward the spin's total (or its multiplied total)
  const tumblePlaces = () => G.countPlaces(S.countTo != null ? S.countTo : S.tumbleWin);

  // ---------------- top plaque ----------------
  H.drawPlaque = ctx => {
    const L = G.L, p = L.plaque, P = L.portrait;
    let line;
    if (S.inFS) line = S.tumbleShown > 0 ? T('tumbleWin') + ' ' + G.money(S.tumbleShown, tumblePlaces()) : T('freeSpinOf', { a: Math.min(S.fsPlayed, S.fsAward), b: S.fsAward });
    else if (S.tumbleShown > 0) line = T('tumbleWin') + ' ' + G.money(S.tumbleShown, tumblePlaces());
    else line = T('winUpTo');
    const size = L.compact ? G.clamp(L.topH * 0.42, 9, 14) : P ? Math.min(G.W * 0.045, 22) : G.clamp(L.reel.w * 0.032, 16, 30);
    const maxW = P ? G.W * 0.56 : L.compact ? L.reel.w * 1.2 : L.reel.w * 0.8;
    ctx.font = G.font(size, 900, true);
    const tw = Math.min(maxW, ctx.measureText(line).width) + size * 2.2, th = size * 1.75;
    const x = G.clamp(p.cx - tw / 2, 4, G.W - tw - 4), y = p.y - th / 2, cx = x + tw / 2;
    H.plaqueC = { x: cx, y: p.y };
    // ribbon
    const g = ctx.createLinearGradient(0, y, 0, y + th);
    g.addColorStop(0, 'rgba(70,16,30,.92)'); g.addColorStop(1, 'rgba(30,6,14,.95)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + tw, y); ctx.lineTo(x + tw - th * 0.35, y + th / 2); ctx.lineTo(x + tw, y + th); ctx.lineTo(x, y + th); ctx.lineTo(x + th * 0.35, y + th / 2); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#e8b54a'; ctx.stroke();
    const pop = Math.max(0, 1 - (G.clock.real - (S.plaquePopT || -9)) / 0.3);
    ctx.save(); ctx.translate(cx, p.y); ctx.scale(1 + pop * 0.12, 1 + pop * 0.12);
    G.goldText(ctx, line, 0, 1, size, { maxW });
    ctx.restore();
  };

  // ---------------- bottom bar ----------------
  H.drawBottom = ctx => {
    const L = G.L, bb = L.bottom, P = L.portrait, W = G.W;
    const g = ctx.createLinearGradient(0, bb.y, 0, bb.y + bb.h);
    g.addColorStop(0, 'rgba(22,10,44,.94)'); g.addColorStop(1, 'rgba(6,2,14,.98)');
    ctx.fillStyle = g; ctx.fillRect(bb.x, bb.y, bb.w, bb.h);
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, 'rgba(232,181,74,0)'); lg.addColorStop(0.5, 'rgba(232,181,74,.9)'); lg.addColorStop(1, 'rgba(232,181,74,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, bb.y, W, 1.5);
    if (L.compact) drawBottomCompact(ctx, bb); else if (P) drawBottomPortrait(ctx, bb); else drawBottomLandscape(ctx, bb);
  };

  function iconButton(ctx, id, name, cx, cy, s, onClick, opts) {
    opts = opts || {};
    const a = G.button(id, cx - s * 0.75, cy - s * 0.75, s * 1.5, s * 1.5, onClick, { disabled: opts.disabled, label: opts.label || id });
    ctx.save(); ctx.globalAlpha = opts.disabled ? 0.4 : 1;
    if (a.h > 0.02 || opts.on) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.max(a.h * 0.7, opts.on ? 0.55 : 0);
      ctx.drawImage(FX.glowSprite(opts.on ? '#ffb02e' : '#a57bff'), cx - s, cy - s, s * 2, s * 2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = opts.disabled ? 0.4 : 1;
    }
    H.icon(ctx, name, cx, cy, s * (1 - a.p * 0.1), opts.on ? '#ffe08a' : '#e9c46a');
    ctx.restore();
  }
  function roundBtn(ctx, id, name, cx, cy, r, onClick, disabled, label) {
    const a = G.button(id, cx - r, cy - r, r * 2, r * 2, onClick, { shape: 'circle', disabled, label });
    ctx.save(); ctx.globalAlpha = disabled ? 0.4 : 1;
    const rr = r * (1 - a.p * 0.08);
    const g = ctx.createRadialGradient(cx, cy - rr * 0.4, rr * 0.1, cx, cy, rr);
    g.addColorStop(0, '#3a2160'); g.addColorStop(1, '#140828');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = a.h > 0.1 ? '#ffe9a0' : '#c8963a'; ctx.stroke();
    H.icon(ctx, name, cx, cy, rr * 1.0, '#ffe7a6');
    ctx.restore();
  }
  function spinButton(ctx, cx, cy, R) {
    const canSpin = !S.busy && !S.inFS && S.auto <= 0;
    const a = G.button('spin', cx - R, cy - R, R * 2, R * 2, () => G.Game.spinPressed(), { shape: 'circle', label: G.mode === 'replay' ? T('replayPlay') : 'Spin' });
    const t = G.clock.real;
    const rr = R * (1 - a.p * 0.06 + a.h * 0.03);
    ctx.save();
    // breathing halo when idle
    if (canSpin) {
      const pl = 0.5 + 0.5 * Math.sin(t * 2.6);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + pl * 0.35;
      const gs = R * 1.8; ctx.drawImage(FX.glowSprite('#ffb02e'), cx - gs, cy - gs, gs * 2, gs * 2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    // gold ring
    const ring = ctx.createLinearGradient(cx, cy - rr, cx, cy + rr);
    ring.addColorStop(0, '#fff2b8'); ring.addColorStop(0.5, '#c88d22'); ring.addColorStop(1, '#ffe08a');
    ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.fill();
    const face = ctx.createRadialGradient(cx - rr * 0.2, cy - rr * 0.35, rr * 0.1, cx, cy, rr * 0.88);
    face.addColorStop(0, S.inFS ? '#ffcf5a' : '#7b3fd0'); face.addColorStop(1, S.inFS ? '#8a3a06' : '#240a52');
    ctx.fillStyle = face; ctx.beginPath(); ctx.arc(cx, cy, rr * 0.86, 0, 7); ctx.fill();
    if (S.auto > 0 || S.inFS) {
      const n = S.inFS ? S.fsLeft : S.auto;
      G.text(ctx, S.inFS ? T('free') : T('auto'), cx, cy - rr * 0.3, rr * 0.24, '#ffe9b0', { weight: 800 });
      G.goldText(ctx, n === Infinity ? '∞' : String(n), cx, cy + rr * 0.12, rr * 0.55, { display: false, weight: 800 });
      if (!S.inFS) G.text(ctx, T('stop'), cx, cy + rr * 0.55, rr * 0.2, '#ffffff', { weight: 800 });
    } else {
      // two curved arrows, spinning while the reels are busy
      const rot = S.busy ? G.clock.real * 9 : Math.sin(t * 1.3) * 0.08;
      ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.strokeStyle = '#fff3cf'; ctx.fillStyle = '#fff3cf'; ctx.lineWidth = rr * 0.12; ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        ctx.rotate(Math.PI);
        ctx.beginPath(); ctx.arc(0, 0, rr * 0.48, 0.25, Math.PI - 0.55); ctx.stroke();
        const ex = Math.cos(Math.PI - 0.55) * rr * 0.48, ey = Math.sin(Math.PI - 0.55) * rr * 0.48;
        ctx.beginPath(); ctx.moveTo(ex - rr * 0.2, ey - rr * 0.02); ctx.lineTo(ex + rr * 0.04, ey - rr * 0.22); ctx.lineTo(ex + rr * 0.08, ey + rr * 0.12); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  function moneyBlock(ctx, label, value, x, y, size, align, color, maxW) {
    G.text(ctx, label, x, y - size * 0.55, size * 0.62, '#a996d6', { weight: 700, align, maxW });
    G.text(ctx, value, x, y + size * 0.42, size, color || '#ffffff', { weight: 800, align, maxW });
  }

  function centerMessage(ctx, x, y, maxW, size) {
    let msg = S.message, col = '#ffe9b0';
    const age = G.clock.real - S.messageT;
    if (!msg || age > 3) {
      if (S.busy && S.tumbleShown > 0) { msg = T('win') + ' ' + G.money(S.tumbleShown, tumblePlaces()); col = '#ffd84a'; }
      else if (S.winDisplay > 0) { msg = T('win') + ' ' + G.money(S.winDisplay); col = '#ffd84a'; }
      else if (S.inFS) msg = S.fsTotal > 0 ? T('featureWin') + ' ' + G.money(S.fsTotal) : T('fsLeft', { n: S.fsLeft });
      else if (S.busy) msg = T('goodLuck');
      else msg = G.mode === 'replay' ? T('replay') : T('idle');
    }
    if (msg.startsWith(T('win') + ' ')) G.goldText(ctx, msg, x, y, size * 1.25, { maxW, display: false, weight: 800 });
    else G.text(ctx, msg, x, y, size, col, { weight: 800, maxW, display: true });
  }

  function drawBottomLandscape(ctx, bb) {
    const W = G.W, cy = bb.y + bb.h / 2, pad = G.L.pad * 1.4;
    const isz = G.clamp(bb.h * 0.3, 16, 28), ig = isz * 1.55;
    let x = pad + isz * 0.6;
    const icons = [
      ['info', 'info', () => G.UI.open('info'), 'Game info'],
      ['settings', 'settings', () => G.UI.open('settings'), 'Settings'],
      ['sound', G.settings.sfx || G.settings.music ? 'sound' : 'mute', () => G.Game.toggleSound(), 'Sound'],
      G.allow('fair') && ['history', 'history', () => G.UI.open('fair'), 'History & fairness'],
      G.allow('stats') && ['stats', 'trophy', () => G.UI.open('stats'), 'Stats & achievements'],
      G.allow('fullscreen') && ['full', 'full', () => G.UI.fullscreen(), 'Fullscreen'],
    ].filter(Boolean);
    icons.forEach(([id, name, fn, label]) => { iconButton(ctx, id, name, x, cy - bb.h * 0.08, isz, fn, { label }); x += ig; });
    if (G.mode === 'demo') G.text(ctx, 'FISKCE.COM', pad, bb.y + bb.h - 9, Math.min(11, bb.h * 0.13), 'rgba(233,196,106,.6)', { weight: 700, align: 'left' });
    // right cluster: turbo, -, SPIN, +, auto
    const R = G.clamp(bb.h * 0.62, 34, 62), r = R * 0.48;
    let rx = W - pad;
    const autoX = rx - r; rx = autoX - r - pad * 0.8;
    const plusX = rx - r; rx = plusX - r - pad * 0.7;
    const spinX = rx - R; rx = spinX - R - pad * 0.7;
    const minusX = rx - r; rx = minusX - r - pad * 0.8;
    const turboX = rx - r; rx = turboX - r - pad;
    const by = cy - bb.h * 0.06, sy = bb.y + bb.h * 0.42 - R * 0.18;
    betButtons(ctx, minusX, plusX, by, r);
    if (G.allow('turbo')) {
      iconButton(ctx, 'turbo', 'bolt', turboX, by, r * 1.1, () => G.Game.toggleTurbo(), { on: G.settings.turbo, label: 'Turbo' });
      G.text(ctx, T('turbo'), turboX, by + r * 1.25, Math.min(10, bb.h * 0.12), '#a996d6', { weight: 700 });
    }
    if (G.allow('auto')) {
      iconButton(ctx, 'auto', S.auto > 0 ? 'stop' : 'auto', autoX, by, r * 1.1, () => G.Game.autoPressed(), { on: S.auto > 0, disabled: S.inFS, label: 'Autoplay' });
      G.text(ctx, T('auto'), autoX, by + r * 1.25, Math.min(10, bb.h * 0.12), '#a996d6', { weight: 700 });
    }
    spinButton(ctx, spinX, sy, R);
    H.autoAnchor = { x: autoX, y: bb.y };
    // credit / bet and the centre message
    const left = x + pad * 0.2, right = rx;
    const fsz = G.clamp(bb.h * 0.2, 12, 20);
    const avail = right - left;
    const colW = Math.max(140, fsz * 8.5);
    if (avail > 260) {
      let mx = left;
      if (G.allow('balance')) { moneyBlock(ctx, T('balance'), G.money(S.credit), mx, cy - bb.h * 0.04, fsz, 'left', null, colW - 10); mx += colW; }
      moneyBlock(ctx, T('bet'), G.money(G.baseBet()), mx, cy - bb.h * 0.04, fsz, 'left', '#ffd36b', fsz * 6); mx += fsz * 6;
      centerMessage(ctx, (mx + right) / 2, cy - bb.h * 0.04, right - mx - 10, fsz * 0.95);
    } else if (G.allow('balance')) {
      moneyBlock(ctx, T('balance'), G.money(S.credit), left, cy - bb.h * 0.04, fsz * 0.9, 'left', null, avail - 10);
    }
    drawAutoMenu(ctx);
  }

  function drawBottomPortrait(ctx, bb) {
    const W = G.W, pad = G.L.pad * 1.2;
    const row1 = bb.y + bb.h * 0.2, row2 = bb.y + bb.h * 0.64;
    const fsz = G.clamp(bb.h * 0.13, 11, 16);
    if (G.allow('balance')) moneyBlock(ctx, T('balance'), G.money(S.credit), pad, row1, fsz, 'left', null, W * 0.28);
    moneyBlock(ctx, T('bet'), G.money(G.baseBet()), W - pad, row1, fsz, 'right', '#ffd36b', W * 0.26);
    centerMessage(ctx, W / 2, row1, W * 0.4, fsz * 0.95);
    const R = G.clamp(Math.min(bb.h * 0.36, W * 0.12), 30, 54), r = R * 0.52;
    const isz = G.clamp(r * 0.95, 16, 26);
    spinButton(ctx, W / 2, row2, R);
    betButtons(ctx, W / 2 - R - r - pad * 0.7, W / 2 + R + r + pad * 0.7, row2, r);
    iconButton(ctx, 'menu', 'menu', pad + isz * 0.7, row2, isz, () => G.UI.open('menu'), { label: 'Menu' });
    iconButton(ctx, 'sound', G.settings.sfx || G.settings.music ? 'sound' : 'mute', pad + isz * 2.4, row2, isz, () => G.Game.toggleSound(), { label: 'Sound' });
    if (G.allow('auto')) iconButton(ctx, 'auto', S.auto > 0 ? 'stop' : 'auto', W - pad - isz * 0.7, row2, isz, () => G.Game.autoPressed(), { on: S.auto > 0, disabled: S.inFS, label: 'Autoplay' });
    if (G.allow('turbo')) iconButton(ctx, 'turbo', 'bolt', W - pad - isz * 2.4, row2, isz, () => G.Game.toggleTurbo(), { on: G.settings.turbo, label: 'Turbo' });
    H.autoAnchor = { x: W - pad - isz * 0.7, y: row2 - isz };
    drawAutoMenu(ctx);
  }

  // − / + bet buttons (not in a replay)
  function betButtons(ctx, minusX, plusX, y, r) {
    if (!G.allow('bet')) return;
    const lock = S.busy || S.inFS || S.auto > 0;
    roundBtn(ctx, 'betDown', 'minus', minusX, y, r, () => G.Game.bet(-1), lock || S.betIndex === 0, 'Lower bet');
    roundBtn(ctx, 'betUp', 'plus', plusX, y, r, () => G.Game.bet(1), lock || S.betIndex === G.BET_STEPS.length - 1, 'Raise bet');
  }

  // 400x225 and other short windows: everything on one slim row
  function drawBottomCompact(ctx, bb) {
    const W = G.W, cy = bb.y + bb.h / 2, pad = 6;
    const isz = G.clamp(bb.h * 0.3, 12, 18);
    iconButton(ctx, 'menu', 'menu', pad + isz * 0.7, cy, isz, () => G.UI.open('menu'), { label: 'Menu' });
    iconButton(ctx, 'sound', G.settings.sfx || G.settings.music ? 'sound' : 'mute', pad + isz * 2.3, cy, isz, () => G.Game.toggleSound(), { label: 'Sound' });
    const R = G.clamp(bb.h * 0.42, 15, 24), r = R * 0.55, g = 5;
    let rx = W - pad;
    const autoX = G.allow('auto') ? (rx -= r, rx) : null; if (autoX) rx -= r + g;
    const plusX = rx - r; rx = plusX - r - g;
    const spinX = rx - R; rx = spinX - R - g;
    const minusX = rx - r; rx = minusX - r - g;
    const turboX = G.allow('turbo') ? rx - r : null; if (turboX) rx = turboX - r - g;
    betButtons(ctx, minusX, plusX, cy, r);
    if (turboX) iconButton(ctx, 'turbo', 'bolt', turboX, cy, r * 1.1, () => G.Game.toggleTurbo(), { on: G.settings.turbo, label: 'Turbo' });
    if (autoX) iconButton(ctx, 'auto', S.auto > 0 ? 'stop' : 'auto', autoX, cy, r * 1.1, () => G.Game.autoPressed(), { on: S.auto > 0, disabled: S.inFS, label: 'Autoplay' });
    spinButton(ctx, spinX, cy, R);
    H.autoAnchor = { x: autoX || spinX, y: bb.y };
    // balance and bet on two lines, then the message in what is left
    const left = pad + isz * 3.4, fsz = G.clamp(bb.h * 0.2, 8, 12), colW = Math.min(110, (rx - left) * 0.55);
    const vy1 = cy - fsz * 0.65, vy2 = cy + fsz * 0.75;
    if (G.allow('balance')) G.text(ctx, T('balance') + ' ' + G.money(S.credit), left, vy1, fsz, '#ffffff', { weight: 800, align: 'left', maxW: colW });
    G.text(ctx, T('bet') + ' ' + G.money(G.baseBet()), left, G.allow('balance') ? vy2 : cy, fsz, '#ffd36b', { weight: 800, align: 'left', maxW: colW });
    const mx = left + colW + 6;
    if (rx - mx > 50) centerMessage(ctx, (mx + rx) / 2, cy, rx - mx - 6, fsz * 0.95);
    drawAutoMenu(ctx);
  }

  function drawAutoMenu(ctx) {
    if (!S.autoMenu || S.auto > 0) return;
    const opts = [10, 25, 50, 100, Infinity];
    const bw = G.clamp(G.W * 0.07, 64, 92), gap = 6;
    // fit above the button even in short windows (400x225)
    const room = H.autoAnchor.y - 20;
    const bh = Math.max(16, Math.min(G.clamp(G.H * 0.05, 34, 46), (room - gap * opts.length) / (opts.length + 0.9)));
    const h = opts.length * (bh + gap) + bh * 0.9;
    const x = G.clamp(H.autoAnchor.x - bw / 2, 8, G.W - bw - 8), y = H.autoAnchor.y - h - 14;
    G.roundRect(ctx, x - 8, y - 8, bw + 16, h + 16, 12);
    ctx.fillStyle = 'rgba(20,8,40,.97)'; ctx.fill(); ctx.strokeStyle = '#e8b54a'; ctx.lineWidth = 1.5; ctx.stroke();
    G.text(ctx, 'AUTOPLAY', x + bw / 2, y + bh * 0.35, Math.min(13, bh * 0.34), '#ffd36b', { weight: 800 });
    let yy = y + bh * 0.85;
    opts.forEach(n => {
      const a = G.button('auto' + n, x, yy, bw, bh, () => G.Game.startAuto(n), { label: 'Autoplay ' + n });
      G.roundRect(ctx, x, yy, bw, bh, 8);
      const g = ctx.createLinearGradient(0, yy, 0, yy + bh);
      g.addColorStop(0, a.h > 0.1 ? '#7b3fd0' : '#4a2390'); g.addColorStop(1, '#22094a');
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#c8963a'; ctx.lineWidth = 1; ctx.stroke();
      G.text(ctx, n === Infinity ? '∞' : String(n), x + bw / 2, yy + bh / 2, bh * 0.45, '#ffffff', { weight: 800 });
      yy += bh + gap;
    });
  }

  // fairness commitment under the board (click opens the verifier)
  H.drawHint = ctx => {
    const L = G.L;
    if (!window.ProvablyFair || !G.allow('fair') || L.noHint) return;
    const h = ProvablyFair.serverHash;
    const text = `PROVABLY FAIR · ${h.slice(0, 10)}…${h.slice(-6)} · #${ProvablyFair.nonce}`;
    const size = G.clamp(L.hintH * 0.36, 9, 12);
    ctx.font = G.font(size, 700);
    const tw = Math.min(ctx.measureText(text).width, G.W * 0.9);
    const a = G.button('fair', G.W / 2 - tw / 2 - 10, L.hintY - size, tw + 20, size * 2, () => G.UI.open('fair'), { label: 'Provably fair details' });
    G.text(ctx, text, L.reel.x + L.reel.w / 2, L.hintY, size, a.h > 0.1 ? '#e8f6ff' : 'rgba(190,225,255,.7)', { weight: 700, maxW: G.W * 0.9 });
  };
})();

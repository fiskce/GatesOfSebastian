/* Thunder Hunter Sebastian — HUD: side panels, logo, plaque, bottom bar.
 * Everything is drawn on the canvas and registered as a hit region each frame
 * (G.button); game.js hit-tests the pointer against those regions.
 *
 * Chrome is one material: machined ink-steel plates (brushed, a 1 px chamfer,
 * a slim gold inlay). Pressing sinks a plate, hover is the key light catching
 * its bevel, and a disabled control is unlit metal that says why when pressed.
 * Gold is kept for money, the Spin button and the frame; Buy is ruby lacquer.
 * Plates are baked per size and state and drawn as images.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX, B = G.Board, E = G.E;
  const H = G.HUD = {};
  const S = G.S, T = G.T;
  const INK = { 0: '#0A0C16', 1: '#12152A', 2: '#1B1F3A', 3: '#272C4D' }, TXT = '#F4F1EA', TXT2 = '#B9B6D3', EMERALD = '#2FD27A';
  // smallest text the HUD draws: 11 px, 8 px in the 400x225 layout (Stake's check sizes)
  const floor = px => Math.max(G.L.compact ? 8 : 11, px);

  // ---------------- buttons ----------------
  const anim = {};   // per-button sprung hover/press values
  G.button = (id, x, y, w, h, onClick, opts) => {
    opts = opts || {};
    const m = G.ctx.getTransform();
    const plain = m.a === G.DPR && m.d === G.DPR && !m.b && !m.c && !m.e && !m.f;
    G.L.buttons.push({ id, x, y, w, h, onClick, shape: opts.shape, disabled: !!opts.disabled, label: opts.label || id, reason: opts.reason, inv: plain ? null : m.inverse() });
    const a = anim[id] || (anim[id] = { h: 0, p: 0, hs: { x: 0, v: 0 }, ps: { x: 0, v: 0 }, t: G.clock.real });
    const hov = G.hoverId === id && !opts.disabled, pr = G.pressId === id && !opts.disabled;
    const dt = G.clamp(G.clock.real - a.t, 0, 0.05); a.t = G.clock.real;
    a.h = G.clamp(G.spring(a.hs, hov ? 1 : 0, dt, G.SPRING.HOVER), 0, 1);
    a.p = G.spring(a.ps, pr ? 1 : 0, dt, pr ? G.SPRING.PRESS : G.SPRING.RELEASE);   // springs back past rest a little
    return a;
  };

  // ---------------- reason chips ----------------
  // a disabled control, when pressed, says why for a moment just above itself
  let chip = null;
  H.chip = (text, x, y) => { chip = { text, x, y, t: G.clock.real }; };
  function drawChip(ctx) {
    if (!chip) return;
    const age = G.clock.real - chip.t;
    if (age > 1.8) { chip = null; return; }
    const a = Math.min(1, age / 0.12, (1.8 - age) / 0.3), size = floor(G.L.compact ? 9 : 12);
    ctx.save(); ctx.globalAlpha = a;
    ctx.font = G.font(size, 800);
    const w = ctx.measureText(chip.text).width + size * 1.6, h = size * 2;
    const x = G.clamp(chip.x - w / 2, 6, G.W - w - 6), y = Math.max(6, chip.y - h - 8 - (1 - a) * 4);
    G.roundRect(ctx, x, y, w, h, 8); ctx.fillStyle = 'rgba(10,12,22,.94)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = INK[3]; ctx.stroke();
    G.text(ctx, chip.text, x + w / 2, y + h / 2, size, TXT, { weight: 800 });
    ctx.restore();
  }

  // ---------------- chrome material ----------------
  const plates = new Map();
  const rrPath = (x, y, w, h, r) => {
    const p = new Path2D(); r = Math.max(0, Math.min(r, w / 2, h / 2));
    p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath();
    return p;
  };
  /* kind: 'steel' (chrome plates), 'ruby' (Buy: oxblood lacquer in a gold
   * bezel), 'well' (a recessed readout), 'disc' (round chrome buttons).
   * state: 'rest', 'hover', 'down', 'off' (unlit). */
  function bakePlate(w, h, rad, kind, state) {
    const M = G.Mat, d = 1 / G.DPR, pad = Math.ceil(Math.max(4, Math.min(w, h) * 0.1));
    const o = G.offscreen(w + pad * 2, h + pad * 2), x = o.x;
    x.translate(pad, pad);
    const round = kind === 'disc' || kind === 'knob';
    const body = round ? (() => { const p = new Path2D(); p.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); return p; })() : rrPath(0, 0, w, h, rad);
    const off = state === 'off', down = state === 'down', hov = state === 'hover';
    if (kind !== 'well' && !down) M.shadowOnly(x, k => k.fill(body), pad * 0.7, 0, pad * 0.3, 'rgba(0,0,0,.5)');
    // body
    let g;
    if (kind === 'ruby') {
      g = x.createRadialGradient(w * 0.3, h * 0.15, 0, w * 0.45, h * 0.4, Math.max(w, h) * 0.85);
      g.addColorStop(0, off ? '#4a1620' : '#9a2234'); g.addColorStop(0.45, off ? '#34101a' : '#7A1322'); g.addColorStop(1, off ? '#1c070c' : '#3A0710');
    } else if (kind === 'knob') {          // a polished steel knob, lit from the upper left
      g = x.createRadialGradient(w * 0.32, h * 0.28, 0, w / 2, h / 2, w * 0.62);
      g.addColorStop(0, '#f2f4fb'); g.addColorStop(0.5, '#a9afc6'); g.addColorStop(1, '#4c5270');
    } else if (kind === 'well') {
      g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#07080f'); g.addColorStop(1, INK[0]);
    } else {
      g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, off ? '#151829' : down ? '#171a33' : INK[2]); g.addColorStop(1, off ? '#0d0f1c' : down ? '#0f1224' : INK[1]);
    }
    x.fillStyle = g; x.fill(body);
    x.save(); x.clip(body);
    const box = [0, 0, w, h];
    if (kind === 'steel' || round) M.texture(x, 'brushed', kind === 'knob' ? 0.04 : 0.05, 'overlay', false, box);
    else if (kind === 'ruby') M.texture(x, 'grain', 0.03, 'overlay', false, box);
    if (kind === 'ruby' && !off) {
      // clear coat: a soft window reflection up top, a warm caustic at the bottom
      x.globalCompositeOperation = 'lighter';
      const wr = x.createLinearGradient(0, h * 0.06, 0, h * 0.42);
      wr.addColorStop(0, 'rgba(255,235,230,.18)'); wr.addColorStop(1, 'rgba(255,235,230,0)');
      x.fillStyle = wr; x.fill(rrPath(w * 0.06, h * 0.05, w * 0.88, h * 0.36, Math.min(rad, h * 0.18)));
      const cg = x.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, w * 0.6);
      cg.addColorStop(0, 'rgba(255,140,90,.10)'); cg.addColorStop(1, 'rgba(255,140,90,0)');
      x.fillStyle = cg; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'source-over';
    } else if (kind !== 'well' && kind !== 'knob' && !off) {
      const tl = x.createLinearGradient(0, 0, 0, h * 0.5);
      tl.addColorStop(0, `rgba(200,210,255,${hov ? 0.09 : 0.05})`); tl.addColorStop(1, 'rgba(200,210,255,0)');
      x.fillStyle = tl; x.fillRect(0, 0, w, h);
    }
    if (down || kind === 'well') M.innerShadow(x, body, kind === 'well' ? 5 : 6, 0, kind === 'well' ? 2 : 2.5, 'rgba(0,0,0,.75)', box);
    x.restore();
    // chamfer: the key light catches the top edge, the bottom edge falls away
    const ch = x.createLinearGradient(0, 0, 0, h);
    if (kind === 'well') { ch.addColorStop(0, 'rgba(0,0,0,.9)'); ch.addColorStop(0.6, 'rgba(0,0,0,0)'); ch.addColorStop(1, 'rgba(120,130,190,.35)'); }
    else {
      const lit = off ? 'rgba(58,65,112,.35)' : hov ? 'rgba(120,132,210,.85)' : down ? 'rgba(58,65,112,.4)' : 'rgba(58,65,112,.6)';
      ch.addColorStop(0, lit); ch.addColorStop(0.5, 'rgba(5,6,12,0)'); ch.addColorStop(1, 'rgba(5,6,12,.95)');
    }
    x.lineWidth = d * 1.5; x.strokeStyle = ch; x.stroke(body);
    // gold: a slim inlay on steel, a polished bezel round the lacquer
    if (kind === 'ruby') {
      x.lineWidth = Math.max(2, Math.min(w, h) * 0.035); x.strokeStyle = off ? 'rgba(160,120,50,.5)' : M.goldBar(x, 0, h); x.stroke(body);
      x.lineWidth = d; x.strokeStyle = 'rgba(42,20,4,.9)'; x.stroke(rrPath(-x.lineWidth, -x.lineWidth, w + x.lineWidth * 2, h + x.lineWidth * 2, rad));
    } else if (kind !== 'well' && kind !== 'knob') {
      const ga = off ? 0.22 : hov ? 0.9 : down ? 0.65 : 0.55, ins = round ? 2.5 : 3;
      const inl = round ? (() => { const p = new Path2D(); p.arc(w / 2, h / 2, w / 2 - ins, 0, Math.PI * 2); return p; })() : rrPath(ins, ins, w - ins * 2, h - ins * 2, Math.max(0, rad - ins * 0.7));
      x.lineWidth = d * 1.2; x.strokeStyle = `rgba(242,201,90,${ga})`; x.stroke(inl);
    }
    return { c: o.c, pad };
  }
  function plate(ctx, r, rad, kind, state, alpha) {
    const key = kind + '|' + state + '|' + Math.round(r.w * 2) + 'x' + Math.round(r.h * 2) + '|' + Math.round(rad) + '|' + G.DPR;
    let c = plates.get(key);
    if (!c) { c = bakePlate(r.w, r.h, rad, kind, state); plates.set(key, c); }
    if (alpha != null) { if (alpha < 0.01) return; ctx.save(); ctx.globalAlpha *= alpha; }
    ctx.drawImage(c.c, r.x - c.pad, r.y - c.pad, r.w + c.pad * 2, r.h + c.pad * 2);
    if (alpha != null) ctx.restore();
  }
  // a pressable plate: rest, with hover and press crossfaded in by their springs
  function plateButton(ctx, r, rad, kind, a, off) {
    if (off) { plate(ctx, r, rad, kind, 'off'); return; }
    plate(ctx, r, rad, kind, 'rest');
    plate(ctx, r, rad, kind, 'hover', a.h * (1 - G.clamp(a.p, 0, 1)));
    plate(ctx, r, rad, kind, 'down', G.clamp(a.p, 0, 1));
  }
  // pressing sinks a plate a little (1 px down, 1.5% smaller)
  function sink(ctx, r, a) {
    const p = G.clamp(a.p, -0.2, 1), s = 1 - p * 0.015;
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2 + p); ctx.scale(s, s); ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }

  // ---------------- icons (vector, no emoji) ----------------
  H.icon = (ctx, name, cx, cy, s, color) => {
    ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = ctx.fillStyle = color || TXT;
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
  let logoC = null, barC = null, plaqueC = null, socketC = null;
  const spinC = new Map();
  H.invalidate = () => { logoC = barC = plaqueC = socketC = null; plates.clear(); spinC.clear(); };
  function buildLogo() {
    const b = G.L.logo, o = G.offscreen(b.w, b.h), x = o.x;
    const big = Math.min(b.h * 0.5, b.w * 0.16);
    x.save();
    G.text(x, 'FISKCE PRESENTS', b.w / 2, b.h * 0.14, Math.max(11, big * 0.26), '#e9d7ff', { weight: 700, display: true, shadow: 'rgba(0,0,0,.7)' });
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
    // a glint sweeping across the title, rarely (the frame and Spin carry the life)
    const p = (t % 9) / 1.2;
    if (p < 1) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(p * Math.PI) * 0.8;
      const gx = b.x + b.w * (p * 1.2 - 0.1);
      ctx.drawImage(FX.starSprite(), gx - b.h * 0.25, b.y + b.h * 0.55 - b.h * 0.25, b.h * 0.5, b.h * 0.5);
      ctx.restore();
    }
  };

  // ---------------- left column: buy / double chance / multiplier ----------------
  H.drawLeft = ctx => {
    const L = G.L, P = L.portrait, rad = Math.min(12, L.buy.h * 0.16);
    if (!G.allow('buy')) { drawBetPanel(ctx, L, P, rad); drawWell(ctx); return; }
    // BUY FREE SPINS: pressable whenever no round is running; it says why when it can't
    const br = L.buy, buyIdle = !S.busy && !S.inFS, buyOk = buyIdle && !S.ante && G.Game.canAfford('bonus');
    const a = G.button('buy', br.x, br.y, br.w, br.h, () => G.Game.askBuy(), { disabled: !buyIdle || S.ante, label: T('buyTitle'),
      reason: S.inFS ? 'reasonFS' : S.busy ? 'reasonRound' : 'msgAnteFirst' });
    ctx.save(); sink(ctx, br, a);
    plateButton(ctx, br, rad, 'ruby', a, !buyOk);
    const fs = P ? Math.min(br.h * 0.22, br.w * 0.1) : Math.min(br.h * 0.16, br.w * 0.12);
    ctx.globalAlpha = buyOk ? 1 : 0.6;
    G.text(ctx, T('buy'), br.x + br.w / 2, br.y + br.h * 0.24, floor(fs * 0.9), '#ffe6dc', { weight: 800, maxW: br.w * 0.9 });
    G.goldText(ctx, T('freeSpins'), br.x + br.w / 2, br.y + br.h * (P ? 0.5 : 0.48), fs * 1.15, { maxW: br.w * 0.88 });
    G.text(ctx, G.money(G.buyCost()), br.x + br.w / 2, br.y + br.h * (P ? 0.78 : 0.76), fs * 1.15, TXT, { weight: 800, maxW: br.w * 0.9, tabular: true });
    ctx.restore();
    drawBetPanel(ctx, L, P, rad);
    drawWell(ctx);
  };

  // DOUBLE CHANCE (ante) on a steel plate; the bet itself lives in the bottom bar's BET readout
  function drawBetPanel(ctx, L, P, rad) {
    const bt = L.bet, anteOk = !S.busy && !S.inFS && G.allow('ante');
    plate(ctx, bt, rad, 'steel', 'rest');
    const fb = P ? Math.min(bt.h * 0.2, bt.w * 0.085) : Math.min(bt.h * 0.11, bt.w * 0.1);
    if (G.mode === 'replay') {      // a replay shows its bet and nothing to change
      G.text(ctx, T('replay'), bt.x + bt.w / 2, bt.y + bt.h * 0.3, floor(fb * 1.1), TXT, { weight: 800, maxW: bt.w * 0.9 });
      G.text(ctx, T('bet') + ' ' + G.money(G.baseBet()), bt.x + bt.w / 2, bt.y + bt.h * 0.62, floor(fb * 1.05), TXT, { weight: 800, maxW: bt.w * 0.9 });
      return;
    }
    // the bet itself lives in the console's BET readout; this plate is the Double Chance module
    G.text(ctx, T('doubleChance'), bt.x + bt.w / 2, bt.y + bt.h * (P ? 0.27 : 0.2), floor(fb * (P ? 0.85 : 0.95)), TXT, { weight: 800, maxW: bt.w * 0.9 });
    if (!P) G.text(ctx, T('doubleChanceSub'), bt.x + bt.w / 2, bt.y + bt.h * 0.33, floor(fb * 0.7), TXT2, { weight: 700, maxW: bt.w * 0.9 });
    // a detent slider: an ink channel, a steel knob, emerald when ON
    const tw = Math.min(bt.w * 0.62, (P ? bt.h * 0.34 : bt.h * 0.2) * 2.6), th = tw / 2.6;
    const tx = bt.x + (bt.w - tw) / 2, ty = bt.y + bt.h * (P ? 0.5 : 0.47);
    const ta = G.button('ante', tx - 6, ty - 6, tw + 12, th + 12, () => G.Game.toggleAnte(), { disabled: !anteOk, label: T('doubleChance'), reason: S.inFS ? 'reasonFS' : 'reasonRound' });
    const ks = H.anteS || (H.anteS = { x: S.ante ? 1 : 0, v: 0, t: G.clock.real });
    const k = G.clamp(G.spring(ks, S.ante ? 1 : 0, G.clamp(G.clock.real - ks.t, 0, 0.05), G.SPRING.KNOB), -0.05, 1.05); ks.t = G.clock.real;
    ctx.save(); ctx.globalAlpha = anteOk ? 1 : 0.55;
    plate(ctx, { x: tx, y: ty, w: tw, h: th }, th / 2, 'well', 'rest');
    if (k > 0.02) {
      ctx.save(); ctx.globalAlpha *= G.clamp(k, 0, 1);
      G.roundRect(ctx, tx + 2, ty + 2, tw - 4, th - 4, th / 2 - 2);
      const eg = ctx.createLinearGradient(0, ty, 0, ty + th); eg.addColorStop(0, '#45e893'); eg.addColorStop(1, '#1f9a58');
      ctx.fillStyle = eg; ctx.fill(); ctx.restore();
    }
    G.text(ctx, S.ante ? T('on') : T('off'), tx + (S.ante ? tw * 0.32 : tw * 0.68), ty + th / 2, floor(th * 0.48), S.ante ? '#06200f' : TXT2, { weight: 800 });
    const kx = tx + th / 2 + G.clamp(k, 0, 1) * (tw - th);
    plate(ctx, { x: kx - th / 2 + 2, y: ty + 2, w: th - 4, h: th - 4 }, 0, 'knob', 'rest');
    ctx.restore();
    // BET always shows the bet level; Double Chance's extra cost is shown here, on its own
    const plus = S.ante ? T('antePlus') + ' · ' + G.money(G.spinCost()) : T('antePlus');
    if (!P) G.text(ctx, plus, bt.x + bt.w / 2, Math.min(ty + th + fb * 1.1, bt.y + bt.h - fb * 0.7), floor(fb * 0.66), S.ante ? EMERALD : TXT2, { weight: 700, maxW: bt.w * 0.92 });
    else if (S.ante) G.text(ctx, plus, bt.x + bt.w / 2, Math.min(ty + th + fb * 0.75, bt.y + bt.h - fb * 0.5), floor(fb * 0.6), EMERALD, { weight: 700, maxW: bt.w * 0.92 });
  }

  /* The multiplier collector: a storm jar. Empty, it is an engraved socket
   * (no "x0" that reads like a fault); orbs fill it with charged glass. */
  H.wellCenter = () => {
    const w = G.L.well;
    return G.L.portrait ? { x: w.x + w.w / 2, y: w.y + w.h * 0.6 } : { x: w.x + w.w / 2, y: w.y + w.h * 0.58 };
  };
  function bakeSocket(R) {
    const M = G.Mat, s = R * 2 + 8, o = G.offscreen(s, s), x = o.x, c = s / 2;
    const disc = new Path2D(); disc.arc(c, c, R, 0, Math.PI * 2);
    const g = x.createRadialGradient(c, c - R * 0.3, R * 0.1, c, c, R);
    g.addColorStop(0, '#141832'); g.addColorStop(1, '#05060c');
    x.fillStyle = g; x.fill(disc);
    M.innerShadow(x, disc, R * 0.18, 0, R * 0.08, 'rgba(0,0,0,.85)', [c - R, c - R, R * 2, R * 2]);
    // an engraved bolt waiting for its charge
    const b = new Path2D(), r = R * 0.42;
    b.moveTo(c + r * 0.2, c - r); b.lineTo(c - r * 0.6, c + r * 0.12); b.lineTo(c - r * 0.02, c + r * 0.12); b.lineTo(c - r * 0.25, c + r); b.lineTo(c + r * 0.62, c - r * 0.18); b.lineTo(c + r * 0.04, c - r * 0.18); b.closePath();
    M.engrave(x, b, Math.max(1, R * 0.035), 'rgba(0,0,0,.9)', 'rgba(150,160,220,.28)');
    // the gold rim it sits in
    x.lineWidth = Math.max(2, R * 0.08); x.strokeStyle = M.goldRound(x, c - R, c - R, c + R, c + R); x.stroke(disc);
    return o.c;
  }
  function drawWell(ctx) {
    const L = G.L, w = L.well, P = L.portrait, t = G.clock.real;
    const val = S.inFS ? S.persistent : S.spinMult, active = val > 0;
    const rad = Math.min(12, w.h * 0.16);
    plate(ctx, w, rad, 'steel', 'rest');
    const label = S.inFS ? T('totalMulti') : T('multiplier');
    G.text(ctx, label, w.x + w.w / 2, w.y + w.h * (P ? 0.2 : 0.14), floor(Math.min(w.w * 0.1, w.h * (P ? 0.17 : 0.09))), active ? '#ffd36b' : TXT2, { weight: 800, maxW: w.w * 0.9 });
    const c = H.wellCenter(), R = Math.min(w.w * 0.36, w.h * (P ? 0.34 : 0.3));
    const sk = Math.round(R * 2) / 2;
    if (!socketC || socketC.R !== sk) socketC = { R: sk, c: bakeSocket(sk) };
    const ss = sk * 2 + 8;
    ctx.drawImage(socketC.c, c.x - ss / 2, c.y - ss / 2, ss, ss);
    if (active) {
      // charged storm glass in the socket, energy crawling round it
      const tier = G.orbTier(val), col = G.ORB_COLORS[tier];
      ctx.save();
      const gg = ctx.createRadialGradient(c.x - R * 0.3, c.y - R * 0.35, R * 0.05, c.x, c.y, R * 0.92);
      gg.addColorStop(0, FX.hexA(col[0], 0.9)); gg.addColorStop(0.45, FX.hexA(col[1], 0.75)); gg.addColorStop(1, FX.hexA(col[2], 0.9));
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(c.x, c.y, R * 0.9, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 4; k++) {
        const a0 = t * (2 + k * 0.6) + k * 1.6;
        ctx.strokeStyle = col[3]; ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 4 + k); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, R * (0.72 + k * 0.08), a0, a0 + 1.3); ctx.stroke();
      }
      ctx.globalAlpha = 0.45; const gs = R * 2.2;
      ctx.drawImage(FX.glowSprite(col[3]), c.x - gs, c.y - gs, gs * 2, gs * 2);
      ctx.restore();
      const pulse = Math.max(0, 1 - (G.clock.real - (S.wellPulseT || -9)) / 0.5);
      ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1 + pulse * 0.45, 1 + pulse * 0.45);
      const txt = '×' + val;
      G.goldText(ctx, txt, 0, R * 0.04, R * (txt.length > 4 ? 0.62 : 0.8), { maxW: R * 1.8, glow: 'rgba(255,170,60,.8)', tabular: true });
      ctx.restore();
    }
  }

  // ---------------- top plaque: an enamel cartouche of fixed width ----------------
  // the tumble win counts toward the spin's total (or its multiplied total)
  const countTo = () => (S.countTo != null ? S.countTo : S.tumbleWin);
  function bakePlaque(w, h) {
    const M = G.Mat, pad = 6, o = G.offscreen(w + pad * 2, h + pad * 2), x = o.x;
    x.translate(pad, pad);
    // a cartouche: a long plate with notched, rounded ends
    const n = h * 0.32, p = new Path2D();
    p.moveTo(n, 0); p.lineTo(w - n, 0); p.arc(w, 0, n, Math.PI, Math.PI * 0.5, true); p.lineTo(w, h - n); p.arc(w, h, n, Math.PI * 1.5, Math.PI, true);
    p.lineTo(n, h); p.arc(0, h, n, 0, -Math.PI * 0.5, true); p.lineTo(0, n); p.arc(0, 0, n, Math.PI * 0.5, 0, true); p.closePath();
    M.shadowOnly(x, k => k.fill(p), 5, 0, 2, 'rgba(0,0,0,.55)');
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#8e1a30'); g.addColorStop(0.5, '#7a1428'); g.addColorStop(1, '#4a0a18');
    x.fillStyle = g; x.fill(p);
    x.save(); x.clip(p);
    M.texture(x, 'grain', 0.03, 'overlay', false, [0, 0, w, h]);
    x.globalCompositeOperation = 'lighter';
    const wr = x.createLinearGradient(0, 0, 0, h * 0.45); wr.addColorStop(0, 'rgba(255,230,230,.16)'); wr.addColorStop(1, 'rgba(255,230,230,0)');
    x.fillStyle = wr; x.fillRect(0, 0, w, h * 0.45);
    x.restore();
    x.lineWidth = Math.max(1.5, h * 0.06); x.strokeStyle = M.goldBar(x, 0, h); x.stroke(p);
    return o.c;
  }
  H.drawPlaque = ctx => {
    const L = G.L, p = L.plaque, P = L.portrait;
    let line, money = false;
    if (S.tumbleShown > 0) { line = T('tumbleWin') + ' ' + G.countMoney(S.tumbleShown, countTo()); money = true; }
    else if (S.inFS) line = T('freeSpins');          // the count itself is on the Spin dome, once
    else line = T('winUpTo');
    const size = L.compact ? G.clamp(L.topH * 0.42, 9, 14) : P ? Math.min(G.W * 0.045, 22) : G.clamp(L.reel.w * 0.032, 16, 30);
    // fixed width per layout: it never resizes as its line changes
    const tw = Math.round(L.compact ? Math.min(G.W * 0.5, L.reel.w * 1.15) : P ? G.W * 0.62 : Math.min(L.reel.w * 0.66, size * 17)), th = Math.round(size * 1.75);
    const x = G.clamp(p.cx - tw / 2, 4, G.W - tw - 4), y = p.y - th / 2, cx = x + tw / 2;
    H.plaqueC = { x: cx, y: p.y };
    if (!plaqueC || plaqueC.w !== tw || plaqueC.h !== th) plaqueC = { w: tw, h: th, c: bakePlaque(tw, th) };
    ctx.drawImage(plaqueC.c, x - 6, y - 6, tw + 12, th + 12);
    const pop = Math.max(0, 1 - (G.clock.real - (S.plaquePopT || -9)) / 0.3);
    ctx.save(); ctx.translate(cx, p.y); ctx.scale(1 + pop * 0.08, 1 + pop * 0.08);
    G.goldText(ctx, line, 0, 1, size, { maxW: tw - th * 1.1, tabular: money });
    ctx.restore();
  };

  // ---------------- bottom bar: the console ----------------
  function bakeBar(w, h) {
    const M = G.Mat, o = G.offscreen(w, h), x = o.x;
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(18,21,42,.97)'); g.addColorStop(1, 'rgba(10,12,22,.99)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.save(); x.beginPath(); x.rect(0, 0, w, h); x.clip(); M.texture(x, 'brushed', 0.04, 'overlay', false, [0, 0, w, h]); x.restore();
    // top edge: the chamfer catching the light, then a slim gold inlay that fades out at the sides
    x.fillStyle = 'rgba(58,65,112,.7)'; x.fillRect(0, 0, w, 1 / G.DPR);
    const lg = x.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(242,201,90,0)'); lg.addColorStop(0.5, 'rgba(242,201,90,.75)'); lg.addColorStop(1, 'rgba(242,201,90,0)');
    x.fillStyle = lg; x.fillRect(0, 2, w, 1.2 / G.DPR);
    return o.c;
  }
  // a recessed readout: label on top, the value under it in fixed-advance digits
  function readout(ctx, r, label, value, color, size, align, press) {
    let a = null;
    if (press) a = G.button(press.id, r.x, r.y, r.w, r.h, press.fn, { disabled: press.disabled, label: press.label, reason: press.reason });
    plate(ctx, r, Math.min(8, r.h * 0.2), 'well', 'rest');
    const ax = align === 'left' ? r.x + size * 0.7 : align === 'right' ? r.x + r.w - size * 0.7 : r.x + r.w / 2;
    G.text(ctx, label, ax, r.y + r.h * 0.3, floor(size * 0.62), a && a.h > 0.3 ? TXT : TXT2, { weight: 700, align, maxW: r.w - size * 1.6 });
    G.text(ctx, value, ax, r.y + r.h * 0.68, size, color, { weight: 800, align, maxW: r.w - size * 1.6, tabular: true, min: floor(size * 0.85) });
    if (a && !press.disabled) {     // a small chevron says it opens something
      const cx = r.x + r.w - size * 0.75, cy = r.y + r.h * 0.5, k = size * 0.22;
      ctx.save(); ctx.strokeStyle = a.h > 0.3 ? TXT : TXT2; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(cx - k, cy - k * 0.5); ctx.lineTo(cx, cy + k * 0.5); ctx.lineTo(cx + k, cy - k * 0.5); ctx.stroke(); ctx.restore();
    }
  }
  // the BET readout opens every bet level
  const betPress = () => {
    const why = S.inFS ? 'reasonFS' : S.auto > 0 ? 'reasonAuto' : S.busy ? 'reasonRound' : null;
    return G.allow('bet') && G.mode !== 'replay' ? { id: 'betReadout', fn: () => G.UI.open('bets'), disabled: !!why, reason: why, label: T('betsTitle') } : null;
  };
  // the balance on screen rolls up to a win and drops straight to a debit; at rest it is exactly S.credit
  let balShown = null, balT = 0;
  function balance() {
    const now = G.clock.real, dt = Math.min(0.05, now - balT); balT = now;
    if (balShown == null || S.credit < balShown) balShown = S.credit;
    // a counting win lands in WIN first, then the balance rolls up
    else if (balShown < S.credit && !G.Overlay.counting()) { balShown += Math.max(0.01, (S.credit - balShown) * Math.min(1, dt * 7)); if (balShown >= S.credit - 1e-9) balShown = S.credit; }
    return balShown === S.credit ? G.money(S.credit) : G.money(balShown, G.countPlaces());
  }
  // WIN: the live tumble count during a spin, the last win (or the feature's total) after it
  function winText() {
    // WIN is the round's total: a spin counts on top of what the round has already banked, so it never runs backwards
    const base = S.winBase || 0, c = G.Overlay.counting();
    // a big win re-counts from zero on its own plate; the readout keeps what the board has already shown
    if (c && c.big) return G.countMoney(base + Math.min(c.to, Math.max(c.shown, S.tumbleShown || 0)), base + c.to);
    if (S.busy && S.tumbleShown > 0) return G.countMoney(base + S.tumbleShown, base + countTo());
    if (S.inFS && S.roundWin > 0) return G.money(S.roundWin);
    return S.winDisplay > 0 ? G.money(S.winDisplay) : G.money(0);
  }
  const winLive = () => (S.busy && S.tumbleShown > 0) || S.winDisplay > 0 || (S.inFS && S.roundWin > 0);
  // the toast lane: messages and hints only, never money
  function toastText() {
    const age = G.clock.real - S.messageT;
    if (S.message && age <= 3 && !S.message.startsWith(T('win') + ' ')) return S.message;
    if (S.inFS || S.busy) return S.busy && !S.inFS && !S.tumbleShown ? T('goodLuck') : '';
    return G.mode === 'replay' ? T('replay') : T('idle');
  }

  H.drawBottom = ctx => {
    const L = G.L, bb = L.bottom, P = L.portrait;
    if (!barC || barC.w !== bb.w || barC.h !== bb.h) barC = { w: bb.w, h: bb.h, c: bakeBar(bb.w, bb.h) };
    H.toasting = false;
    ctx.drawImage(barC.c, bb.x, bb.y, bb.w, bb.h);
    if (S.mood > 0.01) { ctx.fillStyle = `rgba(255,140,40,${0.05 * S.mood})`; ctx.fillRect(bb.x, bb.y, bb.w, bb.h); }    // the storm warms the console
    if (L.compact) drawBottomCompact(ctx, bb); else if (P) drawBottomPortrait(ctx, bb); else drawBottomLandscape(ctx, bb);
    drawChip(ctx);
  };

  // struck icons: warm white at rest, gold only while their thing is on
  function iconButton(ctx, id, name, cx, cy, s, onClick, opts) {
    opts = opts || {};
    const a = G.button(id, cx - s * 0.75, cy - s * 0.75, s * 1.5, s * 1.5, onClick, { disabled: opts.disabled, label: opts.label || id, reason: opts.reason });
    ctx.save();
    if (opts.disabled) ctx.globalAlpha = 0.38;
    const col = opts.on ? '#f2c95a' : a.h > 0.3 ? '#ffffff' : TXT;
    const sz = s * (1 - G.clamp(a.p, 0, 1) * 0.08);
    if (opts.on) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.28; ctx.drawImage(FX.glowSprite('#f2c95a'), cx - s * 0.8, cy - s * 0.8, s * 1.6, s * 1.6); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    H.icon(ctx, name, cx, cy + G.clamp(a.p, 0, 1), sz, col);
    ctx.restore();
  }
  function roundBtn(ctx, id, name, cx, cy, r, onClick, disabled, label, reason) {
    const a = G.button(id, cx - r, cy - r, r * 2, r * 2, onClick, { shape: 'circle', disabled, label, reason });
    const rr = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    ctx.save(); sink(ctx, rr, a);
    plateButton(ctx, rr, r, 'disc', a, disabled);
    H.icon(ctx, name, cx, cy, r * 1.0, disabled ? 'rgba(185,182,211,.45)' : TXT);
    ctx.restore();
  }

  /* ---- the Spin button: the one loud element ----
   * A knurled gold ring round an enamel dome (violet at dusk, amber in the
   * storm). The dome sinks under a press, the arrows cock back, spin while the
   * reels run and settle with a small overshoot. During free spins and
   * autoplay a ring of ticks counts down; with a round running (where a slam
   * is allowed) it reads STOP. Only this button breathes. */
  function bakeSpin(R, mood) {
    const M = G.Mat, pad = Math.ceil(R * 0.25), s = R * 2 + pad * 2, o = G.offscreen(s, s), x = o.x, c = s / 2, d = 1 / G.DPR;
    const ring = new Path2D(); ring.arc(c, c, R, 0, Math.PI * 2);
    M.shadowOnly(x, k => k.fill(ring), R * 0.18, 0, R * 0.08, 'rgba(0,0,0,.6)');
    x.fillStyle = M.goldRoundRadial(x, c, c, R * 0.82, R, true); x.fill(ring);
    if (M.lod.knurl(R * G.DPR)) {     // knurling: fine ticks round the outer edge
      x.save(); x.translate(c, c);
      for (let k = 0; k < 96; k++) {
        const a = (k / 96) * Math.PI * 2, lit = 0.5 + 0.5 * (Math.cos(a) * M.LIGHT.x + Math.sin(a) * M.LIGHT.y);
        x.strokeStyle = `rgba(${lit > 0.5 ? '255,246,210' : '42,20,4'},${0.25 + Math.abs(lit - 0.5) * 0.5})`; x.lineWidth = Math.max(d, R * 0.012);
        x.beginPath(); x.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); x.lineTo(Math.cos(a) * R * 0.985, Math.sin(a) * R * 0.985); x.stroke();
      }
      x.restore();
    }
    x.lineWidth = d * 1.2; x.strokeStyle = '#2a1404'; x.stroke(ring);
    // the enamel dome, its bezel and a clear-coat reflection
    const dome = new Path2D(); dome.arc(c, c, R * 0.84, 0, Math.PI * 2);
    M.innerShadow(x, (() => { const p = new Path2D(); p.arc(c, c, R * 0.86, 0, Math.PI * 2); return p; })(), R * 0.05, 0, R * 0.02, 'rgba(0,0,0,.8)', [c - R, c - R, R * 2, R * 2]);
    const dg = x.createRadialGradient(c - R * 0.25, c - R * 0.35, R * 0.06, c, c, R * 0.86);
    if (mood) { dg.addColorStop(0, '#ffd77a'); dg.addColorStop(0.5, '#e08a1e'); dg.addColorStop(1, '#6e2a04'); }
    else { dg.addColorStop(0, '#9a60ee'); dg.addColorStop(0.5, '#5a24aa'); dg.addColorStop(1, '#1c0742'); }
    x.fillStyle = dg; x.fill(dome);
    x.save(); x.clip(dome);
    M.texture(x, 'grain', 0.03, 'overlay', false, [c - R, c - R, R * 2, R * 2]);
    x.globalCompositeOperation = 'lighter';
    const wr = x.createLinearGradient(0, c - R * 0.8, 0, c - R * 0.15);
    wr.addColorStop(0, 'rgba(255,255,255,.2)'); wr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = wr; x.beginPath(); x.ellipse(c - R * 0.05, c - R * 0.45, R * 0.56, R * 0.3, -0.15, 0, Math.PI * 2); x.fill();
    const cg = x.createRadialGradient(c, c + R * 0.85, 0, c, c + R * 0.85, R * 0.7);
    cg.addColorStop(0, mood ? 'rgba(255,200,120,.16)' : 'rgba(200,150,255,.14)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = cg; x.fillRect(c - R, c - R, R * 2, R * 2);
    x.restore();
    x.lineWidth = d * 1.2; x.strokeStyle = 'rgba(42,20,4,.9)'; x.stroke(dome);
    return { c: o.c, s };
  }
  const spinRot = { x: 0, v: 0 };
  let spinRotT = 0;
  function spinButton(ctx, cx, cy, R) {
    const canSpin = !S.busy && !S.inFS && S.auto <= 0;
    const a = G.button('spin', cx - R, cy - R, R * 2, R * 2, () => G.Game.spinPressed(), { shape: 'circle', label: G.mode === 'replay' ? T('replayPlay') : 'Spin' });
    const t = G.clock.real, dt = G.clamp(t - spinRotT, 0, 0.05); spinRotT = t;
    H.spinC = { x: cx, y: cy };          // the free-spins card collapses into it
    const key = Math.round(R * 4) + '|' + G.DPR;
    let sp = spinC.get(key);
    if (!sp) { sp = [bakeSpin(R, 0), bakeSpin(R, 1)]; spinC.set(key, sp); }
    ctx.save();
    // breathing halo when idle
    if (canSpin) {
      const pl = 0.5 + 0.5 * Math.sin(t * 2.6);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + pl * 0.3;
      const gs = R * 1.8; ctx.drawImage(FX.glowSprite(S.mood > 0.5 ? '#ffb02e' : '#b07cff'), cx - gs, cy - gs, gs * 2, gs * 2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    const p = G.clamp(a.p, -0.2, 1), hs = 1 + a.h * 0.02;
    ctx.translate(cx, cy); ctx.scale(hs, hs); ctx.translate(-cx, -cy);
    const ds = sp[0].s;
    ctx.drawImage(sp[0].c, cx - ds / 2, cy - ds / 2, ds, ds);
    if (S.mood > 0.01) { ctx.globalAlpha = S.mood; ctx.drawImage(sp[1].c, cx - ds / 2, cy - ds / 2, ds, ds); ctx.globalAlpha = 1; }
    // the dome sinks under a press
    if (p > 0.01) { ctx.fillStyle = `rgba(0,0,0,${0.22 * p})`; ctx.beginPath(); ctx.arc(cx, cy + p, R * 0.84, 0, 7); ctx.fill(); }
    const rr = R * (1 - Math.max(0, p) * 0.04);
    const counting = S.auto > 0 || S.inFS;
    if (counting) {
      const n = S.inFS ? S.fsLeft : S.auto, total = S.inFS ? Math.max(S.fsAward, 1) : null;
      // the tick ring: one tick per free spin still to come
      if (total) {
        const N = Math.min(total, 40);
        for (let k = 0; k < N; k++) {
          const ang = -Math.PI / 2 + (k / N) * Math.PI * 2, on = k < Math.round(n * N / total);
          ctx.strokeStyle = on ? '#fff3cf' : 'rgba(255,243,207,.2)'; ctx.lineWidth = Math.max(1.5, rr * 0.035);
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * rr * 0.72, cy + Math.sin(ang) * rr * 0.72); ctx.lineTo(cx + Math.cos(ang) * rr * 0.8, cy + Math.sin(ang) * rr * 0.8); ctx.stroke();
        }
      }
      G.text(ctx, S.inFS ? T('free') : T('auto'), cx, cy - rr * 0.3, floor(rr * 0.22), '#ffe9b0', { weight: 800 });
      G.goldText(ctx, n === Infinity ? '∞' : String(n), cx, cy + rr * 0.1, rr * 0.5, { display: false, weight: 800, tabular: true });
      if (!S.inFS) G.text(ctx, T('stop'), cx, cy + rr * 0.5, floor(rr * 0.19), TXT, { weight: 800 });
    } else {
      // the arrows: cocked by a press, running with the reels, settling with a little overshoot
      const pressed = G.pressId === 'spin' && canSpin;
      if (S.busy) { spinRot.x += dt * (S.slam ? 16 : 9); spinRot.v = 9; }
      else G.spring(spinRot, Math.round(spinRot.x / Math.PI) * Math.PI - (pressed ? 0.35 : 0), dt, G.SPRING.KNOB);
      const sway = S.busy ? 0 : Math.sin(t * 1.3) * 0.05;
      ctx.save(); ctx.translate(cx, cy + Math.max(0, p)); ctx.rotate(spinRot.x + sway);
      ctx.strokeStyle = '#fff3cf'; ctx.fillStyle = '#fff3cf'; ctx.lineWidth = rr * 0.12; ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        ctx.rotate(Math.PI);
        ctx.beginPath(); ctx.arc(0, 0, rr * 0.46, 0.25, Math.PI - 0.55); ctx.stroke();
        const ex = Math.cos(Math.PI - 0.55) * rr * 0.46, ey = Math.sin(Math.PI - 0.55) * rr * 0.46;
        ctx.beginPath(); ctx.moveTo(ex - rr * 0.2, ey - rr * 0.02); ctx.lineTo(ex + rr * 0.04, ey - rr * 0.22); ctx.lineTo(ex + rr * 0.08, ey + rr * 0.12); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      if (S.busy && !S.slam && !S.charging && G.allow('slam') && !G.L.compact) G.text(ctx, T('stop'), cx, cy + rr * 0.62, floor(rr * 0.17), TXT, { weight: 800 });
    }
    ctx.restore();
  }

  // AUTO: lit while it can open its sheet or stop a run; during a single round it says why it can't
  const autoOpts = () => ({ on: S.auto > 0, disabled: S.inFS || (S.busy && S.auto <= 0), label: 'Autoplay', reason: S.inFS ? 'reasonFS' : 'reasonRound' });
  // a fresh message (never money) for the toast lane
  const freshMessage = () => { const age = G.clock.real - S.messageT; return S.message && age <= 3 && !S.message.startsWith(T('win') + ' ') ? S.message : ''; };
  // a message with no room in the bar shows as a pill on the hint line under the board
  function floatToast(ctx, msg) {
    // on the hint row, unless that row carries the session line: then over the board's lower edge
    const size = 13, age = G.clock.real - S.messageT, a = Math.min(1, (3 - age) / 0.3), W = G.W;
    const ty = G.L.noHint || H.sessionLine ? G.L.reel.y + G.L.reel.h - size * 1.4 : G.L.hintY;
    ctx.save(); ctx.globalAlpha = G.clamp(a, 0, 1); ctx.font = G.font(size, 800, true);
    const tw = Math.min(W - 24, ctx.measureText(msg).width + size * 2);
    G.roundRect(ctx, W / 2 - tw / 2, ty - size * 0.9, tw, size * 1.8, size * 0.9); ctx.fillStyle = 'rgba(10,12,22,.9)'; ctx.fill();
    G.text(ctx, msg, W / 2, ty, size, TXT, { weight: 800, maxW: tw - size, display: true, min: 11 });
    ctx.restore();
    H.toasting = true;
  }
  // BALANCE over BET in one well, for narrow bars
  function stackedReadout(ctx, r, size, press) {
    plate(ctx, r, Math.min(8, r.h * 0.2), 'well', 'rest');
    const sv = floor(size * 0.8), sl = floor(size * 0.6), lx = r.x + size * 0.55, vx = r.x + r.w - size * 0.55;
    const rows = [G.allow('balance') && [T('balance'), balance(), r.y + r.h * 0.3], [T('bet'), G.money(G.baseBet()), r.y + r.h * (G.allow('balance') ? 0.72 : 0.5)]].filter(Boolean);
    rows.forEach(([lab, val, y]) => {
      ctx.font = G.font(sl, 700); const lw = ctx.measureText(lab).width;
      G.text(ctx, lab, lx, y, sl, TXT2, { weight: 700, align: 'left' });
      G.text(ctx, val, vx, y, sv, TXT, { weight: 800, align: 'right', tabular: true, maxW: r.w - lw - size * 1.5, min: sv });
    });
    if (press) G.button(press.id, r.x, r.y + r.h * 0.5, r.w, r.h * 0.5, press.fn, { disabled: press.disabled, label: press.label, reason: press.reason });
  }

  function drawBottomLandscape(ctx, bb) {
    const W = G.W, cy = bb.y + bb.h / 2, pad = G.L.pad * 1.4;
    const isz = G.clamp(bb.h * 0.3, 16, 28), ig = Math.max(isz * 1.55, G.coarse ? 46 : 0);      // a touch target apart, with a hair to spare
    let x = pad + isz * 0.6;
    // narrow bars keep two icons and put the rest in the menu, as phones do
    const narrow = W < 760;
    const icons = narrow ? [
      ['menu', 'menu', () => G.UI.open('menu'), 'Menu'],
      ['sound', G.settings.sfx || G.settings.music ? 'sound' : 'mute', () => G.Game.toggleSound(), 'Sound'],
    ] : [
      ['info', 'info', () => G.UI.open('info'), 'Game info'],
      ['settings', 'settings', () => G.UI.open('settings'), 'Settings'],
      ['sound', G.settings.sfx || G.settings.music ? 'sound' : 'mute', () => G.Game.toggleSound(), 'Sound'],
      G.allow('fair') && ['history', 'history', () => G.UI.open('fair'), 'History & fairness'],
      G.allow('stats') && ['stats', 'trophy', () => G.UI.open('stats'), 'Stats & achievements'],
      G.allow('fullscreen') && ['full', 'full', () => G.UI.fullscreen(), 'Fullscreen'],
    ].filter(Boolean);
    icons.forEach(([id, name, fn, label]) => { iconButton(ctx, id, name, x, cy - bb.h * 0.08, isz, fn, { label }); x += ig; });
    if (G.mode === 'demo') G.text(ctx, 'FISKCE.COM', pad, bb.y + bb.h - 9, 11, 'rgba(185,182,211,.55)', { weight: 700, align: 'left' });
    // right cluster: turbo, -, SPIN, +, auto
    const R = G.clamp(bb.h * 0.62, 34, 62), r = R * 0.48;
    let rx = W - pad;
    const autoX = rx - r; rx = autoX - r - pad * 0.8;
    const plusX = rx - r; rx = plusX - r - pad * 0.7;
    const spinX = rx - R; rx = spinX - R - pad * 0.7;
    const minusX = rx - r; rx = minusX - r - pad * 0.8;
    const turboX = rx - r; rx = turboX - r - pad;
    const by = cy - bb.h * 0.06, sy = bb.y + bb.h * 0.42 - R * 0.18, lab = floor(Math.min(11, bb.h * 0.12));
    betButtons(ctx, minusX, plusX, by, r);
    if (G.allow('turbo')) {
      iconButton(ctx, 'turbo', 'bolt', turboX, by, r * 1.1, () => G.Game.toggleTurbo(), { on: G.settings.turbo, label: 'Turbo' });
      G.text(ctx, T('turbo'), turboX, by + r * 1.25, lab, TXT2, { weight: 700 });
    }
    if (G.allow('auto')) {
      iconButton(ctx, 'auto', S.auto > 0 ? 'stop' : 'auto', autoX, by, r * 1.1, () => G.Game.autoPressed(), autoOpts());
      G.text(ctx, T('auto'), autoX, by + r * 1.25, lab, TXT2, { weight: 700 });
    }
    spinButton(ctx, spinX, sy, R);
    // BALANCE · WIN · BET in recessed readouts: shrunk to the room there is, never dropped
    const left = x + pad * 0.2, right = rx, avail = right - left;
    const fsz = G.clamp(bb.h * 0.2, 12, 19), rh = Math.min(bb.h * 0.72, fsz * 3.1), ry = cy - rh / 2 - bb.h * 0.03, gap = pad * 0.6;
    const hasBal = G.allow('balance'), wBal = Math.max(118, fsz * 8.2), wWin = Math.max(100, fsz * 7), wBet = Math.max(96, fsz * 6.4);
    const full = (hasBal ? wBal + gap : 0) + wWin + gap + wBet;
    let mx = left;
    if (!hasBal || full * 0.82 <= avail) {
      const k = Math.min(1, avail / full);
      if (hasBal) { readout(ctx, { x: mx, y: ry, w: wBal * k, h: rh }, T('balance'), balance(), TXT, fsz, 'left'); mx += wBal * k + gap; }
      readout(ctx, { x: mx, y: ry, w: wWin * k, h: rh }, T('win'), winText(), winLive() ? '#ffd36b' : TXT2, fsz, 'left'); mx += wWin * k + gap;
      readout(ctx, { x: mx, y: ry, w: wBet * k, h: rh }, T('bet'), G.money(G.baseBet()), TXT, fsz, 'left', betPress()); mx += wBet * k + gap;
    } else {                    // too narrow for three: BALANCE over BET, and WIN beside them
      const wS = Math.max(wBal, wBet) * 0.95, k = Math.min(1, avail / (wS + gap + wWin));
      stackedReadout(ctx, { x: mx, y: ry, w: wS * k, h: rh }, fsz, betPress()); mx += wS * k + gap;
      readout(ctx, { x: mx, y: ry, w: wWin * k, h: rh }, T('win'), winText(), winLive() ? '#ffd36b' : TXT2, fsz, 'left'); mx += wWin * k + gap;
    }
    // messages: in the lane when they fit there at a readable size, otherwise under the board
    const fresh = freshMessage(), msg = fresh || toastText(), laneW = right - mx - 12;
    if (msg) {
      ctx.font = G.font(fsz * 0.95, 800, true);
      const needs = ctx.measureText(msg).width * (11 / (fsz * 0.95));     // its width at the 11 px floor
      if (laneW >= 90 && needs <= laneW) G.text(ctx, msg, (mx + right) / 2, cy - bb.h * 0.04, fsz * 0.95, TXT, { weight: 800, maxW: laneW, display: true, min: 11 });
      else if (fresh) floatToast(ctx, fresh);
    }
  }

  function drawBottomPortrait(ctx, bb) {
    const W = G.W, pad = G.L.pad * 1.2;
    const fsz = G.clamp(bb.h * 0.12, 12, 16), rh = Math.min(bb.h * 0.36, fsz * 2.9), ry = bb.y + bb.h * 0.06, gap = pad * 0.5;
    const cols = G.allow('balance') ? 3 : 2, cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    let mx = pad;
    if (G.allow('balance')) { readout(ctx, { x: mx, y: ry, w: cw, h: rh }, T('balance'), balance(), TXT, fsz, 'center'); mx += cw + gap; }
    readout(ctx, { x: mx, y: ry, w: cw, h: rh }, T('win'), winText(), winLive() ? '#ffd36b' : TXT2, fsz, 'center'); mx += cw + gap;
    readout(ctx, { x: mx, y: ry, w: cw, h: rh }, T('bet'), G.money(G.baseBet()), TXT, fsz, 'center', betPress());
    const row2 = bb.y + bb.h * 0.68;
    const R = G.clamp(Math.min(bb.h * 0.32, W * 0.12), 30, 54), r = R * 0.52;
    const isz = G.clamp(r * 0.95, 16, 26), step = Math.max(isz * 1.7, G.coarse ? 44 : 0);
    spinButton(ctx, W / 2, row2, R);
    betButtons(ctx, W / 2 - R - r - pad * 0.7, W / 2 + R + r + pad * 0.7, row2, r);
    iconButton(ctx, 'menu', 'menu', pad + isz * 0.7, row2, isz, () => G.UI.open('menu'), { label: 'Menu' });
    iconButton(ctx, 'sound', G.settings.sfx || G.settings.music ? 'sound' : 'mute', pad + isz * 0.7 + step, row2, isz, () => G.Game.toggleSound(), { label: 'Sound' });
    if (G.allow('auto')) iconButton(ctx, 'auto', S.auto > 0 ? 'stop' : 'auto', W - pad - isz * 0.7, row2, isz, () => G.Game.autoPressed(), autoOpts());
    if (G.allow('turbo')) iconButton(ctx, 'turbo', 'bolt', W - pad - isz * 0.7 - step, row2, isz, () => G.Game.toggleTurbo(), { on: G.settings.turbo, label: 'Turbo' });
    // the toast lane takes the hint line under the board for a moment (messages only; the readouts hold the money)
    const fresh = freshMessage();
    if (fresh) floatToast(ctx, fresh);
  }

  // − / + bet buttons (not in a replay); at either end the button goes unlit and says why
  function betButtons(ctx, minusX, plusX, y, r) {
    if (!G.allow('bet')) return;
    const why = S.inFS ? 'reasonFS' : S.auto > 0 ? 'reasonAuto' : S.busy ? 'reasonRound' : null;
    roundBtn(ctx, 'betDown', 'minus', minusX, y, r, () => G.Game.bet(-1), !!why || S.betIndex === 0, 'Lower bet', why || 'reasonMinBet');
    roundBtn(ctx, 'betUp', 'plus', plusX, y, r, () => G.Game.bet(1), !!why || S.betIndex === G.BET_STEPS.length - 1, 'Raise bet', why || 'reasonMaxBet');
  }

  // 400x225 and other short windows: everything on one slim row
  function drawBottomCompact(ctx, bb) {
    const W = G.W, cy = bb.y + bb.h / 2, pad = 6;
    const isz = G.clamp(bb.h * 0.3, 12, 18);
    // on a touch screen neighbours sit a full touch target apart (36 px here), even at 400 px wide
    const roomy = G.coarse, step = Math.max(isz * 1.6, roomy ? 37 : 0), x0 = Math.max(pad + isz * 0.7, roomy ? 19 : 0);
    iconButton(ctx, 'menu', 'menu', x0, cy, isz, () => G.UI.open('menu'), { label: 'Menu' });
    iconButton(ctx, 'sound', G.settings.sfx || G.settings.music ? 'sound' : 'mute', x0 + step, cy, isz, () => G.Game.toggleSound(), { label: 'Sound' });
    const R = G.clamp(bb.h * 0.42, 15, 24), r = R * 0.55, g = roomy ? Math.max(5, 37 - 2 * r) : 5;
    let rx = W - (roomy ? Math.max(pad, 19 - r) : pad);
    const autoX = G.allow('auto') ? (rx -= r, rx) : null; if (autoX) rx -= r + g;
    const plusX = rx - r; rx = plusX - r - g;
    const spinX = rx - R; rx = spinX - R - g;
    const minusX = rx - r; rx = minusX - r - g;
    const turboX = G.allow('turbo') ? rx - r : null; if (turboX) rx = turboX - r - g;
    betButtons(ctx, minusX, plusX, cy, r);
    if (turboX) iconButton(ctx, 'turbo', 'bolt', turboX, cy, r * 1.1, () => G.Game.toggleTurbo(), { on: G.settings.turbo, label: 'Turbo' });
    if (autoX) iconButton(ctx, 'auto', S.auto > 0 ? 'stop' : 'auto', autoX, cy, r * 1.1, () => G.Game.autoPressed(), autoOpts());
    spinButton(ctx, spinX, cy, R);
    // BALANCE and BET on two lines, then a fresh message, WIN or the idle hint in what is left
    const left = x0 + step + Math.max(isz * 1.1, roomy ? 19 : 0), fsz = G.clamp(bb.h * 0.2, 8, 12), colW = Math.min(118, (rx - left) * 0.55);
    const vy1 = cy - fsz * 0.65, vy2 = cy + fsz * 0.75;
    if (G.allow('balance')) G.text(ctx, T('balance') + ' ' + balance(), left, vy1, fsz, TXT, { weight: 800, align: 'left', maxW: colW, tabular: true, min: 8 });
    const bp = betPress(), byy = G.allow('balance') ? vy2 : cy;
    if (bp) G.button(bp.id, left, byy - fsz * 0.8, colW, fsz * 1.6, bp.fn, { disabled: bp.disabled, label: bp.label, reason: bp.reason });
    G.text(ctx, T('bet') + ' ' + G.money(G.baseBet()), left, byy, fsz, TXT, { weight: 800, align: 'left', maxW: colW, tabular: true, min: 8 });
    const mx = left + colW + 6, laneW = rx - mx - 6;
    const fresh = freshMessage();
    let fits = false;
    if (fresh && laneW > 50) { ctx.font = G.font(8, 800, true); fits = ctx.measureText(fresh).width <= laneW; }
    if (fresh && !fits) floatToast(ctx, fresh);          // too long for the lane: under the board, at 11 px
    if (laneW > 50) {
      if (fresh && fits) G.text(ctx, fresh, (mx + rx) / 2, cy, fsz * 0.95, TXT, { weight: 800, maxW: laneW, display: true, min: 8 });
      else if (winLive()) G.text(ctx, T('win') + ' ' + winText(), (mx + rx) / 2, cy, fsz * 1.1, '#ffd36b', { weight: 800, maxW: laneW, tabular: true, min: 8 });
      else {
        const m = toastText();          // the idle hint only when it fits at the 8 px floor
        if (m) { ctx.font = G.font(8, 800, true); if (ctx.measureText(m).width <= laneW) G.text(ctx, m, (mx + rx) / 2, cy, fsz * 0.95, TXT, { weight: 800, maxW: laneW, display: true, min: 8 }); }
      }
    }
  }

  // fairness commitment under the board (click opens the verifier)
  /* Regulated markets: when the RGS asks (displayNetPosition, displayRTP, displaySessionTimer) the
   * player's net position this session, the mode's RTP and the session time stay on screen. */
  H.sessionFacts = () => {
    const R = G.RGS, out = [];
    if (!R || !R.session) return out;
    const s = R.session;
    if (G.allow('net')) {
      const pend = s.pending ? Math.min(Math.round(S.roundWin * 1e6), s.pending.winMicro) : 0;
      const net = (s.wonMicro + pend - s.betMicro) / 1e6;
      out.push([T('sessNet'), (net > 0 ? '+' : net < 0 ? '−' : '') + G.money(Math.abs(net))]);
    }
    if (G.allow('rtp')) {
      const m = (window.GOS_MATH && GOS_MATH.modes) || {}, mode = S.ante ? 'ante' : 'base';
      out.push([T('sessRtp'), (m[mode] ? m[mode].rtp : 96.5).toFixed(2) + '%']);
    }
    if (G.allow('timer')) {
      const t = Math.floor((Date.now() - s.t0) / 1000), h = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
      out.push([T('sessTime'), (h ? h + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0')]);
    }
    return out;
  };
  // drawn outside the world transform, so it never shakes or zooms
  H.drawSession = ctx => {
    const facts = H.sessionFacts(), L = G.L;
    H.sessionLine = false;
    if (!facts.length) return;
    if (!L.noHint) {           // one line on the hint row, under the board
      const size = G.clamp(L.hintH * 0.36, 11, 12);
      G.text(ctx, facts.map(f => f[0] + ' ' + f[1]).join('  ·  '), L.reel.x + L.reel.w / 2, L.hintY, size, TXT2, { weight: 700, maxW: G.W * 0.94, tabular: true, min: 11 });
      H.sessionLine = true;
      return;
    }
    // compact (400x225): the corners of the top band, either side of the plaque
    const size = Math.max(8, Math.min(11, Math.floor(L.topH * 0.36))), y = L.topH * 0.5, room = Math.max(40, L.reel.x - 10);
    const net = facts.find(f => f[0] === T('sessNet')), rest = facts.filter(f => f !== net);
    const fit = (f, maxW) => { ctx.font = G.font(size, 700); const s = f[0] + ' ' + f[1]; return ctx.measureText(s).width <= maxW ? s : f[1]; };
    if (net) G.text(ctx, fit(net, room), 6, y, size, TXT2, { weight: 700, align: 'left', maxW: room, tabular: true, min: 8 });
    if (rest.length) G.text(ctx, rest.map(f => fit(f, room / rest.length)).join(' · '), G.W - 6, y, size, TXT2, { weight: 700, align: 'right', maxW: room, tabular: true, min: 8 });
  };

  H.drawHint = ctx => {
    const L = G.L;
    if (!window.ProvablyFair || !G.allow('fair') || L.noHint || H.toasting) return;
    const h = ProvablyFair.serverHash;
    const text = `PROVABLY FAIR · ${h.slice(0, 10)}…${h.slice(-6)} · #${ProvablyFair.nonce}`;
    const size = G.clamp(L.hintH * 0.36, 11, 12);
    ctx.font = G.font(size, 700);
    const tw = Math.min(ctx.measureText(text).width, G.W * 0.9);
    const a = G.button('fair', G.W / 2 - tw / 2 - 10, L.hintY - size, tw + 20, size * 2, () => G.UI.open('fair'), { label: 'Provably fair details' });
    G.text(ctx, text, L.reel.x + L.reel.w / 2, L.hintY, size, a.h > 0.1 ? '#e8f6ff' : 'rgba(190,225,255,.7)', { weight: 700, maxW: G.W * 0.9 });
  };
})();

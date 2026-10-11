/* Thunder Hunter Sebastian — Sebastian himself.
 *
 * Two hand-drawn clips (art/sebastian_*.gif, packed into sprite sheets by
 * tools/build-sebastian.py; frame data in js/seb-frames.js):
 *
 *   idle   24 frames: breathing, a blink, the fox swaying. Loops on real time.
 *   shoot  40 frames: raise the shotgun (0-8), aim with a wink (9-13), fire
 *          (14-15, the muzzle flash is in the art), smoke (16-24), lower it
 *          (25-29) and settle (30-39).
 *
 * The game asks him to aim before every orb (aimAt) and then fire. Aiming
 * plays the raise sped up on the game clock, so turbo and slam-stop hurry it;
 * firing jumps to frame 14 so the bolt leaves the barrel on the flash. A
 * second orb while the smoke clears goes straight back to the aim pose.
 * Cheering (a jump), leaning in during a tease and the head shake are light
 * transforms on top of whatever frame is showing.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX, B = G.Board, S = G.S;
  const Seb = G.Seb = {};
  const DATA = window.SEB_FRAMES;

  // artwork coordinates (930x825): his feet, the middle of his body, his head
  const FEET_Y = 780, BODY_X = 645, HEAD = [640, 190];
  const TOP_Y = 96;                                   // cap top: the figure is 684 art px tall
  const IDLE_X0 = 337, IDLE_X1 = 930;                 // idle frames' extent (lowered gun to fox tail)
  // the barrel tip per shoot frame (measured on the artwork); the lowered gun otherwise
  const TIP_DOWN = [343, 722];
  const TIP = {
    4: [219, 625], 5: [180, 576], 6: [150, 524], 7: [130, 479], 8: [120, 446],
    9: [116, 434], 10: [117, 436], 11: [117, 438], 12: [117, 436], 13: [116, 432],
    14: [140, 350], 15: [132, 367], 16: [120, 391], 17: [116, 409], 18: [116, 410], 19: [116, 413],
    20: [116, 419], 21: [116, 425], 22: [116, 431], 23: [116, 434], 24: [116, 434],
    25: [120, 446], 26: [130, 479], 27: [150, 524], 28: [180, 576], 29: [219, 625],
  };
  const AIM = 13, FIRE = 14, LOWER_FROM = 25;

  const LINES = {
    big: ['Bullseye!', 'What a shot!', 'Now that is a trophy!'],
    mega: ['MEGA! Did you see that?', 'Hold my fox…', 'Straight to the wall!'],
    epic: ['EPIC! Frame this one!', 'Legendary hunt!', 'The storm is with us!'],
    orb: ['Feel the thunder!', 'Direct hit!', 'Hundred-fold!'],
    near: ['So close…', 'Missed by a whisker!', 'Ooh, that was close!'],
    fsStart: ["Storm's coming!", "Let's hunt!", 'Hold on to your hat!'],
    retrigger: ['More spins!', 'The storm rages on!'],
    milestone: ['The multiplier grows!', "We're climbing!", 'Keep it coming!'],
    fsGood: ['What a hunt!', 'Worth every bolt!'],
    fsBad: ['The fox got away…', 'A quiet storm this time.'],
    idle: ['Nice view from up here.', 'The fox says hi.', "I've got thunder to spare."],
  };
  const PRIORITY = { big: 1, mega: 1, epic: 1, orb: 1, fsStart: 1, fsGood: 1, fsBad: 1, retrigger: 1 };

  const pose = { lean: 0, leanT: 0, jump: 0, jumpV: 0, squash: 0, shake: 0 };
  Seb.pose = pose;                  // read-only view, used by the browser tests
  // the shoot clip: mode 'idle' | 'raise' | 'aim' | 'fire'; frame as a float
  const anim = { mode: 'idle', frame: 0, from: 0, t0: 0, rate: 1 };
  Seb.anim = anim;
  let fireT = -9, idleT = 0, lastSay = -9, bubble = null, cutHead = null, aimHoldT = 0;
  const calm = () => G.settings.reducedMotion ? 0.4 : 1;
  let fig = null;                   // last drawn figure: {cx, floor, k, ...transform}
  Seb.cut = null;                   // big-win cut-in state (driven by overlays.js)

  const ready = () => !!(DATA && B.seb && B.seb.idle && B.seb.shoot);
  const durOf = (clip, i) => DATA[clip][i][8];

  // ---------------- actions ----------------
  // raise the gun (sped up) and resolve once he is aiming; already up: almost at once
  Seb.aimAt = () => {
    G.Seb.activity();
    if (!ready()) return G.wait(0);
    // already raising or aiming: carry on; gun still up after a shot: straight back to aiming;
    // lowering: back up from the same height; otherwise from the start
    let from = 0;
    if (anim.mode === 'raise' || anim.mode === 'aim') from = anim.frame;
    else if (anim.mode === 'fire') from = anim.frame < LOWER_FROM ? AIM : anim.frame < 30 ? 33 - anim.frame : 0;
    from = G.clamp(Math.floor(from), 0, AIM);
    if (S.slam || G.settings.reducedMotion) from = AIM;
    const rate = S.slam ? 6 : 2.4;                    // raise speed vs the artwork (on the game clock, so turbo doubles it)
    Object.assign(anim, { mode: 'raise', from, frame: from, t0: G.clock.game, rate });
    const ms = (AIM - from) * 50 / rate;
    return G.wait(ms);
  };
  Seb.fire = () => {
    fireT = G.clock.real; G.Seb.activity();
    if (!ready()) return;
    Object.assign(anim, { mode: 'fire', from: FIRE, frame: FIRE, t0: G.clock.game, rate: 1 });
  };
  Seb.relax = () => { if (anim.mode === 'raise' || anim.mode === 'aim') Object.assign(anim, { mode: 'fire', from: LOWER_FROM, frame: LOWER_FROM, t0: G.clock.game, rate: 1 }); };
  Seb.lean = on => { pose.leanT = on ? 1 : 0; };
  Seb.cheer = power => {
    if (G.settings.reducedMotion) return;
    if (pose.jump >= -1) pose.jumpV = -(0.9 + (power || 1) * 0.35);    // in figure heights per second
  };
  Seb.headShake = () => { pose.shake = 1; };
  Seb.activity = () => { idleT = 0; };

  Seb.say = (kind, chance) => {
    const pool = LINES[kind];
    if (!pool || !S.started) return;
    const now = G.clock.real, prio = PRIORITY[kind];
    if (chance != null && Math.random() > chance * (S.auto > 0 || G.settings.turbo ? 0.5 : 1)) return;
    if (bubble && !prio) return;
    if (now - lastSay < (prio ? 1.2 : 5)) return;
    lastSay = now;
    bubble = { text: pool[(Math.random() * pool.length) | 0], t: 0, dur: S.auto > 0 || G.settings.turbo ? 1.6 : 2.4 };
  };

  // ---------------- update ----------------
  // the shoot frame `ms` of game time after frame `from`, played at `rate`, stopping at `stopAt`
  function advance(from, ms, rate, stopAt) {
    let f = Math.floor(from), left = ms * rate;
    while (f < stopAt) {
      const d = durOf('shoot', f);
      if (left < d) return f;
      left -= d; f++;
    }
    return stopAt;
  }
  Seb.update = dt => {
    pose.lean += (pose.leanT - pose.lean) * Math.min(1, dt * 4);
    pose.shake = Math.max(0, pose.shake - dt * 1.4);
    // jump: simple ballistic arc in figure-height units, squash on landing
    if (pose.jumpV !== 0 || pose.jump < 0) {
      pose.jumpV += 5.5 * dt; pose.jump += pose.jumpV * dt;
      if (pose.jump >= 0) { pose.squash = Math.min(1, pose.jumpV * 0.9); pose.jump = 0; pose.jumpV = 0; }
    }
    pose.squash = Math.max(0, pose.squash - dt * 4);
    if (ready()) {
      const ms = (G.clock.game - anim.t0) * 1000;
      if (anim.mode === 'raise') {
        anim.frame = advance(anim.from, ms, anim.rate, AIM);
        if (anim.frame >= AIM) { anim.mode = 'aim'; aimHoldT = G.clock.game; }
      } else if (anim.mode === 'aim') {
        anim.frame = AIM;
        if (G.clock.game - aimHoldT > 1.6) Seb.relax();      // never fired: lower the gun again
      } else if (anim.mode === 'fire') {
        const last = DATA.shoot.length - 1;
        anim.frame = advance(anim.from, ms, anim.rate, last + 1);
        if (anim.frame > last) { anim.mode = 'idle'; anim.frame = 0; }
      }
    }
    if (bubble) { bubble.t += dt; if (bubble.t > bubble.dur) bubble = null; }
    if (S.started && !S.busy && !G.Overlay.blocking() && S.auto <= 0) {
      idleT += dt;
      if (idleT > 25) { Seb.say('idle'); idleT = -20; }
    } else idleT = 0;
  };

  // the frame on show now: [clip, index]
  function current() {
    if (anim.mode === 'idle' || !ready()) {
      const n = DATA.idle.length, loop = n * durOf('idle', 0) / 1000;
      return ['idle', Math.floor(((G.clock.real % loop) / loop) * n) % n];
    }
    return ['shoot', G.clamp(Math.floor(anim.frame), 0, DATA.shoot.length - 1)];
  }

  // ---------------- geometry ----------------
  // k = screen px per artwork px; the figure stands with its feet on `floor`
  function figure() {
    const L = G.L, box = L.seb;
    const artH = FEET_Y - TOP_Y, artW = IDLE_X1 - IDLE_X0;
    let h = box.h * (L.portrait ? 0.98 : 0.9);
    const maxW = box.w * (L.portrait ? 1.0 : 1.12);
    if (h * artW / artH > maxW) h = maxW * artH / artW;
    const k = h / artH;
    // place him so the idle figure (lowered gun to fox tail) is centred in the box
    const cx = box.x + box.w / 2 + (BODY_X - (IDLE_X0 + IDLE_X1) / 2) * k;
    return { k, cx, floor: box.y + box.h, h, w: artW * k };
  }
  function transformFor(f) {
    const t = G.clock.real;
    const wiggle = G.settings.reducedMotion ? 0 : Math.sin(t * 28) * 0.03 * pose.shake;
    const ang = -pose.lean * 0.05 * calm() + wiggle;
    const sq = pose.squash;
    const sx = (1 + pose.lean * 0.03) * (1 + sq * 0.07), sy = (1 + pose.lean * 0.03) * (1 - sq * 0.09);
    const jy = pose.jump * f.h * 0.35;
    return { ang, sx, sy, jy };
  }
  // artwork point -> screen, through the figure's transform (pivot at the feet)
  function local(ax, ay, f) {
    f = f || fig;
    const lx = (ax - BODY_X) * f.k * (f.sx || 1), ly = (ay - FEET_Y) * f.k * (f.sy || 1);
    const c = Math.cos(f.ang || 0), s = Math.sin(f.ang || 0);
    return { x: f.cx + lx * c - ly * s, y: f.floor + (f.jy || 0) + lx * s + ly * c };
  }

  Seb.muzzle = () => {
    if (!fig || G.L.noSeb) return { x: G.L.seb.x + G.L.seb.w * 0.2, y: G.L.seb.y + G.L.seb.h * 0.2 };
    const [clip, i] = current();
    const tip = clip === 'shoot' && TIP[i] ? TIP[i] : TIP_DOWN;
    return local(tip[0], tip[1]);
  };

  // ---------------- drawing ----------------
  Seb.draw = ctx => {
    if (!ready() || G.L.noSeb) return;
    const t = G.clock.real;
    const f = figure();
    fig = Object.assign(f, transformFor(f));
    // the cloud he stands on
    const cl = FX.softSprite(S.mood > 0.5 ? '#ffe2b0' : '#efe2ff');
    const cw = f.w * 0.8;
    for (let k = 0; k < 7; k++) {
      const px = f.cx + (k - 3) * cw * 0.16 + Math.sin(t * 0.7 + k) * cw * 0.02, s = cw * (0.2 + (k % 3) * 0.05);
      ctx.globalAlpha = 0.5; ctx.drawImage(cl, px - s, f.floor - s * 0.55, s * 2, s * 1.1);
    }
    ctx.globalAlpha = 1;
    // a soft contact shadow grounds him on the cloud; it shrinks and fades as he jumps
    const up = G.clamp(-fig.jy / (f.h * 0.2), 0, 1), sw = f.w * 0.3 * (1 - up * 0.35), sh = f.h * 0.035 * (1 - up * 0.35);
    const sg = ctx.createRadialGradient(f.cx, f.floor, 0, f.cx, f.floor, sw);
    sg.addColorStop(0, `rgba(12,6,28,${0.42 * (1 - up * 0.6)})`); sg.addColorStop(1, 'rgba(12,6,28,0)');
    ctx.save(); ctx.translate(f.cx, f.floor); ctx.scale(1, sh / sw); ctx.translate(-f.cx, -f.floor);
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(f.cx, f.floor, sw, 0, 7); ctx.fill(); ctx.restore();
    drawFigure(ctx, fig, 1, 1);
  };
  Seb.bubbleText = () => bubble && bubble.text;
  // speech bubble: drawn later, above the board and panels
  Seb.drawBubble = ctx => {
    if (!fig || !ready() || Seb.cut || G.L.noSeb) return;
    drawBubble(ctx, local(HEAD[0], HEAD[1]), fig.w);
  };

  function drawFigure(ctx, f, alpha, auraBoost) {
    const t = G.clock.real, [clip, i] = current();
    const fr = DATA[clip][i], sheet = B.seb[clip];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(f.cx, f.floor + f.jy); ctx.rotate(f.ang); ctx.scale(f.sx, f.sy); ctx.translate(-f.cx, -f.floor);
    // aura: a warm glow behind him, stronger in free spins, just after a shot and mid-jump
    const rec = Math.max(0, 1 - (t - fireT) / 0.5);
    const glowA = Math.min(1, (0.25 + 0.1 * Math.sin(t * 2.4) + rec * 0.5 + S.mood * 0.45 + (pose.jump < 0 ? 0.3 : 0) + pose.lean * 0.3) * auraBoost);
    const body = local(BODY_X, (TOP_Y + FEET_Y) / 2, Object.assign({}, f, { ang: 0, sx: 1, sy: 1, jy: 0 }));
    const gs = f.h * 0.75;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha * glowA * 0.55;
    ctx.drawImage(FX.glowSprite(S.mood > 0.5 ? '#ffb347' : '#b28cff'), body.x - gs * 0.7, body.y - gs, gs * 1.4, gs * 2);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha;
    // the frame, at its place in the artwork
    const x = f.cx + (fr[4] - BODY_X) * f.k, y = f.floor + (fr[5] - FEET_Y) * f.k;
    ctx.drawImage(sheet, fr[0], fr[1], fr[2], fr[3], x, y, fr[6] * f.k, fr[7] * f.k);
    ctx.restore();
    // a burst of light at the barrel on the shot (the flash itself is in the artwork)
    const age = t - fireT;
    if (age < 0.22 && !Seb.cut) {
      const m = Seb.muzzle(), a = 1 - age / 0.22, s = f.h * 0.22 * (0.6 + a);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.8;
      ctx.drawImage(FX.glowSprite('#ffd27a'), m.x - s, m.y - s, s * 2, s * 2);
      ctx.restore();
    }
  }

  function drawBubble(ctx, head, figW) {
    if (!bubble) return;
    const b = bubble, k = b.t < 0.25 ? G.ease.outBack(b.t / 0.25) : 1;
    const a = b.t > b.dur - 0.3 ? Math.max(0, (b.dur - b.t) / 0.3) : 1;
    const size = G.clamp(figW * 0.09, 12, 20);
    ctx.save();
    ctx.font = G.font(size, 800);
    const tw = Math.min(ctx.measureText(b.text).width, G.W * 0.5), pw = size * 0.9, bw = tw + pw * 2, bh = size * 2.1;
    // sits to the left of his head, kept on screen
    let bx = head.x - bw - size * 0.8, by = head.y - bh - size * 0.6;
    bx = G.clamp(bx, 6, G.W - bw - 6); by = G.clamp(by, 6, G.H - bh - 6);
    const ox = bx + bw * 0.85, oy = by + bh;
    ctx.globalAlpha = a;
    ctx.translate(ox, oy); ctx.scale(k, k); ctx.translate(-ox, -oy);
    ctx.fillStyle = 'rgba(255,250,236,.97)'; ctx.strokeStyle = '#3a1d03'; ctx.lineWidth = 2;
    G.roundRect(ctx, bx, by, bw, bh, bh * 0.45); ctx.fill(); ctx.stroke();
    // tail toward the head
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.72, by + bh - 1); ctx.lineTo(head.x - size * 0.2, head.y - size * 0.1); ctx.lineTo(bx + bw * 0.88, by + bh - 1);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx + bw * 0.72, by + bh); ctx.lineTo(head.x - size * 0.2, head.y - size * 0.1); ctx.lineTo(bx + bw * 0.88, by + bh); ctx.stroke();
    G.text(ctx, b.text, bx + bw / 2, by + bh / 2 + 1, size, '#2a1206', { weight: 800, maxW: tw });
    ctx.restore();
  }

  /* Big-win cut-in: drawn over the big-win backdrop. slide 0..1 = in, 1 = held. */
  Seb.drawCutIn = (ctx, alpha, slide) => {
    if (!ready()) return;
    const P = G.L.portrait, artH = FEET_Y - TOP_Y;
    const h = G.H * (P ? 0.42 : 0.74), k = h / artH;
    const e = G.ease.outBack(G.clamp(slide, 0, 1));
    const cx = G.W - (IDLE_X1 - BODY_X) * k - G.W * 0.03 + (1 - e) * h * 1.2, floor = G.H + h * 0.04;
    const f = Object.assign({ k, cx, floor, h, w: (IDLE_X1 - IDLE_X0) * k }, transformFor({ h }));
    f.ang -= 0.06;
    const save = fig; fig = f;
    drawFigure(ctx, f, alpha, 1.6);
    cutHead = { p: local(HEAD[0], HEAD[1], f), w: f.w * 0.8 };
    fig = save;
  };
  // the cut-in's bubble goes on top of the big-win text
  Seb.drawCutBubble = ctx => { if (cutHead) drawBubble(ctx, cutHead.p, cutHead.w); };
})();

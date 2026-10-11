/* Gates of Sebastian — Sebastian himself.
 *
 * The photo is posed with a few eased "joints" that all pivot around his feet:
 * aim (turns toward the cell he is about to hit), lean (lean in during a
 * tease), jump (with squash on landing), head-shake wiggle and recoil. The
 * muzzle and head anchors go through the same transform, so bolts leave the
 * barrel and speech bubbles point at his head whatever pose he is in.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX, B = G.Board, S = G.S;
  const Seb = G.Seb = {};

  /* Anchors measured on assets/sebastian.png (412×605). If the photo is
   * swapped for another size, the eye glow switches itself off. */
  const SRC = { w: 412, h: 605 };
  const EYES = [[162, 107], [183, 105]];
  const HEAD = [172, 92];

  const LINES = {
    big: ['Bullseye!', 'What a shot!', 'Now that is a trophy!'],
    mega: ['MEGA! Did you see that?', 'Hold my fox…', 'Straight to the wall!'],
    epic: ['EPIC! Frame this one!', 'Legendary hunt!', 'The gods are watching!'],
    orb: ['Feel the thunder!', 'Direct hit!', 'Hundred-fold!'],
    near: ['So close…', 'Missed by a feather!', 'Ooh, that was close!'],
    fsStart: ["Storm's coming!", "Let's hunt!", 'Hold on to your hat!'],
    retrigger: ['More spins!', 'The storm rages on!'],
    milestone: ['The multiplier grows!', "We're climbing!", 'Keep it coming!'],
    fsGood: ['What a hunt!', 'Worth every bolt!'],
    fsBad: ['The fox got away…', 'A quiet storm this time.'],
    idle: ['Nice view from up here.', 'The fox says hi.', "I've got thunder to spare."],
  };
  const PRIORITY = { big: 1, mega: 1, epic: 1, orb: 1, fsStart: 1, fsGood: 1, fsBad: 1, retrigger: 1 };

  const pose = { rot: 0, rotT: 0, lean: 0, leanT: 0, jump: 0, jumpV: 0, squash: 0, shake: 0 };
  Seb.pose = pose;                  // read-only view, used by the browser tests
  let fireT = -9, aimT = -9, idleT = 0, lastSay = -9, bubble = null, cutHead = null;
  const calm = () => G.settings.reducedMotion ? 0.4 : 1;
  let fig = null;                   // last drawn figure: {x, y, w, h, cx, floor, ang, sx, sy, jy}
  Seb.cut = null;                   // big-win cut-in state (driven by overlays.js)

  // ---------------- actions ----------------
  Seb.aimAt = (x, y) => {
    if (!fig || !B.seb || S.slam) return G.wait(0);
    const px = fig.cx, py = fig.floor, m = local(B.seb.tip[0], B.seb.tip[1], { ang: 0 });
    const want = Math.atan2(y - py, x - px) - Math.atan2(m.y - py, m.x - px);
    // turn toward the target; always a visible wind-up even when the barrel is nearly on line
    const turn = G.clamp(want * 0.9, -0.18, 0.18);
    pose.rotT = (Math.abs(turn) < 0.05 ? (turn < 0 ? -0.05 : 0.05) : turn) * calm();
    aimT = G.clock.real;
    return G.wait(G.settings.turbo ? 90 : 170);
  };
  Seb.fire = () => { fireT = G.clock.real; G.Seb.activity(); };
  Seb.relax = () => { pose.rotT = 0; };
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
  Seb.update = dt => {
    pose.rot += (pose.rotT - pose.rot) * Math.min(1, dt * 12);
    pose.lean += (pose.leanT - pose.lean) * Math.min(1, dt * 4);
    pose.shake = Math.max(0, pose.shake - dt * 1.4);
    // jump: simple ballistic arc in figure-height units, squash on landing
    if (pose.jumpV !== 0 || pose.jump < 0) {
      pose.jumpV += 5.5 * dt; pose.jump += pose.jumpV * dt;
      if (pose.jump >= 0) { pose.squash = Math.min(1, pose.jumpV * 0.9); pose.jump = 0; pose.jumpV = 0; }
    }
    pose.squash = Math.max(0, pose.squash - dt * 4);
    if (pose.rotT !== 0 && G.clock.real - Math.max(aimT, fireT) > 0.6) pose.rotT = 0;   // relax after the shot
    if (bubble) { bubble.t += dt; if (bubble.t > bubble.dur) bubble = null; }
    if (S.started && !S.busy && !G.Overlay.blocking() && S.auto <= 0) {
      idleT += dt;
      if (idleT > 25) { Seb.say('idle'); idleT = -20; }
    } else idleT = 0;
  };

  // ---------------- geometry ----------------
  function figure() {
    const L = G.L, box = L.seb, seb = B.seb;
    const aspect = seb.w / seb.h;
    let h = box.h * (L.portrait ? 0.98 : 0.9), w = h * aspect;
    const maxW = box.w * (L.portrait ? 1.05 : 1.2);
    if (w > maxW) { w = maxW; h = w / aspect; }
    const cx = box.x + box.w * (L.portrait ? 0.5 : 0.52), floor = box.y + box.h;
    return { w, h, cx, floor, x: cx - w / 2, y: floor - h };
  }
  function recoil() {
    const a = G.clock.real - fireT;
    return a < 0.45 ? Math.sin((a / 0.45) * Math.PI) * (1 - a / 0.45) : 0;
  }
  // the transform shared by drawing and anchors: pivot at the feet
  function transformFor(f) {
    const t = G.clock.real, rec = recoil();
    const wiggle = G.settings.reducedMotion ? 0 : Math.sin(t * 28) * 0.035 * pose.shake;
    const ang = pose.rot - rec * 0.07 * calm() - pose.lean * 0.06 * calm() + wiggle;
    const sq = pose.squash;
    const sx = (1 + pose.lean * 0.03) * (1 + sq * 0.07), sy = (1 + pose.lean * 0.03) * (1 - sq * 0.09) * (1 + Math.sin(t * 2.1) * 0.006);
    const jy = pose.jump * f.h * 0.35 + Math.sin(t * 1.4) * f.h * 0.012;
    return { ang, sx, sy, jy, rec };
  }
  // image-local point (u, v in 0..1 of the cropped figure) -> screen
  function local(u, v, tf) {
    const f = fig, T = tf || f;
    const lx = f.x + u * f.w + (T.rec || 0) * f.w * 0.04 - f.cx, ly = f.y + v * f.h - f.floor;
    const c = Math.cos(T.ang || 0), s = Math.sin(T.ang || 0);
    const x = lx * (T.sx || 1), y = ly * (T.sy || 1);
    return { x: f.cx + x * c - y * s, y: f.floor + (T.jy || 0) + x * s + y * c };
  }
  const srcUV = (px, py) => {
    const sb = B.seb;
    return [(px - sb.ox) / sb.w, (py - sb.oy) / sb.h];
  };

  Seb.muzzle = () => {
    if (!fig || !B.seb) return { x: G.L.seb.x + G.L.seb.w * 0.2, y: G.L.seb.y + G.L.seb.h * 0.6 };
    return local(B.seb.tip[0], B.seb.tip[1]);
  };

  // ---------------- drawing ----------------
  Seb.draw = ctx => {
    const seb = B.seb;
    if (!seb) return;
    const t = G.clock.real;
    const f = figure(), tf = transformFor(f);
    fig = Object.assign(f, tf);
    // the cloud he stands on
    const cl = FX.softSprite(S.mood > 0.5 ? '#ffe2b0' : '#efe2ff');
    for (let k = 0; k < 7; k++) {
      const px = f.cx + (k - 3) * f.w * 0.16 + Math.sin(t * 0.7 + k) * f.w * 0.02, s = f.w * (0.2 + (k % 3) * 0.05);
      ctx.globalAlpha = 0.5; ctx.drawImage(cl, px - s, f.floor - s * 0.55, s * 2, s * 1.1);
    }
    ctx.globalAlpha = 1;
    drawFigure(ctx, f, tf, 1, 1);
  };
  Seb.bubbleText = () => bubble && bubble.text;
  // speech bubble: drawn later, above the board and panels
  Seb.drawBubble = ctx => {
    if (!fig || !B.seb || Seb.cut) return;
    drawBubble(ctx, local(...srcUV(...HEAD)), fig.w);
  };

  function drawFigure(ctx, f, tf, alpha, auraBoost) {
    const seb = B.seb, t = G.clock.real;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(f.cx, f.floor + tf.jy); ctx.rotate(tf.ang); ctx.scale(tf.sx, tf.sy); ctx.translate(-f.cx, -f.floor);
    const x = f.x + tf.rec * f.w * 0.04;
    // aura (rim glow): stronger in free spins, after a shot and mid-jump
    const glow = S.mood > 0.5 ? seb.glowF : seb.glowB;
    if (glow) {
      const k = f.w / seb.w;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * Math.min(1, (0.45 + 0.15 * Math.sin(t * 2.4) + tf.rec * 0.6 + S.mood * 0.2 + (pose.jump < 0 ? 0.35 : 0) + pose.lean * 0.3) * auraBoost);
      ctx.drawImage(glow.c, x - glow.pad * k, f.y - glow.pad * k, glow.c.width * k, glow.c.height * k);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha;
    }
    ctx.drawImage(seb.img, x, f.y, f.w, f.h);
    // glowing eyes once the storm is on
    if (S.mood > 0.05 && seb.srcW === SRC.w && seb.srcH === SRC.h) {
      ctx.globalCompositeOperation = 'lighter';
      const flick = 0.7 + 0.3 * Math.sin(t * 9), s = f.w * 0.018 * (1 + tf.rec * 0.6);
      EYES.forEach(([ex, ey]) => {
        const [u, v] = srcUV(ex, ey), px = x + u * f.w, py = f.y + v * f.h;
        ctx.globalAlpha = alpha * S.mood * flick * 0.9;
        ctx.drawImage(FX.glowSprite('#ffe9a8'), px - s, py - s, s * 2, s * 2);
        ctx.globalAlpha = alpha * S.mood * 0.22;
        ctx.drawImage(FX.glowSprite('#ff9a3a'), px - s * 2.2, py - s * 0.9, s * 4.4, s * 1.8);
      });
    }
    ctx.restore();
    // muzzle flash
    const age = t - fireT;
    if (age < 0.25 && !Seb.cut) {
      const m = Seb.muzzle(), a = 1 - age / 0.25, s = f.w * 0.35 * (0.6 + a);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
      ctx.drawImage(FX.glowSprite('#9fe6ff'), m.x - s, m.y - s, s * 2, s * 2);
      ctx.drawImage(FX.starSprite(), m.x - s * 0.8, m.y - s * 0.8, s * 1.6, s * 1.6);
      ctx.restore();
    }
  }

  function drawBubble(ctx, head, figW) {
    if (!bubble) return;
    const b = bubble, k = b.t < 0.25 ? G.ease.outBack(b.t / 0.25) : 1;
    const a = b.t > b.dur - 0.3 ? Math.max(0, (b.dur - b.t) / 0.3) : 1;
    const size = G.clamp(figW * 0.11, 12, 20);
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
    const seb = B.seb;
    if (!seb) return;
    const P = G.L.portrait, h = G.H * (P ? 0.42 : 0.78), w = h * (seb.w / seb.h);
    const e = G.ease.outBack(G.clamp(slide, 0, 1));
    const cx = G.W - w * (P ? 0.42 : 0.38) + (1 - e) * w * 1.2, floor = G.H + h * 0.06;
    const f = { w, h, cx, floor, x: cx - w / 2, y: floor - h };
    const tf = transformFor(f);
    tf.ang -= 0.08; tf.rec = 0;
    const save = fig; fig = Object.assign({}, f, tf);
    drawFigure(ctx, f, tf, alpha, 1.6);
    cutHead = { p: local(...srcUV(...HEAD)), w: w * 0.7 };
    fig = save;
  };
  // the cut-in's bubble goes on top of the big-win text
  Seb.drawCutBubble = ctx => { if (cutHead) drawBubble(ctx, cutHead.p, cutHead.w); };
})();

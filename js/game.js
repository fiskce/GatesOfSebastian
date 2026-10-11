/* Gates of Sebastian — game flow, input, render loop and boot.
 *
 * Every spin is decided up front by the engine (E.playSpin) from a provably
 * fair random stream; this file only *presents* that result: it drops the
 * board, plays each tumble step, throws the orbs, applies the multiplier and
 * celebrates. Payouts always come from the engine's evaluate(), so what the
 * player is paid is exactly what tools/sim.js measures.
 */
(() => {
  'use strict';
  const G = window.GOS, E = G.E, B = G.Board, FX = G.FX, H = G.HUD, O = G.Overlay, Scene = G.Scene;
  const S = G.S;
  const { COLS, ROWS, CELLS, SCATTER, SCATTERS_FS, SCATTERS_RETRIG, FS_AWARD, FS_RETRIGGER, MAX_WIN_X } = E;
  const PF = window.ProvablyFair;
  const Game = G.Game = {};
  const ctx = G.ctx;

  // ---------------- small helpers ----------------
  const live = document.getElementById('live');
  function say(msg, speak) {
    S.message = msg; S.messageT = G.clock.real;
    if (speak !== false && live) live.textContent = msg;
  }
  function setPace() { G.setPace(S.slam ? 3.5 : G.settings.turbo ? 2 : 1); }
  const semis = n => Math.pow(2, n / 12);
  // adaptive music: a light pulse while spinning, building per cascade; free spins follow the storm
  const fsLevel = () => 0.55 + 0.45 * G.clamp(Math.log2(1 + S.persistent) / 7, 0, 1);
  const spinLevel = () => S.inFS ? fsLevel() : 0.25;

  // game-clock tweens (count-ups)
  const tweens = [];
  function tween(obj, key, to, ms, onStep) {
    return new Promise(res => tweens.push({ obj, key, from: obj[key], to, dur: Math.max(0.001, ms / 1000), t: 0, onStep, res }));
  }
  function updateTweens(dt) {
    for (let k = tweens.length - 1; k >= 0; k--) {
      const tw = tweens[k]; tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      tw.obj[tw.key] = G.lerp(tw.from, tw.to, G.ease.outCubic(p));
      if (tw.onStep) tw.onStep(p);
      if (p >= 1) { tweens.splice(k, 1); tw.res(); }
    }
  }

  // ---------------- round orchestration ----------------
  function canAfford(buy) { return S.credit >= (buy ? G.buyCost() : G.spinCost()) - 1e-9; }

  async function round(buy) {
    if (S.busy || S.inFS) return;
    if (!canAfford(buy)) { S.auto = 0; G.UI.open('credit'); AudioEngine.play('denied'); return; }
    const stake = buy ? G.buyCost() : G.spinCost();
    S.credit -= stake;
    G.Stats.record('stake', { amount: stake, buy });
    G.Seb.activity();
    S.roundWin = 0; S.winDisplay = 0; S.busy = true; S.autoMenu = false;
    G.save();
    const r = await spin({ buy });
    if (r.triggered && !r.maxed) await feature(!buy);
    G.Music.setIntensity(0);
    G.Stats.record('round', { winX: S.roundWin / G.baseBet() });
    S.busy = false; S.slam = false; setPace();
    G.save();
    if (S.auto > 0) {
      S.auto--;
      if (S.auto > 0) {
        if (canAfford(false)) { await G.wait(320); if (S.auto > 0 && !S.busy) round(false); }
        else { S.auto = 0; say('AUTOPLAY STOPPED — NOT ENOUGH CREDIT'); }
      }
    }
  }

  /* One spin (base, ante, buy or a free spin), fully presented. */
  async function spin(opts) {
    const bet = G.baseBet();
    S.slam = false; setPace();
    S.tumbleWin = 0; S.tumbleShown = 0; S.spinMult = 0; S.cascade = 0;
    if (S.inFS) { S.fsLeft--; S.fsPlayed++; }
    else S.winDisplay = 0;
    const mode = S.inFS ? 'fs' : (S.ante && !opts.buy ? 'ante' : 'base');
    const persistentBefore = S.persistent;
    const rng = PF.nextRng();
    const entry = { nonce: PF.nonce, serverHash: PF.serverHash, clientSeed: PF.clientSeed, mode, buy: !!opts.buy,
      persistent: persistentBefore, bet, time: Date.now() };
    const out = E.playSpin(rng, mode, { buy: opts.buy, persistent: persistentBefore });
    AudioEngine.play('spin', { gain: 0.8 });
    G.Music.setIntensity(spinLevel());
    if (S.inFS) say(`FREE SPIN ${S.fsPlayed} OF ${S.fsAward}`, false);
    else S.message = '';

    await dropBoard(out.board, mode);

    for (const step of out.res.steps) await playStep(step, bet);

    // ---- multiplier
    let spinWin = out.ev.winX * bet;
    const applies = out.res.tumbleWinX > 0 && out.ev.mult > 1;
    if (applies) {
      const w = H.wellCenter();
      if (!S.inFS) S.spinMult = 0;          // the collector fires its charge
      await O.slam(out.ev.mult, w);
      say(`${G.money(S.tumbleWin)} × ${out.ev.mult}`, false);
      await tween(S, 'tumbleShown', S.tumbleWin * out.ev.mult, 650, p => { if (Math.random() < 0.5) AudioEngine.play('tick', { rate: 1 + p }); });
      await G.wait(250);
    }
    S.persistent = out.ev.persistentAfter;

    // ---- max-win cap for the whole round
    const capLeft = MAX_WIN_X * bet - S.roundWin;
    let maxed = false;
    if (spinWin >= capLeft) { spinWin = capLeft; maxed = true; }

    if (spinWin > 0) {
      S.credit += spinWin; S.roundWin += spinWin; S.lastWin = spinWin;
      if (S.inFS) S.fsTotal += spinWin;
      await celebrate(spinWin, bet);
    }
    S.tumbleShown = 0;

    G.Stats.record('spin', { free: mode === 'fs', win: spinWin, winX: spinWin / bet, cascades: S.cascade, mult: applies ? out.ev.mult : 0,
      nearMiss: mode !== 'fs' && !opts.buy && out.res.scatters === SCATTERS_FS - 1, maxed });
    entry.winX = spinWin / bet; entry.rawWinX = out.ev.winX; entry.mult = out.ev.mult; entry.scatters = out.res.scatters;
    entry.board = out.board.join(',');
    S.history.unshift(entry); if (S.history.length > 200) S.history.pop();

    // ---- scatters
    const need = S.inFS ? SCATTERS_RETRIG : SCATTERS_FS;
    let triggered = false, retrig = false;
    if (maxed) {
      await O.banner('MAX WIN', G.xfmt(MAX_WIN_X) + ' REACHED', 2200);
    } else if (!S.inFS && (opts.buy || out.res.scatters >= SCATTERS_FS)) {
      triggered = true; await scatterFanfare(out.res.finalBoard);
    } else if (S.inFS && out.res.scatters >= need) {
      retrig = true; G.Seb.say('retrigger'); G.Stats.record('retrigger'); await scatterFanfare(out.res.finalBoard);
      S.fsLeft += FS_RETRIGGER; S.fsAward += FS_RETRIGGER;
      AudioEngine.play('freespins', { gain: 0.8 });
      await O.banner('+' + FS_RETRIGGER + ' FREE SPINS', 'RETRIGGER!', 1600);
    } else if (!S.inFS && out.res.scatters === SCATTERS_FS - 1) {
      say('SO CLOSE — ONE MORE SCATTER!');
      G.Seb.headShake(); G.Seb.say('near', 0.8);
    }
    if (!S.inFS) S.winDisplay = spinWin;
    else S.winDisplay = S.fsTotal;
    return { triggered, retrig, maxed };
  }

  // ---- the board drops in column by column; with enough scatters showing,
  //      the remaining columns are held back and "spin" for suspense
  async function dropBoard(board, mode) {
    const need = mode === 'fs' ? SCATTERS_RETRIG : SCATTERS_FS;
    const turbo = G.settings.turbo;
    const colDelay = [], antic = [];
    let count = 0, t = 0.16;
    for (let c = 0; c < COLS; c++) {
      if (count >= need - 1) { t += turbo ? 0.65 : 1.05; antic.push(c); }
      else t += c === 0 ? 0 : turbo ? 0.04 : 0.075;
      colDelay[c] = t;
      for (let r = 0; r < ROWS; r++) if (board[r * COLS + c] === SCATTER) count++;
    }
    S.scattersLanded = 0; S.scatterNeed = need;
    let drone = null;
    // timers belong to this drop only; a slam can end the drop before they fire
    const id = ++dropSeq, live = () => id === dropSeq && dropping && !S.slam;
    dropping = true;
    if (antic.length) {
      const hold = turbo ? 0.65 : 1.05;
      // start the tease when the first held column would have dropped
      G.wait((colDelay[antic[0]] - hold) * 1000).then(() => {
        if (!live()) return;
        drone = AudioEngine.anticipation(); AudioEngine.suspense(true);
        S.suspense = 1; G.Seb.lean(true); G.Music.heartbeat(true);
        say(mode === 'fs' ? 'RETRIGGER?' : 'ONE MORE SCATTER…', false);
      });
      // the camera follows each held column in turn, pushing a little closer every time
      const gentle = G.L.portrait ? 0.6 : 1;
      antic.forEach((c, k) => G.wait((colDelay[c] - hold) * 1000).then(() => {
        if (!live()) return;
        FX.pushIn((0.045 + k * 0.025) * gentle, { x: G.cellX(c) + G.L.cell / 2, y: G.L.gy + G.L.gridH / 2 });
      }));
    }
    try {
      await B.dropIn(board, { colDelay, antic });
    } finally {
      dropping = false;
      if (drone) drone.stop();
      if (S.suspense || antic.length) { AudioEngine.suspense(false); FX.release(); S.suspense = 0; G.Seb.lean(false); G.Music.heartbeat(false); }
    }
    B.sweep();            // a diagonal glint across the freshly landed board
  }
  let dropSeq = 0, dropping = false;

  B.onLand = (i, c) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const p = G.cellCenter(i), cs = G.L.cell;
    if (row === ROWS - 1 && c.fresh) {
      AudioEngine.play('land', { rate: 0.85 + col * 0.06, gain: 0.7 });
      FX.spawn({ kind: 'smoke', x: p.x, y: p.y + cs * 0.45, vx: G.rand(-30, 30), vy: -10, max: 0.5, size: cs * 0.2, size1: cs * 0.5, color: '#c7b2ff', add: false });
    }
    if (c.id === SCATTER && c.fresh) {
      S.scattersLanded++;
      const n = S.scattersLanded, hit = n >= S.scatterNeed;
      AudioEngine.play('scatterLand', { rate: semis((n - 1) * 3), gain: hit ? 1.2 : 0.9 });
      G.haptic(hit ? [30, 40, 70] : 15);
      if (n === S.scatterNeed) { G.slowmo(0.4, 700); FX.punch(0.03); }     // the scatter that completes the trigger
      FX.ring(p.x, p.y, '#ffcf6a', cs * 0.2, cs * (hit ? 1.4 : 0.9), 0.55, hit ? 7 : 4);
      FX.burst(p.x, p.y, '#ffb02e', hit ? 26 : 12, hit ? 520 : 300, { size: 9, layer: 1 });
      FX.star(p.x, p.y, cs * 0.6, 0.6);
      if (hit) { FX.shake(7); FX.flash(0.25, '255,210,140'); }
    }
    c.fresh = false;
  };

  // forked lightning links every symbol of a winning cluster (nearest-neighbour path)
  function chainEdges(w) {
    const pts = w.cells.map(i => G.cellCenter(i)).sort((a, b) => a.y - b.y || a.x - b.x);
    const order = [pts.shift()];
    while (pts.length) {
      const last = order[order.length - 1];
      let bi = 0, bd = Infinity;
      pts.forEach((p, j) => { const d = (p.x - last.x) ** 2 + (p.y - last.y) ** 2; if (d < bd) { bd = d; bi = j; } });
      order.push(pts.splice(bi, 1)[0]);
    }
    const col = G.SYMBOL_COLORS[w.symbol], edges = [];
    for (let k = 1; k < order.length; k++) {
      const a = order[k - 1], b = order[k];
      edges.push({ a, b, col, d: Math.hypot(b.x - a.x, b.y - a.y) });
    }
    return edges;
  }
  function chainStep(wins) {
    const edges = [];
    wins.forEach(w => edges.push(...chainEdges(w)));
    edges.sort((p, q) => p.d - q.d).slice(0, [10, 18, 40][G.Q.level]).forEach(e =>
      FX.bolt(e.a.x, e.a.y, e.b.x, e.b.y, { layer: 0, dur: 0.75, width: 1.6, color: e.col, depth: G.Q.level >= 2 ? 1 : 0 }));
  }

  // shattered winners stream into the TUMBLE WIN plaque, which counts up as they land
  let flowToken = 0;
  function flowToPlaque(set, stepWin) {
    const token = ++flowToken, target = H.plaqueC;
    if (!target) { S.tumbleShown = S.tumbleWin; return; }
    const n = set.size, per = stepWin / n;
    let arrived = 0, k = 0;
    set.forEach(i => {
      const p = G.cellCenter(i);
      const dur = (G.rand(0.45, 0.7) + (k++) * 0.018) / Math.min(2, G.clock.pace);
      FX.home(p.x, p.y, target.x + G.rand(-24, 24), target.y, G.SYMBOL_COLORS[B.cells[i].id], dur, () => {
        if (token !== flowToken) return;
        arrived++;
        S.tumbleShown = Math.min(S.tumbleWin, S.tumbleShown + per);
        S.plaquePopT = G.clock.real;
        if (arrived % 2) AudioEngine.play('tick', { rate: 1 + arrived * 0.05, gain: 0.7 });
        if (arrived === n) { S.tumbleShown = S.tumbleWin; FX.burst(target.x, target.y, '#ffd27a', 12, 240, { size: 8, layer: 1 }); }
      });
    });
  }

  async function playStep(step, bet) {
    S.cascade++;
    const set = new Set(step.removeSet);
    B.highlight(set, true);
    const cs = G.L.cell;
    chainStep(step.wins);
    G.Music.setIntensity(Math.min(1, spinLevel() + 0.08 * S.cascade));
    AudioEngine.play('crackle', { rate: 1 + S.cascade * 0.05 });
    // one label per winning cluster, at its centre of mass
    for (const w of step.wins) {
      let x = 0, y = 0;
      w.cells.forEach(i => { const p = G.cellCenter(i); x += p.x; y += p.y; });
      x /= w.cells.length; y /= w.cells.length;
      FX.text(x, y, G.money(w.payX * bet), cs * 0.36, '#fff', { display: false, weight: 800, max: 1.5, vy: -36, maxW: cs * 2.4, glow: 'rgba(255,150,40,.85)' });
      FX.text(x, y + cs * 0.38, `${w.count} × ${G.SYMBOL_NAMES[w.symbol]}`, cs * 0.17, '#fff', { display: false, weight: 700, max: 1.5, vy: -36, maxW: cs * 2.4,
        colors: ['#ffffff', '#f0e6ff', '#d9c8ff', '#c7b2ff', '#f0e6ff'], strokeColor: '#1a0730' });
    }
    const stepWin = step.stepWinX * bet;
    S.tumbleWin += stepWin;
    AudioEngine.play(step.stepWinX >= 15 ? 'bigwin' : 'win', { rate: semis(Math.min(S.cascade - 1, 9) * 2) });
    if (S.cascade > 1) say('TUMBLE × ' + S.cascade, false);
    await G.wait(560);
    for (const o of step.orbs) await throwOrb(o);
    // shatter the winners
    AudioEngine.play('shatter', { rate: semis(Math.min(S.cascade - 1, 9)) });
    set.forEach(i => {
      const p = G.cellCenter(i), col = G.SYMBOL_COLORS[B.cells[i].id];
      FX.shards(p.x, p.y, col, 7, cs * 0.14);
      FX.burst(p.x, p.y, col, 6, 260, { size: cs * 0.12 });
    });
    flowToPlaque(set, stepWin);
    await B.explode(set);
    B.highlight(set, false);
    AudioEngine.play('tumble', { gain: 0.7 });
    await B.tumble(set, step.boardAfter);
    await G.wait(90);
    flowToken++; S.tumbleShown = S.tumbleWin;      // settle anything still in flight
  }

  // Sebastian fires a bolt from his shotgun; the orb lands, then flies into the collector
  async function throwOrb(o) {
    const tier = G.orbTier(o.value), col = G.ORB_COLORS[tier][3];
    const c = G.cellCenter(o.cell);
    await G.Seb.aimAt(c.x, c.y);              // he turns toward the cell before he fires
    G.Seb.fire();
    const m = G.Seb.muzzle();
    FX.bolt(m.x, m.y, c.x, c.y, { layer: 1, dur: 0.5, width: 3 + tier, color: tier >= 3 ? '#ffd27a' : '#9fe6ff' });
    FX.flash(0.18 + tier * 0.08, '190,225,255');
    AudioEngine.play('thunder', { gain: 0.45 + tier * 0.15, rate: 1.1 - tier * 0.08 });
    AudioEngine.play('orb', { rate: 1 + tier * 0.25 });
    if (tier >= 2) Scene.lightning(true);
    await G.wait(170);
    const orb = B.addOrb(o.value, o.cell);
    if (tier >= 3) { G.slowmo(0.3, 900); G.Seb.say('orb'); }     // 100x and up: time stops for a moment
    G.haptic(tier >= 2 ? [40, 30, 60] : 20);
    FX.ring(c.x, c.y, col, G.L.cell * 0.2, G.L.cell * (1 + tier * 0.4), 0.5, 5 + tier * 2);
    FX.burst(c.x, c.y, col, 14 + tier * 10, 320 + tier * 140, { size: 10, layer: 1 });
    FX.shake(3 + tier * 4); if (tier >= 2) FX.punch(0.02 + tier * 0.01);
    await G.wait(560 + tier * 140);
    AudioEngine.play('collect', { rate: 1 + tier * 0.15 });
    const w = H.wellCenter();
    await B.flyOrb(orb, w.x, w.y, 0.5);
    FX.ring(w.x, w.y, col, 8, G.L.well.w * 0.5, 0.45, 5);
    FX.burst(w.x, w.y, col, 16, 260, { size: 10, layer: 1 });
    if (S.inFS) { S.persistent += o.value; milestoneCheck(); G.Stats.record('persistent', { value: S.persistent }); } else S.spinMult += o.value;
    G.Stats.record('orb', { value: o.value });
    S.wellPulseT = G.clock.real;
    AudioEngine.play('coin', { rate: 1 + tier * 0.1 });
  }

  // free spins: the total multiplier passing x25/x50/... is an event of its own
  const MILESTONES = [25, 50, 100, 250, 500];
  function milestoneCheck() {
    let hit = 0;
    MILESTONES.forEach(m => { if (S.persistent >= m && m > S.fsMilestone) hit = m; });
    if (!hit) return;
    S.fsMilestone = hit;
    O.milestone('×' + hit + ' TOTAL MULTI', hit >= 100 ? 'THE STORM IS RAGING' : 'THE STORM GROWS');
    AudioEngine.play('thunder', { gain: 1 }); AudioEngine.play('tierUp', { rate: 0.9 + MILESTONES.indexOf(hit) * 0.08 });
    Scene.lightning(true); setTimeout(() => Scene.lightning(true), 160);
    FX.flash(0.5, '255,200,150'); FX.shake(12); FX.punch(0.035);
    G.haptic([60, 40, 90]);
    G.Seb.cheer(1.3); G.Seb.say('milestone');
  }

  async function celebrate(amount, bet) {
    const x = amount / bet;
    if (live) live.textContent = 'You won ' + G.money(amount);
    if (O.tierFor(x) >= 0) {
      await O.bigWin(amount, bet, S.auto > 0 || S.inFS ? 1800 : 3200);
    } else {
      const r = G.L.reel;
      FX.coins(r.x + r.w / 2, r.y + r.h * 0.65, Math.min(30, 4 + Math.round(x * 2)), r.w * 0.2, G.H * 0.7);
      AudioEngine.play('coin', { rate: 1.1 });
      O.winPop(amount, 1100);
      S.winDisplay = S.inFS ? S.fsTotal : amount;
      await G.wait(x >= 5 ? 900 : 550);
    }
  }

  async function scatterFanfare(board) {
    const set = new Set();
    board.forEach((s, i) => { if (s === SCATTER) set.add(i); });
    B.highlight(set, true);
    AudioEngine.play('scatter');
    set.forEach(i => { const p = G.cellCenter(i); FX.ring(p.x, p.y, '#ffd27a', 10, G.L.cell * 1.3, 0.7, 6); FX.burst(p.x, p.y, '#ffb02e', 20, 420, { size: 10, layer: 1 }); });
    FX.shake(8); FX.flash(0.35, '255,210,140');
    await G.wait(1300);
    B.highlight(set, false);
  }

  async function feature(natural) {
    G.Stats.record('feature', { natural });
    G.haptic([40, 40, 80]);
    await O.fsIntro(FS_AWARD, S.auto > 0 ? 2600 : 7000);
    S.inFS = true; S.fsLeft = FS_AWARD; S.fsAward = FS_AWARD; S.fsPlayed = 0; S.fsTotal = 0; S.persistent = 0; S.fsMilestone = 0;
    S.moodTarget = 1; AudioEngine.musicMode('fs');
    G.Seb.say('fsStart');
    Scene.lightning(true);
    await G.wait(700);
    while (S.fsLeft > 0) {
      const r = await spin({});
      if (r.maxed) break;
      await G.wait(380);
    }
    await O.fsOutro(S.fsTotal, S.fsPlayed, G.baseBet(), S.auto > 0 ? 2600 : 6000);
    G.Seb.say(S.fsTotal / G.baseBet() >= 20 ? 'fsGood' : 'fsBad');
    G.Stats.record('featureEnd', { totalX: S.fsTotal / G.baseBet() });
    S.inFS = false; S.persistent = 0; S.moodTarget = 0; AudioEngine.musicMode('base');
    S.winDisplay = S.roundWin;
    say('FEATURE WON ' + G.money(S.fsTotal));
  }

  // ---------------- player actions ----------------
  Game.spinPressed = () => {
    AudioEngine.resume();
    if (O.blocking()) { O.skip(); return; }
    if (S.autoMenu) { S.autoMenu = false; return; }
    if (S.auto > 0) { Game.stopAuto(); return; }
    if (S.busy) { Game.slam(); return; }
    round(false);
  };
  Game.slam = () => {
    if (!S.busy || S.slam) return;
    S.slam = true; G.cancelSlowmo(); FX.release(); setPace(); B.hurry();
    G.haptic(10);
  };
  Game.askBuy = () => {
    if (S.busy || S.inFS) return;
    if (S.ante) { say('TURN OFF DOUBLE CHANCE TO BUY'); return; }
    G.UI.open('buy');
  };
  Game.buy = () => round(true);
  Game.toggleAnte = () => {
    if (S.busy || S.inFS) return;
    S.ante = !S.ante; G.save();
    AudioEngine.play(S.ante ? 'coin' : 'click');
    say(S.ante ? 'DOUBLE CHANCE ON · +25% STAKE' : 'DOUBLE CHANCE OFF');
  };
  Game.bet = d => {
    if (S.busy || S.inFS || S.auto > 0) return;
    S.betIndex = G.clamp(S.betIndex + d, 0, G.BET_STEPS.length - 1); G.save();
    AudioEngine.play('click', { rate: 0.8 + S.betIndex * 0.04 });
    say('BET ' + G.money(G.spinCost()));
  };
  Game.toggleTurbo = () => { G.settings.turbo = !G.settings.turbo; setPace(); G.save(); G.UI.sync(); say(G.settings.turbo ? 'TURBO ON' : 'TURBO OFF'); };
  Game.toggleSound = () => {
    const on = !(G.settings.sfx || G.settings.music);
    G.settings.sfx = on; G.settings.music = on; Game.applySettings(); G.save(); G.UI.sync();
  };
  Game.autoPressed = () => {
    if (S.inFS) return;
    if (S.auto > 0) { Game.stopAuto(); return; }
    S.autoMenu = !S.autoMenu;
  };
  Game.startAuto = n => {
    S.autoMenu = false;
    if (S.busy) return;
    if (!canAfford(false)) { G.UI.open('credit'); return; }
    S.auto = n; say(n === Infinity ? 'AUTOPLAY ∞' : 'AUTOPLAY ' + n);
    round(false);
  };
  Game.stopAuto = () => { S.auto = 0; say('AUTOPLAY STOPPED'); };
  Game.resetCredit = () => { if (S.busy) return; S.credit = G.START_CREDIT; G.save(); say('BALANCE RESET TO ' + G.money(S.credit)); };
  Game.applySettings = () => {
    AudioEngine.setVolume(G.settings.volume);
    AudioEngine.setSfx(G.settings.sfx);
    if (S.started) {
      if (G.settings.music) AudioEngine.startMusic(); else AudioEngine.stopMusic();
      if (G.settings.music && G.settings.dynMusic && !document.hidden) G.Music.start(); else G.Music.stop();
    }
    G.Q.applySetting();
    setPace();
  };

  // re-derive a past spin from a revealed server seed
  Game.verify = (entry, serverSeed) => {
    const hashOk = PF.hashOf(serverSeed) === entry.serverHash;
    const out = E.playSpin(PF.makeStream(serverSeed, entry.clientSeed, entry.nonce), entry.mode, { buy: entry.buy, persistent: entry.persistent });
    const boardOk = out.board.join(',') === entry.board;
    const winOk = Math.abs(out.ev.winX - entry.rawWinX) < 1e-9;
    return { ok: hashOk && boardOk && winOk, hashOk, boardOk, winOk, winX: out.ev.winX };
  };

  // ---------------- input ----------------
  function localXY(e) { const r = G.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  // buttons drawn inside the zoomed/tilted world record their transform, so the
  // pointer is mapped back into each button's own space before testing
  function hit(x, y) {
    const bs = G.L.buttons || [];
    for (let k = bs.length - 1; k >= 0; k--) {
      const b = bs[k];
      let px = x, py = y;
      if (b.inv) { const q = b.inv.transformPoint(new DOMPoint(x * G.DPR, y * G.DPR)); px = q.x; py = q.y; }
      const inside = b.shape === 'circle' ? Math.hypot(px - (b.x + b.w / 2), py - (b.y + b.h / 2)) <= b.w / 2
        : px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
      if (inside) return b;
    }
    return null;
  }
  G.pointer = null; G.pointerN = { x: 0, y: 0 };
  G.canvas.addEventListener('pointerdown', e => {
    AudioEngine.resume();
    const p = localXY(e); G.pointer = p;
    if (O.blocking()) { O.skip(); return; }
    const b = hit(p.x, p.y);
    if (b) {
      if (b.disabled) { AudioEngine.play('denied', { gain: 0.6 }); return; }
      G.pressId = b.id;
      if (b.id !== 'spin') AudioEngine.play('click');
      b.onClick();
      return;
    }
    if (S.autoMenu) { S.autoMenu = false; return; }
    // tapping the board during a spin hurries it along
    const r = G.L.reel, q = G.worldInv ? G.worldInv.transformPoint(new DOMPoint(p.x * G.DPR, p.y * G.DPR)) : p;
    if (S.busy && q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h) Game.slam();
  });
  G.canvas.addEventListener('pointermove', e => {
    G.pointer = localXY(e);
    G.pointerN = { x: (G.pointer.x / G.W) * 2 - 1, y: (G.pointer.y / G.H) * 2 - 1 };
    if (!deviceTilt && e.pointerType === 'mouse') { FX.cam.tiltTarget.x = G.pointerN.x; FX.cam.tiltTarget.y = G.pointerN.y; }
  });
  // phones: tilt the world with the device (relative to how it was held at first)
  let deviceTilt = false, base = null;
  const screenAngle = () => {
    const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0);
    return ((a % 360) + 360) % 360;
  };
  function onOrient(e) {
    if (e.gamma == null || e.beta == null) return;
    deviceTilt = true;
    const a = screenAngle();
    const [x, y] = a === 90 ? [e.beta, -e.gamma] : a === 270 ? [-e.beta, e.gamma] : a === 180 ? [-e.gamma, -e.beta] : [e.gamma, e.beta];
    const now = performance.now();
    // first reading, a rotation or gamma's ±90° wrap: re-centre on how the phone is held now
    if (!base || Math.abs(x - base.x) > 60 || Math.abs(y - base.y) > 60) base = { x, y, t: now };
    const dt = Math.min(0.2, (now - base.t) / 1000); base.t = now;
    base.x += (x - base.x) * dt / 4; base.y += (y - base.y) * dt / 4;     // slowly forgets the resting angle
    FX.cam.tiltTarget.x = G.clamp((x - base.x) / 20, -1, 1);
    FX.cam.tiltTarget.y = G.clamp((y - base.y) / 20, -1, 1);
  }
  window.addEventListener('orientationchange', () => { base = null; });
  Game.enableDeviceTilt = enableDeviceTilt;
  let tiltListening = false;
  function enableDeviceTilt() {
    const D = window.DeviceOrientationEvent;
    if (!D || !(navigator.maxTouchPoints > 0) || !G.settings.tilt || G.settings.reducedMotion || tiltListening) return;
    const on = () => { tiltListening = true; window.addEventListener('deviceorientation', onOrient); };
    if (typeof D.requestPermission === 'function') D.requestPermission().then(r => { if (r === 'granted') on(); }).catch(() => {});   // iOS: needs the PLAY tap
    else on();
  }
  G.canvas.addEventListener('pointerleave', () => { G.pointer = null; });
  window.addEventListener('pointerup', () => { G.pressId = null; });

  document.addEventListener('keydown', e => {
    if (!S.started) return;
    if (G.UI.isOpen()) { if (e.key === 'Escape') G.UI.closeAll(); return; }
    if (e.target && /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) && e.code !== 'Escape') return;
    switch (e.code) {
      case 'Space': case 'Enter': e.preventDefault(); if (!e.repeat) Game.spinPressed(); break;
      case 'ArrowUp': e.preventDefault(); Game.bet(1); break;
      case 'ArrowDown': e.preventDefault(); Game.bet(-1); break;
      case 'KeyT': Game.toggleTurbo(); break;
      case 'KeyM': Game.toggleSound(); break;
      case 'KeyI': G.UI.open('info'); break;
      case 'Escape': S.autoMenu = false; break;
    }
  });

  // pause while the tab is hidden; everything waits on the game clock, so it all freezes together
  document.addEventListener('visibilitychange', () => {
    if (!S.started) return;
    G.clock.paused = document.hidden;
    if (G.settings.music) { if (document.hidden) AudioEngine.stopMusic(); else AudioEngine.startMusic(); }
    if (document.hidden) G.Music.stop(); else if (G.settings.music && G.settings.dynMusic) G.Music.start();
  });

  // ---------------- render loop ----------------
  G.onLayout = () => { Scene.invalidate(); B.invalidate(); H.invalidate(); };
  window.addEventListener('resize', G.resize);
  G.Q.onChange = level => {            // new DPR cap, star/cloud counts, frame caches
    G.resize();
    document.body.classList.toggle('lite', level === 0);   // drop the CSS backdrop blur too
  };

  let last = 0;
  function frame(now) {
    const rawDt = (now - last) / 1000 || 0;
    const dtReal = Math.min(0.05, rawDt); last = now;
    const paused = G.clock.paused;
    G.clock.real += dtReal;
    G.updateClock(dtReal);
    G.Q.sample(Math.min(1, rawDt));        // the true frame interval (dtReal is clamped for physics)
    const dtGame = paused ? 0 : dtReal * G.clock.scale;
    G.clock.game += dtGame;
    G.tickTimers();
    B.update(dtGame); B.updateOrbs(dtGame); updateTweens(dtGame);
    O.update(paused ? 0 : dtReal);
    const dtFx = paused ? 0 : dtReal * G.clock.slow;          // effects slow down with slow-motion, not with turbo
    FX.update(dtFx); FX.updateBolts(dtFx); FX.updateCam(dtReal); G.Seb.update(dtFx); G.Stats.update(dtReal);
    S.mood = S.mood < S.moodTarget ? Math.min(S.moodTarget, S.mood + dtReal * 0.6) : Math.max(S.moodTarget, S.mood - dtReal * 0.6);
    const hb = G.pointer ? hit(G.pointer.x, G.pointer.y) : null;
    G.hoverId = hb ? hb.id : null;
    G.canvas.style.cursor = hb && !hb.disabled ? 'pointer' : 'default';
    render(dtFx);
    requestAnimationFrame(frame);
  }

  function render(dt) {
    const W = G.W, Hh = G.H, cam = FX.cam, L = G.L;
    ctx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    L.buttons = [];
    const tx = cam.tilt.x, ty = cam.tilt.y;
    // background: slight overscan, counter-parallax and a gentler zoom = depth
    ctx.save();
    if (G.Q.level > 0) {        // at the lowest level the sky is a plain copy (no resampling)
      const bz = 1.04 + (cam.zoom + cam.push) * 0.35;
      ctx.translate(W / 2 - tx * 16 + cam.ox * 0.35, Hh / 2 - ty * 10 + cam.oy * 0.35); ctx.scale(bz, bz); ctx.translate(-W / 2, -Hh / 2);
    }
    Scene.draw(ctx, dt);
    ctx.restore();
    // world (shakes, zooms, pushes in, tilts); the bottom bar and overlays stay still
    ctx.save();
    const zc = cam.focus || { x: L.reel.x + L.reel.w / 2, y: L.reel.y + L.reel.h / 2 };
    const z = 1 + cam.zoom + cam.push;
    ctx.translate(cam.ox + tx * 7 + zc.x, cam.oy + ty * 5 + zc.y); ctx.scale(z, z); ctx.translate(-zc.x, -zc.y);
    G.worldInv = ctx.getTransform().inverse();
    G.Seb.draw(ctx);
    B.drawBack(ctx);
    B.drawCells(ctx, dt);
    FX.draw(ctx, 0);
    FX.drawBolts(ctx, 0);
    B.drawFront(ctx);
    H.drawLogo(ctx);
    H.drawLeft(ctx);
    H.drawPlaque(ctx);
    H.drawHint(ctx);
    FX.draw(ctx, 1);
    FX.drawBolts(ctx, 1);
    B.drawOrbs(ctx);
    G.Seb.drawBubble(ctx);
    ctx.restore();
    if (cam.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${cam.flashColor},${cam.flash * 0.45})`; ctx.fillRect(0, 0, W, Hh);
      ctx.globalCompositeOperation = 'source-over';
    }
    H.drawBottom(ctx);
    O.draw(ctx);
    FX.draw(ctx, 2);
    G.Stats.draw(ctx);
    if (G.clock.paused && S.started) {
      ctx.fillStyle = 'rgba(6,2,16,.6)'; ctx.fillRect(0, 0, W, Hh);
      G.goldText(ctx, 'PAUSED', W / 2, Hh / 2, Math.min(W, Hh) * 0.08);
    }
  }

  // ---------------- installable + offline ----------------
  // Only over https (or localhost): file:// can't use service workers, and the
  // manifest link is added here so opening the file from disk logs no errors.
  (function registerPwa() {
    if (!/^https?:$/.test(location.protocol) || /[?&]nosw\b/.test(location.search)) return;
    const link = document.createElement('link'); link.rel = 'manifest'; link.href = 'manifest.json';
    document.head.appendChild(link);
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (!('serviceWorker' in navigator) || (location.protocol === 'http:' && !local)) return;
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}));
  })();

  // ---------------- boot ----------------
  async function boot() {
    G.load();
    G.Q.applySetting();
    G.resize();
    const bar = document.getElementById('loadBar'), pct = document.getElementById('loadPct');
    let pAssets = 0, pFonts = 0;
    const show = () => { const v = Math.round((pAssets * 0.8 + pFonts * 0.2) * 100); bar.style.width = Math.max(3, v) + '%'; pct.textContent = v + '%'; };
    const fonts = document.fonts ? Promise.all([
      document.fonts.load(`900 40px Cinzel`), document.fonts.load(`700 40px Cinzel`),
      document.fonts.load(`800 20px Outfit`), document.fonts.load(`700 20px Outfit`), document.fonts.load(`500 20px Outfit`),
    ]).catch(() => {}).then(() => { pFonts = 1; show(); }) : Promise.resolve();
    const t0 = performance.now();
    await Promise.all([fonts, B.loadAssets(p => { pAssets = p; show(); })]);
    G.onLayout();
    B.setBoard(E.newBoard(Math.random, E.CONFIG.pScatterBase));
    G.UI.init();
    Game.applySettings();
    requestAnimationFrame(t => { last = t; frame(t); });
    const wait = 900 - (performance.now() - t0);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    document.getElementById('loader').classList.add('gone');
    const splash = document.getElementById('splash');
    splash.classList.add('show');
    document.getElementById('playBtn').addEventListener('click', () => {
      AudioEngine.resume();
      enableDeviceTilt();
      S.started = true;
      Game.applySettings();
      AudioEngine.play('whoosh');
      splash.classList.add('leaving');
      setTimeout(() => { splash.style.display = 'none'; }, 650);
      say('PLACE YOUR BET!');
      G.canvas.focus();
    }, { once: true });
  }
  boot();
})();

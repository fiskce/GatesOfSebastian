/* Gates of Sebastian — pure game engine (no DOM)
 *
 * Runs identically in the browser (window.Engine) and in Node (module.exports),
 * so the exact math the browser plays can be simulated over millions of spins
 * (see tools/sim.js). The browser replays the structured `steps` as animation;
 * the simulator only reads the totals. Both call evaluate(), so the payout the
 * player sees is, by construction, the payout the simulator measured.
 *
 * Model (Gates-of-Olympus style):
 *  - 6x5 grid, "pay anywhere": 8+ identical symbols anywhere on the grid win
 *  - Tumble: winners removed, survivors fall, new symbols drop, repeat
 *  - Multiplier orbs (2..500x) can land on any winning tumble step.
 *      Base game: the orbs landed this spin are summed and multiply this spin.
 *      Free spins: orb values add to a persistent multiplier that multiplies
 *      every winning spin for the rest of the feature.
 *  - 4+ scatters award 15 free spins; 3+ during the feature add +5
 *  - Ante Bet: +25% stake for a higher natural free-spins chance
 *  - Buy Free Spins: 100x stake
 *  - Max win 5,000x per round (base spin + any feature it triggers)
 */
(function (root, factory) {
  const Engine = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 6, ROWS = 5, CELLS = COLS * ROWS, MIN_CLUSTER = 8;
  const SCATTER = 'scatter';
  const MAX_WIN_X = 5000;
  const BUY_COST_X = 100, ANTE_COST = 1.25;

  // pays are x total bet for 8-9 / 10-11 / 12+ of a kind
  const SYMBOLS = {
    crown:   { pays: { 8: 10,   10: 25,   12: 50 } },
    ring:    { pays: { 8: 2.5,  10: 10,   12: 25 } },
    glass:   { pays: { 8: 2,    10: 5,    12: 15 } },
    chalice: { pays: { 8: 1.5,  10: 4,    12: 12 } },
    red:     { pays: { 8: 1,    10: 2,    12: 5 } },
    purple:  { pays: { 8: 0.8,  10: 1.5,  12: 4 } },
    green:   { pays: { 8: 0.5,  10: 1,    12: 3 } },
    blue:    { pays: { 8: 0.4,  10: 0.9,  12: 2.5 } },
    gold:    { pays: { 8: 0.25, 10: 0.75, 12: 2 } },
  };
  const PAY_ORDER = ['crown', 'ring', 'glass', 'chalice', 'red', 'purple', 'green', 'blue', 'gold'];

  // multiplier orb values with relative weights
  const ORB_TABLE = [
    [2, 28], [3, 22], [4, 16], [5, 13], [6, 9], [8, 7],
    [10, 5], [25, 3], [50, 1.6], [100, 0.8], [250, 0.28], [500, 0.10],
  ];
  const ORB_TOTAL_W = ORB_TABLE.reduce((a, x) => a + x[1], 0);

  const FS_AWARD = 15, FS_RETRIGGER = 5, SCATTERS_FS = 4, SCATTERS_RETRIG = 3;

  // Tuning knobs, calibrated with tools/sim.js (see README for the measured
  // numbers). pScatterFs is deliberately independent of the ante, so the
  // feature is worth the same however it was reached (natural, ante or buy).
  const CONFIG = {
    payScale: 1.00,
    pScatterBase: 0.0193,
    pScatterAnte: 0.0227,
    pScatterFs: 0.0205,
    baseOrbChance: 0.15,   // per winning tumble step (base game)
    fsOrbChance: 0.543,    // per winning tumble step (free spins)
    fsOrbDouble: 0.26,     // chance a spawning free-spins step drops a 2nd orb
    reelW: { crown: 6, ring: 8, glass: 10, chalice: 12, red: 14, purple: 15, green: 16, blue: 18, gold: 20 },
  };
  let REEL = [];
  function rebuildReel() {
    REEL = [];
    for (const k in CONFIG.reelW) for (let i = 0; i < CONFIG.reelW[k]; i++) REEL.push(k);
  }
  rebuildReel();
  function configure(patch) {
    Object.assign(CONFIG, patch);
    if (patch && patch.reelW) rebuildReel();
  }

  // ---- rng wrapper (injectable for deterministic tests / provably-fair streams) ----
  function makeRng(seed) {
    if (seed == null) return Math.random;
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  const idx = (r, c) => r * COLS + c;
  function pick(arr, rng) { return arr[(rng() * arr.length) | 0]; }
  function rollSymbol(rng, pScatter) { return rng() < pScatter ? SCATTER : pick(REEL, rng); }
  function rollOrbValue(rng) {
    let r = rng() * ORB_TOTAL_W;
    for (const [v, w] of ORB_TABLE) { if ((r -= w) < 0) return v; }
    return 2;
  }
  function pScatterFor(mode) {
    return mode === 'fs' ? CONFIG.pScatterFs : mode === 'ante' ? CONFIG.pScatterAnte : CONFIG.pScatterBase;
  }

  function newBoard(rng, pScatter) {
    const g = new Array(CELLS);
    for (let i = 0; i < CELLS; i++) g[i] = rollSymbol(rng, pScatter);
    return g;
  }

  function findWins(g) {
    const groups = {};
    for (let i = 0; i < CELLS; i++) {
      const s = g[i];
      if (s === SCATTER) continue;
      (groups[s] || (groups[s] = [])).push(i);
    }
    const wins = [];
    for (const s in groups) {
      const cells = groups[s];
      if (cells.length < MIN_CLUSTER) continue;
      const n = cells.length;
      const tier = n >= 12 ? 12 : n >= 10 ? 10 : 8;
      wins.push({ symbol: s, cells, count: n, payX: SYMBOLS[s].pays[tier] * CONFIG.payScale });
    }
    return wins;
  }

  function countScatters(g) {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (g[i] === SCATTER) n++;
    return n;
  }

  // gravity: remove winners, survivors fall, new symbols drop in
  function tumble(g, removeSet, rng, pScatter) {
    const out = new Array(CELLS);
    for (let c = 0; c < COLS; c++) {
      const survivors = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        const i = idx(r, c);
        if (!removeSet.has(i)) survivors.push(g[i]);
      }
      let k = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        out[idx(r, c)] = k < survivors.length ? survivors[k++] : rollSymbol(rng, pScatter);
      }
    }
    return out;
  }

  function spawnOrbs(g, removeSet, rng, inFreeSpins) {
    const chance = inFreeSpins ? CONFIG.fsOrbChance : CONFIG.baseOrbChance;
    if (rng() >= chance) return [];
    const count = inFreeSpins && rng() < CONFIG.fsOrbDouble ? 2 : 1;
    const free = [];
    for (let i = 0; i < CELLS; i++) if (g[i] !== SCATTER && !removeSet.has(i)) free.push(i);
    const orbs = [];
    for (let n = 0; n < count && free.length; n++) {
      const j = (rng() * free.length) | 0;
      const cell = free.splice(j, 1)[0];
      orbs.push({ cell, value: rollOrbValue(rng) });
    }
    return orbs;
  }

  /* Resolve ONE spin from a starting board: every tumble step, the orbs that
   * landed and the final board. Does not apply multipliers (see evaluate). */
  function resolveSpin(board, opts) {
    const rng = opts.rng, inFreeSpins = !!opts.inFreeSpins, pScatter = opts.pScatter;
    let g = board.slice();
    const steps = [];
    let tumbleWinX = 0;
    const orbValues = [];

    for (;;) {
      const wins = findWins(g);
      if (!wins.length) break;
      const removeSet = new Set();
      let stepWinX = 0;
      for (const w of wins) { stepWinX += w.payX; for (const c of w.cells) removeSet.add(c); }
      tumbleWinX += stepWinX;
      const orbs = spawnOrbs(g, removeSet, rng, inFreeSpins);
      for (const o of orbs) orbValues.push(o.value);
      const before = g;
      g = tumble(g, removeSet, rng, pScatter);
      steps.push({ board: before, wins, removeSet: [...removeSet], orbs, stepWinX, boardAfter: g });
    }
    return { steps, tumbleWinX, orbValues, finalBoard: g, scatters: countScatters(g) };
  }

  /* Apply the multiplier rules to a resolved spin. The ONE place payouts are
   * computed — used by the browser and the simulator alike. */
  function evaluate(res, inFreeSpins, persistentBefore) {
    let orbSum = 0;
    for (const v of res.orbValues) orbSum += v;
    let persistentAfter = persistentBefore || 0, mult;
    if (inFreeSpins) { persistentAfter += orbSum; mult = persistentAfter > 0 ? persistentAfter : 1; }
    else mult = orbSum > 0 ? orbSum : 1;
    return { orbSum, mult, winX: res.tumbleWinX * mult, persistentAfter };
  }

  /* One spin, start to finish: draws the board (or a bonus-buy board), resolves
   * it and evaluates it. mode: 'base' | 'ante' | 'fs'. */
  function playSpin(rng, mode, opts) {
    opts = opts || {};
    const inFreeSpins = mode === 'fs';
    const pScatter = pScatterFor(mode);
    let board = newBoard(rng, pScatter);
    if (opts.buy) board = plantScatters(board, SCATTERS_FS, rng);
    const res = resolveSpin(board, { rng, inFreeSpins, pScatter });
    const ev = evaluate(res, inFreeSpins, opts.persistent || 0);
    return { board, res, ev, pScatter };
  }

  /* A complete free-spins feature from 0 persistent multiplier (pure totals). */
  function playFeature(rng, capX) {
    let spins = FS_AWARD, persistent = 0, totalX = 0, played = 0, retriggers = 0;
    const cap = capX == null ? MAX_WIN_X : capX;
    while (spins > 0) {
      spins--; played++;
      const s = playSpin(rng, 'fs', { persistent });
      persistent = s.ev.persistentAfter;
      totalX += s.ev.winX;
      if (s.res.scatters >= SCATTERS_RETRIG) { spins += FS_RETRIGGER; retriggers++; }
      if (totalX >= cap) { totalX = cap; break; }
    }
    return { totalX, played, retriggers, persistent };
  }

  /* A complete round (one paid spin + any feature it triggers), in x bet units,
   * capped at MAX_WIN_X. opts: {rng, ante, buy} */
  function playRound(opts) {
    const rng = opts.rng || Math.random;
    const buy = !!(opts.buy || opts.forceBonus);
    const s = playSpin(rng, opts.ante && !buy ? 'ante' : 'base', { buy });
    let totalX = Math.min(s.ev.winX, MAX_WIN_X);
    const triggered = buy || s.res.scatters >= SCATTERS_FS;
    if (triggered && totalX < MAX_WIN_X) totalX += playFeature(rng, MAX_WIN_X - totalX).totalX;
    return Math.min(totalX, MAX_WIN_X);
  }

  // force at least n scatters onto a board (bonus buy)
  function plantScatters(g, n, rng) {
    g = g.slice();
    let have = countScatters(g);
    const spots = [];
    for (let i = 0; i < CELLS; i++) if (g[i] !== SCATTER) spots.push(i);
    while (have < n && spots.length) {
      const j = (rng() * spots.length) | 0;
      g[spots.splice(j, 1)[0]] = SCATTER;
      have++;
    }
    return g;
  }

  return {
    COLS, ROWS, CELLS, MIN_CLUSTER, SCATTER, MAX_WIN_X, BUY_COST_X, ANTE_COST,
    SYMBOLS, PAY_ORDER, FS_AWARD, FS_RETRIGGER, SCATTERS_FS, SCATTERS_RETRIG,
    ORB_TABLE, CONFIG, configure, pScatterFor,
    makeRng, newBoard, findWins, countScatters, tumble, spawnOrbs,
    resolveSpin, evaluate, playSpin, playFeature, playRound, plantScatters, idx,
  };
});

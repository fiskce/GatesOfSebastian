/* Thunder Hunter Sebastian — core: shared namespace, game clock, helpers, layout.
 *
 * Every script adds to the single GOS namespace (classic scripts, no build
 * step, works from file:// too). Animation waits run on a *game clock* rather
 * than setTimeout: turbo and slam-stop just speed the clock up, and pausing
 * freezes every pending wait in step with the animation.
 */
window.GOS = (() => {
  'use strict';
  const E = window.Engine;
  const G = { E, Music: window.GOSMusic, mode: 'demo' };

  // ---------------- canvas ----------------
  G.canvas = document.getElementById('game');
  G.ctx = G.canvas.getContext('2d');
  G.W = 0; G.H = 0; G.DPR = 1;

  // ---------------- clock ----------------
  // real: seconds since boot (ambient visuals). game: scaled, pausable (gameplay).
  // scale = pace (1 normal / 2 turbo / 3.5 slam) × slow (slow-motion dips).
  G.clock = { real: 0, game: 0, scale: 1, pace: 1, slow: 1, paused: false };
  let slowmo = null;
  G.setPace = pace => { G.clock.pace = pace; G.clock.scale = pace * G.clock.slow; };
  // turbo as saved, but only where the jurisdiction allows it (one browser can visit several)
  G.turboOn = () => !!G.settings.turbo && (!G.allow || G.allow('turbo'));
  // a finger, not a mouse: hit areas and spacing grow to touch size
  G.coarse = !!(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  // dip game time to `factor` almost instantly, then ease back to normal over realMs
  G.slowmo = (factor, realMs) => {
    if (G.clock.pace > 2) return;                       // slam-stop wins
    if (G.settings.reducedMotion) factor = Math.max(factor, 0.6);
    if (G.turboOn() || G.S.auto > 0) { factor = Math.max(factor, 0.55); realMs *= 0.5; }
    slowmo = { factor: Math.min(factor, G.clock.slow), t: 0, dur: realMs / 1000 };
  };
  G.cancelSlowmo = () => { slowmo = null; G.clock.slow = 1; G.clock.scale = G.clock.pace; };
  G.updateClock = dtReal => {
    if (slowmo) {
      slowmo.t += dtReal;
      const p = slowmo.t / slowmo.dur;
      G.clock.slow = p < 0.08 ? G.lerp(1, slowmo.factor, p / 0.08) : G.lerp(slowmo.factor, 1, Math.pow(G.clamp((p - 0.08) / 0.92, 0, 1), 2));
      if (p >= 1) { slowmo = null; G.clock.slow = 1; }
    }
    G.clock.scale = G.clock.pace * G.clock.slow;
  };
  const timers = [];
  G.wait = ms => new Promise(res => timers.push({ at: G.clock.game + ms / 1000, res }));
  G.tickTimers = () => {
    for (let i = timers.length - 1; i >= 0; i--) {
      if (G.clock.game >= timers[i].at) { const t = timers[i]; timers.splice(i, 1); t.res(); }
    }
  };
  // resolves on the first of: a game-time timeout, or G.skip() (tap / space)
  let skipWaiters = [];
  G.waitOrSkip = ms => new Promise(res => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    G.wait(ms).then(fin);
    skipWaiters.push(fin);
  });
  G.skip = () => { const w = skipWaiters; skipWaiters = []; w.forEach(f => f()); return w.length > 0; };

  // ---------------- springs ----------------
  // A damped spring stepped with real time, so a press feels the same at 60 and 120 Hz.
  // [angular frequency, damping ratio]; RELEASE overshoots by about 3%.
  G.SPRING = { HOVER: [18, 1], PRESS: [42, 0.9], RELEASE: [20, 0.75], KNOB: [26, 0.8], READOUT: [14, 1] };
  G.spring = (s, target, dt, preset) => {
    const w = preset[0], z = preset[1], h = Math.min(dt, 0.05) / 2;
    for (let k = 0; k < 2; k++) { s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * h; s.x += s.v * h; }
    return s.x;
  };

  // ---------------- math / easing ----------------
  G.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.rand = (a, b) => a + Math.random() * (b - a);
  G.ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inCubic: t => t * t * t,
    inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    outBack: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
  };

  // ---------------- wording ----------------
  G.T = window.GOS_STR.T;

  // ---------------- money ----------------
  // [symbol, symbol after the amount, decimals]. Social currencies read "10.00 SC".
  const CURRENCIES = {
    USD: ['$'], CAD: ['CA$'], MXN: ['MX$'], EUR: ['€'], GBP: ['£'], AUD: ['A$'], NZD: ['NZ$'], BRL: ['R$'], INR: ['₹'],
    JPY: ['¥', false, 0], KRW: ['₩', false, 0], IDR: ['Rp', false, 0], NGN: ['₦', false, 0], CNY: ['CN¥'], TRY: ['₺'],
    PHP: ['₱'], ZAR: ['R'], RUB: ['₽', true], CHF: ['CHF '], SEK: ['kr', true], NOK: ['kr', true], CZK: ['Kč', true],
    DKK: ['kr.', true], PLN: ['zł', true], VND: ['₫', true, 0], CLP: ['CLP', true, 0], ARS: ['ARS', true], PEN: ['S/', true],
    SAR: ['SAR', true], ILS: ['₪', true], AED: ['AED', true], TND: ['TND', true], OMR: ['OMR', true], QAR: ['QAR', true],
    XSC: ['SC', true], XEC: ['SC', true], XGC: ['GC', true],
  };
  G.currency = 'USD';
  G.setCurrency = code => { G.currency = String(code || 'USD').toUpperCase(); };
  function cur() {
    const c = CURRENCIES[G.currency];
    return c ? { sym: c[0], after: !!c[1], dec: c[2] == null ? 2 : c[2] } : { sym: G.currency, after: true, dec: 2 };
  }
  /* Every amount shows exactly the currency's own decimals (two for USD, none for JPY):
   * never three, so a sub-cent amount such as 3.025 reads $3.03. It is rounded to the
   * nearest unit, half away from zero, from whole micro-units so float noise can't tip it.
   * Only the display rounds: the balance and every win stay exact, as the RGS settles them. */
  G.countPlaces = () => cur().dec;
  G.countMoney = shown => G.money(shown);
  G.money = (n, places) => {
    const c = cur(), p = Math.min(places != null ? places : c.dec, c.dec);
    const u = Math.round(Math.abs(n) * 1e6), v = Math.round(u / Math.pow(10, 6 - p)) / Math.pow(10, p);
    const s = v.toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
    return (n < 0 && v > 0 ? '-' : '') + (c.after ? s + ' ' + c.sym : c.sym + s);
  };
  G.xfmt = n => (Math.round(n * 100) / 100).toLocaleString('en-US') + '×';

  // ---------------- fonts ----------------
  G.FONT_DISPLAY = '"Cinzel", Georgia, "Times New Roman", serif';
  G.FONT_UI = '"Outfit", "Segoe UI", Roboto, Arial, sans-serif';
  G.font = (size, weight, display) => `${weight || 700} ${Math.round(size)}px ${display ? G.FONT_DISPLAY : G.FONT_UI}`;

  // ---------------- palette ----------------
  G.SYMBOL_COLORS = {
    crown: '#ffd34d', ring: '#ff5fa2', glass: '#3ddc84', chalice: '#4aa8ff', red: '#ff3b3b',
    purple: '#b44dff', green: '#2ecc71', blue: '#2f8bff', gold: '#ffc22e', scatter: '#ff9d1c',
  };
  G.SYMBOL_NAMES = {
    crown: 'Crown', ring: 'Ring', glass: 'Hourglass', chalice: 'Chalice', red: 'Ruby',
    purple: 'Amethyst', green: 'Emerald', blue: 'Sapphire', gold: 'Topaz', scatter: 'Scatter',
  };
  G.orbTier = v => v >= 100 ? 3 : v >= 25 ? 2 : v >= 6 ? 1 : 0;
  G.ORB_COLORS = [   // [core, mid, rim, glow] per tier: green, blue, purple, red-gold
    ['#eaffd0', '#5ee36a', '#178a2c', '#7dff6a'],
    ['#dff4ff', '#4fb6ff', '#1046b8', '#6ac8ff'],
    ['#f6e2ff', '#c46bff', '#5a14a8', '#d68cff'],
    ['#fff4c4', '#ff7a2e', '#a3110a', '#ffb04a'],
  ];

  // ---------------- bets ----------------
  G.BET_STEPS = [0.20, 0.40, 0.60, 0.80, 1.00, 1.50, 2.00, 2.50, 5.00, 10.00, 20.00, 30.00, 50.00, 75.00, 100.00];
  G.START_CREDIT = 100000;

  // ---------------- state ----------------
  G.S = {
    credit: G.START_CREDIT, betIndex: 7, ante: false,
    busy: false, started: false,
    inFS: false, fsLeft: 0, fsPlayed: 0, fsTotal: 0, fsAward: 0, persistent: 0, roundWin: 0,
    spinMult: 0,           // orbs collected during the current base spin
    tumbleWin: 0, tumbleShown: 0, winDisplay: 0, lastWin: 0, cascade: 0,
    auto: 0, autoMenu: false,
    mood: 0, moodTarget: 0,  // 0 = base (dusk), 1 = free spins (golden storm)
    message: '', messageT: 0,
    history: [],
  };
  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  G.settings = { volume: 0.7, musicVol: 0.8, sfxVol: 0.85, music: true, sfx: true, turbo: false, reducedMotion: false, introSeen: false,
    quality: 'auto', tilt: false, haptics: touch, dynMusic: true };
  G.baseBet = () => G.BET_STEPS[G.S.betIndex];
  G.spinCost = () => G.baseBet() * (G.S.ante ? E.ANTE_COST : 1);
  G.buyCost = () => G.baseBet() * E.BUY_COST_X;

  // ---------------- persistence (best effort) ----------------
  // v9 has its own key; the first visit carries the v8/v7 balance and settings over.
  // Played through Stake (or replaying) only the settings are kept: the balance,
  // bet and mode always come from the RGS.
  const KEY = 'gos9', OLD_KEYS = ['gos8', 'gos7'];
  G.load = () => {
    try {
      let raw = localStorage.getItem(KEY);
      for (let k = 0; !raw && k < OLD_KEYS.length; k++) raw = localStorage.getItem(OLD_KEYS[k]);
      const d = JSON.parse(raw || 'null');
      if (!d) return;
      if (d.settings) Object.assign(G.settings, d.settings);
      if (G.mode !== 'demo') return;
      if (Number.isFinite(d.credit)) G.S.credit = d.credit;
      if (Number.isInteger(d.betIndex)) G.S.betIndex = G.clamp(d.betIndex, 0, G.BET_STEPS.length - 1);
      G.S.ante = !!d.ante;
    } catch (e) { /* storage unavailable */ }
  };
  G.save = () => {
    try {
      const d = G.mode === 'demo' ? { credit: G.S.credit, betIndex: G.S.betIndex, ante: G.S.ante, settings: G.settings } : { settings: G.settings };
      if (G.mode !== 'demo') { const old = JSON.parse(localStorage.getItem(KEY) || 'null'); if (old) Object.assign(old, d); localStorage.setItem(KEY, JSON.stringify(old || d)); }
      else localStorage.setItem(KEY, JSON.stringify(d));
    } catch (e) { /* storage unavailable */ }
  };
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) G.settings.reducedMotion = true;

  // ---------------- haptics ----------------
  G.haptic = pattern => {
    if (!G.settings.haptics || !navigator.vibrate || !G.S.started) return;
    try { navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
  };

  // ---------------- adaptive quality ----------------
  // level 2 = everything, 1 = trimmed, 0 = lean (weak phones / CPU-only canvas).
  // In 'auto' the frame time is sampled and the level steps down quickly when
  // frames run long, and back up slowly once they are comfortably fast.
  const Q = G.Q = { level: 2, fx: 1, dprCap: 2, onChange: null };
  const LEVELS = [{ fx: 0.4, dprCap: 1 }, { fx: 0.7, dprCap: 1.5 }, { fx: 1, dprCap: 2 }];
  const frameTimes = [];
  const drops = [0, 0, 0];          // a level dropped from twice is not tried again (stops see-sawing)
  let slowFor = 0, fastFor = 0, settleFor = 2;
  Q.set = level => {
    level = G.clamp(level, 0, 2);
    const changed = level !== Q.level;
    Q.level = level; Q.fx = LEVELS[level].fx; Q.dprCap = LEVELS[level].dprCap;
    slowFor = fastFor = 0; settleFor = 2; frameTimes.length = 0;
    if (changed && Q.onChange) Q.onChange(level);
  };
  Q.applySetting = () => {
    const m = G.settings.quality;
    Q.set(m === 'high' ? 2 : m === 'medium' ? 1 : m === 'low' ? 0 : Q.level);
  };
  Q.sample = dtReal => {
    // only judge the game itself: not while hidden, before PLAY or under a panel (their CSS blur is costly)
    if (G.settings.quality !== 'auto' || G.clock.paused || document.hidden || !G.S.started || (G.UI && G.UI.isOpen())) return;
    if (settleFor > 0) { settleFor -= dtReal; return; }      // ignore spikes right after boot/resize/rebuilds
    frameTimes.push(dtReal * 1000); if (frameTimes.length > 60) frameTimes.shift();
    if (frameTimes.length < 12) return;                    // ~0.2 s at 60 fps, ~3 s on a struggling device
    const med = frameTimes.slice().sort((a, b) => a - b)[frameTimes.length >> 1];
    // a healthy 60 Hz frame is 16.7 ms, 120 Hz is 8.3 ms
    if (med > 24) { slowFor += dtReal; fastFor = 0; } else if (med < 19) { fastFor += dtReal; slowFor = 0; } else { slowFor = fastFor = 0; }
    if (slowFor > 2 && Q.level > 0) { drops[Q.level]++; Q.set(Q.level - 1); }
    else if (fastFor > 10 && Q.level < 2 && drops[Q.level + 1] < 2) Q.set(Q.level + 1);
  };
  Q.settle = () => { settleFor = 2; frameTimes.length = 0; };

  // ---------------- layout ----------------
  // Recomputed on resize only. Board positions are stored in row units, so
  // anything mid-animation survives a resize.
  const { COLS, ROWS } = E;
  G.L = {};
  G.layout = () => {
    const W = G.W, H = G.H;
    G.L = W / H < 1.15 ? portrait(W, H) : (H < 330 || W < 560) ? compact(W, H) : landscape(W, H);
    G.L.buttons = [];
    if (G.onLayout) G.onLayout();
  };

  function gridFit(L, x, y, w, h) {
    // fit the 6x5 grid (with frame padding fp) into the box, centred
    const fp = L.fp;
    const gapR = 0.06;                       // gap as a fraction of a cell
    const cellW = (w - fp * 2) / (COLS + (COLS - 1) * gapR);
    const cellH = (h - fp * 2) / (ROWS + (ROWS - 1) * gapR);
    const cell = Math.max(16, Math.floor(Math.min(cellW, cellH)));
    const gap = Math.round(cell * gapR);
    const gridW = cell * COLS + gap * (COLS - 1), gridH = cell * ROWS + gap * (ROWS - 1);
    const fw = gridW + fp * 2, fh = gridH + fp * 2;
    const fx = Math.round(x + (w - fw) / 2), fy = Math.round(y + (h - fh) / 2);
    Object.assign(L, { cell, gap, gridW, gridH, gx: fx + fp, gy: fy + fp, reel: { x: fx, y: fy, w: fw, h: fh } });
  }

  function landscape(W, H) {
    const L = { portrait: false };
    const m = Math.min(W, H);
    L.pad = Math.max(8, m * 0.014);
    L.botH = Math.round(G.clamp(H * 0.11, 62, 104));
    L.topH = Math.round(G.clamp(H * 0.085, 40, 86));
    L.hintH = Math.round(G.clamp(H * 0.045, 22, 40));
    L.fp = Math.round(G.clamp(m * 0.022, 10, 24));
    const contentW = Math.min(W, 1640);
    const leftW = Math.round(G.clamp(contentW * 0.135, 120, 220));
    const sideGap = L.pad * 1.6;
    const bandY = L.topH, bandH = H - L.topH - L.botH - L.hintH;
    // the board is centred on screen: the same width is kept free on both sides
    // (left: buy / bet / multiplier panels; right: logo and Sebastian)
    const sideW = Math.max(leftW, Math.round(G.clamp(contentW * 0.2, 150, 330)));
    const maxGridW = contentW - (sideW + sideGap * 2) * 2;
    gridFit(L, W / 2 - maxGridW / 2, bandY, maxGridW, bandH);
    const r = L.reel;
    L.left = { x: r.x - sideGap - leftW, y: r.y, w: leftW, h: r.h };
    const rx = r.x + r.w + sideGap;
    L.right = { x: rx, y: 0, w: G.clamp(W - rx - L.pad, 80, 400), h: H - L.botH };
    L.bottom = { x: 0, y: H - L.botH, w: W, h: L.botH };
    L.hintY = r.y + r.h + L.hintH * 0.55;
    // left column: buy / bet+ante / multiplier collector
    const lp = L.left, g = L.pad;
    const buyH = Math.round(lp.h * 0.24), betH = Math.round(lp.h * 0.33);
    L.buy = { x: lp.x, y: lp.y, w: lp.w, h: buyH };
    L.bet = { x: lp.x, y: lp.y + buyH + g, w: lp.w, h: betH };
    const wellY = L.bet.y + betH + g, wellH = lp.y + lp.h - wellY;
    L.well = { x: lp.x, y: wellY, w: lp.w, h: wellH };
    // right column: logo on top, Sebastian on a cloud below
    const rp = L.right;
    L.logo = { x: rp.x, y: L.pad, w: rp.w, h: Math.min(rp.w * 0.42, H * 0.17) };
    const sebTop = L.logo.y + L.logo.h + L.pad;
    L.seb = { x: rp.x, y: sebTop, w: rp.w, h: H - L.botH - sebTop + L.botH * 0.12 };
    L.plaque = { cx: r.x + r.w / 2, y: L.topH * 0.5 };
    return L;
  }

  // short landscape windows (down to 400x225): no logo, no Sebastian, no hint line;
  // buy + bet on the left, the multiplier on the right, one slim bottom bar
  function compact(W, H) {
    const L = { portrait: false, compact: true, noLogo: true, noSeb: true, noHint: true };
    L.pad = 4;
    L.botH = Math.round(G.clamp(H * 0.2, 40, 60));
    L.topH = Math.round(G.clamp(H * 0.11, 20, 32));
    L.hintH = 0;
    L.fp = Math.round(G.clamp(H * 0.025, 4, 10));
    const sideW = Math.round(G.clamp(W * 0.2, 74, 150)), gap = 6;
    const bandY = L.topH, bandH = H - L.topH - L.botH - 4;
    gridFit(L, sideW + gap * 2, bandY, W - (sideW + gap * 2) * 2, bandH);
    const r = L.reel;
    const top = r.y, colH = r.h;
    L.left = { x: r.x - gap - sideW, y: top, w: sideW, h: colH };
    const buyH = Math.round(colH * 0.42);
    L.buy = { x: L.left.x, y: top, w: sideW, h: buyH };
    L.bet = { x: L.left.x, y: top + buyH + gap, w: sideW, h: colH - buyH - gap };
    L.well = { x: r.x + r.w + gap, y: top, w: sideW, h: colH };
    L.right = L.well;
    L.seb = L.well;
    L.logo = { x: 0, y: 0, w: 1, h: 1 };
    L.bottom = { x: 0, y: H - L.botH, w: W, h: L.botH };
    L.hintY = H;
    L.plaque = { cx: r.x + r.w / 2, y: L.topH * 0.5 };
    return L;
  }

  function portrait(W, H) {
    const L = { portrait: true };
    const m = Math.min(W, H);
    L.pad = Math.max(6, m * 0.016);
    L.botH = Math.round(G.clamp(H * 0.15, 96, 150));
    L.fp = Math.round(G.clamp(W * 0.026, 8, 18));
    const panelH = Math.round(G.clamp(H * 0.085, 54, 92));
    L.hintH = Math.round(G.clamp(H * 0.032, 18, 30));
    const side = Math.max(6, W * 0.025);
    // the board takes the full width; whatever height is left goes to the
    // header (logo + Sebastian), then to even spacing
    const below = L.botH + panelH + L.hintH + L.pad;
    const gapR = 0.06;
    const cellW = (W - side * 2 - L.fp * 2) / (COLS + (COLS - 1) * gapR);
    const frameH = cellW * (ROWS + (ROWS - 1) * gapR) + L.fp * 2;
    const rest = H - below - frameH;
    const headH = Math.round(G.clamp(rest, 84, W * 0.66));
    const spare = Math.max(0, rest - headH);
    const boardTop = headH + spare * 0.35, boardBot = H - below - spare * 0.65;
    gridFit(L, side, boardTop, W - side * 2, boardBot - boardTop);
    L.topH = headH;
    const r = L.reel;
    L.hintY = r.y + r.h + L.hintH * 0.55;
    const py = r.y + r.h + L.hintH + spare * 0.3;
    const pw = Math.min(W - side * 2, r.w), px = (W - pw) / 2, g = L.pad;
    const wBuy = pw * 0.33, wBet = pw * 0.37, wWell = pw - wBuy - wBet - g * 2;
    L.buy = { x: px, y: py, w: wBuy, h: panelH };
    L.bet = { x: px + wBuy + g, y: py, w: wBet, h: panelH };
    L.well = { x: px + wBuy + wBet + g * 2, y: py, w: wWell, h: panelH };
    L.bottom = { x: 0, y: H - L.botH, w: W, h: L.botH };
    const logoH = Math.min(headH * 0.6, W * 0.3);
    L.logo = { x: side, y: L.pad * 0.6 + Math.max(0, headH * 0.6 - logoH) * 0.35, w: W * 0.6, h: logoH };
    L.seb = { x: W * 0.58, y: L.pad, w: W * 0.42, h: headH + L.fp * 0.4 - L.pad };
    L.right = L.seb;
    const below2 = L.logo.y + L.logo.h;
    L.plaque = { cx: W * 0.3 + side * 0.5, y: below2 + Math.max(18, (headH - below2) * 0.45) };
    return L;
  }

  // row/col -> screen (row may be fractional while falling)
  G.cellX = c => G.L.gx + c * (G.L.cell + G.L.gap);
  G.cellY = r => G.L.gy + r * (G.L.cell + G.L.gap);
  G.cellCenter = i => ({ x: G.cellX(i % COLS) + G.L.cell / 2, y: G.cellY(Math.floor(i / COLS)) + G.L.cell / 2 });

  G.resize = () => {
    G.DPR = Math.min(window.devicePixelRatio || 1, G.Q.dprCap);
    G.Q.settle();
    G.W = G.canvas.clientWidth; G.H = G.canvas.clientHeight;
    G.canvas.width = Math.round(G.W * G.DPR); G.canvas.height = Math.round(G.H * G.DPR);
    G.ctx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
    G.layout();
  };

  // offscreen canvas helper (sized in CSS px, backed at DPR)
  G.offscreen = (w, h, dpr) => {
    const c = document.createElement('canvas');
    const d = dpr || G.DPR;
    c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d));
    const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0);
    return { c, x, w, h };
  };

  G.roundRect = (ctx, x, y, w, h, r) => {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };

  // soft additive halo (much cheaper than shadowBlur on large animated text)
  const haloCache = {};
  function haloSprite(color) {
    if (haloCache[color]) return haloCache[color];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color); g.addColorStop(0.55, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return (haloCache[color] = c);
  }

  /* Fixed-advance digits: every digit takes the width of the widest one, so a
   * number that counts or changes never jitters sideways. Returns the char
   * centres (from the left edge) and the total width at the current font. */
  function tabular(ctx, text) {
    let dw = 0;
    for (let d = 0; d <= 9; d++) dw = Math.max(dw, ctx.measureText(String(d)).width);
    const xs = []; let w = 0;
    for (const ch of text) { const cw = ch >= '0' && ch <= '9' ? dw : ctx.measureText(ch).width; xs.push(w + cw / 2); w += cw; }
    return { xs, w };
  }
  function drawTabular(ctx, text, x, y, align, draw) {
    const t = tabular(ctx, text), left = align === 'left' ? x : align === 'right' ? x - t.w : x - t.w / 2;
    ctx.textAlign = 'center';
    let i = 0;
    for (const ch of text) draw(ch, left + t.xs[i++], y);
    ctx.textAlign = align;
  }
  const textW = (ctx, text, tab) => tab ? tabular(ctx, text).w : ctx.measureText(text).width;

  // gold text with dark outline + glow; size is shrunk to fit maxW
  G.goldText = (ctx, text, x, y, size, opts) => {
    opts = opts || {};
    const display = opts.display !== false;
    ctx.font = G.font(size, opts.weight || 900, display);
    if (opts.maxW) {
      const w = textW(ctx, text, opts.tabular);
      if (w > opts.maxW) { size *= opts.maxW / w; ctx.font = G.font(size, opts.weight || 900, display); }
    }
    ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'middle';
    const top = y - size * 0.55, bot = y + size * 0.45;
    const gr = ctx.createLinearGradient(0, top, 0, bot);
    const stops = opts.colors || ['#fffbe0', '#ffe27a', '#f4b62a', '#c47d0e', '#ffd75e'];
    stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
    ctx.lineJoin = 'round';
    if (opts.glow) {
      const w = textW(ctx, text, opts.tabular), al = ctx.textAlign;
      const cx = al === 'left' ? x + w / 2 : al === 'right' ? x - w / 2 : x;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.55;
      ctx.drawImage(haloSprite(opts.glow), cx - w * 0.62 - size * 0.4, y - size * 0.95, w * 1.24 + size * 0.8, size * 1.9);
      ctx.restore();
    }
    ctx.lineWidth = Math.max(2, size * (opts.stroke || 0.14));
    ctx.strokeStyle = opts.strokeColor || '#3a1d03';
    ctx.fillStyle = gr;
    if (opts.tabular) {
      drawTabular(ctx, text, x, y, opts.align || 'center', (ch, cx, cy) => ctx.strokeText(ch, cx, cy));
      drawTabular(ctx, text, x, y, opts.align || 'center', (ch, cx, cy) => ctx.fillText(ch, cx, cy));
    } else { ctx.strokeText(text, x, y); ctx.fillText(text, x, y); }
    return size;
  };

  // plain text helper
  G.text = (ctx, t, x, y, size, color, opts) => {
    opts = opts || {};
    ctx.font = G.font(size, opts.weight || 700, opts.display);
    if (opts.maxW) {
      const w = textW(ctx, t, opts.tabular);
      if (w > opts.maxW) { size = Math.max(opts.min || 6, size * opts.maxW / w); ctx.font = G.font(size, opts.weight || 700, opts.display); }
    }
    ctx.textAlign = opts.align || 'center'; ctx.textBaseline = opts.baseline || 'middle';
    if (opts.shadow) { ctx.save(); ctx.shadowColor = opts.shadow; ctx.shadowBlur = opts.blur || 6; ctx.shadowOffsetY = opts.offY || 1; }
    ctx.fillStyle = color;
    if (opts.tabular) drawTabular(ctx, t, x, y, opts.align || 'center', (ch, cx, cy) => ctx.fillText(ch, cx, cy));
    else ctx.fillText(t, x, y);
    if (opts.shadow) ctx.restore();
    return size;
  };

  return G;
})();

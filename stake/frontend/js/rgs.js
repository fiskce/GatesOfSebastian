/* Thunder Hunter Sebastian — Stake Engine RGS client.
 *
 * The launch URL decides how the game runs:
 *   replay=true    replays one past bet from /bet/replay; no wallet at all
 *   sessionID=…    real play through the RGS wallet (rgs_url). If the RGS
 *                  can't be reached the game stops with an error; it never
 *                  falls back to the demo
 *   neither        the local demo (fiskce.com): local balance, outcomes from
 *                  the provably-fair stream, exactly as before. The Stake
 *                  package (js/build.js target 'stake') has no demo: without a
 *                  session it says so and stops
 *
 * Amounts on the wire are integers in millionths of the currency. Book
 * payoutMultiplier values are hundredths of the base bet; the RGS reports a
 * round's payoutMultiplier as a plain multiple of the base bet.
 *
 * Rounds from the RGS carry their book's events in round.state; each spin
 * event is rebuilt by Engine.expandSpin and animated by the same code as a
 * demo spin (see game.js, eventSource below).
 */
(() => {
  'use strict';
  const G = window.GOS, E = G.E, S = G.S, STR = window.GOS_STR, T = G.T;
  const q = new URLSearchParams(location.search);
  const API = 1e6;
  const R = G.RGS = {};

  const STAKE_BUILD = (window.GOS_BUILD || {}).target === 'stake';
  G.mode = q.get('replay') === 'true' ? 'replay' : q.get('sessionID') || STAKE_BUILD ? 'rgs' : 'demo';
  R.sessionID = q.get('sessionID') || '';
  R.lang = (q.get('lang') || 'en').slice(0, 8);
  R.device = q.get('device') || '';
  R.base = normalize(q.get('rgs_url'));
  R.flags = {};
  if (q.get('currency')) G.setCurrency(q.get('currency'));
  else if (G.mode === 'replay' && STR.social) G.setCurrency('XSC');

  // "rgs.example.com" -> "https://rgs.example.com"; localhost gets http
  function normalize(u) {
    if (!u) return null;
    u = u.trim();
    if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(u) ? 'http://' : 'https://') + u;
    try { const x = new URL(u); return (x.origin + x.pathname).replace(/\/+$/, ''); } catch (e) { return null; }
  }
  R.normalize = normalize;

  // ---------------- requests ----------------
  class RgsError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }
  R.Error = RgsError;
  async function call(path, body, timeoutMs) {
    if (!R.base) throw new RgsError('NO_RGS');
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), timeoutMs || 15000);
    let res;
    try {
      res = await fetch(R.base + path, body === undefined
        ? { signal: ctl && ctl.signal, cache: 'no-store' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl && ctl.signal, cache: 'no-store' });
    } catch (e) {
      throw new RgsError(e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || (data && typeof data.error === 'string' && data.error)) {
      throw new RgsError((data && (data.error || data.code)) || (res.status >= 500 ? 'ERR_GEN' : 'HTTP_' + res.status), data && data.message);
    }
    if (!data) throw new RgsError('ERR_GEN', 'empty response');
    return data;
  }
  // safe to repeat (they don't move money): retried with backoff on transient failures
  const transient = e => /^(NETWORK|TIMEOUT|ERR_GEN|ERR_MAINTENANCE)$/.test(e.code);
  async function retry(fn, tries) {
    let delay = 1000;
    for (let k = 1; ; k++) {
      try { return await fn(); } catch (e) {
        if (k >= (tries || 4) || !transient(e)) throw e;
        await new Promise(r => setTimeout(r, delay)); delay *= 2;
      }
    }
  }

  // ---------------- wallet ----------------
  function applyBalance(b) {
    if (!b || !Number.isFinite(+b.amount)) return;
    if (b.currency) G.setCurrency(b.currency);
    R.balanceMicro = Math.round(+b.amount);
    S.credit = R.balanceMicro / API;
  }
  // bet levels: the configured list filtered to min/max/step, or one built from them
  function betLevels(cfg) {
    const n = v => (v == null || v === '' ? NaN : Number(v));
    const min = n(cfg.minBet), max = n(cfg.maxBet), step = n(cfg.stepBet);
    let levels = Array.isArray(cfg.betLevels) ? cfg.betLevels.map(Number).filter(v => Number.isSafeInteger(v) && v > 0) : [];
    if (!levels.length && min > 0 && max >= min && step > 0) for (let v = min; v <= max && levels.length < 500; v += step) levels.push(v);
    levels = [...new Set(levels.filter(v => !(v < min) && !(v > max) && !(step > 0 && v % step !== 0)))].sort((a, b) => a - b);
    if (!levels.length) throw new RgsError('ERR_VAL', 'no usable bet levels');
    // defaultBetLevel: an amount in the list, else an index into it, else the nearest level below it
    const def = n(cfg.defaultBetLevel);
    let i = levels.indexOf(def);
    if (i < 0 && Number.isInteger(def) && def >= 0 && def < levels.length) i = def;
    if (i < 0) { i = 0; levels.forEach((v, k) => { if (v <= def) i = k; }); }
    return { levels, index: i };
  }
  R.betLevels = betLevels;
  function useLevels(levels, index) {
    G.BET_MICRO = levels.slice();
    G.BET_STEPS = levels.map(v => v / API);
    S.betIndex = G.clamp(index, 0, levels.length - 1);
  }
  G.betMicro = () => (G.BET_MICRO ? G.BET_MICRO[S.betIndex] : Math.round(G.baseBet() * API));
  // what a round costs in this mode, in millionths, worked out in integers
  const COST100 = { base: 100, ante: Math.round(E.ANTE_COST * 100), bonus: E.BUY_COST_X * 100 };
  R.costMicro = (mode, amount) => (amount * COST100[mode]) / 100;

  const authenticate = () => {
    if (!R.sessionID) return Promise.reject(new RgsError('NO_RGS'));
    return retry(() => call('/wallet/authenticate', { sessionID: R.sessionID, language: R.lang }), 3);
  };
  R.authenticate = async () => {
    const d = await authenticate();
    applyBalance(d.balance);
    const cfg = d.config || {};
    const { levels, index } = betLevels(cfg);
    useLevels(levels, index);
    // a refresh keeps the bet [187]: the open (or last) round's bet, else the one this player last chose here
    const keep = micro => { const k = levels.indexOf(Math.round(+micro)); if (k >= 0) S.betIndex = k; return k >= 0; };
    const saved = G.settings.lastBet && G.settings.lastBet[G.currency];
    if (!(d.round && keep(d.round.amount))) keep(saved);
    R.flags = cfg.jurisdiction || {};
    if (R.flags.socialCasino || STR.socialCurrency(G.currency)) STR.setSocial(true);
    R.active = d.round && d.round.active === true ? d.round : null;
    R.session = { t0: Date.now(), betMicro: 0, wonMicro: 0, pending: null };
    return d;
  };
  // where things stand after a lost answer: the balance, and the round the RGS has (open or last), if any.
  // Bet levels and flags are left as they are.
  R.status = async () => {
    const d = await authenticate();
    applyBalance(d.balance);
    return d.round || null;
  };
  // never retried: if the answer is lost the RGS may already have charged the bet
  R.play = async (mode, amount) => {
    const d = await call('/wallet/play', { sessionID: R.sessionID, amount, mode });
    applyBalance(d.balance);
    if (!d.round) throw new RgsError('ERR_GEN', 'no round in the response');
    return d.round;
  };
  // A lost answer may still have settled the round: if a retry is refused, ask the RGS. A round it no
  // longer holds open was settled, and the balance it reports is the settled one.
  R.endRound = async () => {
    try {
      const d = await retry(() => call('/wallet/end-round', { sessionID: R.sessionID }));
      applyBalance(d.balance); return d;
    } catch (e) {
      let r;
      try { r = await R.status(); } catch (e2) { throw e; }
      if (r && r.active === true) throw e;
      return { settled: true };
    }
  };
  R.refreshBalance = async () => { const d = await retry(() => call('/wallet/balance', { sessionID: R.sessionID }), 2); applyBalance(d.balance); return d; };

  // a round's book events (the RGS may hand state over as a JSON string)
  R.eventsOf = round => {
    let st = round && round.state;
    if (typeof st === 'string') { try { st = JSON.parse(st); } catch (e) { st = null; } }
    if (st && !Array.isArray(st) && Array.isArray(st.events)) st = st.events;
    if (!Array.isArray(st)) throw new RgsError('ERR_STATE', 'round has no events');
    return st;
  };

  // ---------------- replay ----------------
  R.replay = {
    game: q.get('game') || '', version: q.get('version') || '', mode: (q.get('mode') || '').toLowerCase(), event: q.get('event') || '',
  };
  // the bet: millionths like every RGS amount; a plain decimal ("1.5") is read as currency
  (() => {
    const a = q.get('amount');
    let micro = a && /^\d+$/.test(a) ? +a : a && /^\d*\.\d+$/.test(a) ? Math.round(+a * API) : 0;
    if (!(micro > 0)) micro = API;
    R.replay.amount = micro;
  })();
  // the modes this game publishes (index.json); a replay of anything else can't be shown
  R.modes = () => Object.keys((window.GOS_MATH && GOS_MATH.modes) || { base: 1, ante: 1, bonus: 1 });
  R.fetchReplay = async () => {
    const p = R.replay, enc = encodeURIComponent;
    if (!R.base || !p.game || !p.version || !p.event || R.modes().indexOf(p.mode) < 0) throw new RgsError('REPLAY_PARAMS');
    let d;
    try { d = await retry(() => call(`/bet/replay/${enc(p.game)}/${enc(p.version)}/${enc(p.mode)}/${enc(p.event)}`), 3); }
    catch (e) { throw /^(NOT_FOUND|HTTP_404)$/.test(e.code) ? new RgsError('REPLAY_NOT_FOUND') : e; }
    const events = R.eventsOf(d);
    R.checkRound(events, d.payoutMultiplier);
    return { payoutMultiplier: +d.payoutMultiplier || 0, costMultiplier: +d.costMultiplier || null, events };
  };

  /* A round's events must add up: every spin rebuilds through Engine.expandSpin (which checks the
   * board, the wins and the orbs), their wins sum to the final win and to the round's payout. The
   * payout is read as a plain multiple of the bet, or as hundredths of it (book units), whichever the
   * RGS sends. Throws ERR_STATE if anything disagrees. */
  R.checkRound = (events, payout) => {
    let persistent = 0, sum = 0, fin = null;
    try {
      for (const e of events) {
        if (!e) continue;
        if (e.type === 'spin') {
          const out = E.expandSpin(JSON.parse(JSON.stringify(e)), e.mode === 'fs' ? persistent : 0);
          if (e.mode === 'fs') persistent = out.ev.persistentAfter;
          sum += e.win;
        } else if (e.type === 'finalWin') fin = e.win;
      }
    } catch (err) { throw new RgsError('ERR_STATE', err.message); }
    const pm = +payout;
    const ok = (fin == null || fin === sum) && (payout == null || payout === '' || !Number.isFinite(pm) || Math.round(pm * 100) === sum || Math.round(pm) === sum);
    if (!ok) throw new RgsError('ERR_STATE', 'the round does not add up');
    return sum;
  };

  // ---------------- what a mode allows ----------------
  G.allow = what => {
    const f = R.flags || {};
    switch (what) {
      case 'buy': return G.mode !== 'replay' && !f.disabledBuyFeature;
      case 'ante': case 'bet': return G.mode !== 'replay';
      case 'auto': return G.mode !== 'replay' && !f.disabledAutoplay;
      case 'turbo': return G.mode !== 'replay' && !f.disabledTurbo;
      case 'slam': return !f.disabledSlamstop;
      case 'space': return !f.disabledSpacebar;
      case 'fullscreen': return !f.disabledFullscreen;
      case 'fair': case 'stats': case 'resetBalance': return G.mode === 'demo';
      case 'balance': return G.mode !== 'replay';
      // regulated markets: what the RGS asks the game to show (net position, RTP, session time)
      case 'net': return G.mode === 'rgs' && !!f.displayNetPosition;
      case 'rtp': return G.mode === 'rgs' && !!f.displayRTP;
      case 'timer': return G.mode === 'rgs' && !!f.displaySessionTimer;
      case 'superTurbo': return !f.disabledSuperTurbo;        // read for completeness: the game has no super turbo
      default: return true;
    }
  };
  // jurisdictions can set a minimum round length (milliseconds; small numbers are read as seconds)
  R.minRoundMs = () => {
    const v = +(R.flags || {}).minimumRoundDuration || 0;
    return v > 0 && v < 100 ? v * 1000 : v;
  };

  // ---------------- spin sources ----------------
  // A round's spins as the game asks for them, rebuilt from book events.
  R.eventSource = events => {
    const spins = events.filter(e => e && e.type === 'spin');
    let i = 0;
    return {
      next(mode, o) {
        const e = spins[i++];
        if (!e) throw new RgsError('ERR_STATE', 'the round ran out of spins');
        const out = E.expandSpin(e, e.mode === 'fs' ? o.persistent : 0);
        return { out, winX100: e.win, capped: !!e.capped };
      },
      hasNext: () => i < spins.length,
      left: () => spins.length - i,
    };
  };

  // ---------------- error wording ----------------
  R.message = e => {
    const c = (e && e.code) || 'ERR_GEN';
    const k = {
      ERR_IPB: 'errIPB', ERR_GLE: 'errGLE', ERR_IS: 'errSession', ERR_ATE: 'errSession', ERR_LOC: 'errLoc', ERR_VAL: 'errVal',
      ERR_MAINTENANCE: 'errMaint', NETWORK: 'errNet', TIMEOUT: 'errNet', NO_RGS: 'errNoRgs',
      ERR_STATE: G.mode === 'replay' ? 'errReplayState' : 'errState', RECOVERED: 'errNetRecovered',
      REPLAY_PARAMS: 'errReplayParams', REPLAY_NOT_FOUND: 'errReplayNotFound',
    }[c] || 'errGen';
    return T(k) + (k === 'errGen' ? ' (' + c + ')' : '');
  };
})();

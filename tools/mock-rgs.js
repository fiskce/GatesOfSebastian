#!/usr/bin/env node
/* Thunder Hunter Sebastian — a local stand-in for Stake Engine's RGS.
 *
 * Serves the game and plays the books exported by tools/export-math.js, so the
 * whole Stake flow can be tried and tested without Stake:
 *
 *   node tools/mock-rgs.js                    # http://localhost:8125
 *   open http://localhost:8125/?sessionID=demo1&rgs_url=localhost:8125
 *   replay: http://localhost:8125/?replay=true&rgs_url=localhost:8125&game=ths&version=1&mode=bonus&event=12&amount=1000000
 *
 *   --port 8125   --math math/   --balance 1000000000 (millionths)   --currency USD
 *   --root <dir>  the static files to serve (default: the repo; e.g. stake/frontend for the package)
 *
 * Wallet API (JSON over POST, amounts in millionths, CORS open):
 *   /wallet/authenticate {sessionID, language} -> {balance, config, round}
 *   /wallet/balance      {sessionID}           -> {balance}
 *   /wallet/play         {sessionID, amount, mode} -> {balance, round}
 *                        picks a book by weight; a round that pays nothing is
 *                        closed at once, any other stays active until end-round
 *   /wallet/end-round    {sessionID}           -> {balance}   (refused with no active round)
 *   /bet/event           {sessionID, event}    -> {event}
 *   GET /bet/replay/{game}/{version}/{mode}/{event} -> {payoutMultiplier, costMultiplier, state}
 *     (event = book id)
 *
 * Test switches (this mock only):
 *   POST /mock/session {sessionID, balance?, currency?, betLevels?, minBet?, maxBet?, stepBet?,
 *                       defaultBetLevel?, jurisdiction?, force?: {mode: id}, fail?: {path, code, status, after}}
 *        fail.after = true applies the request and then fails the response (a lost answer);
 *        fail.drop = true (with after) applies it and then drops the connection with no answer at all
 *   GET  /mock/log      every API call so far;  POST /mock/reset  forget everything
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const A = (() => {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return o;
})();
const ROOT = path.resolve(A.root || path.join(__dirname, '..'));
const PORT = +A.port || 8125;
const MATH = path.resolve(A.math || path.join(__dirname, '..', 'math'));
const START_BALANCE = +A.balance || 1000e6;
const CURRENCY = A.currency || 'USD';
const LEVELS = [100000, 200000, 400000, 600000, 800000, 1000000, 1500000, 2000000, 2500000, 5000000, 10000000, 20000000, 50000000, 100000000];

// ---------------- the math ----------------
const index = JSON.parse(fs.readFileSync(path.join(MATH, 'index.json'), 'utf8'));
const MODES = {};
for (const m of index.modes) {
  const rows = fs.readFileSync(path.join(MATH, m.weights), 'utf8').trim().split('\n').map(l => l.split(',').map(Number));
  const books = zlib.zstdDecompressSync(fs.readFileSync(path.join(MATH, m.events))).toString().trim().split('\n');
  const cum = []; let total = 0;
  for (const [, w] of rows) { total += w; cum.push(total); }
  MODES[m.name] = { cost: m.cost, rows, books, cum, total };
  console.log(`mode ${m.name}: ${books.length} books, cost ${m.cost}`);
}
function pick(mode) {
  const M = MODES[mode], r = Math.random() * M.total;
  let lo = 0, hi = M.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (M.cum[mid] > r) hi = mid; else lo = mid + 1; }
  return lo + 1;
}
const book = (mode, id) => JSON.parse(MODES[mode].books[id - 1]);

// ---------------- sessions ----------------
let sessions = {}, log = [], betSeq = 1;
function session(id) {
  if (!sessions[id]) sessions[id] = { balance: START_BALANCE, currency: CURRENCY, round: null, force: {}, fail: null, cfg: {} };
  return sessions[id];
}
class ApiError extends Error { constructor(code, msg, status) { super(msg || code); this.code = code; this.status = status || 400; } }
const bal = s => ({ amount: s.balance, currency: s.currency });

const api = {
  '/wallet/authenticate': (b, s) => {
    const levels = s.cfg.betLevels || LEVELS;
    return {
      balance: bal(s),
      config: {
        minBet: s.cfg.minBet != null ? s.cfg.minBet : levels[0], maxBet: s.cfg.maxBet != null ? s.cfg.maxBet : levels[levels.length - 1],
        stepBet: s.cfg.stepBet != null ? s.cfg.stepBet : 10000, defaultBetLevel: s.cfg.defaultBetLevel != null ? s.cfg.defaultBetLevel : 1000000,
        betLevels: levels,
        jurisdiction: Object.assign({ socialCasino: /^(XSC|XGC|XEC)$/.test(s.currency) }, s.cfg.jurisdiction || {}),
      },
      round: s.round || null,          // the open round, or the last one (inactive), as Stake's RGS does
    };
  },
  '/wallet/balance': (b, s) => ({ balance: bal(s) }),
  '/wallet/play': (b, s) => {
    const M = MODES[b.mode];
    if (!M) throw new ApiError('ERR_VAL', 'unknown mode ' + b.mode);
    const levels = s.cfg.betLevels || LEVELS;
    if (!Number.isSafeInteger(b.amount) || !levels.includes(b.amount)) throw new ApiError('ERR_VAL', 'invalid bet amount ' + b.amount);
    if (s.round && s.round.active) throw new ApiError('ERR_VAL', 'a round is still active');
    const cost = Math.round(b.amount * M.cost);
    if (s.balance < cost) throw new ApiError('ERR_IPB', 'insufficient balance');
    const id = s.force[b.mode] || pick(b.mode);
    const bk = book(b.mode, id);
    s.balance -= cost;
    const payout = Math.round(b.amount * bk.payoutMultiplier / 100);
    s.round = { betID: betSeq++, amount: b.amount, payout, payoutMultiplier: bk.payoutMultiplier / 100, costMultiplier: M.cost,
      active: payout > 0, mode: b.mode, event: null, state: bk.events, bookID: id };
    return { balance: bal(s), round: s.round };
  },
  '/wallet/end-round': (b, s) => {
    if (!s.round || !s.round.active) throw new ApiError('ERR_VAL', 'no active round');
    s.balance += s.round.payout; s.round.active = false;
    return { balance: bal(s) };
  },
  '/bet/event': (b, s) => { if (s.round) s.round.event = b.event; return { event: b.event }; },
};

// ---------------- server ----------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.txt': 'text/plain' };
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function serveFile(req, res, p) {
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(f).size, type = TYPES[path.extname(f)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const s = m[1] ? +m[1] : size - +m[2], e = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(f, { start: s, end: e }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
    res.end(); return;
  }
  // replay
  const rp = /^\/bet\/replay\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(p);
  if (rp && req.method === 'GET') {
    log.push({ path: '/bet/replay', mode: rp[3], event: rp[4], t: Date.now() });
    const M = MODES[rp[3]], id = +rp[4];
    if (!M || !(id >= 1 && id <= M.books.length)) return send(res, 404, { error: 'NOT_FOUND', message: 'no such event' });
    const bk = book(rp[3], id);
    return send(res, 200, { payoutMultiplier: bk.payoutMultiplier / 100, costMultiplier: M.cost, state: bk.events });
  }
  if (p === '/mock/log') return send(res, 200, log);
  if (req.method !== 'POST' || !(api[p] || p.startsWith('/mock/'))) return serveFile(req, res, p);
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    let b;
    try { b = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { error: 'ERR_VAL', message: 'bad JSON' }); }
    if (p === '/mock/reset') { sessions = {}; log = []; return send(res, 200, { ok: true }); }
    if (p === '/mock/session') {
      const s = session(b.sessionID);
      if (b.balance != null) s.balance = b.balance;
      if (b.currency) s.currency = b.currency;
      for (const k of ['betLevels', 'minBet', 'maxBet', 'stepBet', 'defaultBetLevel', 'jurisdiction']) if (b[k] !== undefined) s.cfg[k] = b[k];
      if (b.force) s.force = b.force;
      if (b.fail !== undefined) s.fail = b.fail;
      return send(res, 200, { ok: true });
    }
    log.push({ path: p, body: b, t: Date.now() });
    if (!b.sessionID) return send(res, 400, { error: 'ERR_IS', message: 'missing sessionID' });
    const s = session(b.sessionID);
    const fail = s.fail && s.fail.path === p ? s.fail : null;
    if (fail) s.fail = null;
    if (fail && !fail.after) return send(res, fail.status || 500, { error: fail.code || 'ERR_GEN', message: 'injected' });
    try {
      const out = api[p](b, s);
      if (fail && fail.drop) return req.socket.destroy();
      if (fail) return send(res, fail.status || 500, { error: fail.code || 'ERR_GEN', message: 'injected after applying' });
      send(res, 200, out);
    } catch (e) {
      if (e instanceof ApiError) send(res, e.status, { error: e.code, message: e.message });
      else { console.error(e); send(res, 500, { error: 'ERR_GEN', message: String(e) }); }
    }
  });
}).listen(PORT, () => console.log(`mock RGS + game on http://localhost:${PORT}/?sessionID=demo1&rgs_url=localhost:${PORT}`));

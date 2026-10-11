#!/usr/bin/env node
/* Thunder Hunter Sebastian — Stake Engine math export
 *
 * Plays the exact engine the browser uses (js/engine.js) and writes the files
 * Stake Engine's RGS serves rounds from, plus the numbers the in-game rules
 * show:
 *
 *   math/index.json                  the modes, their cost and their files
 *   math/lookUpTable_<mode>_0.csv    id,weight,payoutMultiplier per book (no header)
 *   math/books_<mode>.jsonl.zst      one round per line:
 *                                    {id, payoutMultiplier, events, criteria, baseGameWins, freeGameWins}
 *   math/summary.json                what was generated and what it measures
 *   js/math-info.js                  RTP, max win and cost per mode for the rules
 *
 *   node tools/export-math.js                     # default sizes, a few minutes on 4 cores
 *   node tools/export-math.js --scale 4           # 4x the books per bucket
 *   node tools/export-math.js --scale 0.02 --out /tmp/math --no-info   # tiny export for tests
 *
 * payoutMultiplier is in hundredths of the base bet (1250 = 12.5x), the same
 * in every mode; a mode's cost is what the RGS charges per base bet (1, 1.25,
 * 100). The client animates a book from its events: each `spin` event holds
 * the board, the board after every tumble and the orbs that landed, which
 * Engine.expandSpin turns back into exactly what playSpin returned.
 *
 * Books are sampled in buckets ("criteria"), like Stake's math SDK does:
 *   0          rounds that pay nothing
 *   basegame   rounds that pay without free spins
 *   freegame   rounds with free spins (every bonus-mode round)
 *   wincap     rounds that reach the 5,000x max win (found by search, so the
 *              max win is in every mode's table)
 * Each bucket gets its natural probability, measured while sampling, shared
 * evenly by its books. Then one group's weight is scaled so the RTP comes out
 * at exactly the target: the 0 bucket in base and ante, and the books under
 * 20x in the bonus mode, which has almost no 0x rounds.
 *
 * Every book has its own random stream (a hash of mode, job and index), so
 * any book can be regenerated on its own. The samples are the same for a
 * given --workers count; the max-win search keeps whatever the workers find
 * first, which varies a little from run to run.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));

const TARGET_RTP = 0.965;
const MODES = {
  base:  { cost: 1,               opts: {} },
  ante:  { cost: E.ANTE_COST,     opts: { ante: true } },
  bonus: { cost: E.BUY_COST_X,    opts: { buy: true } },
};
const MAX_X100 = E.MAX_WIN_X * 100;
const WEIGHT_SCALE = 1e15;              // total weight of a mode before the RTP adjustment (< 2^53)

// ---------------- random streams ----------------
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rngFor(tag, i) {
  let x = (fnv(tag) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  const sm = () => {
    x = (x + 0x9e3779b9) | 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = sm(), b = sm(), c = sm(), d = sm();
  const next = () => {                    // sfc32
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let k = 0; k < 12; k++) next();
  return next;
}

// ---------------- worker ----------------
function classify(r, mode) {
  const pm = Math.round(r.totalX * 100);
  if (pm >= MAX_X100) return 'wincap';
  if (mode === 'bonus' || r.feature) return 'freegame';
  return pm > 0 ? 'basegame' : '0';
}
function bookOf(r) {
  const ev = E.roundEvents(r);
  return { pm: ev.payoutX100, base: ev.baseX100, fs: ev.fsX100, events: JSON.stringify(ev.events) };
}
function work({ job, mode, quotas, rounds, shared, w, W }) {
  const opts = MODES[mode].opts;
  const counts = { '0': 0, basegame: 0, freegame: 0, wincap: 0, triggered: 0 };
  const kept = { '0': [], basegame: [], freegame: [], wincap: [] };
  let attempts = 0;
  const tag = mode + ':' + job;
  // 'caprate' only counts; the others keep books until every quota is met
  // (and 'sample' also keeps any max-win round it meets on the way)
  // 'wincap' searches until all workers together have found enough (a shared counter)
  const found = shared ? new Int32Array(shared) : null;
  const done = rounds ? () => attempts >= rounds
    : found ? () => Atomics.load(found, 0) >= quotas.wincap
    : () => Object.keys(quotas).every(k => kept[k].length >= quotas[k]);
  for (let i = w; !done(); i += W) {
    const r = E.playRoundDetailed({ rng: rngFor(tag, i), ...opts });
    attempts++;
    const c = classify(r, mode);
    counts[c]++;
    if (r.triggered) counts.triggered++;
    if (rounds) continue;
    if (found) { if (c === 'wincap') { kept.wincap.push(Object.assign(bookOf(r), { stream: i })); Atomics.add(found, 0, 1); } continue; }
    if ((quotas[c] != null && kept[c].length < quotas[c]) || (c === 'wincap' && job === 'sample')) kept[c].push(Object.assign(bookOf(r), { stream: i }));
  }
  return { attempts, counts, kept };
}
if (!isMainThread) { parentPort.postMessage(work(workerData)); return; }

// ---------------- main ----------------
function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return o;
}
const A = args();
const root = path.join(__dirname, '..');
const OUT = path.resolve(A.out || path.join(root, 'math'));
const WORKERS = Math.max(1, +A.workers || Math.min(8, os.cpus().length));
const SCALE = +A.scale || 1;
const LEVEL = +A.level || 19;
const q = n => Math.max(1, Math.round(n * SCALE));
const SIZES = {
  base:  { '0': q(20000), basegame: q(60000), freegame: q(15000), wincap: Math.max(2, Math.round(6 * Math.min(1, SCALE * 4))) },
  ante:  { '0': q(20000), basegame: q(60000), freegame: q(15000), wincap: Math.max(2, Math.round(6 * Math.min(1, SCALE * 4))) },
  bonus: { freegame: q(30000), wincap: Math.max(2, Math.round(16 * Math.min(1, SCALE * 4))) },
};
const CAPRATE_ROUNDS = q(200000);       // extra bonus rounds, only to measure how often a feature hits the cap
const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...m);

function runJob(job, mode, quotas, rounds) {
  const per = {};
  const shared = job === 'wincap' ? new SharedArrayBuffer(4) : null;
  for (const k in quotas) per[k] = shared ? quotas[k] : Math.ceil(quotas[k] / WORKERS);
  return Promise.all(Array.from({ length: WORKERS }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(__filename, { workerData: { job, mode, quotas: per, rounds: rounds && Math.ceil(rounds / WORKERS), shared, w, W: WORKERS } });
    wk.on('message', res); wk.on('error', rej);
  }))).then(parts => {
    const out = { attempts: 0, counts: {}, kept: {} };
    for (const p of parts) {
      out.attempts += p.attempts;
      for (const k in p.counts) out.counts[k] = (out.counts[k] || 0) + p.counts[k];
      for (const k in p.kept) (out.kept[k] = out.kept[k] || []).push(...p.kept[k]);
    }
    // a stable order whatever order the workers finished in
    for (const k in out.kept) { out.kept[k].sort((a, b) => a.stream - b.stream); if (quotas[k] != null && !shared) out.kept[k].length = Math.min(out.kept[k].length, quotas[k]); }
    return out;
  });
}

// spread each bucket's probability evenly across its books, then scale the
// adjustable group so the RTP is exactly the target
function weigh(mode, buckets, probs) {
  const cost = MODES[mode].cost, target = TARGET_RTP * cost * 100;     // mean payoutMultiplier we want
  const books = [];
  for (const crit of ['0', 'basegame', 'freegame', 'wincap']) {
    const list = buckets[crit] || [];
    if (!list.length || !probs[crit]) continue;
    const w = probs[crit] * WEIGHT_SCALE / list.length;
    for (const b of list) books.push(Object.assign(b, { criteria: crit, weight: w }));
  }
  const adjustable = mode === 'bonus' ? b => b.pm < 2000 && b.criteria !== 'wincap' : b => b.criteria === '0';
  let aw = 0, ap = 0, rw = 0, rp = 0;
  for (const b of books) { if (adjustable(b)) { aw += b.weight; ap += b.weight * b.pm; } else { rw += b.weight; rp += b.weight * b.pm; } }
  const k = (rp - target * rw) / (target * aw - ap);
  if (!(k > 0) || !isFinite(k)) throw new Error(`${mode}: cannot reach ${TARGET_RTP * 100}% by re-weighting (k=${k})`);
  for (const b of books) { if (adjustable(b)) b.weight *= k; b.weight = Math.max(1, Math.round(b.weight)); }
  return { books, k };
}

function stats(mode, books) {
  let W = 0n, P = 0n, hitW = 0n, maxPm = 0;
  for (const b of books) {
    const w = BigInt(b.weight);
    W += w; P += w * BigInt(b.pm);
    if (b.pm > 0) hitW += w;
    if (b.pm > maxPm) maxPm = b.pm;
  }
  // RTP = mean payout / cost, in percent, to 6 decimals
  const rtp = Number((P * 100000000n) / (W * BigInt(Math.round(MODES[mode].cost * 100)))) / 1e6;
  return { rtp, hitRate: Number((hitW * 1000000n) / W) / 1e6, maxWinX: maxPm / 100, totalWeight: W.toString() };
}

function write(mode, books) {
  const csv = [], lines = [];
  books.forEach((b, i) => {
    const id = i + 1;
    csv.push(`${id},${b.weight},${b.pm}`);
    lines.push(`{"id":${id},"payoutMultiplier":${b.pm},"events":${b.events},"criteria":"${b.criteria}","baseGameWins":${b.base / 100},"freeGameWins":${b.fs / 100}}`);
  });
  const csvFile = `lookUpTable_${mode}_0.csv`, booksFile = `books_${mode}.jsonl.zst`;
  fs.writeFileSync(path.join(OUT, csvFile), csv.join('\n') + '\n');
  const raw = Buffer.from(lines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, booksFile), zlib.zstdCompressSync(raw, { params: { [zlib.constants.ZSTD_c_compressionLevel]: LEVEL } }));
  return { csvFile, booksFile, rawBytes: raw.length };
}

// read everything back from disk and check it: ids, weights, payouts, events
function verify(mode, expected) {
  const csv = fs.readFileSync(path.join(OUT, `lookUpTable_${mode}_0.csv`), 'utf8').trim().split('\n').map(l => l.split(',').map(Number));
  const lines = zlib.zstdDecompressSync(fs.readFileSync(path.join(OUT, `books_${mode}.jsonl.zst`))).toString().trim().split('\n');
  if (csv.length !== lines.length) throw new Error(mode + ': CSV and books differ in length');
  let maxPm = 0;
  lines.forEach((line, i) => {
    const b = JSON.parse(line), [id, w, pm] = csv[i];
    if (b.id !== i + 1 || id !== b.id || pm !== b.payoutMultiplier || !(w >= 1) || !Number.isSafeInteger(w)) throw new Error(`${mode}: book ${i + 1} does not match its CSV row`);
    if (Math.round((b.baseGameWins + b.freeGameWins) * 100) !== pm) throw new Error(`${mode}: book ${b.id} wins do not add up`);
    let persistent = 0, sum = 0;
    b.events.forEach((e, k) => {
      if (e.index !== k) throw new Error(`${mode}: book ${b.id} event index`);
      if (e.type !== 'spin') return;
      const out = E.expandSpin(e, e.mode === 'fs' ? persistent : 0);
      if (e.mode === 'fs') persistent = out.ev.persistentAfter;
      sum += e.win;
    });
    const fin = b.events[b.events.length - 1];
    if (sum !== pm || fin.type !== 'finalWin' || fin.win !== pm) throw new Error(`${mode}: book ${b.id} events do not add up to its payout`);
    if (mode === 'bonus' && !b.events.some(e => e.type === 'freeSpinsTrigger') && pm < MAX_X100) throw new Error(`${mode}: book ${b.id} has no free spins`);
    if (pm > maxPm) maxPm = pm;
  });
  if (maxPm !== MAX_X100) throw new Error(`${mode}: no book reaches the max win`);
  const st = stats(mode, csv.map(([, w, pm]) => ({ weight: w, pm })));
  if (Math.abs(st.rtp - expected.rtp) > 1e-9 || Math.abs(st.rtp - TARGET_RTP * 100) > 0.001) throw new Error(`${mode}: RTP read back as ${st.rtp}`);
  return lines.length;
}

(async () => {
  const want = (A.modes ? String(A.modes).split(',') : Object.keys(MODES));
  fs.mkdirSync(OUT, { recursive: true });
  log(`exporting ${want.join(', ')} to ${OUT} with ${WORKERS} workers (scale ${SCALE})`);

  // how often a free-spins feature reaches the cap (measured on bonus rounds)
  // (every bonus round played counts, including the max-win search's)
  const bonusSample = await runJob('sample', 'bonus', { freegame: SIZES.bonus.freegame });
  const capRun = await runJob('caprate', 'bonus', {}, CAPRATE_ROUNDS);
  const bonusSearch = await runJob('wincap', 'bonus', { wincap: SIZES.bonus.wincap });
  const capped = bonusSample.counts.wincap + capRun.counts.wincap + bonusSearch.counts.wincap;
  const features = bonusSample.attempts + capRun.attempts + bonusSearch.attempts;
  const qCap = capped / features;
  log(`feature cap rate: ${capped} in ${features} bonus rounds (1 in ${Math.round(1 / qCap).toLocaleString()})`);

  const index = { modes: [] }, summary = { generated: new Date().toISOString(), targetRtp: TARGET_RTP * 100, scale: SCALE, workers: WORKERS, featureCapRate: qCap, modes: {} };
  const info = {};
  for (const mode of want) {
    const sizes = SIZES[mode];
    let sample, probs;
    if (mode === 'bonus') {
      sample = bonusSample;
      probs = { freegame: 1 - qCap, wincap: qCap };
    } else {
      sample = await runJob('sample', mode, { '0': sizes['0'], basegame: sizes.basegame, freegame: sizes.freegame });
      const n = sample.attempts, pTrig = sample.counts.triggered / n, pCap = pTrig * qCap;
      probs = { '0': sample.counts['0'] / n, basegame: sample.counts.basegame / n, freegame: Math.max(0, sample.counts.freegame / n + sample.counts.wincap / n - pCap), wincap: pCap };
      log(`${mode}: ${n.toLocaleString()} rounds sampled, free spins 1 in ${Math.round(1 / pTrig)}`);
    }
    // the max-win bucket: natural capped rounds from the sample plus a search
    const search = mode === 'bonus' ? bonusSearch : await runJob('wincap', mode, { wincap: sizes.wincap });
    log(`${mode}: ${search.kept.wincap.length} max-win rounds found in ${search.attempts.toLocaleString()} searched`);
    const buckets = {
      '0': sample.kept['0'] || [], basegame: sample.kept.basegame || [], freegame: sample.kept.freegame || [],
      wincap: [...(sample.kept.wincap || []), ...search.kept.wincap],
    };
    const { books, k } = weigh(mode, buckets, probs);
    const st = stats(mode, books);
    const files = write(mode, books);
    const n = verify(mode, st);
    log(`${mode}: ${n.toLocaleString()} books, RTP ${st.rtp.toFixed(4)}%, hit rate ${(st.hitRate * 100).toFixed(2)}%, max ${st.maxWinX}x, re-weight ${k.toFixed(4)}`);
    index.modes.push({ name: mode, cost: MODES[mode].cost, events: files.booksFile, weights: files.csvFile });
    summary.modes[mode] = { cost: MODES[mode].cost, books: n, buckets: Object.fromEntries(Object.entries(buckets).map(([c, l]) => [c, l.length])),
      probabilities: probs, reweight: k, ...st, rawBookBytes: files.rawBytes,
      bytes: { books: fs.statSync(path.join(OUT, files.booksFile)).size, weights: fs.statSync(path.join(OUT, files.csvFile)).size } };
    info[mode] = { cost: MODES[mode].cost, rtp: +st.rtp.toFixed(2), maxWinX: st.maxWinX };
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (!A['no-info'] && want.length === Object.keys(MODES).length) {
    fs.writeFileSync(path.join(root, 'js', 'math-info.js'),
      '/* Generated by tools/export-math.js from the published Stake math. Do not edit. */\n' +
      'window.GOS_MATH = ' + JSON.stringify({ targetRtp: TARGET_RTP * 100, maxWinX: E.MAX_WIN_X, modes: info }, null, 2) + ';\n');
    log('wrote js/math-info.js');
  }
  log('done');
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Thunder Hunter Sebastian — RTP simulator
 *
 * Plays the exact engine the browser uses (js/engine.js) headlessly.
 *
 *   node tools/sim.js                 # decomposed RTP for base / ante / buy
 *   node tools/sim.js --spins 4e6 --features 3e5 --workers 8
 *   node tools/sim.js --rounds 2e6    # also run full rounds (hit rate, spread)
 *
 * A high-volatility game needs an enormous number of full rounds before its
 * average settles, so RTP is measured in parts instead:
 *
 *   RTP(mode) = ( B(mode) + p(mode) * F ) / cost(mode)
 *
 *   B  mean base-spin return (no feature)     — low variance, cheap to pin down
 *   p  natural free-spins trigger rate          — a simple proportion
 *   F  mean value of one 15-spin feature        — measured from many features
 *
 * The 5,000x cap is applied per feature here, which is what playRound does in
 * practice (a base spin worth enough to collide with it is vanishingly rare).
 */
'use strict';
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return o;
}

// ---------------- worker ----------------
function work({ job, n, seed, config }) {
  if (config) E.configure(config);
  const rng = E.makeRng(seed);
  if (job === 'base' || job === 'ante') {
    let sum = 0, sq = 0, trig = 0, hits = 0;
    for (let i = 0; i < n; i++) {
      const s = E.playSpin(rng, job);
      const x = Math.min(s.ev.winX, E.MAX_WIN_X);
      sum += x; sq += x * x; if (x > 0) hits++;
      if (s.res.scatters >= E.SCATTERS_FS) trig++;
    }
    return { n, sum, sq, trig, hits };
  }
  if (job === 'buyspin') {
    let sum = 0, sq = 0;
    for (let i = 0; i < n; i++) { const x = Math.min(E.playSpin(rng, 'base', { buy: true }).ev.winX, E.MAX_WIN_X); sum += x; sq += x * x; }
    return { n, sum, sq };
  }
  if (job === 'feature') {
    let sum = 0, sq = 0, spins = 0, retr = 0, capped = 0, zero = 0;
    const buckets = [0, 0, 0, 0, 0, 0];               // <20, <50, <100, <250, <1000, >=1000
    for (let i = 0; i < n; i++) {
      const f = E.playFeature(rng);
      const x = f.totalX;
      sum += x; sq += x * x; spins += f.played; retr += f.retriggers;
      if (x >= E.MAX_WIN_X) capped++;
      if (x === 0) zero++;
      buckets[x < 20 ? 0 : x < 50 ? 1 : x < 100 ? 2 : x < 250 ? 3 : x < 1000 ? 4 : 5]++;
    }
    return { n, sum, sq, spins, retr, capped, zero, buckets };
  }
  if (job === 'round' || job === 'roundAnte') {
    let sum = 0, sq = 0, hits = 0, x100 = 0, max = 0;
    for (let i = 0; i < n; i++) {
      const x = E.playRound({ rng, ante: job === 'roundAnte' });
      sum += x; sq += x * x; if (x > 0) hits++; if (x >= 100) x100++; if (x > max) max = x;
    }
    return { n, sum, sq, hits, x100, max };
  }
  throw new Error('unknown job ' + job);
}

if (!isMainThread) { parentPort.postMessage(work(workerData)); return; }

// ---------------- main ----------------
function merge(parts) {
  const out = {};
  for (const p of parts) for (const k in p) {
    if (Array.isArray(p[k])) out[k] = (out[k] || p[k].map(() => 0)).map((v, i) => v + p[k][i]);
    else if (k === 'max') out[k] = Math.max(out[k] || 0, p[k]);
    else out[k] = (out[k] || 0) + p[k];
  }
  return out;
}
function run(job, total, workers, seed, config) {
  const per = Math.ceil(total / workers);
  return Promise.all(Array.from({ length: workers }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(__filename, { workerData: { job, n: per, seed: (seed + w * 7919) >>> 0, config } });
    wk.on('message', res); wk.on('error', rej);
  }))).then(merge);
}
const mean = r => r.sum / r.n;
const sd = r => Math.sqrt(Math.max(0, r.sq / r.n - mean(r) ** 2));
const se = r => sd(r) / Math.sqrt(r.n);
const pct = (x, d = 2) => (100 * x).toFixed(d) + '%';

async function measure(o) {
  const workers = +o.workers || Math.max(1, os.cpus().length);
  const spins = +o.spins || 2e6, features = +o.features || 1.5e5, seed = +o.seed || 20261011;
  const config = o.config ? JSON.parse(o.config) : null;
  if (config) E.configure(config);
  const [base, ante, buyspin, feat] = await Promise.all([
    run('base', spins, workers, seed, config),
    run('ante', spins, workers, seed + 1, config),
    run('buyspin', Math.min(spins, 5e5), workers, seed + 2, config),
    run('feature', features, workers, seed + 3, config),
  ]);
  const F = mean(feat), Fse = se(feat);
  const pB = base.trig / base.n, pA = ante.trig / ante.n;
  const rtpBase = mean(base) + pB * F;
  const rtpAnte = (mean(ante) + pA * F) / E.ANTE_COST;
  const rtpBuy = (mean(buyspin) + F) / E.BUY_COST_X;
  // rough standard errors (independent parts)
  const seBase = Math.sqrt(se(base) ** 2 + (pB * Fse) ** 2 + (F * Math.sqrt(pB * (1 - pB) / base.n)) ** 2);
  const seAnte = Math.sqrt(se(ante) ** 2 + (pA * Fse) ** 2 + (F * Math.sqrt(pA * (1 - pA) / ante.n)) ** 2) / E.ANTE_COST;
  const seBuy = Math.sqrt(se(buyspin) ** 2 + Fse ** 2) / E.BUY_COST_X;
  return { base, ante, buyspin, feat, F, Fse, pB, pA, rtpBase, rtpAnte, rtpBuy, seBase, seAnte, seBuy };
}

async function main() {
  const o = args();
  const t0 = Date.now();
  const m = await measure(o);
  const f = m.feat;
  if (o.json) { console.log(JSON.stringify({ rtpBase: m.rtpBase, rtpAnte: m.rtpAnte, rtpBuy: m.rtpBuy, F: m.F, pB: m.pB, pA: m.pA, B: mean(m.base), BA: mean(m.ante), Bbuy: mean(m.buyspin), seBase: m.seBase, seAnte: m.seAnte, seBuy: m.seBuy })); return; }
  console.log(`Thunder Hunter Sebastian — engine simulation (${m.base.n.toLocaleString()} base spins, ${f.n.toLocaleString()} features)\n`);
  console.log('Components');
  console.log(`  base-spin return   B      ${mean(m.base).toFixed(4)}x   (ante board ${mean(m.ante).toFixed(4)}x)`);
  console.log(`  base hit frequency        ${pct(m.base.hits / m.base.n)}`);
  console.log(`  free-spins trigger p      1 in ${(1 / m.pB).toFixed(0)}   (ante 1 in ${(1 / m.pA).toFixed(0)}, ${(m.pA / m.pB).toFixed(2)}x)`);
  console.log(`  feature value      F      ${m.F.toFixed(2)}x ± ${m.Fse.toFixed(2)}   (avg ${(f.spins / f.n).toFixed(1)} spins, ${(f.retr / f.n).toFixed(2)} retriggers per feature)`);
  console.log(`  feature spread            <20x ${pct(f.buckets[0] / f.n, 1)} · 20-50x ${pct(f.buckets[1] / f.n, 1)} · 50-100x ${pct(f.buckets[2] / f.n, 1)} · 100-250x ${pct(f.buckets[3] / f.n, 1)} · 250-1000x ${pct(f.buckets[4] / f.n, 1)} · 1000x+ ${pct(f.buckets[5] / f.n, 2)} · max-win ${pct(f.capped / f.n, 3)}`);
  console.log('\nReturn to player');
  console.log(`  Base game          ${pct(m.rtpBase)} ± ${pct(m.seBase)}   (feature share ${pct(m.pB * m.F / m.rtpBase, 1)})`);
  console.log(`  Ante (1.25x stake) ${pct(m.rtpAnte)} ± ${pct(m.seAnte)}`);
  console.log(`  Buy (100x stake)   ${pct(m.rtpBuy)} ± ${pct(m.seBuy)}`);
  if (o.rounds) {
    const workers = +o.workers || Math.max(1, os.cpus().length);
    const r = await run('round', +o.rounds, workers, 4242);
    console.log(`\nFull rounds (${r.n.toLocaleString()}): RTP ${pct(mean(r))} ± ${pct(se(r))} · hit ${pct(r.hits / r.n)} · σ ${sd(r).toFixed(1)}x · 100x+ ${pct(r.x100 / r.n, 3)} · max ${r.max.toFixed(0)}x`);
  }
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
main().catch(e => { console.error(e); process.exit(1); });

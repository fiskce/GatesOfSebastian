#!/usr/bin/env node
/* Quick self-checks: provably-fair crypto matches Node's, streams are
 * deterministic, and the engine's invariants hold. Run: node tools/test.js */
'use strict';
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const PF = require(path.join(__dirname, '..', 'js', 'fair.js'));
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));

let n = 0;
const pending = [];
const pass = name => { n++; console.log('  ok  ' + name); };
// a check may return a promise: it is counted when it settles, and a failure fails the run
const ok = (name, fn) => { const r = fn(); if (r && r.then) pending.push(r.then(() => pass(name), e => { e.message = name + ': ' + e.message; throw e; })); else pass(name); };

ok('SHA-256 matches node:crypto', () => {
  for (const msg of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'q'.repeat(1000)]) {
    assert.strictEqual(PF._hex(PF._sha256(PF._bytes(msg))), crypto.createHash('sha256').update(msg).digest('hex'));
  }
});
ok('HMAC-SHA256 matches node:crypto', () => {
  for (const [k, m] of [['key', 'msg'], ['a'.repeat(100), 'b'], ['', '']]) {
    assert.strictEqual(PF._hex(PF._hmac(PF._bytes(k), PF._bytes(m))), crypto.createHmac('sha256', k).update(m).digest('hex'));
  }
});
ok('commitment hash is SHA-256 of the revealed seed', () => {
  const h = PF.serverHash, seed = PF.rotate();
  assert.strictEqual(crypto.createHash('sha256').update(seed).digest('hex'), h);
});
ok('spin streams are deterministic per (server, client, nonce)', () => {
  const s = 'ab'.repeat(32);
  const a = PF.makeStream(s, 'client', 7), b = PF.makeStream(s, 'client', 7), c = PF.makeStream(s, 'client', 8);
  const xa = Array.from({ length: 50 }, a), xb = Array.from({ length: 50 }, b), xc = Array.from({ length: 50 }, c);
  assert.deepStrictEqual(xa, xb); assert.notDeepStrictEqual(xa, xc);
  assert.ok(xa.every(v => v >= 0 && v < 1));
});
ok('same stream replays the same spin', () => {
  const s = 'cd'.repeat(32);
  const r1 = E.playSpin(PF.makeStream(s, 'c', 3), 'base'), r2 = E.playSpin(PF.makeStream(s, 'c', 3), 'base');
  assert.deepStrictEqual(r1.board, r2.board); assert.strictEqual(r1.ev.winX, r2.ev.winX);
});
ok('engine invariants over 20k spins', () => {
  const rng = E.makeRng(1);
  for (let i = 0; i < 20000; i++) {
    const mode = ['base', 'ante', 'fs'][i % 3];
    const s = E.playSpin(rng, mode, { persistent: i % 5 });
    for (const st of s.res.steps) {
      for (const w of st.wins) assert.ok(w.count >= E.MIN_CLUSTER && w.cells.every(c => st.board[c] === w.symbol));
      for (const o of st.orbs) assert.ok(!st.removeSet.includes(o.cell) && st.board[o.cell] !== E.SCATTER);
    }
    assert.ok(E.findWins(s.res.finalBoard).length === 0);
    assert.ok(s.ev.winX >= 0 && Number.isFinite(s.ev.winX));
  }
});
ok('bonus buy always plants 4+ scatters', () => {
  const rng = E.makeRng(2);
  for (let i = 0; i < 5000; i++) assert.ok(E.countScatters(E.playSpin(rng, 'base', { buy: true }).board) >= E.SCATTERS_FS);
});
ok('rounds never exceed the max win', () => {
  const rng = E.makeRng(3);
  for (let i = 0; i < 3000; i++) assert.ok(E.playRound({ rng, buy: true }) <= E.MAX_WIN_X);
});
ok('payout math is unchanged (fingerprint of 5,000 spins, recorded from v10.2)', () => {
  const h = crypto.createHash('sha256');
  for (const mode of ['base', 'ante', 'fs']) for (let s = 1; s <= 1500; s++) {
    const o = E.playSpin(E.makeRng(s), mode, { persistent: mode === 'fs' ? s % 7 : 0 });
    h.update(mode + s + o.board.join('') + o.ev.winX.toFixed(6) + o.res.scatters + o.ev.persistentAfter);
  }
  for (let s = 1; s <= 500; s++) { const o = E.playSpin(E.makeRng(s), 'base', { buy: true }); h.update('buy' + s + o.board.join('') + o.ev.winX.toFixed(6)); }
  assert.strictEqual(h.digest('hex'), '13e8e19b997598b46bbddfc32f66b25920a0c30481368e38557792122b245df9');
});
ok('every pay is a whole number of tenths of the bet (Stake accepts payouts in 0.1x steps)', () => {
  assert.strictEqual(E.CONFIG.payScale, 1);
  for (const k in E.SYMBOLS) for (const n in E.SYMBOLS[k].pays) {
    const v = E.SYMBOLS[k].pays[n] * 10;
    assert.ok(Math.abs(v - Math.round(v)) < 1e-9 && v >= 1, k + ' ' + n + ': ' + E.SYMBOLS[k].pays[n]);
  }
});
// ---- Stake math export: rounds as book events ----
// a frozen copy of the v8 playRound, to prove playRoundDetailed draws the same numbers
// (v11: plus Super Free Spins, whose feature starts at SUPER_START with its own orb chance)
function playRoundV8(opts) {
  const rng = opts.rng, sup = !!opts.super, buy = !!opts.buy || sup;
  const s = E.playSpin(rng, opts.ante && !buy ? 'ante' : 'base', { buy });
  let totalX = Math.min(s.ev.winX, E.MAX_WIN_X);
  if ((buy || s.res.scatters >= E.SCATTERS_FS) && totalX < E.MAX_WIN_X) {
    let spins = E.FS_AWARD, persistent = sup ? E.SUPER_START : 0, fx = 0; const cap = E.MAX_WIN_X - totalX;
    while (spins > 0) {
      spins--;
      const f = E.playSpin(rng, 'fs', { persistent, super: sup });
      persistent = f.ev.persistentAfter; fx += f.ev.winX;
      if (f.res.scatters >= E.SCATTERS_RETRIG) spins += E.FS_RETRIGGER;
      if (fx >= cap) { fx = cap; break; }
    }
    totalX += fx;
  }
  return Math.min(totalX, E.MAX_WIN_X);
}
const ROUND_MODES = [['base', {}], ['ante', { ante: true }], ['bonus', { buy: true }], ['super', { super: true }]];
const isBuy = name => name === 'bonus' || name === 'super';
ok('detailed rounds pay exactly what playRound pays (20,000 rounds per mode, 4,000 per buy)', () => {
  for (const [name, o] of ROUND_MODES) for (let s = 1; s <= (isBuy(name) ? 4000 : 20000); s++) {
    const a = playRoundV8({ rng: E.makeRng(s), ...o }), r = E.playRoundDetailed({ rng: E.makeRng(s), ...o });
    assert.strictEqual(r.totalX, a, name + ' seed ' + s);
    assert.strictEqual(E.playRound({ rng: E.makeRng(s), ...o }), a);
  }
});
function stripped(out) {   // playSpin's result without the fields a book doesn't carry
  return { board: out.board, res: out.res, ev: out.ev };
}
ok('every spin survives the trip through a book event unchanged (30,000 spins)', () => {
  for (const mode of ['base', 'ante', 'fs']) for (let s = 1; s <= 9000; s++) {
    const persistent = mode === 'fs' ? (s * 7) % 60 : 0;
    const out = E.playSpin(E.makeRng(s), mode, { persistent });
    const e = JSON.parse(JSON.stringify(E.serializeSpin(out, mode, Math.round(out.ev.winX * 100))));
    assert.deepStrictEqual(stripped(E.expandSpin(e, persistent)), stripped(out), mode + ' seed ' + s);
  }
  for (let s = 1; s <= 3000; s++) {
    const out = E.playSpin(E.makeRng(s), 'base', { buy: true });
    const e = JSON.parse(JSON.stringify(E.serializeSpin(out, 'base', Math.round(out.ev.winX * 100), { buy: true })));
    assert.deepStrictEqual(stripped(E.expandSpin(e, 0)), stripped(out));
  }
});
ok('round events add up to the payout and replay through expandSpin', () => {
  for (const [name, o] of ROUND_MODES) for (let s = 1; s <= (isBuy(name) ? 1500 : 6000); s++) {
    const r = E.playRoundDetailed({ rng: E.makeRng(s), ...o });
    const { events, payoutX100 } = E.roundEvents(r);
    assert.strictEqual(payoutX100, Math.round(r.totalX * 100));
    let persistent = 0, sum = 0;
    events.forEach((e, i) => assert.strictEqual(e.index, i));
    for (const e of events) if (e.type === 'freeSpinsTrigger') persistent = e.start || 0;
    else if (e.type === 'spin') {
      const out = E.expandSpin(JSON.parse(JSON.stringify(e)), e.mode === 'fs' ? persistent : 0);
      if (e.mode === 'fs') persistent = out.ev.persistentAfter;
      sum += e.win;
    }
    assert.strictEqual(sum, payoutX100);
    assert.strictEqual(events[events.length - 1].type, 'finalWin');
    assert.strictEqual(events[events.length - 1].win, payoutX100);
  }
});
ok('Super Free Spins start at x100 (the trigger event says so) and only their free spins use the super orb chance', () => {
  assert.ok(E.SUPER_COST_X === 500 && E.SUPER_START === 100 && E.CONFIG.superOrbChance < E.CONFIG.fsOrbChance);
  let features = 0;
  for (let s = 1; s <= 600; s++) {
    const r = E.playRoundDetailed({ rng: E.makeRng(s), super: true }), { events } = E.roundEvents(r);
    const trig = events.find(e => e.type === 'freeSpinsTrigger'), first = r.spins.find(sp => sp.mode === 'fs');
    if (!trig) { assert.strictEqual(r.totalX, E.MAX_WIN_X); continue; }      // only a capped paid spin skips the feature
    features++;
    assert.strictEqual(trig.start, E.SUPER_START); assert.strictEqual(first.persistentBefore, E.SUPER_START);
    assert.ok(r.spins.filter(sp => sp.mode === 'fs').every(sp => sp.out.ev.persistentAfter >= E.SUPER_START));
  }
  assert.ok(features > 590);
  // a regular buy's trigger carries no start, and its feature starts at 0
  const r = E.playRoundDetailed({ rng: E.makeRng(7), buy: true });
  assert.strictEqual(E.roundEvents(r).events.find(e => e.type === 'freeSpinsTrigger').start, undefined);
  // the super flag only matters in free spins: a base spin draws the same either way
  assert.deepStrictEqual(E.playSpin(E.makeRng(9), 'base', { super: true }).board, E.playSpin(E.makeRng(9), 'base').board);
});
ok('a tampered book event is rejected', () => {
  let seed = 1, out;
  do out = E.playSpin(E.makeRng(seed++), 'fs', { persistent: 3 }); while (out.res.steps.length < 2 || !out.res.orbValues.length);
  const good = E.serializeSpin(out, 'fs', Math.round(out.ev.winX * 100));
  const bad = [
    e => { e.win += 5; },
    e => { e.board = e.board.slice(1) + 'A'; },
    e => { e.board = e.board.replace(/./, 'Z'); },
    e => { e.steps.push({ board: e.steps[e.steps.length - 1].board }); },
    e => { e.steps.pop(); },
    e => { const st = e.steps.find(x => x.orbs); st.orbs[0][1] = 7; },
    e => { const b = e.steps[0].board; e.steps[0].board = b.slice(0, 29) + (b[29] === 'A' ? 'B' : 'A'); },
  ];
  for (const f of bad) { const e = JSON.parse(JSON.stringify(good)); f(e); assert.throws(() => E.expandSpin(e, 3)); }
});
// ---- Stake: wording and the published math ----
function loadStrings(search) {
  const vm = require('vm'), fs = require('fs');
  const sandbox = { window: {}, location: { search }, URLSearchParams, document: { documentElement: { classList: { toggle() {} } }, querySelectorAll: () => [] } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'strings.js'), 'utf8'), sandbox);
  return sandbox.window.GOS_STR;
}
ok('social casino wording has none of the restricted words', () => {
  const STR = loadStrings('?social=true');
  assert.ok(STR.social);
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'js', 'strings.js'), 'utf8');
  const keys = [...src.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]).concat([...src.matchAll(/,\s(\w+):\s[\['\x27]/g)].map(m => m[1]));
  // words and phrases alike ("loss limit", "cost of"), as whole words
  const re = new RegExp('\\b(' + STR.RESTRICTED.map(w => w.replace(/ /g, '\\s+')).join('|') + ')\\b', 'i');
  for (const k of new Set(keys)) {
    const t = STR.T(k, { v: '1.00 SC', a: 1, b: 2, n: 3, x: '5,000×' }).replace(/<[^>]+>/g, '');
    assert.ok(!re.test(t), `social "${k}": ${t}`);
  }
  assert.ok(loadStrings('?currency=XSC').social, 'a social currency turns social wording on');
  assert.ok(!loadStrings('').social);
});
ok('the published Stake math matches the engine and the rules', () => {
  const fs = require('fs'), zlib = require('zlib'), dir = path.join(__dirname, '..', 'math');
  if (!fs.existsSync(path.join(dir, 'index.json'))) { console.log('      (no math/ export; skipped)'); return; }
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const cost = { base: 1, ante: E.ANTE_COST, bonus: E.BUY_COST_X, super: E.SUPER_COST_X };
  const info = (() => { const w = {}; require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'math-info.js'), 'utf8'), { window: w }); return w.GOS_MATH; })();
  assert.deepStrictEqual(index.modes.map(m => m.name), ['base', 'ante', 'bonus', 'super']);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  for (const m of index.modes) {
    // re-weighting to exactly 96.5% stays within 3% of the game's natural odds
    const k = summary.modes[m.name].reweight;
    assert.ok(k == null || Math.abs(k - 1) <= 0.03, m.name + ' re-weighting k ' + k);
    assert.strictEqual(m.cost, cost[m.name], m.name + ' cost');
    let W = 0n, P = 0n, max = 0;
    for (const line of fs.readFileSync(path.join(dir, m.weights), 'utf8').trim().split('\n')) {
      const [, w, pm] = line.split(',').map(BigInt); W += w; P += w * pm; if (Number(pm) > max) max = Number(pm);
      // Stake's math verification: whole 0.1x steps, nothing below 0.1x but 0
      assert.ok(pm % 10n === 0n && (pm === 0n || pm >= 10n), m.name + ' payout ' + pm + ' is not a whole 0.1x step');
    }
    const rtp = Number((P * 100000000n) / (W * BigInt(Math.round(m.cost * 100)))) / 1e6;     // percent
    assert.ok(Math.abs(rtp - 96.5) < 0.001, m.name + ' RTP ' + rtp);
    assert.strictEqual(max, E.MAX_WIN_X * 100, m.name + ' max win');
    assert.strictEqual(info.modes[m.name].rtp, 96.5); assert.strictEqual(info.modes[m.name].cost, m.cost);
    // a sample of books replays through the engine and adds up
    const lines = zlib.zstdDecompressSync(fs.readFileSync(path.join(dir, m.events))).toString().trim().split('\n');
    for (let i = 0; i < lines.length; i += Math.max(1, Math.floor(lines.length / 400))) {
      const b = JSON.parse(lines[i]); let persistent = 0, sum = 0;
      for (const e of b.events) if (e.type === 'freeSpinsTrigger') persistent = e.start || 0;
      else if (e.type === 'spin') { const o = E.expandSpin(e, e.mode === 'fs' ? persistent : 0); if (e.mode === 'fs') persistent = o.ev.persistentAfter; sum += e.win; }
      assert.strictEqual(sum, b.payoutMultiplier, m.name + ' book ' + b.id);
    }
  }
});
ok('every asset the game loads exists and is precached by the service worker', () => {
  const fs = require('fs'), root = path.join(__dirname, '..');
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const sw = read('sw.js');
  const core = [...sw.match(/const CORE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of core) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), 'precached file missing on disk: ' + f);
  const r = require('./assets.js').refs(root);         // the same reader tools/build-stake.js packages from
  const sounds = r.sounds.filter(f => !f.startsWith('sounds/music'));   // the music tracks (3.5 MB, ogg or m4a) are cached on first play instead
  const manifest = JSON.parse(read('manifest.json')).icons.map(i => i.src);
  for (const f of [...r.html, ...r.css, ...r.images, ...sounds, ...manifest, 'manifest.json']) {
    assert.ok(fs.existsSync(path.join(root, f)), 'referenced file missing: ' + f);
    if (/\.(mp4|webm)$/.test(f)) continue;    // video is streamed from the network, never cached
    assert.ok(core.includes(f), 'not precached by sw.js: ' + f);
  }
});
ok('every sound the game plays is in the v10 kit (or is one of the few kept outside it)', () => {
  const fs = require('fs'), root = path.join(__dirname, '..');
  const SFX = require(path.join(root, 'js', 'sfx-recipes.js'));
  const sheet = JSON.parse(fs.readFileSync(path.join(root, 'sounds', 'sfx.json'), 'utf8'));
  const OUTSIDE = ['thunder', 'achievement', 'whoosh'];          // a file and two synths in audio.js
  const names = new Set();
  for (const f of fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    for (const m of src.matchAll(/AudioEngine\.play\('([A-Za-z0-9.]+)'/g)) names.add(m[1]);
  }
  // names built at run time: 'tine.' + a note, 'tier.' + a number
  for (const n of ['G4', 'Bb4', 'C5', 'D5', 'F5', 'G5', 'F4', 'A4', 'Bb5', 'D6']) names.add('tine.' + n);
  for (let k = 0; k < 4; k++) names.add('tier.' + k);
  names.delete('tine.'); names.delete('tier.');
  for (const n of names) {
    if (OUTSIDE.includes(n)) continue;
    assert.ok(SFX.RECIPES[n], 'no recipe for "' + n + '"');
    for (let v = 0; v < SFX.RECIPES[n].variants; v++) assert.ok(sheet.slots[n + '#' + v], 'no sheet slot for ' + n + '#' + v);
  }
  assert.strictEqual(sheet.hash.length > 0, true);
});
ok('every string the code asks for exists (canvas, DOM and overlays)', () => {
  const fs = require('fs'), root = path.join(__dirname, '..');
  const STR = loadStrings('');
  const missing = [];
  for (const f of fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    for (const m of src.matchAll(/\bG?\.?T\('([a-zA-Z]+)'/g)) if (STR.T(m[1]) === m[1]) missing.push(f + ': ' + m[1]);
  }
  for (const m of fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/data-t[ha]?="([a-zA-Z]+)"/g)) if (STR.T(m[1]) === m[1]) missing.push('index.html: ' + m[1]);
  assert.deepStrictEqual(missing, []);
});
ok('amounts never show more decimals than the currency has (no $3.025)', () => {
  const vm = require('vm'), fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
  const money = src.match(/\/\/ -+ money -+\n([\s\S]*?)\n\s*\/\/ -+ fonts/)[1];     // the real formatter, on its own
  const G = {};
  vm.runInNewContext(money, { G });
  const want = [['USD', 3.025, '$3.03'], ['USD', 16.125, '$16.13'], ['USD', 2.1875, '$2.19'], ['USD', 0.005, '$0.01'], ['USD', 0.004, '$0.00'],
    ['USD', 1234567.891, '$1,234,567.89'], ['USD', -3.025, '-$3.03'], ['USD', 100, '$100.00'], ['JPY', 3.5, '¥4'], ['XSC', 2.1875, '2.19 SC'], ['EUR', 0.125, '€0.13'],
    // Stake's currency table: symbol, side and decimals
    ['RUB', 10, '₽10.00'], ['DKK', 10, '10.00 KR'], ['NOK', 10, 'kr10.00'], ['ILS', 10, '10.00 ILS'], ['TWD', 10, 'NT$10.00'],
    ['NGN', 10, '₦10.00'], ['CLP', 10.4, '10 CLP'], ['VND', 10, '10 ₫'], ['XGC', 10, '10.00 GC'], ['BHD', 1, 'BD1.00'], ['PLN', 1, '1.00 zł']];
  for (const [c, n, s] of want) { G.setCurrency(c); assert.strictEqual(G.money(n), s, c + ' ' + n); }
  G.setCurrency('USD');
  assert.strictEqual(G.countMoney(16.125, 16.125), '$16.13');
  assert.strictEqual(G.money(16.125, 3), '$16.13');           // asking for more decimals still gives the currency's own
  let seed = 7;
  for (let i = 0; i < 20000; i++) {                            // any micro-unit amount: exactly two decimals
    seed = (seed * 48271) % 2147483647;
    const s = G.money(seed % 1e9 / 1e6);
    assert.ok(/^\$[\d,]+\.\d{2}$/.test(s), s);
  }
});
ok('the service worker is v11 and clears only older v11 caches (every version shares the origin)', async () => {
  const vm = require('vm'), sw = require('fs').readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.ok(/VERSION = 'gos11-core-\d+'/.test(sw) && /MEDIA = VERSION\.replace\('-core-', '-media-'\)/.test(sw));
  // run the real activate step against a fake Cache Storage holding this game's caches from every version, and another app's
  const version = sw.match(/VERSION = '([^']+)'/)[1], media = version.replace('-core-', '-media-');
  const keys = [version, media, 'gos11-core-0', 'gos11-media', 'gos10-core-6', 'gos10-media-6', 'gos9-core-3', 'gos9-media', 'gos8-core-2', 'other-app-cache', 'workbox-precache'];
  const deleted = [], on = {};
  const self = { addEventListener: (t, f) => { on[t] = f; }, clients: { claim: () => Promise.resolve() }, skipWaiting() {}, registration: { scope: 'https://x/' } };
  vm.runInNewContext(sw, { self, caches: { keys: async () => keys, delete: async k => { deleted.push(k); return true; } }, Promise, URL, setTimeout, Request: function () {}, Response: function () {} });
  let done; on.activate({ waitUntil: p => { done = p; } });
  await done;
  assert.deepStrictEqual(deleted.sort(), ['gos11-core-0', 'gos11-media'].filter(k => k !== version && k !== media).sort());
});
ok('the game writes nothing to the console (Stake play logs nothing; ?debug=1 routes through G.log)', () => {
  const fs = require('fs'), dir = path.join(__dirname, '..', 'js');
  const found = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((l, i) => {
      if (/\bconsole\.(log|warn|error|info|debug|trace)\s*\(/.test(l) && !/G\.log = /.test(l)) found.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(found, []);
});
ok('the Stake package is exactly what tools/build-stake.js makes from this repo', () => {
  const fs = require('fs'), vm = require('vm'), root = path.join(__dirname, '..'), pkg = path.join(root, 'stake');
  if (!fs.existsSync(path.join(pkg, 'frontend', 'index.html'))) { console.log('      (no stake/ package; skipped)'); return; }
  const B = require('./build-stake.js'), fe = B.frontendFiles(root);
  const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name)).split(path.sep).join('/')]);
  const front = path.join(pkg, 'frontend'), files = walk(front).sort();
  // exactly the files the game loads (plus the licences), and none of the forbidden ones
  assert.deepStrictEqual(files, [...fe.files, 'index.html', 'css/style.css', 'js/build.js'].sort());
  for (const f of files) assert.ok(!B.FORBIDDEN.some(re => re.test(f)), 'forbidden in the package: ' + f);
  // the page and stylesheet without their demo-only blocks; everything else byte-identical to the repo
  assert.strictEqual(fs.readFileSync(path.join(front, 'index.html'), 'utf8'), fe.html);
  assert.strictEqual(fs.readFileSync(path.join(front, 'css/style.css'), 'utf8'), fe.css);
  for (const f of fe.files) assert.ok(fs.readFileSync(path.join(front, f)).equals(fs.readFileSync(path.join(root, f))), 'stale copy in the package: ' + f);
  // the build flag: target stake, tied to these books
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(front, 'js/build.js'), 'utf8'), ctx);
  assert.strictEqual(ctx.window.GOS_BUILD.target, 'stake');
  assert.strictEqual(ctx.window.GOS_BUILD.mathHash, B.mathHash(path.join(root, 'math')));
  assert.strictEqual(B.mathHash(path.join(pkg, 'math')), B.mathHash(path.join(root, 'math')));
  // the math: index.json and the six files it names, byte-equal to math/
  assert.deepStrictEqual(walk(path.join(pkg, 'math')).sort(), B.mathFiles(path.join(root, 'math')).slice().sort());
  for (const f of B.mathFiles(path.join(root, 'math'))) assert.ok(fs.readFileSync(path.join(pkg, 'math', f)).equals(fs.readFileSync(path.join(root, 'math', f))), 'stale math file: ' + f);
  // every replay case names a real book with the payout it states
  const ev = JSON.parse(fs.readFileSync(path.join(pkg, 'replay-events.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(root, 'math', 'index.json'), 'utf8'));
  for (const m of index.modes) {
    const rows = fs.readFileSync(path.join(root, 'math', m.weights), 'utf8').trim().split('\n').map(l => l.split(',').map(Number));
    for (const k of ['loss', 'normalWin', 'bigWin', 'bonusTrigger', 'winCap']) {
      const e = ev[m.name][k];
      assert.ok(e && rows[e.event - 1], `${m.name} ${k}`);
      assert.strictEqual(rows[e.event - 1][2] / 100, e.payoutMultiplier, `${m.name} ${k} payout`);
    }
  }
  // no Stake branding anywhere in the package's text files
  for (const f of files.filter(f => /\.(html|css|js|json|txt)$/.test(f))) assert.ok(!/only on stake|preroll/i.test(fs.readFileSync(path.join(front, f), 'utf8')), 'branding left in ' + f);
});
Promise.all(pending).then(() => console.log(`\n${n} checks passed`), e => { console.error(e); process.exit(1); });

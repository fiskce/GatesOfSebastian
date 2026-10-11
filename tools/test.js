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
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

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
ok('payout math is unchanged (fingerprint of 5,000 spins, recorded from v7)', () => {
  const h = crypto.createHash('sha256');
  for (const mode of ['base', 'ante', 'fs']) for (let s = 1; s <= 1500; s++) {
    const o = E.playSpin(E.makeRng(s), mode, { persistent: mode === 'fs' ? s % 7 : 0 });
    h.update(mode + s + o.board.join('') + o.ev.winX.toFixed(6) + o.res.scatters + o.ev.persistentAfter);
  }
  for (let s = 1; s <= 500; s++) { const o = E.playSpin(E.makeRng(s), 'base', { buy: true }); h.update('buy' + s + o.board.join('') + o.ev.winX.toFixed(6)); }
  assert.strictEqual(h.digest('hex'), '117e516f6c8b6432127463ab2a8ef10cd93a2c5259e3e20407f5f6c59ea5e653');
});
// ---- Stake math export: rounds as book events ----
// a frozen copy of the v8 playRound, to prove playRoundDetailed draws the same numbers
function playRoundV8(opts) {
  const rng = opts.rng, buy = !!opts.buy;
  const s = E.playSpin(rng, opts.ante && !buy ? 'ante' : 'base', { buy });
  let totalX = Math.min(s.ev.winX, E.MAX_WIN_X);
  if ((buy || s.res.scatters >= E.SCATTERS_FS) && totalX < E.MAX_WIN_X) {
    let spins = E.FS_AWARD, persistent = 0, fx = 0; const cap = E.MAX_WIN_X - totalX;
    while (spins > 0) {
      spins--;
      const f = E.playSpin(rng, 'fs', { persistent });
      persistent = f.ev.persistentAfter; fx += f.ev.winX;
      if (f.res.scatters >= E.SCATTERS_RETRIG) spins += E.FS_RETRIGGER;
      if (fx >= cap) { fx = cap; break; }
    }
    totalX += fx;
  }
  return Math.min(totalX, E.MAX_WIN_X);
}
const ROUND_MODES = [['base', {}], ['ante', { ante: true }], ['bonus', { buy: true }]];
ok('detailed rounds pay exactly what playRound pays (20,000 rounds per mode)', () => {
  for (const [name, o] of ROUND_MODES) for (let s = 1; s <= (name === 'bonus' ? 4000 : 20000); s++) {
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
  for (const [name, o] of ROUND_MODES) for (let s = 1; s <= (name === 'bonus' ? 1500 : 6000); s++) {
    const r = E.playRoundDetailed({ rng: E.makeRng(s), ...o });
    const { events, payoutX100 } = E.roundEvents(r);
    assert.strictEqual(payoutX100, Math.round(r.totalX * 100));
    let persistent = 0, sum = 0;
    events.forEach((e, i) => assert.strictEqual(e.index, i));
    for (const e of events) if (e.type === 'spin') {
      const out = E.expandSpin(JSON.parse(JSON.stringify(e)), e.mode === 'fs' ? persistent : 0);
      if (e.mode === 'fs') persistent = out.ev.persistentAfter;
      sum += e.win;
    }
    assert.strictEqual(sum, payoutX100);
    assert.strictEqual(events[events.length - 1].type, 'finalWin');
    assert.strictEqual(events[events.length - 1].win, payoutX100);
  }
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
  const re = new RegExp('\\b(' + STR.RESTRICTED.filter(w => !w.includes(' ')).join('|') + ')\\b|win feature', 'i');
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
  const cost = { base: 1, ante: E.ANTE_COST, bonus: E.BUY_COST_X };
  const info = (() => { const w = {}; require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'math-info.js'), 'utf8'), { window: w }); return w.GOS_MATH; })();
  assert.deepStrictEqual(index.modes.map(m => m.name).sort(), ['ante', 'base', 'bonus']);
  for (const m of index.modes) {
    assert.strictEqual(m.cost, cost[m.name], m.name + ' cost');
    let W = 0n, P = 0n, max = 0;
    for (const line of fs.readFileSync(path.join(dir, m.weights), 'utf8').trim().split('\n')) {
      const [, w, pm] = line.split(',').map(BigInt); W += w; P += w * pm; if (Number(pm) > max) max = Number(pm);
    }
    const rtp = Number((P * 100000000n) / (W * BigInt(Math.round(m.cost * 100)))) / 1e6;     // percent
    assert.ok(Math.abs(rtp - 96.5) < 0.001, m.name + ' RTP ' + rtp);
    assert.strictEqual(max, E.MAX_WIN_X * 100, m.name + ' max win');
    assert.strictEqual(info.modes[m.name].rtp, 96.5); assert.strictEqual(info.modes[m.name].cost, m.cost);
    // a sample of books replays through the engine and adds up
    const lines = zlib.zstdDecompressSync(fs.readFileSync(path.join(dir, m.events))).toString().trim().split('\n');
    for (let i = 0; i < lines.length; i += Math.max(1, Math.floor(lines.length / 400))) {
      const b = JSON.parse(lines[i]); let persistent = 0, sum = 0;
      for (const e of b.events) if (e.type === 'spin') { const o = E.expandSpin(e, e.mode === 'fs' ? persistent : 0); if (e.mode === 'fs') persistent = o.ev.persistentAfter; sum += e.win; }
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
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]);
  const css = [...read('css/style.css').matchAll(/url\(\.\.\/([^)]+)\)/g)].map(m => m[1]);
  const symbols = [...read('js/board.js').matchAll(/'(assets\/[^']+\.(?:png|webp))'/g)].map(m => m[1]);
  const sounds = [...read('js/audio.js').matchAll(/'(sounds\/[^']+)'/g)].map(m => m[1]).filter(f => !f.startsWith('sounds/music'));   // the music tracks (3.5 MB) are cached on first play instead
  const manifest = JSON.parse(read('manifest.json')).icons.map(i => i.src);
  for (const f of [...refs, ...css, ...symbols, ...sounds, ...manifest, 'manifest.json']) {
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
ok('the service worker is v10 and clears older versions of this game only', () => {
  const sw = require('fs').readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.ok(/VERSION = 'gos10-core-\d+'/.test(sw) && /MEDIA = 'gos10-media'/.test(sw));
  const re = /^gos\d+-(core|media)/;
  for (const k of ['gos9-core-3', 'gos9-media', 'gos8-core-2']) assert.ok(re.test(k), k);
  for (const k of ['other-app-cache', 'workbox-precache']) assert.ok(!re.test(k), k);
});
console.log(`\n${n} checks passed`);

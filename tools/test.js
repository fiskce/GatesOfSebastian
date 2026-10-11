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
console.log(`\n${n} checks passed`);

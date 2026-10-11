#!/usr/bin/env node
/* Checks for the v10 sound kit: the recipes (js/sfx-recipes.js), the sheets
 * they were rendered into (sounds/sfx-*.ogg|m4a) and sounds/sfx.json.
 * Run: node tools/test-sfx.js   (needs ffmpeg; re-render with tools/render-sfx.js) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const crypto = require('crypto');
const assert = require('assert');
const RECIPES_FILE = path.join(__dirname, '..', 'js', 'sfx-recipes.js');
const SFX = require(RECIPES_FILE);

const ROOT = path.join(__dirname, '..');
const SR = SFX.SR;
const BUDGET_OGG = 460000;                 // bytes, all three .ogg sheets (what a browser downloads); target ~450 KB
const BUDGET_DECODED = 18 * 1048576;       // bytes of decoded audio (48 kHz float) the three sheets hold in memory
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const db = x => 20 * Math.log10(Math.max(x, 1e-12));
const lin = d => Math.pow(10, d / 20);
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; };
function peak(chs) { let p = 0; for (const c of chs) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i])); return p; }
function onset(chs, rel) { const t = peak(chs) * lin(rel); for (let i = 0; i < chs[0].length; i++) for (const c of chs) if (Math.abs(c[i]) >= t) return i; return chs[0].length; }
function hashOf(out) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from(out.L.buffer, out.L.byteOffset, out.L.byteLength));
  h.update(Buffer.from(out.R.buffer, out.R.byteOffset, out.R.byteLength));
  return h.digest('hex').slice(0, 16);
}
function decode(file, ch) {
  const b = cp.execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(ROOT, file), '-f', 'f32le', '-ac', String(ch), '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), len = x.length / ch;
  return Array.from({ length: ch }, (_, k) => { const c = new Float32Array(len); for (let i = 0; i < len; i++) c[i] = x[i * ch + k]; return c; });
}
function ebur128(chs) {      // integrated LUFS + true peak of float channels (0.5 s of silence after, like render-sfx)
  const c = chs.length, len = chs[0].length, buf = Buffer.alloc(len * c * 4);
  for (let i = 0; i < len; i++) for (let k = 0; k < c; k++) buf.writeFloatLE(chs[k][i], (i * c + k) * 4);
  const r = cp.spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(SR), '-ac', String(c), '-i', '-', '-af', 'apad=pad_dur=0.5,ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { input: buf, maxBuffer: 1 << 26 });
  const s = r.stderr.toString(), sum = s.slice(s.lastIndexOf('Summary:'));
  return { lufs: Number(sum.match(/I:\s+(-?[\d.]+)/)[1]), truePeak: Number(sum.match(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)/)[1]) };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < h; j++) {
        const p = i + j, q = p + h, vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// energy share per band (mono mix, Hann frames, first frame centred on the onset)
function bands(out, edges) {
  const N = 2048, x = new Float64Array(out.L.length + N);
  for (let i = 0; i < out.L.length; i++) x[i + N / 2] = (out.L[i] + out.R[i]) / 2;
  const P = new Float64Array(N / 2);
  for (let s = 0; s + N <= x.length; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
  }
  let tot = 0; for (let k = 1; k < N / 2; k++) tot += P[k];
  return edges.map(([a, b]) => { let e = 0; for (let k = 1; k < N / 2; k++) { const f = k * SR / N; if (f >= a && f < b) e += P[k]; } return e / tot; });
}
function biquad(x, type, f, q) {   // RBJ high/low-pass, for the band checks
  const w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  const b = type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 + 2 * c * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
// a phone speaker: high-pass 300 Hz (4th order), low-pass 10 kHz
const phone = x => biquad(biquad(biquad(Float64Array.from(x), 'hp', 300, 0.7071), 'hp', 300, 0.7071), 'lp', 10000, 0.7071);
// short-window loudness of a render at its playback gain, full range and through a phone speaker
function playLoud(key) {
  const name = key.split('#')[0], o = renders.get(key), g = db(json.slots[key].gain), mono = !SFX.RECIPES[name].stereo;
  const L = o.L, R = mono ? o.L : o.R, pL = phone(L), pR = mono ? pL : phone(R);
  return { full: SFX.punch(L, R) + g, phone: SFX.punch(pL, pR) + g };
}

const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'sounds', 'sfx.json'), 'utf8'));
const all = SFX.list();
const renders = new Map();
for (const [name, v] of all) renders.set(name + '#' + v, SFX.render(name, v));
const variantsOf = name => Array.from({ length: SFX.RECIPES[name].variants }, (_, v) => name + '#' + v);

// ---------------- the recipes ----------------
ok('every recipe is deterministic per seed and matches the rendered sheets', () => {
  for (const [name, v] of all) {
    const key = name + '#' + v, a = renders.get(key), b = SFX.render(name, v);
    assert.strictEqual(hashOf(a), hashOf(b), key + ' renders differently twice');
    assert.ok(json.slots[key], key + ' has no slot in sfx.json');
    assert.strictEqual(json.slots[key].hash, hashOf(a), key + ' changed since the sheets were rendered (run tools/render-sfx.js)');
  }
  assert.notStrictEqual(hashOf(renders.get('ui.press#0')), hashOf(renders.get('ui.press#1')), 'variants differ');
});
ok('recipes use only our own deterministic math (identical samples in every JS engine)', () => {
  const src = fs.readFileSync(RECIPES_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bad = src.match(/Math\.(sin|cos|tan|exp|expm1|log|log2|log10|log1p|pow|tanh|sinh|cosh|atan|atan2|asin|acos|hypot|cbrt|random)\b/g);
  assert.ok(!bad, 'non-deterministic Math calls: ' + (bad || []).join(', '));
  assert.ok(!/AudioContext|OfflineAudioContext/.test(src), 'no Web Audio inside the recipes');
});
ok('job() renders the same samples in small steps, with the same playback gain (the runtime fallback)', () => {
  let worst = { ms: 0, key: '' }, steps = 0;
  for (const [name, v] of all) {
    const key = name + '#' + v;
    let best = null;
    for (let pass = 0; pass < 2; pass++) {               // the faster of two passes per step: GC pauses aren't the recipe's
      const j = SFX.job(name, v), t = [];
      for (;;) { const a = process.hrtime.bigint(), d = j.step(); t.push(Number(process.hrtime.bigint() - a) / 1e6); if (d) break; }
      best = best ? best.map((x, i) => Math.min(x, t[i])) : t;
      if (pass) {
        assert.strictEqual(hashOf(j.out), hashOf(renders.get(key)), key + ' job() differs from render()');
        assert.deepStrictEqual(j.out.notesUsed.slice().sort(), renders.get(key).notesUsed.slice().sort(), key + ' notes');
        assert.ok(Math.abs(db(j.gain) - db(SFX.gainFor(name, renders.get(key), v))) < 1e-9, key + ' job gain');
      }
    }
    const mx = Math.max(...best); steps += best.length;
    if (mx > worst.ms) worst = { ms: mx, key };
  }
  // ~8 ms here is ~30 ms on a 4x slower phone: a requestIdleCallback slice, not a frozen frame
  assert.ok(worst.ms <= 25, `longest job() step ${worst.ms.toFixed(1)} ms (${worst.key})`);
  console.log(`      ${steps} steps, longest ${worst.ms.toFixed(1)} ms (${worst.key})`);
});
ok('every render is finite, peaks at −1 dBFS, starts within 48 samples and ends in silence', () => {
  for (const [key, o] of renders) {
    assert.ok(o.L instanceof Float32Array && o.R instanceof Float32Array && o.L.length === o.R.length && o.L.length > 0, key);
    for (const c of [o.L, o.R]) for (let i = 0; i < c.length; i++) assert.ok(Number.isFinite(c[i]), key + ' NaN/Inf at ' + i);
    const p = peak([o.L, o.R]);
    assert.ok(Math.abs(db(p) + 1) < 0.01, key + ' peak ' + db(p).toFixed(2));
    const on = onset([o.L, o.R], -40);
    assert.ok(on <= 48, `${key} onset ${on} samples`);
    assert.strictEqual(o.L[o.L.length - 1], 0, key + ' last sample');
    assert.strictEqual(o.R[o.R.length - 1], 0, key + ' last sample');
    // the last 5 ms only fade: nothing in them is louder than the 15 ms before
    const f = Math.min(240, o.L.length >> 2), len = o.L.length;
    const pre = peak([o.L.subarray(Math.max(0, len - 4 * f), len - f), o.R.subarray(Math.max(0, len - 4 * f), len - f)]), tail = peak([o.L.subarray(len - f), o.R.subarray(len - f)]);
    assert.ok(tail <= Math.max(pre * 1.05, 1e-6), key + ' tail is not a fade');
  }
});
ok('sounds end in their own tails (−60 dB), never cut by their maxDur while still audible (> −45 dB); tier beds ~2 s, finale ≥ 2.4 s', () => {
  let worst = { d: -Infinity, key: '' };
  for (const [key, o] of renders) {
    if (SFX.RECIPES[key.split('#')[0]].fixed) continue;   // the charge is cut to its timeline (it ends in the breath)
    if (o.endDb > worst.d) worst = { d: o.endDb, key };
    assert.ok(o.endDb <= -45, `${key} is cut at ${o.endDb} dB re its peak`);
  }
  for (let k = 0; k < 4; k++) { const s = renders.get('tier.' + k + '#0').L.length / SR; assert.ok(s >= 1.85 && s <= 2.6, `tier.${k} lasts ${s.toFixed(2)} s`); }
  assert.ok(renders.get('maxwin#0').L.length / SR >= 2.4, 'maxwin is shorter than 2.4 s');
  console.log(`      loudest ending ${worst.d.toFixed(1)} dB (${worst.key})`);
});
ok('no DC offset (|mean| < 0.1% of peak) and mono recipes are exactly dual-mono', () => {
  for (const [key, o] of renders) {
    for (const c of [o.L, o.R]) { let s = 0; for (let i = 0; i < c.length; i++) s += c[i]; assert.ok(Math.abs(s / c.length) < 1e-3 * peak([c]), key + ' DC ' + (s / c.length).toExponential(2)); }
    const name = key.split('#')[0];
    if (!SFX.RECIPES[name].stereo) for (let i = 0; i < o.L.length; i++) assert.strictEqual(o.L[i], o.R[i], key + ' is not dual-mono');
  }
});
ok('tonal elements use only G A Bb C D F, and every note played is declared', () => {
  const allowed = /^(G|A|Bb|C|D|F)[0-8]$/;
  for (const name of Object.keys(SFX.RECIPES)) {
    const r = SFX.RECIPES[name];
    for (const nt of r.notes) { assert.ok(allowed.test(nt), name + ' declares ' + nt); assert.ok(SFX.NOTES[nt] > 0, nt); }
    for (let v = 0; v < r.variants; v++) for (const nt of renders.get(name + '#' + v).notesUsed) assert.ok(r.notes.includes(nt), `${name}#${v} plays undeclared ${nt}`);
  }
  assert.ok(Math.abs(SFX.NOTES.A4 - 440) < 1e-9 && Math.abs(SFX.NOTES.D6 - 1174.6590716696303) < 1e-6);
  assert.throws(() => SFX.render('no.such.sound', 0));
});
ok('no held partial is out of key: every peak above 1 kHz that lasts ≥ 300 ms (within −30 dB of the loudest) is a harmonic of a declared note', () => {
  // the note check only sees note() calls; this hears the result (e.g. a glass bar's 2.756x partial held under a tremolo)
  const N = 4096, hop = 1024, need = Math.ceil(0.3 * SR / hop), k0 = Math.ceil(1000 * N / SR);
  let checked = 0;
  for (const [key, o] of renders) {
    if (o.L.length < 0.4 * SR) continue;
    const r = SFX.RECIPES[key.split('#')[0]], frames = [];
    for (let s = 0; s + N <= o.L.length; s += hop) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = (o.L[s + i] + o.R[s + i]) / 2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
      fft(re, im); const m = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) m[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-30); frames.push(m);
    }
    let top = -Infinity; for (const m of frames) for (let k = 1; k < N / 2; k++) top = Math.max(top, m[k]);
    let open = new Map(); const held = [];
    for (const m of frames) {
      const next = new Map();
      for (let k = k0; k < N / 2 - 1; k++) if (m[k] > top - 30 && m[k] >= m[k - 1] && m[k] > m[k + 1]) {
        const d = (m[k - 1] - m[k + 1]) / (2 * (m[k - 1] - 2 * m[k] + m[k + 1])), f = (k + d) * SR / N;
        const prev = open.get(k) || open.get(k - 1) || open.get(k + 1);
        next.set(k, prev ? { n: prev.n + 1, f: prev.f.concat([f]) } : { n: 1, f: [f] });
      }
      for (const t of next.values()) if (t.n === need) held.push(t);
      open = next;
    }
    for (const t of held) {
      const f = median(t.f), cents = (a, b) => 1200 * Math.log2(a / b);
      const ok = r.notes.some(nm => { for (let k = 1; k <= 16; k++) if (Math.abs(cents(f, k * SFX.NOTES[nm])) <= 30) return true; return false; });
      assert.ok(ok, `${key}: a held partial at ${f.toFixed(0)} Hz is no harmonic of ${r.notes.join(' ')}`);
    }
    checked++;
  }
  console.log(`      ${checked} renders of 0.4 s or more`);
});
ok('the contract: every name the engine uses exists with its variants, bus and target', () => {
  const want = {
    ui: { 'ui.press': 6, 'ui.press.l': 6, 'ui.release': 3, 'ui.hover': 3, 'ui.denied': 2, 'ui.confirm': 1, 'ui.open': 2, 'ui.close': 2, 'toggle.on': 2, 'toggle.off': 2, 'turbo.on': 1, 'turbo.off': 1, 'bet.stop': 2 },
    world: { 'spin.press': 4, 'spin.press.auto': 2, 'spin.press.fs': 2, 'spin.press.dc': 2, 'spin.press.t': 2, 'spin.dropout': 3, 'land.thock': 4,
      'tine.G4': 1, 'tine.Bb4': 1, 'tine.C5': 1, 'tine.D5': 1, 'tine.F5': 1, 'tine.G5': 1, 'tine.F4': 1, 'tine.A4': 1, 'tine.Bb5': 1, 'tine.D6': 1,
      'spin.lock': 2, 'spin.brake': 2, 'win.tick': 3, 'win.chime': 2, 'win.coins': 3, 'count.tick': 4, 'orb.shot': 4, 'orb.embed': 4, 'shell.eject': 3, 'collect': 2, 'slam': 4, 'tumble': 2, 'scatter.lock': 1 },
    fs: { 'fs.charge': 1, 'fs.break': 1, 'fs.horn.A4': 1, 'fs.horn.D5': 1, 'fs.award.click': 3, 'fs.retrigger': 1, 'fs.milestone': 5, 'fs.last': 1, 'fs.outro': 1, 'tier.0': 1, 'tier.1': 1, 'tier.2': 1, 'tier.3': 1, 'maxwin': 1 },
  };
  const names = [];
  for (const [bus, set] of Object.entries(want)) for (const [name, variants] of Object.entries(set)) {
    const r = SFX.RECIPES[name]; names.push(name);
    assert.ok(r, 'missing recipe ' + name);
    assert.strictEqual(r.variants, variants, name + ' variants'); assert.strictEqual(r.bus, bus, name + ' bus');
    const t = r.target, kinds = ['peakDb', 'lufs', 'sustainDb'].filter(k => t[k] != null);
    assert.ok(kinds.length === 1 && (!t.punch || t.peakDb != null), name + ' target');
    if (t.punch) assert.ok(SFX.PUNCH[name] != null, name + ' has no calibrated loudness (run tools/render-sfx.js --calibrate)');
    for (let v = 0; v < variants; v++) assert.ok(Number.isFinite(SFX.targetOf(name, v).value), name + ' target of #' + v);
    assert.deepStrictEqual(json.recipes[name] && { v: json.recipes[name].variants, b: json.recipes[name].bus, n: json.recipes[name].notes }, { v: r.variants, b: r.bus, n: r.notes }, name + ' in sfx.json');
  }
  assert.deepStrictEqual(Object.keys(SFX.RECIPES).sort(), names.sort(), 'no extra recipes');
  assert.strictEqual(Object.keys(json.slots).length, all.length, 'one slot per recipe x variant');
});

// ---------------- the sheets ----------------
const decoded = {};
for (const [bus, f] of Object.entries(json.files)) decoded[bus] = { ogg: decode(f.ogg, f.channels), m4a: decode(f.m4a, f.channels) };
const playSlot = (key, fmt) => {           // a decoded slot at its playback gain
  const s = json.slots[key], start = Math.round(s.offset * SR), len = Math.round(s.duration * SR);
  return decoded[s.file][fmt || 'ogg'].map(c => Float32Array.from(c.subarray(start, start + len), v => v * s.gain));
};
ok('sound sheets decode, every slot fits inside both files, and nothing clips', () => {
  assert.strictEqual(json.sampleRate, SR);
  for (const [bus, f] of Object.entries(json.files)) for (const fmt of ['ogg', 'm4a']) {
    const d = decoded[bus][fmt], len = d[0].length;
    assert.ok(Math.abs(len / SR - f.duration) < 0.03, `${bus}.${fmt} decodes to ${(len / SR).toFixed(3)} s, sfx.json says ${f.duration}`);
    assert.ok(peak(d) < 1, `${bus}.${fmt} clips`);
    for (const [key, s] of Object.entries(json.slots)) if (s.file === bus) assert.ok(Math.round((s.offset + s.duration) * SR) <= len, `${key} runs past the end of ${bus}.${fmt}`);
  }
});
ok('each slot in the decoded sheets is its recipe, time-aligned, and sfx.json states each format\'s codec delay', () => {
  // alignment = the lag (±48 samples) that best matches the first 50 ms; ffmpeg's
  // decoder applies the MP4 edit list, so both formats should sit at lag 0, as
  // files[].delay says; a decoder that ignores the edit list adds priming.m4a
  let worst = { ogg: 0, m4a: 0 }, worstSnr = { ogg: Infinity, m4a: Infinity };
  for (const [key, s] of Object.entries(json.slots)) {
    const o = renders.get(key), ch = json.files[s.file].channels, start = Math.round(s.offset * SR), len = Math.round(s.duration * SR);
    assert.strictEqual(len, o.L.length, key + ' duration');
    const ref = ch === 1 ? [o.L] : [o.L, o.R], g = lin(-1) / peak(ref), N = Math.min(len, 2400);
    for (const fmt of ['ogg', 'm4a']) {
      const d = decoded[s.file][fmt], at = start + json.files[s.file].delay[fmt];
      let best = -Infinity, lag = 0;
      for (let l = -48; l <= 48; l++) { let c = 0; for (let k = 0; k < ch; k++) for (let i = 0; i < N; i++) c += ref[k][i] * (d[k][at + i + l] || 0); if (c > best) { best = c; lag = l; } }
      let e = 0, sg = 0;
      for (let k = 0; k < ch; k++) for (let i = 0; i < len; i++) { const r = ref[k][i] * g, v = d[k][at + i + lag] || 0; e += (v - r) * (v - r); sg += r * r; }
      const snr = 10 * Math.log10(sg / e);
      worst[fmt] = Math.max(worst[fmt], Math.abs(lag)); worstSnr[fmt] = Math.min(worstSnr[fmt], snr);
      assert.ok(snr > (fmt === 'ogg' ? 12 : 8), `${key}: decoded ${fmt} differs from the render (SNR ${snr.toFixed(1)} dB at lag ${lag})`);
    }
  }
  assert.ok(worst.ogg <= 1, 'ogg slots are offset by ' + worst.ogg + ' samples');
  assert.ok(worst.m4a <= 48, 'm4a slots are offset by ' + worst.m4a + ' samples');
  for (const [bus, f] of Object.entries(json.files)) {
    assert.deepStrictEqual(f.delay, { ogg: 0, m4a: 0 }, bus + ' delay');
    assert.strictEqual(f.priming.m4a, 1024, bus + ' AAC priming');
    const first = Object.entries(json.slots).find(([, s]) => s.file === bus)[1];
    assert.strictEqual(f.firstOnset, Math.round(first.offset * SR) + first.onsetSamples, bus + ' firstOnset');
  }
  console.log(`      lag: ogg ≤ ${worst.ogg}, m4a ≤ ${worst.m4a} samples; worst SNR ogg ${worstSnr.ogg.toFixed(1)} dB, m4a ${worstSnr.m4a.toFixed(1)} dB`);
});
ok('playback gains put every slot on its target (peak ±1 dB, punch ±0.5 LU or at its peak cap, sustain ±0.5 dB, LUFS ±1 LU)', () => {
  const worst = {};
  const note = (k, d) => { worst[k] = Math.max(worst[k] || 0, Math.abs(d)); };
  for (const [key, s] of Object.entries(json.slots)) {
    const name = key.split('#')[0], v = +key.split('#')[1], t = SFX.targetOf(name, v), ch = json.files[s.file].channels;
    const sl = playSlot(key), p = db(peak(sl));
    if (t.kind === 'peak') {
      note('peak', p - t.value);
      assert.ok(Math.abs(p - t.value) <= 1, `${key}: decoded peak at playback ${p.toFixed(2)} dBFS, target ${t.value}`);
    } else if (t.kind === 'punch') {
      const l = SFX.punch(sl[0], sl[1] || sl[0]);
      assert.ok(p <= t.cap + 0.05, `${key}: peak ${p.toFixed(2)} dBFS over its cap ${t.cap}`);
      if (p < t.cap - 0.05) { note('punch', l - t.value); assert.ok(Math.abs(l - t.value) <= 0.5, `${key}: loudness ${l.toFixed(2)}, target ${t.value}`); }
      else assert.ok(l >= t.value - 1.5 && l <= t.value + 0.5, `${key}: capped at ${t.cap} dBFS, loudness ${l.toFixed(2)} vs target ${t.value}`);
    } else if (t.kind === 'sustain') {
      const l = SFX.sustain(sl[0], sl[1] || sl[0], t.win[0], t.win[1]); note('sustain', l - t.value);
      assert.ok(Math.abs(l - t.value) <= 0.5, `${key}: sustain ${l.toFixed(2)} dBFS, target ${t.value}`);
      assert.ok(s.truePeakDb <= -1, `${key}: true peak ${s.truePeakDb} dBTP at playback`);
    } else {
      const m = ebur128(ch === 1 ? [sl[0], sl[0]] : sl); note('lufs', m.lufs - t.value);
      assert.ok(Math.abs(m.lufs - t.value) <= 1, `${key}: decoded loudness at playback ${m.lufs} LUFS, target ${t.value}`);
      assert.ok(s.truePeakDb <= -1, `${key}: true peak ${s.truePeakDb} dBTP at playback`);
      assert.ok(m.truePeak <= -0.5, `${key}: decoded true peak ${m.truePeak} dBTP at playback`);
    }
  }
  console.log('      worst decoded deviation: ' + Object.entries(worst).map(([k, d]) => `${k} ${d.toFixed(2)}`).join(', '));
});
ok('variants of a family play equally loud (spread ≤ 1.5 LU) and every "off" sits 1–2 dB under its "on"', () => {
  // a peak target alone follows the random height of a 0.5 ms spike; consecutive
  // clicks were up to 4 dB apart before the families were levelled by loudness
  const loud = key => { const sl = playSlot(key); return SFX.punch(sl[0], sl[1] || sl[0]); };
  let worst = { d: 0, name: '' };
  for (const name of Object.keys(SFX.RECIPES)) {
    const r = SFX.RECIPES[name]; if (r.variants < 2 || r.tiers) continue;
    const l = variantsOf(name).map(loud), d = Math.max(...l) - Math.min(...l);
    if (d > worst.d) worst = { d, name };
    assert.ok(d <= 1.5, `${name}: variants ${l.map(x => x.toFixed(1)).join(' ')} LUFS (spread ${d.toFixed(1)})`);
  }
  for (const [on, off] of [['toggle.on', 'toggle.off'], ['turbo.on', 'turbo.off']]) {
    const a = median(variantsOf(on).map(loud)), b = median(variantsOf(off).map(loud));
    assert.ok(a - b >= 1 && a - b <= 2, `${off} sits ${(a - b).toFixed(2)} dB under ${on}`);
  }
  console.log(`      widest family ${worst.name} ${worst.d.toFixed(2)} LU`);
});
ok('bigger tiers are louder on full range and on a phone speaker (orb shots, embeds, slams)', () => {
  for (const name of ['orb.shot', 'orb.embed', 'slam']) {
    const l = variantsOf(name).map(playLoud);
    for (let k = 1; k < l.length; k++) {
      assert.ok(l[k].full - l[k - 1].full >= 0.5, `${name} tier ${k} full range ${l[k].full.toFixed(1)} vs ${l[k - 1].full.toFixed(1)}`);
      assert.ok(l[k].phone - l[k - 1].phone >= 0.3, `${name} tier ${k} on a phone ${l[k].phone.toFixed(1)} vs ${l[k - 1].phone.toFixed(1)}`);
    }
  }
});
ok('the JS meters (runtime fallback gains) agree with the sheet gains', () => {
  // the sheet levels the decoded .ogg, the fallback levels the render: they differ
  // where the codec moved a sharp peak (peak targets, capped punches) or dropped
  // part of a 9–15 ms high click's energy (punch: Vorbis loses up to ~1 dB of a
  // hover glint, which the sheet gain makes up), never in the meters themselves
  const worst = {}, tol = { lufs: 0.5, sustain: 0.5, punch: 1.25, peak: 1.5 };
  for (const [key, s] of Object.entries(json.slots)) {
    const name = key.split('#')[0], v = +key.split('#')[1], t = SFX.targetOf(name, v), o = renders.get(key);
    const g = db(SFX.gainFor(name, o, v)), d = Math.abs(g - db(s.gain));
    const kind = t.kind === 'punch' && (s.peakDb >= t.cap - 0.05 || db(peak([o.L, o.R])) + g >= t.cap - 0.05) ? 'peak' : t.kind;
    worst[kind] = Math.max(worst[kind] || 0, d);
    assert.ok(d <= tol[kind], `${key}: gainFor ${g.toFixed(2)} dB vs sheet ${db(s.gain).toFixed(2)} dB`);
  }
  console.log('      worst difference (dB): ' + Object.entries(worst).map(([k, d]) => `${k} ${d.toFixed(2)}`).join(', '));
});
ok('the ogg sheets fit the download budget and the decoded sheets the memory budget', () => {
  let total = 0, mem = 0;
  for (const f of Object.values(json.files)) {
    const b = fs.statSync(path.join(ROOT, f.ogg)).size; assert.strictEqual(b, f.bytes.ogg); total += b; assert.ok(fs.statSync(path.join(ROOT, f.m4a)).size > 1000);
    assert.strictEqual(f.decodedBytes, Math.round(f.duration * SR) * f.channels * 4); mem += f.decodedBytes;
  }
  assert.strictEqual(json.decodedBytes, mem);
  assert.ok(total <= BUDGET_OGG, `ogg sheets ${total} bytes > ${BUDGET_OGG}`);
  assert.ok(mem <= BUDGET_DECODED, `decoded sheets ${mem} bytes > ${BUDGET_DECODED}`);
  console.log(`      ogg ${total} bytes (${(total / 1024).toFixed(1)} KiB), m4a ${(Object.values(json.files).reduce((a, f) => a + f.bytes.m4a, 0) / 1024).toFixed(1)} KiB, decoded ${(mem / 1048576).toFixed(2)} MiB`);
});

// ---------------- the spec (v10 sound plan) ----------------
ok('Click is dry and short: ui.press ≤ 70 ms, ui.press.l ≤ 90 ms, and UI sounds keep < 1% of their energy above 8 kHz', () => {
  for (let v = 0; v < 6; v++) { assert.ok(renders.get('ui.press#' + v).L.length <= 0.07 * SR); assert.ok(renders.get('ui.press.l#' + v).L.length <= 0.09 * SR); }
  for (const [key, o] of renders) if (SFX.RECIPES[key.split('#')[0]].bus === 'ui') { const [hi] = bands(o, [[8000, 24000]]); assert.ok(hi < 0.01, `${key}: ${(hi * 100).toFixed(2)}% above 8 kHz`); }
});
ok('Spin press ≤ 180 ms with its breech clack at 22 ms (turbo ≤ 90 ms, clack at 12 ms)', () => {
  const clack = o => {         // the loudest 1 ms of the 0.7–4 kHz band after 10 ms
    const b = biquad(biquad(Float64Array.from(o.L), 'hp', 700, 0.707), 'lp', 4000, 0.707);
    let best = 0, at = 0;
    for (let i = 480; i + 48 < b.length && i < 2880; i += 8) { let e = 0; for (let j = i; j < i + 48; j++) e += b[j] * b[j]; if (e > best) { best = e; at = i; } }
    return at / SR * 1000;
  };
  for (const name of ['spin.press', 'spin.press.dc', 'spin.press.fs', 'spin.press.auto']) for (let v = 0; v < SFX.RECIPES[name].variants; v++) {
    const o = renders.get(name + '#' + v); assert.ok(o.L.length <= 0.18 * SR, name + ' length');
    const c = clack(o); assert.ok(c >= 19 && c <= 26, `${name}#${v} clack at ${c.toFixed(1)} ms`);
  }
  for (let v = 0; v < 2; v++) { const o = renders.get('spin.press.t#' + v); assert.ok(o.L.length <= 0.09 * SR); const c = clack(o); assert.ok(c >= 10 && c <= 16, 'turbo clack at ' + c.toFixed(1)); }
});
ok('lands, the board lock and the bet stop read on phones (body 160–500 Hz, contact 1–5 kHz, ≤ 9.5 LU lost through the speaker)', () => {
  for (let v = 0; v < 4; v++) {
    const [body, contact] = bands(renders.get('land.thock#' + v), [[160, 500], [1000, 5000]]);
    assert.ok(body > 0.4 && contact > 0.04, `land.thock#${v}: ${(body * 100).toFixed(1)}% / ${(contact * 100).toFixed(1)}%`);
  }
  const lost = [];
  for (const name of ['land.thock', 'spin.lock', 'bet.stop']) for (const key of variantsOf(name)) {
    const l = playLoud(key), d = l.full - l.phone; lost.push(`${key} ${d.toFixed(1)}`);
    assert.ok(d <= 9.5, `${key} loses ${d.toFixed(1)} LU on a phone speaker`);
  }
  console.log('      lost on a phone: ' + lost.join(', '));
});
ok('Sebastian\'s call D–A–D is one phrase: the BREAK\'s D4, A4 and D5 sustain within 1.5 dB, rising to the last note', () => {
  // the D4 lives inside fs.break: render the BREAK with and without it (the
  // recipe source with that horn muted) and measure the difference
  const src = fs.readFileSync(RECIPES_FILE, 'utf8'), hook = "0.004, HORN_IN_BREAK);";
  assert.strictEqual(src.split(hook).length, 2, 'the BREAK horn line moved: update this test');
  const mod = { exports: {} };
  vm.runInNewContext(src.replace(hook, '0.004, -400);'), { module: mod });
  const full = renders.get('fs.break#0'), muted = mod.exports.render('fs.break', 0), g = json.slots['fs.break#0'].gain;
  const d = { L: full.L.map((x, i) => (x - muted.L[i]) * g), R: full.R.map((x, i) => (x - muted.R[i]) * g) };
  const level = key => { const sl = playSlot(key); return SFX.sustain(sl[0], sl[1], 0.05, 0.2); };
  const D4 = SFX.sustain(d.L, d.R, 0.05, 0.2), A4 = level('fs.horn.A4#0'), D5 = level('fs.horn.D5#0');
  assert.ok(Math.abs(A4 - D5) <= 1 && D5 >= A4, `A4 ${A4.toFixed(1)} / D5 ${D5.toFixed(1)} dBFS`);
  assert.ok(Math.abs(D4 - A4) <= 1.5 && A4 >= D4 - 0.5, `the BREAK's D4 ${D4.toFixed(1)} vs A4 ${A4.toFixed(1)} dBFS`);
  console.log(`      sustain at playback: D4 ${D4.toFixed(1)}, A4 ${A4.toFixed(1)}, D5 ${D5.toFixed(1)} dBFS RMS`);
});
ok('The Storm Breaks lands on its timeline: charge 2.396 s building −24 -> −18 dBFS into the breath, BREAK hits at once', () => {
  const ch = renders.get('fs.charge#0'); assert.ok(Math.abs(ch.L.length / SR - 2.396) < 0.001, 'charge length ' + ch.L.length / SR);
  // the breath: from 2.316 s everything sits ~18 dB under where the riser was cut
  const cut = peak([ch.L.subarray(Math.round(2.266 * SR), Math.round(2.316 * SR)), ch.R.subarray(Math.round(2.266 * SR), Math.round(2.316 * SR))]);
  const breath = peak([ch.L.subarray(Math.round(2.33 * SR)), ch.R.subarray(Math.round(2.33 * SR))]);
  assert.ok(db(breath) - db(cut) < -15, 'breath only ' + (db(breath) - db(cut)).toFixed(1) + ' dB under the cut');
  // the build at playback: about −24 dBFS for its first 0.4 s, about −18 dBFS before the breath
  const pc = playSlot('fs.charge#0'), seg = (a, b) => db(peak(pc.map(c => c.subarray(Math.round(a * SR), Math.round(b * SR)))));
  const start = seg(0, 0.4), end = seg(1.9, 2.316);
  assert.ok(Math.abs(start + 24) <= 1.5 && Math.abs(end + 18) <= 1, `charge builds ${start.toFixed(1)} -> ${end.toFixed(1)} dBFS`);
  // BREAK hits at once: its first 10 ms are within 3 dB of its loudest 10 ms, which comes in the first 40 ms
  const br = renders.get('fs.break#0'), env = [];
  for (let i = 0; i + 480 <= br.L.length; i += 480) { let e = 0; for (let j = i; j < i + 480; j++) e += br.L[j] * br.L[j] + br.R[j] * br.R[j]; env.push(10 * Math.log10(e + 1e-20)); }
  const mx = Math.max(...env);
  assert.ok(env[0] > mx - 3 && env.indexOf(mx) <= 3, `BREAK envelope: first 10 ms ${(env[0] - mx).toFixed(1)} dB, loudest at ${env.indexOf(mx) * 10} ms`);
  const marks = SFX.RECIPES['fs.break'].marks; assert.ok(Math.abs(marks.hornA4 - 0.2344) < 0.001 && Math.abs(marks.hornD5 - 0.4688) < 0.001);
  console.log(`      charge ${start.toFixed(1)} -> ${end.toFixed(1)} dBFS peak at playback`);
});

console.log(`\n${n} checks passed`);

#!/usr/bin/env node
/* Checks for the v10 sound kit: the recipes (js/sfx-recipes.js), the sheets
 * they were rendered into (sounds/sfx-*.ogg|m4a) and sounds/sfx.json.
 * Run: node tools/test-sfx.js   (needs ffmpeg; re-render with tools/render-sfx.js) */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const assert = require('assert');
const SFX = require(path.join(__dirname, '..', 'js', 'sfx-recipes.js'));

const ROOT = path.join(__dirname, '..');
const SR = SFX.SR;
const BUDGET_OGG = 460000;                 // bytes, all three .ogg sheets (what a browser downloads); target ~450 KB
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const db = x => 20 * Math.log10(Math.max(x, 1e-12));
const lin = d => Math.pow(10, d / 20);
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
function biquad(x, type, f, q) {   // RBJ high/low-pass, for the band checks
  const w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  const b = type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 + 2 * c * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'sounds', 'sfx.json'), 'utf8'));
const all = SFX.list();
const renders = new Map();
for (const [name, v] of all) renders.set(name + '#' + v, SFX.render(name, v));

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
  const src = fs.readFileSync(path.join(ROOT, 'js', 'sfx-recipes.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const bad = src.match(/Math\.(sin|cos|tan|exp|expm1|log|log2|log10|log1p|pow|tanh|sinh|cosh|atan|atan2|asin|acos|hypot|cbrt|random)\b/g);
  assert.ok(!bad, 'non-deterministic Math calls: ' + (bad || []).join(', '));
  assert.ok(!/AudioContext|OfflineAudioContext/.test(src), 'no Web Audio inside the recipes');
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
    assert.ok(r.target && (r.target.peakDb != null) !== (r.target.lufs != null), name + ' target');
    assert.deepStrictEqual(json.recipes[name] && { v: json.recipes[name].variants, b: json.recipes[name].bus, n: json.recipes[name].notes }, { v: r.variants, b: r.bus, n: r.notes }, name + ' in sfx.json');
  }
  assert.deepStrictEqual(Object.keys(SFX.RECIPES).sort(), names.sort(), 'no extra recipes');
  assert.strictEqual(Object.keys(json.slots).length, all.length, 'one slot per recipe x variant');
});

// ---------------- the sheets ----------------
const decoded = {};
for (const [bus, f] of Object.entries(json.files)) decoded[bus] = { ogg: decode(f.ogg, f.channels), m4a: decode(f.m4a, f.channels) };
ok('sound sheets decode, every slot fits inside both files, and nothing clips', () => {
  assert.strictEqual(json.sampleRate, SR);
  for (const [bus, f] of Object.entries(json.files)) for (const fmt of ['ogg', 'm4a']) {
    const d = decoded[bus][fmt], len = d[0].length;
    assert.ok(Math.abs(len / SR - f.duration) < 0.03, `${bus}.${fmt} decodes to ${(len / SR).toFixed(3)} s, sfx.json says ${f.duration}`);
    assert.ok(peak(d) < 1, `${bus}.${fmt} clips`);
    for (const [key, s] of Object.entries(json.slots)) if (s.file === bus) assert.ok(Math.round((s.offset + s.duration) * SR) <= len, `${key} runs past the end of ${bus}.${fmt}`);
  }
});
ok('each slot in the decoded sheets is its recipe, time-aligned (no codec delay to correct)', () => {
  // alignment = the lag (±48 samples) that best matches the first 50 ms; the
  // runtime searches 200 samples for AAC priming, here ffmpeg's decoder applies
  // the MP4 edit list so both formats should sit at lag 0
  let worst = { ogg: 0, m4a: 0 }, worstSnr = { ogg: Infinity, m4a: Infinity };
  for (const [key, s] of Object.entries(json.slots)) {
    const o = renders.get(key), ch = json.files[s.file].channels, start = Math.round(s.offset * SR), len = Math.round(s.duration * SR);
    assert.strictEqual(len, o.L.length, key + ' duration');
    const ref = ch === 1 ? [o.L] : [o.L, o.R], g = lin(-1) / peak(ref), N = Math.min(len, 2400);
    for (const fmt of ['ogg', 'm4a']) {
      const d = decoded[s.file][fmt];
      let best = -Infinity, lag = 0;
      for (let l = -48; l <= 48; l++) { let c = 0; for (let k = 0; k < ch; k++) for (let i = 0; i < N; i++) c += ref[k][i] * (d[k][start + i + l] || 0); if (c > best) { best = c; lag = l; } }
      let e = 0, sg = 0;
      for (let k = 0; k < ch; k++) for (let i = 0; i < len; i++) { const r = ref[k][i] * g, v = d[k][start + i + lag] || 0; e += (v - r) * (v - r); sg += r * r; }
      const snr = 10 * Math.log10(sg / e);
      worst[fmt] = Math.max(worst[fmt], Math.abs(lag)); worstSnr[fmt] = Math.min(worstSnr[fmt], snr);
      assert.ok(snr > (fmt === 'ogg' ? 12 : 8), `${key}: decoded ${fmt} differs from the render (SNR ${snr.toFixed(1)} dB at lag ${lag})`);
    }
  }
  assert.ok(worst.ogg <= 1, 'ogg slots are offset by ' + worst.ogg + ' samples');
  assert.ok(worst.m4a <= 48, 'm4a slots are offset by ' + worst.m4a + ' samples');
  console.log(`      lag: ogg ≤ ${worst.ogg}, m4a ≤ ${worst.m4a} samples; worst SNR ogg ${worstSnr.ogg.toFixed(1)} dB, m4a ${worstSnr.m4a.toFixed(1)} dB`);
});
ok('playback gains put every slot on its target (±1 dB peak / ±1 LU, stingers ≤ −1 dBTP)', () => {
  let worst = 0;
  for (const [key, s] of Object.entries(json.slots)) {
    const name = key.split('#')[0], t = SFX.RECIPES[name].target, ch = json.files[s.file].channels;
    const start = Math.round(s.offset * SR), len = Math.round(s.duration * SR);
    const sl = decoded[s.file].ogg.map(c => Float32Array.from(c.subarray(start, start + len), v => v * s.gain));
    if (t.peakDb != null) {
      const p = db(peak(sl)); worst = Math.max(worst, Math.abs(p - t.peakDb));
      assert.ok(Math.abs(p - t.peakDb) <= 1, `${key}: decoded peak at playback ${p.toFixed(2)} dBFS, target ${t.peakDb}`);
      assert.ok(Math.abs(s.peakDb - t.peakDb) <= 0.1, key + ' sfx.json peakDb');
    } else {
      const m = ebur128(ch === 1 ? [sl[0], sl[0]] : sl); worst = Math.max(worst, Math.abs(m.lufs - t.lufs));
      assert.ok(Math.abs(m.lufs - t.lufs) <= 1, `${key}: decoded loudness at playback ${m.lufs} LUFS, target ${t.lufs}`);
      assert.ok(s.truePeakDb <= -1, `${key}: true peak ${s.truePeakDb} dBTP at playback`);
      assert.ok(m.truePeak <= -0.5, `${key}: decoded true peak ${m.truePeak} dBTP at playback`);
    }
  }
  console.log(`      worst decoded deviation from target: ${worst.toFixed(2)} dB/LU`);
});
ok('the JS loudness meter (runtime fallback gains) agrees with ffmpeg within 0.5 LU', () => {
  let worst = 0;
  for (const [key, s] of Object.entries(json.slots)) {
    const name = key.split('#')[0]; if (SFX.RECIPES[name].target.lufs == null) continue;
    const o = renders.get(key), stored = s.lufs - db(s.gain);      // sfx.json holds loudness at playback
    const js = SFX.loudness(o.L, o.R); worst = Math.max(worst, Math.abs(js - stored));
    assert.ok(Math.abs(js - stored) <= 0.5, `${key}: JS ${js.toFixed(2)} vs ffmpeg ${stored.toFixed(2)} LUFS`);
    assert.ok(Math.abs(db(SFX.gainFor(name, o)) - db(s.gain)) <= 0.5, key + ' gainFor');
  }
  console.log(`      worst difference ${worst.toFixed(2)} LU`);
});
ok('the ogg sheets fit the download budget', () => {
  let total = 0;
  for (const f of Object.values(json.files)) { const b = fs.statSync(path.join(ROOT, f.ogg)).size; assert.strictEqual(b, f.bytes.ogg); total += b; assert.ok(fs.statSync(path.join(ROOT, f.m4a)).size > 1000); }
  assert.ok(total <= BUDGET_OGG, `ogg sheets ${total} bytes > ${BUDGET_OGG}`);
  console.log(`      ogg ${(total / 1024).toFixed(1)} KiB, m4a ${(Object.values(json.files).reduce((a, f) => a + f.bytes.m4a, 0) / 1024).toFixed(1)} KiB`);
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
ok('lands read on phones: body in 160–500 Hz and a contact in 1–5 kHz', () => {
  for (let v = 0; v < 4; v++) {
    const [body, contact] = bands(renders.get('land.thock#' + v), [[160, 500], [1000, 5000]]);
    assert.ok(body > 0.4 && contact > 0.02, `land.thock#${v}: ${(body * 100).toFixed(1)}% / ${(contact * 100).toFixed(1)}%`);
  }
});
ok('The Storm Breaks lands on its timeline: charge 2.396 s ending in the breath, BREAK hits at once', () => {
  const ch = renders.get('fs.charge#0'); assert.ok(Math.abs(ch.L.length / SR - 2.396) < 0.001, 'charge length ' + ch.L.length / SR);
  // the breath: from 2.316 s everything sits ~18 dB under where the riser was cut
  const cut = peak([ch.L.subarray(Math.round(2.266 * SR), Math.round(2.316 * SR)), ch.R.subarray(Math.round(2.266 * SR), Math.round(2.316 * SR))]);
  const breath = peak([ch.L.subarray(Math.round(2.33 * SR)), ch.R.subarray(Math.round(2.33 * SR))]);
  assert.ok(db(breath) - db(cut) < -15, 'breath only ' + (db(breath) - db(cut)).toFixed(1) + ' dB under the cut');
  // the riser rises: last 0.5 s louder than the first 0.5 s
  const rms = (c, a, b) => { let e = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += c[i] * c[i]; return Math.sqrt(e / ((b - a) * SR)); };
  assert.ok(db(rms(ch.L, 1.8, 2.3)) - db(rms(ch.L, 0.0, 0.5)) > 4, 'charge builds');
  // BREAK hits at once: its first 10 ms are within 3 dB of its loudest 10 ms, which comes in the first 40 ms
  const br = renders.get('fs.break#0'), env = [];
  for (let i = 0; i + 480 <= br.L.length; i += 480) { let e = 0; for (let j = i; j < i + 480; j++) e += br.L[j] * br.L[j] + br.R[j] * br.R[j]; env.push(10 * Math.log10(e + 1e-20)); }
  const mx = Math.max(...env);
  assert.ok(env[0] > mx - 3 && env.indexOf(mx) <= 3, `BREAK envelope: first 10 ms ${(env[0] - mx).toFixed(1)} dB, loudest at ${env.indexOf(mx) * 10} ms`);
  const marks = SFX.RECIPES['fs.break'].marks; assert.ok(Math.abs(marks.hornA4 - 0.2344) < 0.001 && Math.abs(marks.hornD5 - 0.4688) < 0.001);
});

console.log(`\n${n} checks passed`);

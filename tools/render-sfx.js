#!/usr/bin/env node
/* Thunder Hunter Sebastian — renders the v10 sound sheets from js/sfx-recipes.js.
 *
 *   node tools/render-sfx.js                      # render, measure, encode, write sounds/
 *   node tools/render-sfx.js --work /tmp/sfx      # where the WAVs and previews go (default: OS temp)
 *   node tools/render-sfx.js --no-encode          # measure and print only, leave sounds/ alone
 *   node tools/render-sfx.js --calibrate          # first rewrite the PUNCH table in js/sfx-recipes.js
 *
 * Authoring tool like export-math.js: the game itself has no build step and
 * can render the same recipes at runtime. Needs ffmpeg (libvorbis + aac).
 *
 * For every recipe x variant:
 *   1. render it (48 kHz float, deterministic per seed)
 *   2. normalise the stored audio to −1 dBFS sample peak
 * Slots are packed per bus (ui mono, world and fs stereo) with 60 ms of silence
 * between them (and before the first), encoded to sounds/sfx-<bus>.ogg (Vorbis;
 * ui q4, world q5, fs q4, see BUSES) and sounds/sfx-<bus>.m4a (AAC 128 kbps). Then each slot is
 * measured where it will play from, the decoded .ogg (a codec moves sharp peaks
 * by up to ~1 dB), with ffmpeg ebur128: integrated LUFS over the sound plus 0.5 s
 * of silence, sample peak, 4x true peak; UI slots are measured dual-mono, the
 * way they play. The linear playback gain puts the slot on its recipe's target
 * (SFX.targetOf, the same rules as SFX.gainFor at runtime):
 *   peak    -> sample peak
 *   punch   -> short-window loudness (SFX.punch, loudest 100 ms), peak capped at
 *              peakDb + 1: variants, tiers and on/off pairs that must match or step
 *   sustain -> RMS over a window (the horn call, levelled as one phrase)
 *   lufs    -> integrated loudness; a stinger's true peak after gain stays <= −1 dBTP
 * sounds/sfx.json describes it all:
 *
 *   files[<sheet>] = {ogg, m4a, channels, duration, bytes, decodedBytes (48 kHz
 *     float), delay: {ogg, m4a} (samples the decoded sheet is late by, measured;
 *     0 = play slots at their offsets), priming: {m4a} (what a decoder that
 *     ignores the MP4 edit list adds), firstOnset (sample of the first slot's
 *     attack, to measure one offset per sheet)}
 *   slots["<name>#<variant>"] = {file: <sheet>, offset, duration (s), gain (linear),
 *     lufs, punch, peakDb, truePeakDb (at playback, i.e. after gain), onsetSamples
 *     (first sample above −40 dB re the slot peak), hash (of the render)}
 *
 * Phone previews (high-pass 300 Hz, low-pass 10 kHz) of the three families are
 * written to <work>/preview for listening.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const RECIPES_FILE = path.join(__dirname, '..', 'js', 'sfx-recipes.js');
let SFX = require(RECIPES_FILE);

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WORK = path.resolve(arg('--work', path.join(os.tmpdir(), 'gos-render-sfx')));
const ENCODE = !args.includes('--no-encode');
const CALIBRATE = args.includes('--calibrate');
const SR = SFX.SR, GAP = 0.06, TARGET_STORE_DB = -1;
// cutoff: the encoder's own lowpass sits where the recipes stop (ui is cut at 7.5 kHz, world/fs at 11 kHz).
// q: the stingers (fs) are encoded at q4, not q5: since they end in their own
// tails (~2 s tier beds, a 2.5 s finale) q5 would put the .ogg set ~40 KB over
// its ~450 KB budget. They are long, dense and play over the music on the
// stinger bus, the most forgiving material here; the short, transient world
// and UI sounds keep q5/q4.
const BUSES = { ui: { channels: 1, q: 4, cutoff: 11000 }, world: { channels: 2, q: 5, cutoff: 11000 }, fs: { channels: 2, q: 4, cutoff: 11000 } };
const AAC_KBPS = 128;
const VERSION = 1;

fs.mkdirSync(path.join(WORK, 'slots'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'preview'), { recursive: true });

// ---------------- helpers ----------------
const dbOf = x => 20 * Math.log10(Math.max(x, 1e-12));
const lin = d => Math.pow(10, d / 20);
const round = (x, d) => Number(x.toFixed(d));
function peak(chs) { let p = 0; for (const c of chs) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i])); return p; }
function onset(chs, rel) {   // first sample above `rel` dB relative to the peak
  const t = peak(chs) * lin(rel), n = chs[0].length;
  for (let i = 0; i < n; i++) for (const c of chs) if (Math.abs(c[i]) >= t) return i;
  return n;
}
function hashOf(out) {
  const h = crypto.createHash('sha256');
  h.update(Buffer.from(out.L.buffer, out.L.byteOffset, out.L.byteLength));
  h.update(Buffer.from(out.R.buffer, out.R.byteOffset, out.R.byteLength));
  return h.digest('hex').slice(0, 16);
}
// 32-bit float WAV (format 3), interleaved
function writeWav(file, chs) {
  const n = chs[0].length, c = chs.length, data = Buffer.alloc(n * c * 4);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) data.writeFloatLE(chs[k][i], (i * c + k) * 4);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(c, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * c * 4, 28); h.writeUInt16LE(c * 4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
function ffmpeg(argv) {
  return new Promise((resolve, reject) => {
    cp.execFile('ffmpeg', ['-hide_banner', '-nostats'].concat(argv), { maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      if (err) reject(new Error('ffmpeg failed: ' + argv.join(' ') + '\n' + stderr)); else resolve(stderr);
    });
  });
}
// ebur128 summary: integrated LUFS, sample peak, true peak (dBFS)
async function measure(file) {
  const log = await ffmpeg(['-i', file, '-af', 'apad=pad_dur=0.5,ebur128=peak=true+sample:framelog=quiet', '-f', 'null', '-']);
  const sum = log.slice(log.lastIndexOf('Summary:'));
  const num = re => { const m = sum.match(re); return m ? Number(m[1]) : NaN; };
  return {
    lufs: num(/I:\s+(-?[\d.]+|-inf)\s+LUFS/),
    sample: num(/Sample peak:\s+Peak:\s+(-?[\d.]+|-inf)/),
    truePeak: num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)/),
  };
}
function decode(file, ch, inputOpts) {
  const b = cp.execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error'].concat(inputOpts || [], ['-i', file, '-f', 'f32le', '-ac', String(ch), '-ar', String(SR), '-']), { maxBuffer: 1 << 28 });
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), len = x.length / ch;
  return Array.from({ length: ch }, (_, k) => { const c = new Float32Array(len); for (let i = 0; i < len; i++) c[i] = x[i * ch + k]; return c; });
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

// ---------------- calibrate: the PUNCH table in js/sfx-recipes.js ----------------
// A family's short-window loudness at its nominal peak (median over the
// variants); tiers step up `tierStep` dB to the top tier's nominal level; an
// `under: [name, dB]` recipe sits that far under the other one.
function calibrate() {
  const table = {}, later = [];
  for (const name of Object.keys(SFX.RECIPES)) {
    const r = SFX.RECIPES[name], t = r.target;
    if (!t.punch) continue;
    if (t.under) { later.push(name); continue; }
    const at = v => Array.isArray(t.peakDb) ? t.peakDb[v] : t.peakDb;
    const nominal = [];
    for (let v = 0; v < r.variants; v++) { const o = SFX.render(name, v); nominal.push(SFX.punch(o.L, o.R) + at(v) - dbOf(peak([o.L, o.R]))); }
    if (t.tierStep) { const top = nominal[nominal.length - 1]; table[name] = nominal.map((_, k) => round(top - (nominal.length - 1 - k) * t.tierStep, 1)); }
    else { const s = nominal.slice().sort((a, b) => a - b), m = s.length >> 1; table[name] = round(s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2, 1); }
  }
  for (const name of later) { const [ref, d] = SFX.RECIPES[name].target.under; table[name] = round(table[ref] - d, 1); }
  const body = '  const PUNCH = {\n' + Object.entries(table).map(([k, v]) => `    '${k}': ${JSON.stringify(v).replace(/,/g, ', ')},`).join('\n') + '\n  };\n';
  const src = fs.readFileSync(RECIPES_FILE, 'utf8'), re = /(\/\/ <punch> \(generated\)\n)[\s\S]*?(\s*\/\/ <\/punch>)/;
  if (!re.test(src)) throw new Error('no <punch> block in ' + RECIPES_FILE);
  fs.writeFileSync(RECIPES_FILE, src.replace(re, (all, a, b) => a + body + b.replace(/^\n/, '')));
  delete require.cache[require.resolve(RECIPES_FILE)];
  SFX = require(RECIPES_FILE);
  console.log(`calibrated ${Object.keys(table).length} loudness targets -> ${path.relative(process.cwd(), RECIPES_FILE)}`);
}

// How late a decoded sheet is (samples): for every slot, the lag (±maxLag) at
// which its first 25 ms best match the render; the median over the slots (one
// slot can mislead: a tremolo or a ring correlates at several lags)
function sheetDelay(mine, got, maxLag) {
  const lags = mine.map(s => {
    const ref = s.chs[0], N = Math.min(ref.length, 1200); let best = -Infinity, lag = 0;
    for (let l = -maxLag; l <= maxLag; l++) {     // normalised: a louder stretch of the slot must not win
      let c = 0, e = 0; for (let i = 0; i < N; i++) { const g = got[s.start + i + l] || 0; c += ref[i] * g; e += g * g; }
      c /= Math.sqrt(e) || 1; if (c > best) { best = c; lag = l; }
    }
    return lag;
  }).sort((a, b) => a - b);
  return lags[lags.length >> 1];
}

// ---------------- render ----------------
async function main() {
  const t0 = Date.now();
  if (CALIBRATE) calibrate();
  const slots = SFX.list().map(([name, variant]) => {
    const r = SFX.RECIPES[name], out = SFX.render(name, variant);
    const p = peak([out.L, out.R]), g = lin(TARGET_STORE_DB) / p;
    const L = Float32Array.from(out.L, v => v * g), Rr = Float32Array.from(out.R, v => v * g);
    const chs = BUSES[r.bus].channels === 1 ? [L] : [L, Rr];
    return { key: name + '#' + variant, name, variant, r, t: SFX.targetOf(name, variant), chs, hash: hashOf(out), onset: onset(chs, -40), notesUsed: out.notesUsed };
  });
  console.log(`rendered ${slots.length} slots in ${Date.now() - t0} ms`);

  // ---------------- sheets ----------------
  const json = { version: VERSION, sampleRate: SR, gap: GAP, files: {}, slots: {}, recipes: {} };
  const gapN = Math.round(GAP * SR), decoded = {};
  for (const bus of Object.keys(BUSES)) {
    const mine = slots.filter(s => s.r.bus === bus), ch = BUSES[bus].channels;
    const total = gapN + mine.reduce((a, s) => a + s.chs[0].length + gapN, 0);
    const sheet = Array.from({ length: ch }, () => new Float32Array(total));
    let at = gapN;
    for (const s of mine) {
      for (let k = 0; k < ch; k++) sheet[k].set(s.chs[k], at);
      s.start = at; s.length = s.chs[0].length;
      at += s.length + gapN;
    }
    const wav = path.join(WORK, `sfx-${bus}.wav`);
    writeWav(wav, sheet);
    const ogg = `sounds/sfx-${bus}.ogg`, m4a = `sounds/sfx-${bus}.m4a`;
    const f = json.files[bus] = { ogg, m4a, channels: ch, duration: round(total / SR, 6), bytes: {}, decodedBytes: total * ch * 4 };
    if (ENCODE) {
      const common = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
      await ffmpeg(['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', String(BUSES[bus].q), '-cutoff', String(BUSES[bus].cutoff)].concat(common, [path.join(ROOT, ogg)]));
      await ffmpeg(['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', AAC_KBPS + 'k', '-movflags', '+faststart'].concat(common, [path.join(ROOT, m4a)]));
      decoded[bus] = decode(path.join(ROOT, ogg), ch);
      // codec delay, measured: what the engine must add to every offset, per format
      // (firstOnset lets it check one slot per sheet: each sheet opens with 60 ms of silence)
      f.delay = { ogg: sheetDelay(mine, decoded[bus][0], 1100), m4a: sheetDelay(mine, decode(path.join(ROOT, m4a), ch)[0], 1100) };
      f.priming = { m4a: sheetDelay(mine, decode(path.join(ROOT, m4a), ch, ['-ignore_editlist', '1'])[0], 1100) - f.delay.m4a };
      f.firstOnset = mine[0].start + mine[0].onset;
    }
    const size = p => fs.existsSync(path.join(ROOT, p)) ? fs.statSync(path.join(ROOT, p)).size : 0;
    f.bytes = { ogg: size(ogg), m4a: size(m4a) };
  }
  json.decodedBytes = Object.values(json.files).reduce((a, f) => a + f.decodedBytes, 0);

  // ---------------- measure what will play (the decoded .ogg slot) and set gains ----------------
  await pool(slots, Math.max(2, os.cpus().length), async s => {
    const src = decoded[s.r.bus] ? decoded[s.r.bus].map(c => c.slice(s.start, s.start + s.length)) : s.chs;
    const file = path.join(WORK, 'slots', s.key.replace(/[^\w.#-]/g, '_') + '.wav');
    writeWav(file, src.length === 1 ? [src[0], src[0]] : src);    // dual-mono: UI plays on both speakers
    s.m = await measure(file);
    s.m.punch = SFX.punch(src[0], src[1] || src[0]);
    const t = s.t;
    let gainDb;
    if (t.kind === 'lufs') gainDb = t.value - s.m.lufs;
    else if (t.kind === 'sustain') gainDb = t.value - SFX.sustain(src[0], src[1] || src[0], t.win[0], t.win[1]);
    else if (t.kind === 'punch') gainDb = Math.min(t.value - s.m.punch, t.cap - s.m.sample);
    else gainDb = t.value - s.m.sample;
    s.gainDb = gainDb;
    s.play = { lufs: s.m.lufs + gainDb, punch: s.m.punch + gainDb, peak: s.m.sample + gainDb, truePeak: s.m.truePeak + gainDb };
    s.problems = [];
    if (t.kind === 'lufs' || t.kind === 'sustain') { if (s.play.truePeak > -1 + 0.05) s.problems.push(`true peak ${s.play.truePeak.toFixed(1)} dBTP after gain`); }
    else if (s.play.truePeak > 0) s.problems.push(`true peak ${s.play.truePeak.toFixed(1)} dBTP after gain`);
    if (t.kind === 'punch' && s.play.punch < t.value - 1.5) s.problems.push(`${(t.value - s.play.punch).toFixed(1)} dB under its loudness target (peak cap)`);
    if (s.onset > 48) s.problems.push(`onset ${s.onset} samples`);
    if (!Number.isFinite(s.m.lufs)) s.problems.push('no loudness');
  });
  for (const s of slots) {
    json.slots[s.key] = {
      file: s.r.bus, offset: round(s.start / SR, 6), duration: round(s.length / SR, 6),
      gain: Number(lin(s.gainDb).toPrecision(6)), lufs: round(s.play.lufs, 1), punch: round(s.play.punch, 1), peakDb: round(s.play.peak, 1), truePeakDb: round(s.play.truePeak, 1),
      onsetSamples: s.onset, hash: s.hash,
    };
  }
  for (const name of Object.keys(SFX.RECIPES)) {
    const r = SFX.RECIPES[name], target = Object.assign({}, r.target);
    if (target.punch) { target.punch = SFX.PUNCH[name]; delete target.under; delete target.tierStep; }
    json.recipes[name] = { variants: r.variants, bus: r.bus, stereo: !!r.stereo, notes: r.notes, target };
    if (r.tiers) json.recipes[name].tiers = true;
    if (r.marks) json.recipes[name].marks = r.marks;
  }
  json.hash = crypto.createHash('sha256').update(slots.map(s => s.hash).join('')).digest('hex').slice(0, 12);
  if (ENCODE) fs.writeFileSync(path.join(ROOT, 'sounds', 'sfx.json'), format(json));

  // ---------------- report ----------------
  const pad = (v, n) => String(v).padStart(n);
  console.log('\n' + 'slot'.padEnd(20) + pad('bus', 6) + pad('ms', 7) + pad('onset', 7) + pad('gain dB', 9) + pad('play pk', 9) + pad('punch', 8) + pad('LUFS', 7) + pad('TP', 7) + '  target');
  for (const s of slots) {
    const t = s.t, desc = t.kind === 'punch' ? `punch ${t.value} (pk ≤ ${t.cap})` : t.kind === 'sustain' ? `sustain ${t.value} dBFS` : t.kind === 'lufs' ? `${t.value} LUFS` : `peak ${t.value}`;
    console.log(s.key.padEnd(20) + pad(s.r.bus, 6) + pad((s.length / SR * 1000).toFixed(0), 7) + pad(s.onset, 7) +
      pad(s.gainDb.toFixed(1), 9) + pad(s.play.peak.toFixed(1), 9) + pad(s.play.punch.toFixed(1), 8) + pad(s.play.lufs.toFixed(1), 7) + pad(s.play.truePeak.toFixed(1), 7) +
      '  ' + desc + (s.problems.length ? '  !! ' + s.problems.join('; ') : ''));
  }
  console.log('  (levels at playback, measured on the decoded .ogg slot; the sheet audio peaks at −1 dBFS)');
  const bytes = { ogg: 0, m4a: 0 };
  for (const [bus, f] of Object.entries(json.files)) {
    console.log(`sfx-${bus}: ${f.duration.toFixed(2)} s, ${f.channels} ch, ogg ${(f.bytes.ogg / 1024).toFixed(1)} KB, m4a ${(f.bytes.m4a / 1024).toFixed(1)} KB, decoded ${(f.decodedBytes / 1048576).toFixed(2)} MB` +
      (f.delay ? `, delay ogg ${f.delay.ogg} / m4a ${f.delay.m4a} (+${f.priming.m4a} without the edit list)` : ''));
    bytes.ogg += f.bytes.ogg; bytes.m4a += f.bytes.m4a;
  }
  console.log(`total: ogg ${bytes.ogg} bytes (${(bytes.ogg / 1024).toFixed(1)} KB), m4a ${(bytes.m4a / 1024).toFixed(1)} KB, decoded ${(json.decodedBytes / 1048576).toFixed(2)} MB`);

  await previews(slots);
  const bad = slots.filter(s => s.problems.length);
  console.log(`\n${slots.length} slots, ${bad.length} with problems, ${((Date.now() - t0) / 1000).toFixed(1)} s` + (ENCODE ? '' : ' (not encoded)'));
  if (bad.length) process.exitCode = 1;
}

// sfx.json with one slot per line (diffs stay readable)
function format(j) {
  const line = o => JSON.stringify(o);
  const block = (o, ind) => '{\n' + Object.entries(o).map(([k, v]) => ind + JSON.stringify(k) + ': ' + line(v)).join(',\n') + '\n' + ind.slice(2) + '}';
  return '{\n' +
    `  "version": ${j.version},\n  "hash": ${JSON.stringify(j.hash)},\n  "sampleRate": ${j.sampleRate},\n  "gap": ${j.gap},\n  "decodedBytes": ${j.decodedBytes},\n` +
    `  "files": ${block(j.files, '    ')},\n  "slots": ${block(j.slots, '    ')},\n  "recipes": ${block(j.recipes, '    ')}\n}\n`;
}

// ---------------- previews: the families as they would play (playback gains applied) ----------------
async function previews(slots) {
  const by = {}; for (const s of slots) by[s.key] = s;
  const dir = path.join(WORK, 'preview');
  const seq = (dur) => ({ L: new Float32Array(Math.round(dur * SR)), R: new Float32Array(Math.round(dur * SR)) });
  // place a slot at t seconds with extra dB and optional playbackRate (linear interpolation is fine for a preview)
  const put = (o, key, t, extraDb, rate) => {
    const s = by[key.includes('#') ? key : key + '#0']; if (!s) throw new Error('preview: no slot ' + key);
    const g = lin(s.gainDb + (extraDb || 0)), at = Math.round(t * SR), rt = rate || 1, n = Math.floor(s.length / rt);
    const L = s.chs[0], Rr = s.chs[1] || s.chs[0];
    for (let i = 0; i < n && at + i < o.L.length; i++) {
      const x = i * rt, k = Math.floor(x), f = x - k, k1 = Math.min(k + 1, s.length - 1);
      o.L[at + i] += (L[k] + (L[k1] - L[k]) * f) * g; o.R[at + i] += (Rr[k] + (Rr[k1] - Rr[k]) * f) * g;
    }
  };
  const out = [];
  // UI family
  {
    const o = seq(6.2); let t = 0.1;
    for (let v = 0; v < 6; v++, t += 0.22) put(o, 'ui.press#' + v, t);
    t += 0.2; for (let v = 0; v < 6; v++, t += 0.25) put(o, 'ui.press.l#' + v, t, 0, v % 2 ? 1.0175 : 0.9827);
    t += 0.2; for (const k of ['toggle.on#0', 'toggle.off#0', 'turbo.on#0', 'turbo.off#0', 'bet.stop#0', 'ui.denied#0', 'ui.confirm#0']) { put(o, k, t); t += 0.4; }
    put(o, 'ui.press#2', t); put(o, 'ui.open#0', t + 0.02); t += 0.5; put(o, 'ui.close#0', t); t += 0.45;
    for (let v = 0; v < 3; v++) { put(o, 'ui.hover#' + v, t); t += 0.15; }
    for (let v = 0; v < 3; v++) { put(o, 'ui.press.l#' + v, t); put(o, 'ui.release#' + v, t + 0.12); t += 0.3; }
    out.push(['ui-family', o]);
  }
  // Spin family: press -> (network) -> dropout -> 6 lands with tines -> lock; then a slam
  {
    const o = seq(7.5);
    const VOICINGS = [['G4', 'Bb4', 'C5', 'D5', 'F5', 'G5'], ['G4', 'Bb4', 'D5', 'C5', 'F5', 'G5'], ['Bb4', 'C5', 'D5', 'F5', 'G5', 'G4']];
    let t = 0.1;
    for (let sp = 0; sp < 4; sp++) {
      const key = sp === 3 ? 'spin.press.dc#0' : 'spin.press#' + sp;
      put(o, key, t);
      const d = t + 0.25; put(o, 'spin.dropout#' + (sp % 3), d);
      const l0 = d + 0.2, tines = sp !== 2;                  // one spin in four drops the tines (here: the third)
      for (let c = 0; c < 6; c++) {
        put(o, 'land.thock#' + (c % 4), l0 + c * 0.075);
        if (tines) put(o, 'tine.' + VOICINGS[sp % 3][c], l0 + c * 0.075 + 0.003, -12);
      }
      put(o, 'spin.lock#' + (sp % 2), l0 + 5 * 0.075 + 0.12);
      t = l0 + 0.6 + 0.35;
    }
    // slam: press, dropout, two lands, brake, the rest merge into one chord
    put(o, 'spin.press#3', t); const d = t + 0.25; put(o, 'spin.dropout#2', d);
    put(o, 'land.thock#0', d + 0.2); put(o, 'tine.G4', d + 0.203, -12);
    put(o, 'spin.brake#0', d + 0.26);
    put(o, 'land.thock#1', d + 0.27, 3); for (const [i, nm] of ['Bb4', 'C5', 'D5', 'F5', 'G5'].entries()) put(o, 'tine.' + nm, d + 0.273 + i * 0.01, -12);
    t = d + 1.0;
    put(o, 'spin.press.t#0', t); put(o, 'spin.press.t#1', t + 0.35); put(o, 'spin.press.auto#0', t + 0.7); put(o, 'spin.press.fs#0', t + 1.05);
    out.push(['spin-family', o]);
  }
  // World events: wins, orbs, slams
  {
    const o = seq(9.0); let t = 0.1;
    for (const k of ['win.tick#0', 'win.chime#0', 'win.coins#0']) { put(o, k, t); t += 0.75; }
    for (let i = 0; i < 10; i++) put(o, 'count.tick#' + (i % 4), t + i * 0.0694); t += 0.9;
    for (let v = 0; v < 4; v++) { put(o, 'orb.shot#' + v, t); put(o, 'shell.eject#' + (v % 3), t + 0.08); put(o, 'orb.embed#' + v, t + 0.35); t += 1.25 + v * 0.1; }
    put(o, 'collect#0', t); t += 0.7;
    for (let v = 0; v < 4; v++) { put(o, 'slam#' + v, t); t += 0.6 + v * 0.2; }
    put(o, 'tumble#0', t); put(o, 'scatter.lock#0', t + 0.5); put(o, 'tine.G4', t + 0.5);
    out.push(['world-events', o]);
  }
  // The Storm Breaks: the H6 timeline (t = 0 at scatterFanfare), then the FS family
  {
    const o = seq(29.0), BREAK = 2.996, E8 = 0.2344, S32 = 0.0586;
    ['G4', 'Bb4', 'D5', 'G5'].forEach((nm, i) => { put(o, 'scatter.lock#0', i * 0.12); put(o, 'tine.' + nm, i * 0.12, -4); });
    put(o, 'fs.charge#0', 0.6);
    put(o, 'fs.break#0', BREAK); put(o, 'fs.horn.A4#0', BREAK + E8); put(o, 'fs.horn.D5#0', BREAK + 2 * E8);
    const PENTA = [0, 2, 4, 7, 9];
    for (let k = 0; k < 15; k++) { const d = Math.floor(k * 9 / 15), st = PENTA[d % 5] + 12 * Math.floor(d / 5); put(o, 'fs.award.click#' + (k % 3), BREAK + 2 * E8 + k * S32, 0, Math.pow(2, st / 12)); }
    put(o, 'spin.press.fs#1', 4.6);
    let t = 5.6; put(o, 'fs.retrigger#0', t); t += 1.3;
    for (let v = 0; v < 5; v++) { put(o, 'fs.milestone#' + v, t); t += 0.95; }
    put(o, 'fs.last#0', t); t += 0.9;
    put(o, 'fs.outro#0', t); t += 2.6;
    for (let k = 0; k < 4; k++) { put(o, 'tier.' + k, t); t += 2.6; }
    put(o, 'maxwin#0', t);
    out.push(['storm-breaks', o]);
    o.marks = { BREAK };
  }
  for (const [name, o] of out) {
    const full = path.join(dir, name + '.wav'), phone = path.join(dir, name + '-phone.wav');
    const pk = peak([o.L, o.R]);
    writeWav(full, [o.L, o.R]);
    await ffmpeg(['-y', '-loglevel', 'error', '-i', full, '-af', 'highpass=f=300:poles=2,highpass=f=300:poles=2,lowpass=f=10000:poles=2', '-c:a', 'pcm_f32le', phone]);
    console.log(`preview ${name}: ${(o.L.length / SR).toFixed(1)} s, peak ${dbOf(pk).toFixed(1)} dBFS -> ${path.relative(process.cwd(), full)} (+ -phone)`);
  }
  // under the music: the storm sequence over the base track (filtered) handing to the feature track from offset 0 at t = 0.6 s
  const base = path.join(ROOT, 'sounds', 'music-base.ogg'), feat = path.join(ROOT, 'sounds', 'music-feature.ogg');
  if (fs.existsSync(base) && fs.existsSync(feat)) {
    const storm = path.join(dir, 'storm-breaks.wav'), mixed = path.join(dir, 'storm-breaks-music.wav');
    // music at about −23 LUFS (v10 target): base −18.7 LUFS source -> −4.3 dB; feature −12.9 -> −10.1 dB
    await ffmpeg(['-y', '-loglevel', 'error', '-i', storm, '-ss', '20', '-i', base, '-i', feat, '-filter_complex',
      '[1:a]aresample=48000,atrim=0:1.0,volume=-4.3dB,lowpass=f=900,afade=t=out:st=0.6:d=0.4[b];' +
      '[2:a]aresample=48000,atrim=0:28.4,volume=-10.1dB,adelay=600|600[f];' +
      '[0:a][b][f]amix=inputs=3:normalize=0:duration=first[m]', '-map', '[m]', '-c:a', 'pcm_f32le', mixed]);
    console.log(`preview storm-breaks-music: the sequence over the soundtracks -> ${path.relative(process.cwd(), mixed)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

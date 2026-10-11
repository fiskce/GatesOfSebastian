/* Thunder Hunter Sebastian — v10 "Forged Storm" sound recipes.
 *
 * One recipe source for every new sound effect. tools/render-sfx.js renders
 * them offline into the sound sheets (sounds/sfx-ui|world|fs.ogg + .m4a and
 * sounds/sfx.json); the game can render the very same recipes at runtime when
 * a sheet can't be loaded (file://, decode failure), so it never changes voice.
 *
 * Pure JS, no Web Audio. A recipe depends only on its seed, and the kit uses
 * nothing but IEEE-754 basic arithmetic: sin/exp/log below are our own
 * polynomials (Math.sin & co. may differ in the last bit between engines), so
 * Node and every browser render bit-identical samples.
 *
 * The sound language (v10 plan, "Sound redesign"):
 *   - tonal elements use only G A Bb C D F (safe over the G-minor base track and
 *     the F-major / D-minor feature track); root D; Sebastian's horn call D–A–D
 *   - every press starts with the shared 0.5 ms "detent" (noise band-passed at
 *     3.2 kHz) on sample 0; it sits in the 1–8 kHz gap both tracks leave
 *   - weight comes from tanh harmonics at 160–480 Hz (phone speakers); sub
 *     below 60 Hz is only ever a −12 dB extra
 *   - four material voices: brass (chrome), steel (breech), glass (board, orbs),
 *     storm (sky); felt damps the chrome
 *   - bigger = lower, longer, wider
 *
 * Exposes window.GOS_SFX (module.exports in Node):
 *   SR                      48000
 *   NOTES                   {'D6': Hz, ...} for G A Bb C D F, octaves 0–8
 *   RECIPES[name]           {variants, bus: 'ui'|'world'|'fs', stereo, notes, target:{peakDb}|{lufs}, marks?, render(seed, variant)}
 *   list()                  [[name, variant], ...] in sheet order
 *   render(name, variant)   {L, R} Float32Array at 48 kHz, peak −1 dBFS (+ notesUsed)
 *   seedOf(name, variant)   the seed render() uses
 *   loudness(L, R)          BS.1770 integrated LUFS (the same 400 ms/100 ms gating as ffmpeg ebur128)
 *   gainFor(name, out)      linear playback gain that puts a render on its target (for the runtime fallback)
 */
(function (root, factory) {
  const SFX = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = SFX;
  else root.GOS_SFX = SFX;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SR = 48000;
  const PI = 3.141592653589793, LN2 = 0.6931471805599453, LN10 = 2.302585092994046;

  // ---------------- deterministic math (basic IEEE ops only) ----------------
  // sin(2πp): reduce to a quarter wave, Taylor to x^15 (error < 1e-9)
  function sin1(p) {
    p -= Math.floor(p);
    let q = p < 0.5 ? p : p - 1;
    if (q > 0.25) q = 0.5 - q; else if (q < -0.25) q = -0.5 - q;
    const x = q * 2 * PI, x2 = x * x;
    return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156 * (1 - x2 / 210)))))));
  }
  const cos1 = p => sin1(p + 0.25);
  function exp(x) {
    if (x < -700) return 0;
    if (x > 700) x = 700;
    const t = x / LN2, n = Math.floor(t), r = (t - n) * LN2;
    let s = 1, term = 1;
    for (let k = 1; k <= 13; k++) { term = term * r / k; s += term; }
    if (n > 0) for (let i = 0; i < n; i++) s *= 2;
    else for (let i = 0; i < -n; i++) s *= 0.5;
    return s;
  }
  function log(x) {
    if (!(x > 0)) return -Infinity;
    let n = 0;
    while (x >= 2) { x *= 0.5; n++; }
    while (x < 1) { x *= 2; n--; }
    const s = (x - 1) / (x + 1), s2 = s * s;
    let sum = 0, p = s;
    for (let k = 1; k < 42; k += 2) { sum += p / k; p *= s2; }
    return 2 * sum + n * LN2;
  }
  const db = d => exp(d * LN10 / 20);
  const toDb = x => 20 * log(x) / LN10;
  const cents = c => exp(c * LN2 / 1200);
  const pw = (x, y) => x > 0 ? exp(y * log(x)) : 0;          // x^y for x >= 0
  const tanPi = u => sin1(u / 2) / cos1(u / 2);              // tan(πu)
  // rational tanh (Padé 3/2, smooth clip at ±3): the saturation used everywhere
  function tanh(x) {
    if (x >= 3) return 1;
    if (x <= -3) return -1;
    const x2 = x * x;
    return x * (27 + x2) / (27 + 9 * x2);
  }
  const decayK = t60 => exp(-6.907755278982137 / (Math.max(1e-4, t60) * SR));   // per-sample factor reaching −60 dB at t60

  // ---------------- seeded noise ----------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  const seedOf = (name, variant) => fnv('gos10:' + name + '#' + (variant | 0));
  const rr = (rng, a, b) => a + (b - a) * rng();
  const vary = (rng, x, p) => x * (1 + p * (2 * rng() - 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

  // ---------------- notes: only the six safe pitch classes exist ----------------
  const PC = { C: 0, D: 2, F: 5, G: 7, A: 9, Bb: 10 };
  const NOTES = {};
  for (let oct = 0; oct <= 8; oct++) for (const k in PC) {
    const midi = 12 * (oct + 1) + PC[k];
    NOTES[k + oct] = 440 * exp((midi - 69) / 12 * LN2);
  }
  let used = null;                                   // notes touched by the running render
  function note(name) {
    const f = NOTES[name];
    if (!f) throw new Error('sfx: note outside G A Bb C D F: ' + name);
    if (used) used.add(name);
    return f;
  }

  // ---------------- buffers & mixing ----------------
  const ns = sec => Math.max(1, Math.round(sec * SR));
  function peakOf(x) { let p = 0; for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > p) p = a; } return p; }
  function norm(x, to) { const p = peakOf(x); if (p > 0) { const g = (to || 1) / p; for (let i = 0; i < x.length; i++) x[i] *= g; } return x; }
  function scale(x, g) { for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
  function reverse(x) { const y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[x.length - 1 - i]; return y; }
  function addInto(dst, src, at, g) { const o = Math.round(at * SR); for (let i = 0; i < src.length && i + o < dst.length; i++) dst[i + o] += src[i] * g; return dst; }

  // stereo mix bus; pan −1..1, equal power, centre = unity on both sides
  function Mix(sec) { this.n = ns(sec); this.L = new Float64Array(this.n); this.R = new Float64Array(this.n); }
  Mix.prototype.add = function (x, at, gainDb, pan) {
    const o = Math.round((at || 0) * SR), g = db(gainDb || 0), a = ((pan || 0) + 1) * 0.125;
    const gl = g * cos1(a) * 1.4142135623730951, gr = g * sin1(a) * 1.4142135623730951;
    for (let i = 0; i < x.length && i + o < this.n; i++) { this.L[i + o] += x[i] * gl; this.R[i + o] += x[i] * gr; }
    return this;
  };
  Mix.prototype.addSt = function (st, at, gainDb) {
    const o = Math.round((at || 0) * SR), g = db(gainDb || 0);
    for (let i = 0; i < st.L.length && i + o < this.n; i++) { this.L[i + o] += st.L[i] * g; this.R[i + o] += st.R[i] * g; }
    return this;
  };
  Mix.prototype.peak = function () { return Math.max(peakOf(this.L), peakOf(this.R)); };
  // bake a little of the room into the sound (wet only, added at wetDb); a generator: `yield* m.space(...)`
  Mix.prototype.space = function* (wetDb, o) { return this.addSt(yield* roomG(this.L, this.R, o), 0, wetDb); };
  // bus saturation: glue + tames crest factor (stingers must hit −16 LUFS under −1 dBTP)
  Mix.prototype.glue = function (drive) {
    const p = this.peak(); if (!p) return this;
    const k = drive / p, n = tanh(drive);
    for (let i = 0; i < this.n; i++) { this.L[i] = tanh(this.L[i] * k) / n; this.R[i] = tanh(this.R[i] * k) / n; }
    return this;
  };

  // ---------------- filters ----------------
  // TPT state-variable filter (Zavalishin / Simper). fc: number or function(i) -> Hz.
  // type: lp | hp | bp (unity gain at centre) | notch
  function svf(x, type, fc, Q) {
    const k = 1 / (Q || 0.7071), dyn = typeof fc === 'function';
    let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0;
    const coef = f => {
      const g = tanPi(Math.min(0.49, Math.max(1, f) / SR));
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    };
    if (!dyn) coef(fc);
    for (let i = 0; i < x.length; i++) {
      if (dyn && (i & 15) === 0) coef(fc(i));
      const v0 = x[i], v3 = v0 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      x[i] = type === 'lp' ? v2 : type === 'bp' ? v1 * k : type === 'hp' ? v0 - k * v1 - v2 : v0 - k * v1;
    }
    return x;
  }
  // exponential sweep helper for svf/osc: f0 -> f1 over sec, then hold
  function sweep(f0, f1, sec, delay) {
    const d = ns(delay || 0), n = ns(sec), l = log(f1 / f0);
    return i => i <= d ? f0 : i >= d + n ? f1 : f0 * exp(l * (i - d) / n);
  }

  // ---------------- sources ----------------
  function white(rng, n) { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = rng() * 2 - 1; return x; }
  function pink(rng, n) {        // Paul Kellet's economy pink: felt and air
    const x = new Float64Array(n); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return x;
  }
  // sine with a frequency function (Hz per sample index)
  function sine(n, f, phase) {
    const x = new Float64Array(n); let p = phase || 0; const dyn = typeof f === 'function';
    for (let i = 0; i < n; i++) { x[i] = sin1(p); p += (dyn ? f(i) : f) / SR; if (p > 1) p -= 1; }
    return x;
  }
  function blep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }
  // polyBLEP sawtooth (band-limited: brass and pads without aliasing fizz)
  function saw(n, f, phase) {
    const x = new Float64Array(n); let p = phase || 0; const dyn = typeof f === 'function';
    for (let i = 0; i < n; i++) {
      const dt = (dyn ? f(i) : f) / SR;
      x[i] = 2 * p - 1 - blep(p, dt);
      p += dt; if (p >= 1) p -= 1;
    }
    return x;
  }
  // ---------------- envelopes ----------------
  // linear attack, exponential decay to −60 dB at t60
  function ad(n, attack, t60, hold) {
    const e = new Float64Array(n), a = Math.max(1, ns(attack)), h = ns(hold || 0), k = decayK(t60);
    let v = 1;
    for (let i = 0; i < n; i++) {
      if (i < a) e[i] = i / a;
      else if (i < a + h) e[i] = 1;
      else { e[i] = v; v *= k; }
    }
    return e;
  }
  // attack / sustain / release (sustain until `on`, release t60)
  function asr(n, attack, on, t60, curve) {
    const e = new Float64Array(n), a = Math.max(1, ns(attack)), o = ns(on), k = decayK(t60);
    let v = 1;
    for (let i = 0; i < n; i++) {
      if (i < a) { const t = i / a; e[i] = curve ? t * (2 - t) : t; }
      else if (i < o) e[i] = 1;
      else { v *= k; e[i] = v; }
    }
    return e;
  }
  const mul = (x, e) => { for (let i = 0; i < x.length; i++) x[i] *= e[i]; return x; };
  const satArr = (x, drive) => { const n = tanh(drive); for (let i = 0; i < x.length; i++) x[i] = tanh(drive * x[i]) / n; return x; };

  // ---------------- modal bank ----------------
  // Struck modes: each mode = [Hz, t60 s, level dB] rings as an exact decaying
  // sinusoid (2-pole recurrence from its initial state, so no per-sample trig)
  // with a seeded start phase, plus a short band-passed noise strike. Levels
  // are exact (a weak spot in a noise burst can't hide a mode), every variant
  // gets its own phases and grain, and nothing is passed at DC.
  function modal(rng, len, modes, o) {
    o = o || {};
    const n = ns(len), out = new Float64Array(n), att = 4;
    let lo = Infinity, hi = 0;
    for (const [f, t60, lv] of modes) {
      if (!(f > 20 && f < SR * 0.45)) continue;
      lo = Math.min(lo, f); hi = Math.max(hi, f);
      const r = decayK(t60), w = f / SR, c = 2 * r * cos1(w), r2 = r * r, A = db(lv || 0), ph = rng();
      let y2 = A / r2 * sin1(ph - 2 * w), y1 = A / r * sin1(ph - w);
      for (let i = 0; i < n; i++) {
        const v = c * y1 - r2 * y2; y2 = y1; y1 = v;
        out[i] += i < att ? v * (i + 1) / (att + 1) : v;      // 4-sample ramp: a strike, not a step
      }
    }
    const k = o.click == null ? 1 : o.click;
    if (k > 0 && hi > 0) {                                    // the strike: what the hammer / latch / finger adds
      const sn = Math.max(3, ns(o.strike || 0.0005)), x = new Float64Array(sn + ns(0.002));
      for (let i = 0; i < sn; i++) x[i] = (rng() * 2 - 1) * sin1(0.5 * (i + 0.5) / sn);
      svf(x, 'bp', Math.min(9000, Math.max(900, Math.sqrt(lo * hi) * 1.5)), 0.7);
      addInto(out, norm(x), 0, 0.3 * k);
    }
    return out;
  }

  // ---------------- reverb: 8-line FDN, Hadamard feedback, damped ----------------
  // A generator (yields every ~0.4 s of audio) so the runtime fallback can slice
  // a long stinger's render into small steps; room() runs it in one go.
  function* roomG(L, R, o) {
    o = o || {};
    const n = L.length, size = o.size || 1, pre = ns(o.pre || 0.01);
    const D = [1031, 1327, 1523, 1747, 1913, 2111, 2357, 2557].map(d => Math.max(64, Math.round(d * size)));
    const line = D.map(d => new Float64Array(d)), idx = new Int32Array(8), z = new Float64Array(8), s = new Float64Array(8);
    const g = D.map(d => exp(-6.907755278982137 * d / ((o.t60 || 1.2) * SR)));
    const a = exp(-2 * PI * (o.damp || 5000) / SR);           // one-pole lowpass in each line
    const outL = new Float64Array(n), outR = new Float64Array(n), h = 1 / 2.8284271247461903;
    for (let i = 0; i < n; i++) {
      if ((i & 16383) === 16383) yield;
      const inL = i >= pre ? L[i - pre] : 0, inR = i >= pre ? R[i - pre] : 0;
      for (let k = 0; k < 8; k++) { const v = line[k][idx[k]]; z[k] = v + (z[k] - v) * a; s[k] = z[k]; }
      outL[i] = s[0] - s[2] + s[4] - s[6]; outR[i] = s[1] - s[3] + s[5] - s[7];
      // fast Walsh–Hadamard (orthogonal after ×1/√8)
      for (let w = 1; w < 8; w <<= 1) for (let k = 0; k < 8; k += w << 1) for (let j = k; j < k + w; j++) {
        const u = s[j], v = s[j + w]; s[j] = u + v; s[j + w] = u - v;
      }
      for (let k = 0; k < 8; k++) {
        line[k][idx[k]] = s[k] * h * g[k] + (k < 4 ? inL : inR) * (k & 1 ? -0.5 : 0.5);
        if (++idx[k] >= D[k]) idx[k] = 0;
      }
    }
    const wd = o.width == null ? 0.7 : o.width;
    for (let i = 0; i < n; i++) { const mid = (outL[i] + outR[i]) * 0.5, sd = (outL[i] - outR[i]) * 0.5 * wd; outL[i] = (mid + sd) * 0.5; outR[i] = (mid - sd) * 0.5; }
    return { L: outL, R: outR };
  }
  // drive a generator to its end (the synchronous path)
  function run(it) { let r; while (!(r = it.next()).done); return r.value; }

  // ======================================================================
  // Material voices (building blocks shared by every recipe)
  // ======================================================================

  // The detent: 0.5 ms noise burst, band-passed (3.2 kHz, Q 1.4), gone in 5 ms.
  function detent(rng, f, q) {
    const n = ns(0.007), x = new Float64Array(n), burst = ns(0.0005);
    for (let i = 0; i < burst; i++) x[i] = (rng() * 2 - 1) * (1 - i / burst * 0.5);
    x[0] = 0.9;                                             // sample-0 edge: the transient is on the very first sample
    svf(x, 'bp', f || 3200, q || 1.4);
    const k = exp(-4.6 / (0.005 * SR));                     // −40 dB at 5 ms
    let v = 1; for (let i = 0; i < n; i++) { x[i] *= v; v *= k; }
    return norm(x);
  }
  // felt-damped body: sine sweep, tanh drive, high-pass; weight that survives phones
  function thock(rng, o) {
    const n = ns((o.t60 || 0.03) * 1.15 + (o.sweep || 0.01) + 0.004);
    const x = sine(n, sweep(o.f0, o.f1, o.sweep || 0.012), 0.02);
    mul(x, ad(n, o.attack || 0.0006, o.t60 || 0.03));
    if (o.even) for (let i = 0; i < n; i++) x[i] += o.even * x[i] * x[i];   // 2nd harmonic: the octave carries the weight on phone speakers
    satArr(x, o.drive || 1.8);
    if (o.felt !== 0) {                                     // a breath of felt on the strike
      const f = pink(rng, ns(0.004)); svf(f, 'lp', 1400, 0.7); mul(f, ad(f.length, 0.0003, 0.004));
      addInto(x, norm(f), 0, db(o.felt == null ? -12 : o.felt));
    }
    if (o.hp) svf(svf(x, 'hp', o.hp, 0.7071), 'hp', o.hp * 0.7, 0.6);
    if (o.lp) svf(x, 'lp', o.lp, 0.7071);
    return norm(x);
  }
  // engraved brass plate: modal ratios 1 / 1.59 / 2.14 / 2.65 (D6 -> Bb6, G7 kept in key)
  function brassPlate(rng, f, o) {
    o = o || {};
    const T = o.t60 || [0.018, 0.011, 0.007, 0.005], sc = o.decay || 1;
    const r = [1, 1.5874, vary(rng, 2.14, 0.03), 2.6697];
    const lv = o.levels || [0, -3, -7, -9];
    const modes = r.map((k, i) => [f * k * (i === 0 ? cents(rr(rng, -4, 4)) : vary(rng, 1, i === 2 ? 0 : 0.006)), vary(rng, T[i] * sc, 0.1), lv[i]]);
    if (o.twin !== false) modes.push([f * cents(9), T[0] * sc * 0.8, -10]);   // a sister mode: the faint beat of real cast metal
    return norm(modal(rng, Math.max(...T) * sc * 1.5 + 0.004, modes, { strike: 0.0004 }));
  }
  // steel breech: G5 / Bb6 / A7 modes (the spec's 820 / 1960 / 3400 Hz pulled into key) + mass modes + grit
  function breech(rng, o) {
    o = o || {};
    const sc = o.decay || 1, base = o.f || NOTES.G5;
    const modes = [
      [base * cents(rr(rng, -6, 6)), vary(rng, 0.030 * sc, 0.1), 0],
      [base * 2.3785 * vary(rng, 1, 0.004), vary(rng, 0.015 * sc, 0.1), -2],
      [base * 4.4898 * vary(rng, 1, 0.01), vary(rng, 0.008 * sc, 0.1), -4],
      [base * vary(rng, 1.43, 0.03), 0.006 * sc, -9],
      [base * vary(rng, 3.37, 0.03), 0.005 * sc, -10],
      [base * vary(rng, 5.9, 0.04), 0.004 * sc, -12],
    ];
    const x = modal(rng, 0.045 * sc + 0.01, modes, { strike: 0.0003, click: 2 });
    const hit = white(rng, ns(0.004)); svf(hit, 'hp', 900, 0.7); mul(hit, ad(hit.length, 0.0001, 0.003));
    addInto(x, norm(hit), 0, db(-4));
    return norm(satArr(norm(x), 1.6));
  }
  // crystal tine: fundamental + slow-beating twin + glass-bar partials (2.756, 5.404) + contact
  function tine(rng, f, o) {
    o = o || {};
    const t60 = o.t60 || 0.32, len = o.len || t60 * 1.05;
    const modes = [
      [f, t60, 0],
      [f + vary(rng, 2.6, 0.2), t60 * 0.85, -8],
      [f * 2.756, t60 * 0.32, o.bright == null ? -13 : o.bright],
      [f * 5.404, t60 * 0.13, (o.bright == null ? -13 : o.bright) - 8],
    ];
    const x = modal(rng, len, modes, { strike: 0.0003, click: 0.4 });
    const c = white(rng, ns(0.0012)); svf(c, 'bp', Math.min(7000, f * 4), 1.2); mul(c, ad(c.length, 0.00005, 0.001));
    addInto(x, norm(c), 0, db(o.contact == null ? -16 : o.contact));
    return norm(x);
  }
  // brass shell casing ring (tube modes)
  function shell(rng, f, o) {
    o = o || {};
    const t60 = o.t60 || 0.09;
    const x = modal(rng, t60 * 1.1 + 0.01, [
      [f * cents(rr(rng, -5, 5)), t60, 0],
      [f * vary(rng, 2.71, 0.01), t60 * 0.45, -7],
      [f * vary(rng, 5.15, 0.02), t60 * 0.22, -13],
    ], { strike: 0.0002, click: 1 });
    return norm(x);
  }
  // glass ring (orb / jar): modes 1, 2.32, 4.25, 6.63
  function glass(rng, f, t60) {
    return norm(modal(rng, t60 * 1.05, [
      [f, t60, 0], [f + vary(rng, 1.8, 0.2), t60 * 0.9, -9], [f * 2.32, t60 * 0.45, -9], [f * 4.25, t60 * 0.22, -15], [f * 6.63, t60 * 0.1, -21],
    ], { strike: 0.0004, click: 0.6 }));
  }
  // short pluck (toggle dyads): two partials, felt-short
  function pluck(rng, f, t60, lp) {
    const x = modal(rng, t60 * 1.05, [[f, t60, 0], [f * 2.0, t60 * 0.5, -10], [f * 2.756, t60 * 0.3, -16]], { strike: 0.0003, click: 0.3 });
    if (lp) svf(x, 'lp', lp, 0.7071);
    return norm(x);
  }
  // storm crack: 1–8 kHz noise + electric micro-crackles. Stereo: the crackles differ per side.
  function crack(rng, o) {
    o = o || {};
    const len = o.len || 0.09, n = ns(len), t60 = o.t60 || 0.03;
    const side = () => {
      const x = white(rng, n);
      mul(x, ad(n, 0.0001, t60));
      for (let c = 0, cnt = o.crackles || 6; c < cnt; c++) {             // crackles: tiny bursts, decaying
        const at = ns(rr(rng, 0.004, len * 0.7)), w = ns(rr(rng, 0.0006, 0.002)), a = rr(rng, 0.3, 0.8) * (1 - at / n);
        for (let i = 0; i < w && at + i < n; i++) x[at + i] += (rng() * 2 - 1) * a * (1 - i / w);
      }
      svf(x, 'hp', o.lo || 1000, 0.7071); svf(x, 'hp', (o.lo || 1000) * 0.8, 0.6);
      svf(x, 'lp', o.hi || 8000, 0.7071);
      return norm(x);
    };
    const L = side(), R = o.stereo ? side() : L;
    return { L, R };
  }
  // boom: pitch-dropping sine with tanh harmonics (160–480 Hz on phones) + optional −12 dB sub
  function boom(rng, f, o) {
    o = o || {};
    const t60 = o.t60 || 0.6, n = ns(t60 * 1.1 + 0.02);
    const x = sine(n, sweep(f * (o.drop || 1.6), f, o.dropT || 0.04), 0);
    mul(x, ad(n, o.attack || 0.0015, t60));
    if (o.even) for (let i = 0; i < n; i++) x[i] += o.even * x[i] * x[i];
    satArr(x, o.drive || 2.4);
    svf(x, 'lp', o.lp || 1800, 0.7071);
    if (o.sub) {
      const s = sine(n, sweep(f, f * 0.5, 0.06), 0);
      mul(s, ad(n, 0.003, t60 * 0.9));
      addInto(x, norm(s), 0, db(-12));
    }
    return norm(x);
  }
  // thunder roll: low noise driven by random "rolls", saturated for audibility, stereo-decorrelated
  // (the long renders below are generators: `yield* rumble(...)`, one step per side)
  function* rumble(rng, dur, o) {
    o = o || {};
    const n = ns(dur), env = new Float64Array(n);
    const rolls = o.rolls || 5;
    for (let r = 0; r < rolls; r++) {
      const at = r === 0 ? 0 : ns(rr(rng, 0.05, dur * 0.6)), a = Math.max(1, ns(rr(rng, 0.02, 0.09))), k = decayK(rr(rng, 0.25, 0.7) * dur);
      const amp = r === 0 ? 1 : rr(rng, 0.35, 0.85);
      let v = amp;
      for (let i = at; i < n; i++) { const t = i - at; env[i] += t < a ? amp * t / a : (v *= k); }
    }
    const k = decayK(o.t60 || dur); let v = 1;
    for (let i = 0; i < n; i++) { env[i] *= v; v *= k; }
    const base = o.stereo === false ? null : white(rng, n), wd = o.width == null ? 0.45 : o.width;
    const side = (k) => {
      const x = white(rng, n);
      if (base && k) for (let i = 0; i < n; i++) x[i] = x[i] * wd + base[i] * (1 - wd);
      else if (base) for (let i = 0; i < n; i++) x[i] = base[i];
      svf(x, 'lp', o.fc || 420, 0.8); svf(x, 'lp', (o.fc || 420) * 1.4, 0.7);
      mul(norm(x), env);
      satArr(norm(x), o.drive || 2.2);
      svf(x, 'lp', o.lp || 2600, 0.7071);
      svf(x, 'hp', 35, 0.7071);
      return x;
    };
    const L = side(0);
    yield;
    const R = o.stereo === false ? L : side(1);
    const p = Math.max(peakOf(L), peakOf(R)) || 1;
    return { L: scale(L, 1 / p), R: R === L ? L : scale(R, 1 / p) };
  }
  // x^1.75 with sqrt only (sqrt is correctly rounded everywhere; pw() costs a log and an exp)
  const p175 = x => { const r = Math.sqrt(x); return x * r * Math.sqrt(r); };
  // Sebastian's horn: one hunting horn (a detuned pair sounds like a synth
  // patch). Brass gets brighter the harder it is blown: the lowpass follows the
  // breath, a ~1.25 kHz "edge" formant sits over the ~480 Hz bell and the lips
  // add a little even-harmonic drive, so at forte harmonics 2–4 sit within
  // ~3–10 dB of the fundamental (a flute or ocarina keeps them 11–23 dB down).
  // The lips scoop up into the note, the pitch breathes, vibrato arrives late.
  function* horn(rng, f, dur, o) {
    o = o || {};
    const rel = o.release || 0.16, n = ns(dur + rel * 1.1);
    const scoop = rr(rng, -42, -28), vibD = ns(0.18), vibR = rr(rng, 4.8, 5.6), wowR = rr(rng, 0.7, 1.3), wowP = rng();
    const fq = i => {
      const t = i / SR, vib = i > vibD ? 6 * Math.min(1, (i - vibD) / ns(0.15)) * sin1(vibR * t) : 0;
      return f * cents(scoop * exp(-t / 0.014) + vib + 2 * sin1(wowP + wowR * t));
    };
    const a = saw(n, fq, rng());                            // a lone saw: brass is close to 1/k (a pulse at a random phase can cancel the fundamental)
    // breath envelope: soft attack with a small "blat" overshoot, sustain, release
    const env = new Float64Array(n), at = ns(o.attack || 0.024), on = ns(dur), k = decayK(rel), tg = ns(0.004);
    let r = 1;
    for (let i = 0; i < n; i++) {
      if (i < at) { const t = i / at; env[i] = Math.max(t * t * (3 - 2 * t) * 1.12, 0.07 * Math.min(1, i / tg)); }
      else if (i < on) { const t = (i - at) / SR; env[i] = 0.9 + 0.22 * exp(-t / 0.05) - 0.05 * Math.min(1, t / 0.8); }
      else { r *= k; env[i] = r * (0.9 - 0.05 * Math.min(1, (on - at) / SR / 0.8)); }
    }
    const bright = o.bright || 10;
    svf(a, 'lp', i => f * (1.6 + bright * p175(env[i] / 1.12)), 0.8);
    mul(a, env);
    yield;
    // breath noise riding the attack
    const br = white(rng, n); svf(br, 'bp', Math.min(5000, f * 3.2), 0.9);
    for (let i = 0; i < n; i++) a[i] += br[i] * env[i] * (0.014 + 0.14 * exp(-i / SR / 0.018));
    // the bell (~480 Hz body), the brass edge (~1.25 kHz) and the bell's bright
    // radiation (~2.4 kHz: a bell passes the highs and reflects the lows)
    const bell = Float64Array.from(a), edge = Float64Array.from(a), air = Float64Array.from(a);
    svf(bell, 'bp', 480, 1.6); svf(edge, 'bp', 1250, 0.9); svf(air, 'bp', 2600, 0.7);
    for (let i = 0; i < n; i++) a[i] += bell[i] * (o.bell == null ? 0.15 : o.bell) + edge[i] * (o.edge == null ? 0.6 : o.edge) + air[i] * (o.air == null ? 1.1 : o.air);
    // the lips: a touch of even-harmonic drive (x²; its envelope thump is high-passed away), then tanh
    norm(a); for (let i = 0; i < n; i++) a[i] += 0.16 * a[i] * a[i];
    svf(a, 'hp', 70, 0.7071);
    satArr(norm(a), 1.6);
    if (f >= NOTES.A4) { svf(a, 'lp', 5600, 0.7071); svf(a, 'lp', 7200, 0.6); }    // the high calls stay open
    else { svf(a, 'lp', 4200, 0.7071); svf(a, 'lp', 5600, 0.6); }
    // the tongue: a soft "t" on the first millisecond so the note speaks on sample 0
    const tq = white(rng, ns(0.003)); svf(tq, 'bp', 1800, 0.8); mul(tq, ad(tq.length, 0.0001, 0.003));
    addInto(a, norm(tq), 0, 0.12);
    scale(a, Math.SQRT1_2);                                 // centred (−3 dB a side, like the stab and pad pan law)
    return { L: a, R: a };
  }
  // detuned saw stack chord stab (brass section): LP sweeps closed as it decays
  function* stab(rng, notes, o) {
    o = o || {};
    const t60 = o.t60 || 0.25, n = ns(o.len || t60 * 1.2 + 0.02), out = { L: new Float64Array(n), R: new Float64Array(n) };
    for (let j = 0; j < notes.length; j++) {
      const f = note(notes[j]), x = new Float64Array(n);
      for (const c of [-9, 0, 8]) { const s = saw(n, f * cents(c + rr(rng, -1.5, 1.5)), rng()); for (let i = 0; i < n; i++) x[i] += s[i]; }
      svf(x, 'lp', sweep(o.fc0 || 2500, o.fc1 || 700, t60), 0.9);
      mul(x, ad(n, o.attack || 0.004, t60, o.hold || 0.02));
      norm(x);
      const pan = notes.length > 1 ? (j / (notes.length - 1) * 2 - 1) * (o.spread == null ? 0.25 : o.spread) : 0, A = (pan + 1) * 0.125;
      const gl = cos1(A), gr = sin1(A), lv = 1 / Math.sqrt(notes.length);
      for (let i = 0; i < n; i++) { out.L[i] += x[i] * gl * lv; out.R[i] += x[i] * gr * lv; }
      if (n > SR / 2) yield;
    }
    const d = o.drive || 1.6, nn = tanh(d), p = Math.max(peakOf(out.L), peakOf(out.R)) || 1;
    for (let i = 0; i < n; i++) { out.L[i] = tanh(out.L[i] / p * d) / nn; out.R[i] = tanh(out.R[i] / p * d) / nn; }
    return out;
  }
  // warm pad (low brass + strings): slow attack, gentle filter drift
  function* pad(rng, notes, dur, o) {
    o = o || {};
    const rel = o.release || 0.5, n = ns(dur + rel), out = { L: new Float64Array(n), R: new Float64Array(n) };
    for (let j = 0; j < notes.length; j++) {
      const f = note(notes[j]), x = new Float64Array(n);
      const ph = rng();                                       // the sine sits in phase with the centre saw's fundamental (never cancels it)
      for (const c of [-7, 0, 6]) { const s = saw(n, f * cents(c ? c + rr(rng, -1, 1) : 0), c ? rng() : ph); for (let i = 0; i < n; i++) x[i] += s[i] * 0.33; }
      const sn = sine(n, f, ph + 0.5); for (let i = 0; i < n; i++) x[i] += sn[i] * 0.6;
      const lfo = rr(rng, 0.3, 0.6), lph = rng();
      svf(x, 'lp', i => (o.fc || 1100) * (1 + 0.18 * sin1(lph + lfo * i / SR)), 0.7);
      mul(x, asr(n, o.attack || 0.06, dur, rel, true));
      norm(x);
      const pan = notes.length > 1 ? (j / (notes.length - 1) * 2 - 1) * (o.spread || 0.35) : 0, A = (pan + 1) * 0.125;
      const gl = cos1(A), gr = sin1(A), lv = 1 / Math.sqrt(notes.length);
      for (let i = 0; i < n; i++) { out.L[i] += x[i] * gl * lv; out.R[i] += x[i] * gr * lv; }
      yield;
    }
    return out;
  }
  // band-passed noise swish (felt panels, spools, whooshes)
  function swish(rng, dur, f0, f1, o) {
    o = o || {};
    const n = ns(dur), x = o.white ? white(rng, n) : pink(rng, n);
    svf(x, 'bp', sweep(f0, f1, dur), o.q || 1.2);
    if (o.q2) svf(x, 'bp', sweep(f0, f1, dur), o.q2);
    const e = new Float64Array(n), pk = o.peakAt == null ? 0.4 : o.peakAt, floor = o.floor == null ? 0.18 : o.floor;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      e[i] = t < pk ? floor + (1 - floor) * pw(t / pk, 1.5) : pw(1 - (t - pk) / (1 - pk), 1.8);
    }
    return norm(mul(x, e));
  }
  // glass grain: 2 ms of noise + a 4–7 kHz ping (15 ms)
  function grain(rng, f, o) {
    o = o || {};
    const x = modal(rng, 0.03, [[f, o.t60 || 0.015, 0], [f * 1.53, (o.t60 || 0.015) * 0.6, -8]], { strike: 0.0002, click: 0.5 });
    const nz = white(rng, ns(0.002)); svf(nz, 'hp', 2500, 0.7); mul(nz, ad(nz.length, 0.00005, 0.002));
    addInto(x, norm(nz), 0, db(o.noise == null ? -6 : o.noise));
    return norm(x);
  }
  // coin clink: circular-plate modes, principal pitched in key
  function coin(rng, f) {
    const t60 = rr(rng, 0.11, 0.22);
    return norm(modal(rng, t60 * 1.05, [
      [f, t60, 0], [f * vary(rng, 1.594, 0.01), t60 * 0.7, -4], [f * vary(rng, 2.136, 0.01), t60 * 0.45, -8], [f * vary(rng, 2.653, 0.01), t60 * 0.3, -12],
    ], { strike: 0.0002, click: 1.2 }));
  }

  // ======================================================================
  // Recipes
  // ======================================================================
  // A recipe is fn(rng, variant) -> Mix, or a generator function that yields
  // between its heavy layers: job() turns those yields into small time slices
  // for the runtime fallback; render() runs straight through. Same samples.
  const RECIPES = {}, ORDER = [];
  function R(name, meta, fn) {
    meta.notes = meta.notes || [];
    meta.steps = function* (seed, variant) {
      const rng = mulberry32(seed >>> 0), r = fn(rng, variant | 0);
      const m = r && typeof r.next === 'function' ? yield* r : r;
      yield;
      return yield* finish(m, meta);
    };
    meta.render = (seed, variant) => run(meta.steps(seed, variant));
    RECIPES[name] = meta; ORDER.push(name);
  }
  // shared pieces
  const pressCore = (rng, m, o) => {        // "Brass Detent": detent + plate + felt thock
    m.add(detent(rng, 3200 * cents(rr(rng, -40, 40))), 0, 0);
    m.add(brassPlate(rng, o.plate, { decay: (o.decay || 1) * 1.6 }), 0, -3);
    m.add(thock(rng, { f0: o.f0, f1: o.f1, sweep: o.sweep || 0.012, t60: o.t60 || 0.04, drive: 2, even: 0.25, hp: 140 }), 0.001, o.thockDb || -10);
  };

  // ---------------- UI bus: "Brass Detent" (mono, dry) ----------------
  R('ui.press', { variants: 6, bus: 'ui', stereo: false, notes: ['D6', 'A3', 'F3'], target: { peakDb: -20, punch: true }, maxDur: 0.07 }, (rng) => {
    const m = new Mix(0.07);
    pressCore(rng, m, { plate: note('D6'), f0: note('A3'), f1: note('F3') });
    return m;
  });
  // large plates (Buy, bet ±, Start, modal primaries): lower plate, lower thock, longer
  R('ui.press.l', { variants: 6, bus: 'ui', stereo: false, notes: ['A5', 'F3', 'Bb2'], target: { peakDb: -20, punch: true }, maxDur: 0.09 }, (rng) => {
    const m = new Mix(0.09);
    pressCore(rng, m, { plate: note('A5'), decay: 1.25, f0: note('F3'), f1: note('Bb2'), sweep: 0.016, t60: 0.06, thockDb: -8 });
    return m;
  });
  // pointer-up on large plates: 3 ms tick (F7), timed by the engine to the release overshoot
  R('ui.release', { variants: 3, bus: 'ui', stereo: false, notes: ['F7'], target: { peakDb: -32, punch: true }, maxDur: 0.012 }, (rng) => {
    const m = new Mix(0.012);
    m.add(detent(rng, note('F7') * cents(rr(rng, -15, 15)), 2.2), 0, -3);
    m.add(modal(rng, 0.01, [[note('F7') * cents(rr(rng, -15, 15)), 0.004, 0], [note('F7') * 1.59, 0.0025, -8]], { click: 0.5 }), 0, -2);
    return m;
  });
  // hover (fine pointer, Spin/Buy only): a 10 ms glint at D8
  R('ui.hover', { variants: 3, bus: 'ui', stereo: false, notes: ['D8'], target: { peakDb: -38, punch: true }, maxDur: 0.016 }, (rng) => {
    const m = new Mix(0.016);
    m.add(modal(rng, 0.014, [[note('D8') * cents(rr(rng, -10, 10)), 0.008, 0], [note('D8') * 1.5, 0.004, -12]], { strike: 0.0002, click: 0.6 }), 0, 0);
    return m;
  });
  // soft "nuh-uh": two felt thumps D4 then A3 over a Bb2 body
  R('ui.denied', { variants: 2, bus: 'ui', stereo: false, notes: ['D4', 'A3', 'Bb2'], target: { peakDb: -24, punch: true }, maxDur: 0.15 }, (rng) => {
    const m = new Mix(0.15);
    const d = detent(rng, 3200); svf(d, 'lp', 2200, 0.7); m.add(norm(d), 0, -14);
    const thump = (f, at) => {
      const n = ns(0.06), x = sine(n, f, 0), h = sine(n, f * 2, 0.1);
      for (let i = 0; i < n; i++) x[i] += h[i] * 0.6;
      mul(x, ad(n, 0.002, 0.05)); satArr(x, 1.4); svf(x, 'lp', 1200, 0.7071);
      m.add(norm(x), at, 0);
    };
    thump(note('D4') * cents(rr(rng, -6, 6)), 0.001);
    thump(note('A3') * cents(rr(rng, -6, 6)), 0.07);
    m.add(thock(rng, { f0: note('Bb2') * 1.2, f1: note('Bb2'), sweep: 0.01, t60: 0.06, drive: 2, hp: 80, felt: -16 }), 0.002, -6);
    return m;
  });
  // unmute confirm: soft D5 + A5 dyad
  R('ui.confirm', { variants: 1, bus: 'ui', stereo: false, notes: ['D5', 'A5'], target: { peakDb: -22 }, maxDur: 0.13 }, (rng) => {
    const m = new Mix(0.13);
    const d = detent(rng, 3200); svf(d, 'lp', 4000, 0.7); m.add(norm(d), 0, -10);
    m.add(tine(rng, note('D5'), { t60: 0.11, len: 0.12, bright: -18 }), 0, -1);
    m.add(tine(rng, note('A5'), { t60: 0.10, len: 0.11, bright: -18 }), 0.012, -3);
    return m;
  });
  // panel open: 180 ms felt swish (pink noise, 500 -> 1600 Hz)
  R('ui.open', { variants: 2, bus: 'ui', stereo: false, notes: [], target: { peakDb: -26, punch: true }, maxDur: 0.19 }, (rng) => {
    const m = new Mix(0.19);
    m.add(swish(rng, 0.18, 500, 1600, { q: 1.1, peakAt: 0.35, floor: 0.2 }), 0, 0);
    return m;
  });
  // panel close: the swish reversed, then a felt latch
  R('ui.close', { variants: 2, bus: 'ui', stereo: false, notes: ['F3', 'D3'], target: { peakDb: -26, punch: true }, maxDur: 0.21 }, (rng) => {
    const m = new Mix(0.21);
    m.add(swish(rng, 0.15, 1600, 500, { q: 1.1, peakAt: 0.7, floor: 0.14 }), 0, -2);
    const d = detent(rng, 2800); svf(d, 'lp', 3000, 0.7); m.add(norm(d), 0.15, -6);
    m.add(thock(rng, { f0: note('F3'), f1: note('D3'), sweep: 0.01, t60: 0.035, drive: 1.8, hp: 120 }), 0.151, -4);
    return m;
  });
  // toggles answer in two notes: on = press + D6 -> A6, off = A6 -> D6 duller
  const toggle = (rng, on, spool) => {
    const m = new Mix(spool ? 0.17 : 0.15);
    pressCore(rng, m, { plate: note('D6'), f0: note('A3'), f1: note('F3') });
    const [a, b] = on ? [note('D6'), note('A6')] : [note('A6'), note('D6')];
    m.add(pluck(rng, a, 0.07, on ? 0 : 3000), 0.012, -5);
    m.add(pluck(rng, b, 0.08, on ? 0 : 3000), 0.052, -5);
    if (spool) m.add(swish(rng, 0.14, on ? 600 : 2400, on ? 2400 : 600, { white: true, q: 2.2, peakAt: on ? 0.75 : 0.3, floor: 0.15 }), 0.004, -8);
    return m;
  };
  R('toggle.on', { variants: 2, bus: 'ui', stereo: false, notes: ['D6', 'A6', 'A3', 'F3'], target: { peakDb: -20, punch: true }, maxDur: 0.15 }, rng => toggle(rng, true));
  R('toggle.off', { variants: 2, bus: 'ui', stereo: false, notes: ['D6', 'A6', 'A3', 'F3'], target: { peakDb: -20, punch: true, under: ['toggle.on', 1.5] }, maxDur: 0.15 }, rng => toggle(rng, false));
  R('turbo.on', { variants: 1, bus: 'ui', stereo: false, notes: ['D6', 'A6', 'A3', 'F3'], target: { peakDb: -20, punch: true }, maxDur: 0.17 }, rng => toggle(rng, true, true));
  R('turbo.off', { variants: 1, bus: 'ui', stereo: false, notes: ['D6', 'A6', 'A3', 'F3'], target: { peakDb: -20, punch: true, under: ['turbo.on', 1.5] }, maxDur: 0.17 }, rng => toggle(rng, false, true));
  // bet at its min/max: two dull thock ticks 28 ms apart (replaces the buzzer)
  R('bet.stop', { variants: 2, bus: 'ui', stereo: false, notes: ['F3', 'D3', 'D5'], target: { peakDb: -22, punch: true }, maxDur: 0.08 }, (rng) => {
    const m = new Mix(0.08);
    m.add(detent(rng, 3200), 0, -14);
    for (const at of [0, 0.028]) {
      const t = thock(rng, { f0: note('F3') * cents(rr(rng, -8, 8)), f1: note('D3'), sweep: 0.008, t60: 0.03, drive: 3, even: 0.6, hp: 120, felt: -8 });
      svf(t, 'lp', 1500, 0.7071);
      m.add(norm(t), at + 0.0005, at ? -2 : 0);
      // a dull felt-wood tock (D5, 12 ms): the stop still reads on a phone speaker, which drops F3/D3
      m.add(modal(rng, 0.03, [[note('D5') * cents(rr(rng, -8, 8)), 0.014, 0], [note('D5') * vary(rng, 2.31, 0.02), 0.007, -9]], { strike: 0.0004, click: 0.3 }), at + 0.0005, (at ? -2 : 0) - 2);
    }
    return m;
  });

  // ---------------- WORLD bus: "Breech & Roll", the board, the orbs ----------------
  // Space comes from the world bus's send to the shared room at runtime; only
  // the shots and slams bake their own (their width grows with the tier).
  // the commit: detent + G6 tine, breech clack @22 ms, weight, A5 -> D6 charge @70 ms
  const spinPress = (rng, m, o) => {
    o = o || {};
    const clackAt = o.clackAt == null ? 0.022 : o.clackAt;
    m.add(detent(rng, 2400 * cents(rr(rng, -30, 30))), 0, -6);
    if (o.tine !== false) m.add(tine(rng, note('G6'), { t60: 0.025 * 1.6, len: 0.04, bright: -20, contact: -30 }), 0, -14);
    m.add(breech(rng, { decay: o.decay || 1 }), clackAt, 0);
    if (o.weight !== false) m.add(thock(rng, { f0: note('D3'), f1: note('G2'), sweep: 0.03, t60: o.weightT60 || 0.06, drive: 3, even: 0.45, hp: 60, felt: -14 }), clackAt + 0.0005, -6);
    if (o.charge !== false) {
      const n = ns(0.105), f = sweep(note('A5'), note('D6'), 0.04);
      const x = sine(n, f, 0), h = sine(n, i => f(i) * 2, 0.3);
      for (let i = 0; i < n; i++) x[i] = (x[i] + h[i] * 0.25) * (0.55 + 0.45 * sin1(37 * i / SR));
      mul(x, asr(n, 0.004, 0.035, 0.07));
      svf(x, 'lp', 6000, 0.7071);
      m.add(norm(x), 0.07, -20);
    }
  };
  const SPIN_NOTES = ['G6', 'G2', 'D3', 'A5', 'D6'];
  R('spin.press', { variants: 4, bus: 'world', stereo: false, notes: SPIN_NOTES, target: { peakDb: -14, punch: true }, maxDur: 0.18 }, (rng) => {
    const m = new Mix(0.18); spinPress(rng, m); return m;
  });
  // autoplay rounds: detent + clack only (quieter by target)
  R('spin.press.auto', { variants: 2, bus: 'world', stereo: false, notes: [], target: { peakDb: -22, punch: true }, maxDur: 0.08 }, (rng) => {
    const m = new Mix(0.08); spinPress(rng, m, { tine: false, weight: false, charge: false }); return m;
  });
  // each free spin: clack + a 60 ms storm crackle riser + a D5 tine
  R('spin.press.fs', { variants: 2, bus: 'world', stereo: true, notes: ['G6', 'G2', 'D3', 'D5'], target: { peakDb: -14, punch: true }, maxDur: 0.18 }, (rng) => {
    const m = new Mix(0.18);
    spinPress(rng, m, { charge: false });
    for (let c = 0; c < 9; c++) {                           // riser: bursts get denser and louder toward 60 ms
      const t = pw(c / 8, 0.7) * 0.058, w = ns(rr(rng, 0.0015, 0.004)), x = white(rng, w);
      svf(x, 'hp', 3500, 0.7); mul(x, ad(w, 0.0001, w / SR));
      m.add(norm(x), t + 0.002, -24 + 10 * c / 8, rr(rng, -0.5, 0.5));
    }
    m.add(tine(rng, note('D5'), { t60: 0.12, len: 0.12 }), 0.06, -12);
    return m;
  });
  // Double Chance: the press + two shell tinks (Bb6, D7)
  R('spin.press.dc', { variants: 2, bus: 'world', stereo: false, notes: SPIN_NOTES.concat(['Bb6', 'D7']), target: { peakDb: -14, punch: true }, maxDur: 0.18 }, (rng) => {
    const m = new Mix(0.18); spinPress(rng, m);
    m.add(shell(rng, note('Bb6'), { t60: 0.07 }), 0.06, -12);
    m.add(shell(rng, note('D7'), { t60: 0.07 }), 0.085, -13);
    return m;
  });
  // turbo: 90 ms, no charge
  R('spin.press.t', { variants: 2, bus: 'world', stereo: false, notes: ['G6', 'G2', 'D3'], target: { peakDb: -14, punch: true }, maxDur: 0.09 }, (rng) => {
    const m = new Mix(0.09); spinPress(rng, m, { clackAt: 0.012, charge: false, decay: 0.8, weightT60: 0.045 }); return m;
  });
  // old symbols fall out: 14–18 glass grains on the exit stagger (25 ms/column + 8 ms/row), panned ±0.35, over an airy swell
  const GRAIN_NOTES = ['C8', 'D8', 'F8', 'G8'];
  R('spin.dropout', { variants: 3, bus: 'world', stereo: true, notes: GRAIN_NOTES, target: { peakDb: -28, punch: true }, maxDur: 0.36 }, (rng) => {
    const m = new Mix(0.36);
    const cells = [];
    for (let c = 0; c < 6; c++) for (let r = 0; r < 5; r++) cells.push([c, r]);
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
    const count = 14 + Math.floor(rng() * 5), chosen = cells.slice(0, count);
    if (!chosen.some(([c, r]) => c === 0 && r === 0)) chosen[0] = [0, 0];          // first grain on sample 0
    for (const [c, r] of chosen) {
      const f = note(pick(rng, GRAIN_NOTES)) * cents(rr(rng, -20, 20));
      m.add(grain(rng, f), c * 0.025 + r * 0.008, rr(rng, -4, 0), (c / 5 * 2 - 1) * 0.35);
    }
    m.add(swish(rng, 0.33, 300, 900, { q: 1.0, peakAt: 0.45, floor: 0.12 }), 0, -7);
    return m;
  });
  // the column land body: contact tick + gem-in-velvet thock (G3 -> F3), no tine (tines are separate)
  R('land.thock', { variants: 4, bus: 'world', stereo: false, notes: ['G3', 'F3', 'D7'], target: { peakDb: -20, punch: true }, maxDur: 0.1 }, (rng) => {
    const m = new Mix(0.1);
    const tick = white(rng, ns(0.0012)); svf(tick, 'bp', 2200 * cents(rr(rng, -50, 50)), 1.3); mul(tick, ad(tick.length, 0.00005, 0.001));
    m.add(norm(tick), 0, 0);
    // the gem meeting the velvet: a short cut-stone tock (D7 region, 12–18 ms) in the band phones keep
    m.add(modal(rng, 0.03, [[note('D7') * cents(rr(rng, -30, 30)), vary(rng, 0.016, 0.15), 0], [note('D7') * vary(rng, 1.42, 0.03), 0.01, -4], [note('D7') * vary(rng, 2.3, 0.04), 0.006, -8]], { click: 0.6 }), 0, -2.5);
    m.add(thock(rng, { f0: note('G3') * cents(rr(rng, -10, 10)), f1: note('F3'), sweep: 0.02, t60: 0.07, drive: 2.4, even: 0.8, hp: 110, felt: -10 }), 0.0003, 0);
    const v = pink(rng, ns(0.012)); svf(v, 'lp', 900, 0.7); mul(v, ad(v.length, 0.0005, 0.012));
    m.add(norm(v), 0, -14);                                   // velvet puff
    return m;
  });
  // crystal tines for lands, scatter locks and ladders
  for (const nm of ['G4', 'Bb4', 'C5', 'D5', 'F5', 'G5', 'F4', 'A4', 'Bb5', 'D6']) {
    R('tine.' + nm, { variants: 1, bus: 'world', stereo: false, notes: [nm], target: { peakDb: -20 }, maxDur: 0.27 }, (rng) => {
      const m = new Mix(0.27);
      m.add(tine(rng, note(nm), { t60: 0.26, len: 0.27 }), 0, 0);
      return m;
    });
  }
  // board seated: breech clack at −10 dB + an F2 body (80 ms)
  R('spin.lock', { variants: 2, bus: 'world', stereo: false, notes: ['G2', 'F2', 'G3', 'F3', 'C4'], target: { peakDb: -18, punch: true }, maxDur: 0.11 }, (rng) => {
    const m = new Mix(0.11);
    m.add(breech(rng, { decay: 0.8 }), 0, -3);
    m.add(thock(rng, { f0: note('G2'), f1: note('F2'), sweep: 0.02, t60: 0.08, drive: 3.4, even: 0.6, hp: 50, felt: -12 }), 0.0005, 0);
    // the seat beat's own harmonics (F3 = 2x, C4 = 3x F2): phones play these, not the 87–98 Hz beat itself
    m.add(thock(rng, { f0: note('G3'), f1: note('F3'), sweep: 0.015, t60: 0.05, drive: 3, even: 0.6, hp: 160, felt: -12 }), 0.0008, -1);
    m.add(thock(rng, { f0: note('C4') * 1.06, f1: note('C4'), sweep: 0.012, t60: 0.04, drive: 2.6, even: 0.3, hp: 200, felt: 0 }), 0.001, -2);
    return m;
  });
  // slam-stop: a lighter brass brake (D5 / F6 / F7 modes) over a Bb2 body
  R('spin.brake', { variants: 2, bus: 'world', stereo: false, notes: ['D5', 'F6', 'F7', 'Bb2'], target: { peakDb: -16, punch: true }, maxDur: 0.11 }, (rng) => {
    const m = new Mix(0.11);
    m.add(detent(rng, 2400), 0, -8);
    m.add(norm(satArr(modal(rng, 0.06, [
      [note('D5') * cents(rr(rng, -5, 5)), vary(rng, 0.04, 0.1), 0], [note('F6'), vary(rng, 0.02, 0.1), -2], [note('F7'), vary(rng, 0.01, 0.1), -5], [note('D5') * vary(rng, 1.47, 0.03), 0.008, -10],
    ], { strike: 0.0004, click: 1.5 }), 1.5)), 0.0005, 0);
    m.add(thock(rng, { f0: note('Bb2') * 1.25, f1: note('Bb2'), sweep: 0.015, t60: 0.06, drive: 2.8, even: 0.5, hp: 70 }), 0.001, -5);
    return m;
  });
  // neutral below-bet tick: muted felt and brass, no pitch to celebrate
  R('win.tick', { variants: 3, bus: 'world', stereo: false, notes: ['G3', 'F3'], target: { peakDb: -22, punch: true }, maxDur: 0.06 }, (rng) => {
    const m = new Mix(0.06);
    const d = detent(rng, 2600); svf(d, 'lp', 3500, 0.7); m.add(norm(d), 0, -2);
    m.add(thock(rng, { f0: note('G3'), f1: note('F3'), sweep: 0.008, t60: 0.035, drive: 2.4, even: 0.5, hp: 120, lp: 2500, felt: -8 }), 0.0005, -3);
    return m;
  });
  // 1–5x: an in-key G–Bb–D chime
  R('win.chime', { variants: 2, bus: 'world', stereo: true, notes: ['G5', 'Bb5', 'D6', 'D7'], target: { peakDb: -18, punch: true }, maxDur: 0.52 }, (rng) => {
    const m = new Mix(0.52);
    ['G5', 'Bb5', 'D6'].forEach((nm, i) => m.add(tine(rng, note(nm) * cents(rr(rng, -4, 4)), { t60: 0.4, len: 0.42, bright: -11 }), i * 0.045, -i * 1.2, (i - 1) * 0.25));
    m.add(brassPlate(rng, note('D7'), { decay: 6, twin: true }), 0.09, -16, 0.1);
    return m;
  });
  // 5–15x: coins on velvet
  const COIN_NOTES = ['Bb6', 'C7', 'D7', 'F7'];
  R('win.coins', { variants: 3, bus: 'world', stereo: true, notes: COIN_NOTES.concat(['G3']), target: { peakDb: -16, punch: true }, maxDur: 0.46 }, (rng) => {
    const m = new Mix(0.46);
    const count = 6 + Math.floor(rng() * 3);
    for (let c = 0; c < count; c++) {
      const at = c === 0 ? 0 : pw(rng(), 1.4) * 0.28;
      m.add(coin(rng, note(pick(rng, COIN_NOTES)) * cents(rr(rng, -12, 12))), at, -rr(rng, 0, 7) - at * 10, rr(rng, -0.55, 0.55));
    }
    m.add(thock(rng, { f0: note('G3') * 1.1, f1: note('G3'), sweep: 0.01, t60: 0.05, drive: 1.5, hp: 120, felt: -6 }), 0.001, -10);
    return m;
  });
  // count-ups: a tiny brass tick, quiet (the engine paces it; pitch never climbs)
  R('count.tick', { variants: 4, bus: 'world', stereo: false, notes: ['D7'], target: { peakDb: -26, punch: true }, maxDur: 0.03 }, (rng) => {
    const m = new Mix(0.03);
    const d = detent(rng, 2800 * cents(rr(rng, -40, 40))); svf(d, 'lp', 5000, 0.7); m.add(norm(d), 0, -2);
    m.add(modal(rng, 0.028, [[note('D7') * cents(rr(rng, -8, 8)), 0.014, 0], [note('D7') * 1.5874, 0.008, -6]], { strike: 0.0002, click: 0.8 }), 0, -3);
    return m;
  });
  // the orb shot: a thunder-magic report on the bolt's frame, never a gunshot.
  // tier 0..3 (variants): bigger = lower, longer, wider
  const SHOT = [
    { zing: ['D7', 'D6'], body: ['D3', 'A2'], len: 0.38, rumble: 0.28, fc: 900, wet: -18, width: 0.35, sub: false },
    { zing: ['A6', 'A5'], body: ['A2', 'F2'], len: 0.52, rumble: 0.45, fc: 700, wet: -16, width: 0.55, sub: false },
    { zing: ['F6', 'F5'], body: ['F2', 'D2'], len: 0.7, rumble: 0.62, fc: 560, wet: -14, width: 0.75, sub: true },
    { zing: ['D6', 'D5'], body: ['D2', 'D2'], len: 0.85, rumble: 0.78, fc: 440, wet: -12, width: 1, sub: true },
  ];
  R('orb.shot', { variants: 4, bus: 'world', stereo: true, notes: ['D7', 'D6', 'A6', 'A5', 'F6', 'F5', 'D5', 'D3', 'A2', 'F2', 'D2', 'G3', 'F3'], target: { peakDb: -14, punch: true, tierStep: 1.5 }, tiers: true, maxDur: 0.85 }, function* (rng, v) {
    const T = SHOT[Math.min(3, v)], m = new Mix(T.len);
    const c = crack(rng, { len: 0.05 + v * 0.015, t60: 0.02 + v * 0.008, lo: 1100 - v * 150, hi: 8000, crackles: 4 + v, stereo: true });
    m.addSt(c, 0, -3 + v * 0.7);
    // the magic: a crystal "zing" dropping an octave, ring-modulated shimmer
    const zn = ns(0.09 + v * 0.05), zf = sweep(note(T.zing[0]), note(T.zing[1]), 0.06 + v * 0.04);
    const z = sine(zn, zf, 0);
    for (let i = 0; i < zn; i++) z[i] *= 0.6 + 0.4 * sin1(53 * i / SR);
    mul(z, ad(zn, 0.0008, 0.07 + v * 0.05));
    m.add(norm(z), 0.001, -9 - v * 0.5);
    // the body's harmonics grow with the tier (more 2nd/3rd, harder drive): a phone
    // speaker can't play the lower fundamental, so this is where "bigger" lives there
    m.add(boom(rng, note(T.body[1]), { drop: note(T.body[0]) / note(T.body[1]) * 1.25, dropT: 0.05 + v * 0.02, t60: 0.14 + v * 0.1, drive: 3 + v * 0.3, even: 0.4 + v * 0.2, lp: 1600, sub: T.sub }), 0.002, -3);
    // the punch phones can play: a felt-damped mid thock (G3 -> F3) on the impact, heavier per tier
    m.add(thock(rng, { f0: note('G3') * 1.3, f1: note('F3'), sweep: 0.015, t60: 0.05 + v * 0.02, drive: 3 + v * 0.2, even: 0.3 + v * 0.2, hp: 140 }), 0.002, -6 + v * 0.5);
    const rb = yield* rumble(rng, T.rumble, { fc: T.fc, rolls: 2 + v, drive: 2.4, lp: 2400, width: 0.15 + T.width * 0.35 });   // width grows with the tier
    m.addSt(rb, 0.008, -7 + v * 0.5);
    yield* m.space(T.wet, { t60: 0.5 + v * 0.25, size: 0.7 + v * 0.15, damp: 4000, width: 0.4 + v * 0.15 });
    return m.glue(1.3);
  });
  // the orb lands: thunk + glass ring tuned by tier (bigger = lower)
  const EMBED = ['D6', 'A5', 'F5', 'D5'];
  R('orb.embed', { variants: 4, bus: 'world', stereo: false, notes: ['D6', 'A5', 'F5', 'D5', 'D3', 'A2', 'G3'], target: { peakDb: -18, punch: true, tierStep: 1 }, tiers: true, maxDur: 0.75 }, (rng, v) => {
    const len = 0.32 + v * 0.14, m = new Mix(len);
    m.add(thock(rng, { f0: note('G3') * 1.3 - v * 25, f1: v > 1 ? note('A2') : note('D3'), sweep: 0.02, t60: 0.07 + v * 0.02, drive: 2.2, hp: 80, felt: -8 }), 0, -1);
    m.add(glass(rng, note(EMBED[v]), 0.3 + v * 0.13), 0.002, -5);
    return m;
  });
  // shells eject after a shot: a brass casing ringing and bouncing
  const SHELL_NOTES = ['C7', 'D7', 'F7'];
  R('shell.eject', { variants: 3, bus: 'world', stereo: false, notes: SHELL_NOTES, target: { peakDb: -22, punch: true }, maxDur: 0.42 }, (rng, v) => {
    const m = new Mix(0.42), f = note(SHELL_NOTES[v % 3]);
    let at = 0, amp = 0, gap = rr(rng, 0.11, 0.14);
    for (let b = 0; b < 5; b++) {
      m.add(shell(rng, f * cents(rr(rng, -10, 10)), { t60: 0.16 - b * 0.02 }), at, amp);
      at += gap; gap *= rr(rng, 0.6, 0.72); amp -= rr(rng, 4, 6);
    }
    return m;
  });
  // orbs gather into the jar: airy rise + D minor arpeggio + glass plink
  R('collect', { variants: 2, bus: 'world', stereo: true, notes: ['D5', 'F5', 'A5', 'D6'], target: { peakDb: -16, punch: true }, maxDur: 0.56 }, (rng) => {
    const m = new Mix(0.56);
    m.add(swish(rng, 0.36, 400, 3000, { q: 1.4, peakAt: 0.8, floor: 0.25 }), 0, -8);
    ['D5', 'F5', 'A5', 'D6'].forEach((nm, i) => m.add(tine(rng, note(nm), { t60: 0.22, len: 0.24, bright: -11 }), i * 0.05, -4 - (3 - i) * 0.8, -0.3 + i * 0.2));
    m.add(glass(rng, note('D6'), 0.24), 0.3, -2, 0.2);
    return m;
  });
  // the collector slams onto the win: brass anvil + glass, bigger = lower, heavier
  const SLAM = [
    { anvil: 'D5', body: ['D3', 'A2'], len: 0.45, wet: -17 },
    { anvil: 'A4', body: ['A2', 'F2'], len: 0.6, wet: -15 },
    { anvil: 'F4', body: ['F2', 'D2'], len: 0.76, wet: -13 },
    { anvil: 'D4', body: ['D2', 'D2'], len: 0.9, wet: -11 },
  ];
  R('slam', { variants: 4, bus: 'world', stereo: true, notes: ['D5', 'A4', 'F4', 'D4', 'D3', 'A2', 'F2', 'D2', 'D6', 'A6', 'G3', 'F3'], target: { peakDb: -14, punch: true, tierStep: 1.5 }, tiers: true, maxDur: 0.9 }, function* (rng, v) {
    const T = SLAM[Math.min(3, v)], m = new Mix(T.len), a = note(T.anvil);
    m.add(detent(rng, 2400 - v * 300), 0, -6);
    const c = crack(rng, { len: 0.05, t60: 0.02 + v * 0.006, lo: 700 - v * 100, hi: 6500 - v * 600, crackles: 2, stereo: true });
    m.addSt(c, 0, -8 + v);
    m.add(norm(satArr(modal(rng, T.len * 0.8, [
      [a * cents(rr(rng, -4, 4)), 0.32 + v * 0.14, 0], [a * 2.0 * vary(rng, 1, 0.003), 0.2 + v * 0.08, -4], [a * 2.76, 0.12 + v * 0.05, -7], [a * 3.9, 0.07, -11], [a * 5.4, 0.04, -14],
    ], { strike: 0.0006, click: 2 }), 1.3)), 0.001, -3);
    m.add(boom(rng, note(T.body[1]), { drop: note(T.body[0]) / note(T.body[1]) * 1.2, dropT: 0.05, t60: 0.2 + v * 0.13, drive: 3.2 + v * 0.3, even: 0.4 + v * 0.2, lp: 1500, sub: v >= 2 }), 0.002, -1);
    m.add(thock(rng, { f0: note('G3') * 1.3, f1: note('F3'), sweep: 0.015, t60: 0.06 + v * 0.025, drive: 3 + v * 0.2, even: 0.3 + v * 0.2, hp: 140 }), 0.002, -5 + v * 0.5);   // heavier per tier, where phones hear it
    if (v >= 1) ['D6', 'A6'].forEach((nm, i) => m.add(tine(rng, note(nm), { t60: 0.25, len: 0.26 }), 0.01 + i * 0.03, -14, i ? 0.4 : -0.4));
    yield* m.space(T.wet, { t60: 0.5 + v * 0.22, size: 0.8 + v * 0.12, damp: 3800, width: 0.4 + v * 0.15 });
    return m.glue(1.4);
  });
  // winners shatter and exit: glass spray + falling whoosh + a soft body
  R('tumble', { variants: 2, bus: 'world', stereo: true, notes: ['C8', 'D8', 'F8', 'G8', 'C7', 'D7', 'F7', 'A2'], target: { peakDb: -18, punch: true }, maxDur: 0.42 }, (rng) => {
    const m = new Mix(0.42);
    const g = ['C7', 'D7', 'F7', 'C8', 'D8', 'F8', 'G8'];
    for (let i = 0; i < 26; i++) {
      const at = i === 0 ? 0 : pw(rng(), 1.8) * 0.13;
      m.add(grain(rng, note(pick(rng, g)) * cents(rr(rng, -25, 25)), { t60: rr(rng, 0.012, 0.03), noise: -3 }), at, -rr(rng, 0, 9) - at * 25, rr(rng, -0.6, 0.6));
    }
    m.add(swish(rng, 0.34, 2400, 400, { q: 1.1, peakAt: 0.25, floor: 0.4 }), 0, -6);
    m.add(thock(rng, { f0: note('A2') * 1.4, f1: note('A2'), sweep: 0.03, t60: 0.09, drive: 2, hp: 60 }), 0.004, -9);
    return m;
  });
  // scatter locks in place: detent + a short glass lock + felt (the engine layers a tine on top)
  R('scatter.lock', { variants: 1, bus: 'world', stereo: false, notes: ['D6', 'G3'], target: { peakDb: -18 }, maxDur: 0.13 }, (rng) => {
    const m = new Mix(0.13);
    m.add(detent(rng, 3200), 0, -2);
    m.add(glass(rng, note('D6') * 1.0, 0.06), 0, -6);
    m.add(breech(rng, { decay: 0.5, f: note('D6') }), 0.003, -10);
    m.add(thock(rng, { f0: note('G3') * 1.2, f1: note('G3'), sweep: 0.008, t60: 0.05, drive: 1.8, hp: 110 }), 0.001, -6);
    return m;
  });

  // ---------------- FS bus: "The Storm Breaks" (stereo, stingers) ----------------
  // The stinger bus adds a 25% send to the shared room at runtime, so the bakes
  // keep only a short, narrow body of space (t60 ≤ 1.2 s): no double reverb.
  // Every stinger ends in its own tail (the −60 dB trim in finish), never on a cut.
  // CHARGE: 2.316 s of reversed thunder (LP 400 Hz -> 6 kHz) + D6/A6 crystal tremolo
  // rising 8 -> 14 Hz, −24 -> −18 dBFS; then the 80 ms breath (−18 dB) so BREAK lands at 2.396 s.
  R('fs.charge', { variants: 1, bus: 'fs', stereo: true, notes: ['D6', 'A6', 'D2'], target: { peakDb: -18 }, marks: { breath: 2.316, end: 2.396 }, maxDur: 2.396, fixed: true }, function* (rng) {
    const dur = 2.316, total = 2.396, m = new Mix(total), n = ns(total), nr = ns(dur);
    const ramp = i => Math.min(1, i / nr);
    // reversed thunder: the roll swells toward the cut and ends on the reversed crack
    const th = yield* rumble(rng, total, { fc: 520, rolls: 6, drive: 2.6, lp: 6000, t60: total * 1.2, width: 0.3 });
    const cr = crack(rng, { len: 0.25, t60: 0.12, lo: 900, hi: 7000, crackles: 10, stereo: true });
    addInto(th.L, cr.L, (n - nr) / SR, 0.8); addInto(th.R, cr.R, (n - nr) / SR, 0.8);   // reversed, the crack lands at 2.316 s
    const L = reverse(th.L), Rr = reverse(th.R);
    const lp = sweep(400, 6000, dur);
    for (const c of [L, Rr]) { svf(c, 'lp', lp, 0.8); svf(c, 'hp', 70, 0.7071); }       // sub stays an extra, not the body
    yield;
    // the build starts at a third of its final level, not from silence: the
    // first second has to read over the feature track's intro
    const p = Math.max(peakOf(L.subarray(0, nr)), peakOf(Rr.subarray(0, nr))) || 1;
    for (let i = 0; i < n; i++) { const t = ramp(i), g = (0.32 + 0.68 * t * Math.sqrt(t)) / p; L[i] *= g; Rr[i] *= g; }
    m.addSt({ L, R: Rr }, 0, -3);
    // the air being pulled in: band-passed noise swelling and brightening into the cut (a reversed cymbal of storm)
    const air = white(rng, n), air2 = white(rng, n);
    for (let i = 0; i < n; i++) air2[i] = air[i] * 0.8 + air2[i] * 0.2;
    for (const c of [air, air2]) { svf(c, 'bp', sweep(700, 6500, dur), 0.9); for (let i = 0; i < n; i++) { const t = ramp(i); c[i] *= t * t * t; } }
    const ap = Math.max(peakOf(air), peakOf(air2)) || 1;
    m.addSt({ L: scale(air, 1 / ap), R: scale(air2, 1 / ap) }, 0, -10);
    yield;
    // crystal tremolo D6 + A6, its rate rising 8 -> 14 Hz (phase-integrated). Each
    // pulse re-strikes the crystal: the glass partial (2.756×, a quarter-tone off
    // the key) rings ~50 ms per strike and is gone long before the next; only a
    // soft 2nd harmonic is held
    const tri = new Float64Array(n), strike = new Uint8Array(n); let ph = 0.2;
    for (let i = 0; i < n; i++) {
      const before = ph - Math.floor(ph);
      ph += (8 + 6 * ramp(i)) / SR;
      const q = ph - Math.floor(ph);
      tri[i] = 0.5 + 0.5 * sin1(q - 0.25);
      if (before < 0.15 && q >= 0.15) strike[i] = 1;
    }
    const kGlass = decayK(0.07);
    const tr = (nm, pan) => {
      const f = note(nm), x = sine(n, f, rng()), h2 = sine(n, f * 2, rng()), h = sine(n, f * 2.756, rng());
      let e = 0;
      for (let i = 0; i < n; i++) {
        e = strike[i] ? 1 : e * kGlass;
        x[i] = (x[i] + h2[i] * 0.05 + h[i] * 0.16 * e) * (0.15 + 0.85 * tri[i]) * (0.72 + 0.28 * ramp(i));
      }
      for (let i = 0; i < 96; i++) x[i] *= 0.3 + 0.7 * i / 96;
      m.add(x, 0, -9, pan);
    };
    tr('D6', -0.2); tr('A6', 0.2);
    // a low D pedal so the build has body on phones (harmonics, not sub)
    const ped = sine(n, note('D2'), 0); for (let i = 0; i < n; i++) { const t = ramp(i); ped[i] *= t * t; }
    satArr(ped, 2.5); m.add(norm(ped), 0, -12);
    // the breath: at 2.316 s everything drops 18 dB (12 ms) and holds for the last 80 ms
    const b1 = ns(dur + 0.012), g18 = db(-18);
    for (let i = nr; i < m.n; i++) { const g = i < b1 ? 1 - (1 - g18) * (i - nr) / (b1 - nr) : g18; m.L[i] *= g; m.R[i] *= g; }
    return m;
  });
  // BREAK: crack + D2 boom + D-minor brass stab (D3 A3 D4 F4 A4) + horn D4, then the storm rolls
  const breakHit = function* (rng, m, o) {
    o = o || {};
    m.addSt(crack(rng, { len: 0.12, t60: 0.035, lo: 1000, hi: 8000, crackles: 9, stereo: true }), 0, 0);
    m.add(boom(rng, note('D2'), { drop: 1.7, dropT: 0.05, t60: 0.6, drive: 3.2, even: 0.4, lp: 1600, sub: true }), 0.0015, -2);
    // the stab and the horn carry the BREAK on phone speakers; boom and roll are the weight under them
    m.addSt(yield* stab(rng, o.stab || ['D3', 'A3', 'D4', 'F4', 'A4'], { t60: 0.25, fc0: 2500, fc1: 700, hold: 0.03, drive: 1.8 }), 0.002, -1);
    if (o.horn !== false) m.addSt(yield* horn(rng, note('D4'), 0.21, { release: 0.12 }), 0.004, HORN_IN_BREAK);
    m.addSt(yield* rumble(rng, o.roll || 1.5, { fc: 480, rolls: 5, drive: 2.4, lp: 2600 }), 0.03, -11);
  };
  // Sebastian's call D–A–D is one phrase across three slots: the D4 inside the
  // BREAK, then A4 and D5 on the feature track's 8ths (234 ms). They are levelled
  // as a phrase, by their held sustain (not each to an integrated LUFS, which
  // favours the short note): A4 sits level with the BREAK's D4, D5 a touch above
  // (the call peaks on its last note). tools/test-sfx.js measures all three.
  const HORN_IN_BREAK = -0.5, HORN_SUSTAIN = -17;            // dB in the BREAK mix; dBFS RMS (50–200 ms) at playback
  R('fs.break', { variants: 1, bus: 'fs', stereo: true, notes: ['D2', 'D3', 'A3', 'D4', 'F4', 'A4'], target: { lufs: -16 }, marks: { hornA4: 0.234, hornD5: 0.469 }, maxDur: 2.4 }, function* (rng) {
    const m = new Mix(2.4);
    yield* breakHit(rng, m);
    yield* m.space(-15, { t60: 0.84, size: 1.1, damp: 3800, width: 0.6 });
    return m.glue(2.2);
  });
  R('fs.horn.A4', { variants: 1, bus: 'fs', stereo: true, notes: ['A4'], target: { sustainDb: HORN_SUSTAIN, win: [0.05, 0.2] }, maxDur: 0.8 }, function* (rng) {
    const m = new Mix(0.8);
    m.addSt(yield* horn(rng, note('A4'), 0.22, { release: 0.12 }), 0, 0);
    yield* m.space(-17, { t60: 0.6, size: 0.9, damp: 3800, width: 0.6 });
    return m;
  });
  R('fs.horn.D5', { variants: 1, bus: 'fs', stereo: true, notes: ['D5'], target: { sustainDb: HORN_SUSTAIN + 0.5, win: [0.05, 0.2] }, maxDur: 1.3 }, function* (rng) {
    const m = new Mix(1.3);
    m.addSt(yield* horn(rng, note('D5'), 0.6, { release: 0.16 }), 0, 0);
    yield* m.space(-17, { t60: 0.6, size: 0.9, damp: 3800, width: 0.6 });
    return m;
  });
  // the 15-count: brass shell clicks tuned to F5 (the engine climbs F-major pentatonic with playbackRate)
  R('fs.award.click', { variants: 3, bus: 'fs', stereo: true, notes: ['F5'], target: { peakDb: -20, punch: true }, maxDur: 0.08 }, (rng) => {
    const m = new Mix(0.08);
    const d = detent(rng, 2400); svf(d, 'lp', 4500, 0.7); m.add(norm(d), 0, -6);
    m.add(shell(rng, note('F5'), { t60: 0.07 }), 0, -1, rr(rng, -0.15, 0.15));
    return m;
  });
  // retrigger "reload +5": crack + F-major stab, five brass tinks on 16ths (F5 G5 A5 C6 D6), breech clack
  const RELOAD = ['F5', 'G5', 'A5', 'C6', 'D6'];
  R('fs.retrigger', { variants: 1, bus: 'fs', stereo: true, notes: ['F3', 'A3', 'C4', 'F4', 'F2'].concat(RELOAD), target: { lufs: -17 }, marks: { tinks: [0.234, 0.3512, 0.4684, 0.5856, 0.7028], clack: 0.82 }, maxDur: 1.4 }, function* (rng) {
    const m = new Mix(1.4);
    m.addSt(crack(rng, { len: 0.08, t60: 0.025, lo: 1100, hi: 8000, crackles: 6, stereo: true }), 0, -5);
    m.addSt(yield* stab(rng, ['F3', 'A3', 'C4', 'F4'], { t60: 0.25, hold: 0.02, drive: 1.7 }), 0.002, -3);
    m.add(boom(rng, note('F2'), { t60: 0.3, drive: 2.6, lp: 1500 }), 0.002, -6);
    RELOAD.forEach((nm, i) => m.add(shell(rng, note(nm), { t60: 0.11 }), 0.234 + i * 0.1172, -6 + i * 0.4, -0.4 + i * 0.2));
    m.add(breech(rng), 0.82, -3);
    yield* m.space(-16, { t60: 0.5, size: 0.9, damp: 3800, width: 0.5 });
    return m.glue(2.3);
  });
  // milestones: the horn call stepping up (variants: on D, F, G, A, high D).
  // A uses A–D–A: its fifth would be E, which is outside the six safe notes.
  const CALLS = [['D4', 'A4', 'D5'], ['F4', 'C5', 'F5'], ['G4', 'D5', 'G5'], ['A4', 'D5', 'A5'], ['D5', 'A5', 'D6']];
  R('fs.milestone', { variants: 5, bus: 'fs', stereo: true, notes: ['D4', 'A4', 'D5', 'F4', 'C5', 'F5', 'G4', 'G5', 'A5', 'D6', 'D3', 'F3', 'G3', 'A3'], target: { lufs: -17 }, tiers: true, marks: { notes: [0, 0.1172, 0.2344] }, maxDur: 1.0 }, function* (rng, v) {
    const c = CALLS[Math.min(4, v)], m = new Mix(1.0);
    m.add(detent(rng, 3200), 0, -10);
    for (let i = 0; i < 3; i++) m.addSt(yield* horn(rng, note(c[i]), i < 2 ? 0.1 : 0.2, { release: i < 2 ? 0.08 : 0.14, attack: 0.012 }), i * 0.1172, i === 2 ? 0 : -2);
    // a low brass under the last note: the step feels bigger
    const lo = c[0].replace(/\d$/, d => String(+d - 1));
    m.addSt(yield* stab(rng, [lo], { t60: 0.35, fc0: 1400, fc1: 500, hold: 0.05 }), 0.2344, -10);
    yield* m.space(-16, { t60: 0.5, size: 0.9, damp: 3800, width: 0.5 });
    return m;
  });
  // last free spin: the horn fragment A4 -> D5, soft
  R('fs.last', { variants: 1, bus: 'fs', stereo: true, notes: ['A4', 'D5'], target: { lufs: -24 }, maxDur: 1.1 }, function* (rng) {
    const m = new Mix(1.1);
    m.addSt(yield* horn(rng, note('A4'), 0.2, { release: 0.1, bright: 4.5 }), 0, -1.5);
    m.addSt(yield* horn(rng, note('D5'), 0.3, { release: 0.15, bright: 4.5 }), 0.2344, 0);
    yield* m.space(-15, { t60: 0.6, size: 1, damp: 3800, width: 0.5 });
    return m;
  });
  // the storm passes: a Bb pad (Bb2 F3 D4) resolves to G minor (G2 D3 Bb3) over ~1.8 s, and rings out
  R('fs.outro', { variants: 1, bus: 'fs', stereo: true, notes: ['Bb2', 'F3', 'D4', 'F4', 'G2', 'D3', 'Bb3', 'D5', 'Bb4'], target: { lufs: -18 }, marks: { resolve: 0.82 }, maxDur: 2.8 }, function* (rng) {
    const m = new Mix(2.8);
    m.add(tine(rng, note('D5'), { t60: 0.6, len: 0.6, bright: -16 }), 0, -6, -0.2);
    m.addSt(yield* pad(rng, ['Bb2', 'F3', 'D4', 'F4'], 0.8, { attack: 0.05, release: 0.35, fc: 2000 }), 0, -1);
    m.addSt(yield* pad(rng, ['G2', 'D3', 'Bb3', 'D4'], 0.75, { attack: 0.22, release: 0.55, fc: 1800 }), 0.82, 0);
    m.add(tine(rng, note('Bb4'), { t60: 0.8, len: 0.82, bright: -16 }), 0.84, -6, 0.25);    // the resolution rings on a high Bb (the minor third)
    const rb = yield* rumble(rng, 1.6, { fc: 360, rolls: 3, drive: 2, lp: 1600, width: 0.3 });   // the last of the storm, far away
    m.addSt(rb, 0.15, -16);
    yield* m.space(-15, { t60: 0.9, size: 1.1, damp: 3500, width: 0.5 });
    return m;
  });
  // big-win tier beds (~2 s, the big-win hold is 2.2 s) on Gm, Bb, Dm, F: bigger tier = lower, longer, wider.
  // `hold` is how long the pad sustains; each bed then rings out in its own tail.
  const TIERS = [
    { stab: ['G3', 'Bb3', 'D4', 'G4'], pad: ['G2', 'D3', 'Bb3'], arp: ['G5', 'Bb5', 'D6', 'G6'], boom: null, horn: null, hold: 1.35 },
    { stab: ['Bb2', 'F3', 'Bb3', 'D4', 'F4'], pad: ['Bb2', 'F3', 'D4'], arp: ['Bb5', 'D6', 'F6', 'Bb6'], boom: 'Bb2', horn: ['F4'], hold: 1.4 },
    { stab: ['D3', 'A3', 'D4', 'F4', 'A4'], pad: ['D2', 'A2', 'F3', 'D4'], arp: ['D6', 'F6', 'A6', 'D7'], boom: 'D2', horn: ['D4', 'A4'], hold: 1.45 },
    { stab: ['F2', 'C3', 'F3', 'A3', 'C4', 'F4'], pad: ['F2', 'C3', 'A3', 'F4'], arp: ['F6', 'A6', 'C7', 'F7'], boom: 'F2', horn: ['F4', 'C5', 'F5'], hold: 1.5 },
  ];
  TIERS.forEach((T, k) => {
    const notes = Array.from(new Set([].concat(T.stab, T.pad, T.arp, T.boom ? [T.boom] : [], T.horn || [], k >= 2 ? COIN_NOTES : [])));
    const len = T.hold + 1.25;
    R('tier.' + k, { variants: 1, bus: 'fs', stereo: true, notes, target: { lufs: -18 + k }, maxDur: len }, function* (rng) {
      const m = new Mix(len);
      m.addSt(crack(rng, { len: 0.06, t60: 0.02 + k * 0.006, lo: 1500, hi: 8000, crackles: 2 + k * 2, stereo: true }), 0, -8 + k);
      m.addSt(yield* stab(rng, T.stab, { t60: 0.35 + k * 0.08, fc0: 2600, fc1: 800, hold: 0.04, spread: 0.2 + k * 0.08 }), 0.001, -3);
      m.addSt(yield* pad(rng, T.pad, T.hold, { attack: 0.12, release: 0.6 + k * 0.05, fc: 1100 + k * 150, spread: 0.25 + k * 0.1 }), 0.02, -8);
      T.arp.forEach((nm, i) => m.add(tine(rng, note(nm), { t60: 0.5, len: 0.55, bright: -11 }), 0.06 + i * 0.07, -10, (i / 3 * 2 - 1) * (0.3 + k * 0.15)));
      if (T.boom) m.add(boom(rng, note(T.boom), { t60: 0.5 + k * 0.15, drive: 3, even: 0.4, lp: 1500, sub: k >= 2 }), 0.002, -5);
      if (T.horn) for (let i = 0; i < T.horn.length; i++) m.addSt(yield* horn(rng, note(T.horn[i]), i === T.horn.length - 1 ? 0.4 : 0.1, { release: 0.18 }), 0.12 + i * 0.1172, -7);
      if (k >= 2) {                                          // coins under the big tiers (money)
        for (let c = 0; c < 2 + k * 3; c++) m.add(coin(rng, note(pick(rng, COIN_NOTES))), 0.08 + pw(rng(), 1.3) * 0.7, -18 - rr(rng, 0, 6), rr(rng, -0.7, 0.7));
      }
      yield* m.space(-16 + k, { t60: 0.72 + k * 0.12, size: 0.9 + k * 0.1, damp: 3500, width: 0.5 });
      return m.glue(1.8);
    });
  });
  // max win finale: BREAK, the full horn call D–A–D, then F major blooms with a tine cascade, and rings out
  R('maxwin', { variants: 1, bus: 'fs', stereo: true, notes: ['D2', 'D3', 'A3', 'D4', 'F4', 'A4', 'D5', 'F2', 'C3', 'F3', 'C4', 'F1', 'F5', 'G5', 'A5', 'C6', 'D6', 'F6', 'G6', 'A6', 'C7', 'D7', 'Bb6', 'F7'], target: { lufs: -15 }, marks: { bloom: 0.94 }, maxDur: 3.4 }, function* (rng) {
    const m = new Mix(3.4);
    yield* breakHit(rng, m, { roll: 1.7 });
    m.addSt(yield* horn(rng, note('A4'), 0.21, { release: 0.1 }), 0.2344, HORN_IN_BREAK);
    m.addSt(yield* horn(rng, note('D5'), 0.55, { release: 0.25 }), 0.4688, HORN_IN_BREAK + 0.5);
    m.addSt(yield* stab(rng, ['F2', 'C3', 'F3', 'A3', 'C4', 'F4'], { t60: 0.6, fc0: 2800, fc1: 900, hold: 0.08, spread: 0.7 }), 0.9375, -3);
    m.addSt(yield* pad(rng, ['F2', 'C3', 'A3', 'F4'], 0.95, { attack: 0.08, release: 0.7, fc: 1400, spread: 0.5 }), 0.94, -6);
    m.add(boom(rng, note('F2'), { t60: 0.9, drive: 2.6, lp: 1500, sub: true }), 0.9375, -5);
    const casc = ['F5', 'G5', 'A5', 'C6', 'D6', 'F6', 'G6', 'A6', 'C7', 'D7', 'F7'];
    casc.forEach((nm, i) => m.add(tine(rng, note(nm), { t60: 0.6, len: 0.62, bright: -12 }), 0.95 + i * 0.0586, -10 - i * 0.3, (i % 2 ? 1 : -1) * (0.2 + i * 0.06)));
    for (let c = 0; c < 14; c++) m.add(coin(rng, note(pick(rng, COIN_NOTES))), 0.96 + pw(rng(), 1.2) * 1.0, -16 - rr(rng, 0, 7), rr(rng, -0.8, 0.8));
    yield;
    yield* m.space(-13, { t60: 1.1, size: 1.2, damp: 3500, width: 0.5 });
    return m.glue(2.0);
  });

  // ======================================================================
  // Finish: DC block, mono fold, UI air cut, −1 dBFS peak, trim, 5 ms fade
  // ======================================================================
  const PEAK = db(-1);
  function* finish(m, meta) {
    let L = m.L, Rr = m.R;
    if (!meta.stereo) { for (let i = 0; i < L.length; i++) L[i] = (L[i] + Rr[i]) * 0.5; Rr = L; }
    const chans = Rr === L ? [L] : [L, Rr];
    for (const x of chans) {
      svf(x, 'hp', 20, 0.7071);                              // DC / infrasonic block
      if (meta.bus === 'ui') { svf(x, 'lp', 7500, 0.7071); svf(x, 'lp', 9500, 0.6); }   // dry, nothing harsh above 8 kHz
      else svf(x, 'lp', 11000, 0.7071);                     // nothing up there worth the bits (and phones stop at ~10 kHz)
      if (x.length > SR) yield;
    }
    const p = Math.max(peakOf(L), peakOf(Rr)) || 1;
    // trim the tail below −60 dB re the peak (its t60: inaudible under the music
    // and the shared room, and it costs bytes and decoded memory), never past
    // maxDur, never into the transient; then a cosine fade (5 ms, longer if the
    // cut is still audible) to digital silence, and −1 dBFS peak
    const thr = p * db(-60), fade = ns(0.005);
    let end = L.length, pk = 0;
    while (end > 1 && Math.abs(L[end - 1]) < thr && Math.abs(Rr[end - 1]) < thr) end--;
    if (meta.fixed) end = L.length;                         // timeline pieces keep their exact length
    if (meta.maxDur) end = Math.min(end, ns(meta.maxDur));
    for (let i = 0, m = 0; i < end; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(Rr[i])); if (a > m) { m = a; pk = i; } }
    end = Math.min(L.length, Math.max(end, pk + fade + 2));
    // a tail cut while still audible (maxDur) gets a longer fade, up to 60 ms, never into the transient
    let lvl = 0;
    for (let i = Math.max(0, end - fade - ns(0.02)); i < end - fade; i++) lvl = Math.max(lvl, Math.abs(L[i]), Math.abs(Rr[i]));
    const fd = lvl > p * db(-45) ? Math.max(fade, Math.min(ns(0.06), Math.floor((end - pk) / 3))) : fade;
    const outL = new Float32Array(end), outR = new Float32Array(end);
    for (let i = 0; i < end; i++) {
      const k = i >= end - fd ? 0.5 + 0.5 * cos1(0.5 * (i - (end - fd) + 1) / fd) : 1;
      outL[i] = L[i] * k; outR[i] = Rr[i] * k;
    }
    outL[end - 1] = 0; outR[end - 1] = 0;                    // digital silence on the last sample
    const g = PEAK / (Math.max(peakOf(outL), peakOf(outR)) || 1);
    for (let i = 0; i < end; i++) { outL[i] *= g; outR[i] *= g; }
    return { L: outL, R: outR };
  }

  // ======================================================================
  // Measurement (same numbers the renderer gets from ffmpeg, for the runtime fallback)
  // ======================================================================
  function biquad(x, b0, b1, b2, a1, a2) {
    const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  // BS.1770-4 integrated loudness at 48 kHz, with 0.5 s of silence after the
  // sound so short effects still fill a 400 ms block (render-sfx pads the same way)
  function loudness(L, R) {
    const pad = ns(0.5), n = L.length + pad, chans = R && R !== L ? [L, R] : [L];
    const pw = new Float64Array(n);
    for (const c of chans) {
      const x = new Float64Array(n); for (let i = 0; i < c.length; i++) x[i] = c[i];
      const k1 = biquad(x, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
      const k2 = biquad(k1, 1, -2, 1, -1.99004745483398, 0.99007225036621);
      for (let i = 0; i < n; i++) pw[i] += k2[i] * k2[i];
    }
    if (chans.length === 1 && R === L) for (let i = 0; i < n; i++) pw[i] *= 2;     // dual-mono plays on both speakers
    const blk = ns(0.4), hop = ns(0.1), blocks = [];
    for (let s = 0; s + blk <= n; s += hop) { let e = 0; for (let i = s; i < s + blk; i++) e += pw[i]; blocks.push(e / blk); }
    const lk = e => -0.691 + 10 * log(e) / LN10;
    let g = blocks.filter(e => e > 0 && lk(e) > -70);
    if (!g.length) return -70;
    const rel = lk(g.reduce((a, b) => a + b, 0) / g.length) - 10;
    g = g.filter(e => lk(e) > rel);
    return lk(g.reduce((a, b) => a + b, 0) / g.length);
  }
  // Short-window loudness: the loudest 100 ms (hop 5 ms) of K-weighted power,
  // in LUFS. Clicks and hits are shorter than an integrated-LUFS block; this is
  // how loud they sound, where a sample peak only says how tall their spike is.
  function punch(L, R) {
    const W = ns(0.1), hop = ns(0.005), n = L.length + W, mono = !R || R === L;
    const pw = new Float64Array(n);
    for (const c of mono ? [L] : [L, R]) {
      const x = new Float64Array(n); for (let i = 0; i < c.length; i++) x[i] = c[i];
      const k1 = biquad(x, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
      const k2 = biquad(k1, 1, -2, 1, -1.99004745483398, 0.99007225036621);
      for (let i = 0; i < n; i++) pw[i] += k2[i] * k2[i] * (mono ? 2 : 1);   // dual-mono plays on both speakers
    }
    const cs = new Float64Array(n + 1); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + pw[i];
    let best = 0; for (let s = 0; s + W <= n; s += hop) { const e = cs[s + W] - cs[s]; if (e > best) best = e; }
    return best > 0 ? -0.691 + 10 * log(best / W) / LN10 : -120;
  }
  // RMS level (dBFS, channels averaged) over [a, b] seconds: a held note's sustain
  function sustain(L, R, a, b) {
    const i0 = ns(a), i1 = Math.min(L.length, ns(b)), cs = R && R !== L ? [L, R] : [L];
    let e = 0; for (const c of cs) for (let i = i0; i < i1; i++) e += c[i] * c[i];
    e /= Math.max(1, (i1 - i0) * cs.length);
    return e > 0 ? 10 * log(e) / LN10 : -120;
  }

  // Short-window loudness targets (LUFS, see punch(), at playback) for the sounds
  // that come as variants, tiers or on/off pairs: every variant of a family plays
  // equally loud (a peak target alone follows the random height of a 0.5 ms
  // spike: up to 4 dB apart), peak capped at the recipe's peakDb + 1 dB.
  // Written by `node tools/render-sfx.js --calibrate`: a family's median at its
  // nominal peak; tiers step up `tierStep` dB to the top tier's nominal level;
  // `under: [name, dB]` sits that far under the other recipe (off under on).
  // <punch> (generated)
  const PUNCH = {
    'ui.press': -36.6,
    'ui.press.l': -36.8,
    'ui.release': -52.2,
    'ui.hover': -56,
    'ui.denied': -34.2,
    'ui.open': -34.7,
    'ui.close': -34.8,
    'toggle.on': -34.4,
    'turbo.on': -32.5,
    'bet.stop': -32.6,
    'spin.press': -28.6,
    'spin.press.auto': -38,
    'spin.press.fs': -27.9,
    'spin.press.dc': -27.9,
    'spin.press.t': -29.2,
    'spin.dropout': -38.3,
    'land.thock': -31.9,
    'spin.lock': -30.1,
    'spin.brake': -29.1,
    'win.tick': -34.9,
    'win.chime': -24.6,
    'win.coins': -25.2,
    'count.tick': -44.7,
    'orb.shot': [-27.2, -25.7, -24.2, -22.7],
    'orb.embed': [-32.1, -31.1, -30.1, -29.1],
    'shell.eject': -31.6,
    'collect': -26.2,
    'slam': [-24.8, -23.3, -21.8, -20.3],
    'tumble': -29.3,
    'fs.award.click': -35.9,
    'toggle.off': -35.9,
    'turbo.off': -34,
  };
  // </punch>

  // the level a slot plays at: {kind: 'peak'|'punch'|'lufs'|'sustain', value, peakDb?, cap?, win?}
  function targetOf(name, variant) {
    const t = RECIPES[name].target, v = variant | 0, at = x => Array.isArray(x) ? x[Math.min(x.length - 1, v)] : x;
    if (t.lufs != null) return { kind: 'lufs', value: at(t.lufs) };
    if (t.sustainDb != null) return { kind: 'sustain', value: at(t.sustainDb), win: t.win };
    const pk = at(t.peakDb), P = t.punch ? PUNCH[name] : null;
    if (P != null) return { kind: 'punch', value: at(P), peakDb: pk, cap: pk + 1 };
    return { kind: 'peak', value: pk, peakDb: pk };
  }
  // linear playback gain that puts a render on its target (the runtime fallback;
  // tools/render-sfx.js applies the same rules to the decoded sheets)
  function gainFor(name, out, variant) {
    const v = variant != null ? variant : out.variant | 0, t = targetOf(name, v), p = Math.max(peakOf(out.L), peakOf(out.R)) || 1;
    if (t.kind === 'lufs') return db(t.value - loudness(out.L, out.R));
    if (t.kind === 'sustain') return db(t.value - sustain(out.L, out.R, t.win[0], t.win[1]));
    if (t.kind === 'punch') return Math.min(db(t.value - punch(out.L, out.R)), db(t.cap) / p);
    return db(t.value) / p;
  }

  // ======================================================================
  // API
  // ======================================================================
  const clampV = (r, variant) => Math.max(0, Math.min(r.variants - 1, variant | 0));
  function render(name, variant) {
    const r = RECIPES[name];
    if (!r) throw new Error('sfx: no recipe ' + name);
    const v = clampV(r, variant);
    used = new Set();
    try {
      const out = r.render(seedOf(name, v), v);
      out.variant = v; out.notesUsed = Array.from(used);
      return out;
    } finally { used = null; }
  }
  // The same render cut into small steps (a layer, or ~0.35 s of reverb, each)
  // for the runtime fallback: call step() from requestIdleCallback until it
  // returns true; then job.out is the render and job.gain its playback gain.
  function job(name, variant) {
    const r = RECIPES[name];
    if (!r) throw new Error('sfx: no recipe ' + name);
    const v = clampV(r, variant), notes = new Set(), it = r.steps(seedOf(name, v), v);
    const j = { name, variant: v, done: false, steps: 0, out: null, gain: 1, step };
    function step() {
      if (j.done) return true;
      const prev = used; used = notes; j.steps++;
      try {
        if (!j.out) { const s = it.next(); if (s.done) { j.out = s.value; j.out.variant = v; j.out.notesUsed = Array.from(notes); } }
        else { j.gain = gainFor(name, j.out, v); j.done = true; }     // the meter gets a step of its own
      } finally { used = prev; }
      return j.done;
    }
    return j;
  }
  // job() on a timer: steps for up to sliceMs, then yields to the page; resolves with the finished job
  const now = () => typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  function renderAsync(name, variant, sliceMs) {
    const j = job(name, variant), budget = sliceMs || 6;
    return new Promise((resolve, reject) => {
      (function tick() {
        try { const t = now(); while (!j.step()) if (now() - t >= budget) return void setTimeout(tick, 0); resolve(j); } catch (e) { reject(e); }
      })();
    });
  }
  function list() {
    const out = [];
    for (const name of ORDER) for (let v = 0; v < RECIPES[name].variants; v++) out.push([name, v]);
    return out;
  }
  const ALLOWED = Object.keys(PC);
  return { SR, NOTES, ALLOWED, RECIPES, PUNCH, list, render, job, renderAsync, seedOf, loudness, punch, sustain, targetOf, gainFor, _math: { sin1, exp, log, tanh, db, toDb } };
});

/* Thunder Hunter Sebastian — audio engine
 *
 * Sound effects come from three pre-rendered sound sheets (sounds/sfx-ui,
 * -world, -fs as .ogg, with .m4a twins for Safari) described by
 * sounds/sfx.json. The same recipes (js/sfx-recipes.js) render them in the
 * browser when the sheets can't be fetched (file://), so the game never
 * changes its voice. A few one-off synths remain for sounds outside the kit.
 *
 * Routing:
 *   voices ─ ui / world / stinger / ambience buses ─ glue ─ sfx volume ─ sfx mute ─┐
 *            world, stinger ─ room (one shared reverb) ─ glue                      ├─ master ─ limiter ─ out
 *   music ─ volume ─ lowpass (suspense) ─ duck ─────────────────────────────────────┘
 * A voice manager keeps every sound to its own polyphony, cooldown and
 * priority, so a burst of lands or ticks never piles up into mush.
 */
const AudioEngine = (() => {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  if (AC) { try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); } }

  /* ===================================================================
   * SOUND FILES — set a path (ideally .ogg) to use your own audio for a
   * sound; leave '' to use the built-in version. The two music tracks loop
   * (see TRACKS below). Everything else lives in the sound sheets.
   * =================================================================== */
  const SOUND_FILES = {
    thunder:      'sounds/thunder.ogg',
    music:        'sounds/music-base.ogg',
    musicFeature: 'sounds/music-feature.ogg',
  };
  const SHEETS = 'sounds/sfx.json';

  if (!ctx) {
    const noop = () => {}, voice = { stop: noop };
    return { play: () => voice, playAt: () => voice, anticipation: () => voice, startMusic: noop, stopMusic: noop, setVolume: noop,
      setSfx: noop, setSfxVolume: noop, setMusicVolume: noop, resume: noop, suspend: noop, duck: noop, duckFor: noop, unduck: noop, suspense: noop, musicMode: noop,
      now: () => 0, marks: () => ({}), debug: () => ({ voices: [] }), trackTime: () => null, has: () => false, length: (n, f) => f || 0, ready: Promise.resolve(), ctx: null, musicIn: null,
      get musicOn() { return false; }, get musicTrack() { return null; } };
  }

  // ---------------- the mix ----------------
  const master = ctx.createGain(); master.gain.value = 0.7;
  const limiter = ctx.createDynamicsCompressor();          // a safety net, not a sound: it should rarely move
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
  const trim = ctx.createGain(); trim.gain.value = 0.88;
  master.connect(limiter); limiter.connect(trim); trim.connect(ctx.destination);
  const sfxMute = ctx.createGain(); sfxMute.connect(master);
  const sfxVol = ctx.createGain(); sfxVol.gain.value = 0.85; sfxVol.connect(sfxMute);
  const glue = ctx.createDynamicsCompressor();             // gentle bus glue so layers sit together
  glue.threshold.value = -18; glue.knee.value = 6; glue.ratio.value = 2.5; glue.attack.value = 0.01; glue.release.value = 0.2;
  glue.connect(sfxVol);
  const BUS = {};
  ['ui', 'world', 'stinger', 'amb'].forEach(k => { BUS[k] = ctx.createGain(); BUS[k].connect(glue); });
  // one shared room: world sounds and stingers happen in the same space
  const room = ctx.createConvolver(), roomOut = ctx.createGain();
  room.buffer = roomIR(1.1); roomOut.gain.value = 1; room.connect(roomOut); roomOut.connect(glue);
  [['world', 0.12], ['stinger', 0.2], ['amb', 0.25]].forEach(([k, v]) => { const s = ctx.createGain(); s.gain.value = v; BUS[k].connect(s); s.connect(room); });
  const sfx = BUS.world;                                     // the one-off synths play in the world
  const musicDuck = ctx.createGain(); musicDuck.connect(master);
  const musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 18000; musicLP.Q.value = 0.7;
  musicLP.connect(musicDuck);
  const musicVol = ctx.createGain(); musicVol.gain.value = 0.42; musicVol.connect(musicLP);
  const canPan = typeof ctx.createStereoPanner === 'function';

  function roomIR(sec) {
    const sr = ctx.sampleRate, n = Math.round(sr * sec), b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, k = 0.25 + 0.7 * t;                // the tail darkens as it decays
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * Math.exp(-t * 6.5) * Math.min(1, i / (sr * 0.006)) * 0.5;
      }
    }
    return b;
  }

  const buffers = {};
  let sfxOn = true;

  function resume() { if (ctx.state === 'suspended') ctx.resume(); }
  function suspend() { if (ctx.state === 'running') ctx.suspend(); }
  const ramp = (p, v, tc) => { const t = ctx.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.setTargetAtTime(v, t, tc); };
  function setVolume(v) { ramp(master.gain, Math.max(0, Math.min(1, v)), 0.02); }
  function setSfxVolume(v) { ramp(sfxVol.gain, Math.max(0, Math.min(1, v)), 0.02); }
  const MUSIC_LEVEL = 0.42;                                  // the soundtrack's place in the mix at full volume
  function setMusicVolume(v) { ramp(musicVol.gain, MUSIC_LEVEL * Math.max(0, Math.min(1, v)), 0.05); }
  // mute ramps down (no click) and also silences every voice already sounding
  function setSfx(on) {
    sfxOn = on;
    const g = sfxMute.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.setTargetAtTime(on ? 1 : 0, on ? t : t + 0.08, 0.02);
    if (!on) live.slice().forEach(v => v.stop(0.1));
  }

  async function load(name, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
      if (musicOn && !cur && TRACKS[mode].file === name) playMode(0.05, 1);   // the track arrived after the synth pad started
    } catch (e) { /* missing/blocked (e.g. file://) -> synth fallback */ }
  }

  // ---------------- sound sheets ----------------
  /* slots[name] = [{ buf, start, dur, gain }, ...] one entry per variant.
   * Sheets are decoded once; if they can't be fetched the recipes render the
   * same sounds in idle time, most-used first. */
  const slots = {}, sheetBus = { ui: 'ui', world: 'world', fs: 'stinger' }, busOf = {};
  const vorbis = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; } })();
  async function loadSheets() {
    try {
      const res = await fetch(SHEETS);
      if (!res.ok) throw new Error(res.status);
      const meta = await res.json(), fmt = vorbis ? 'ogg' : 'm4a';
      const bufs = {};
      await Promise.all(Object.keys(meta.files).map(async k => {
        const f = meta.files[k], use = f[fmt] ? fmt : 'ogg', r = await fetch(f[use]);
        if (!r.ok) throw new Error(r.status);
        const ab = await r.arrayBuffer(), want = f.bytes && f.bytes[use];
        // a sheet from another release (a stale cache) would play the wrong sounds at these offsets: use the recipes instead
        if (want && ab.byteLength !== want) throw new Error('sheet ' + k + ' is not the one sfx.json describes');
        bufs[k] = await ctx.decodeAudioData(ab);
      }));
      // AAC decoders may or may not skip the encoder's priming samples: measure one shift per sheet on its
      // first slot (each sheet opens with silence). Vorbis decodes sample-exact, so its offsets are used as they are.
      const shift = {};
      if (fmt === 'm4a') Object.keys(meta.slots).forEach(key => {
        const s = meta.slots[key];
        if (shift[s.file] == null || s.offset < shift[s.file].offset) shift[s.file] = { offset: s.offset, onset: s.onsetSamples || 0 };
      });
      Object.keys(shift).forEach(f => {
        const t = shift[f], fi = meta.files[f] || {}, prime = ((fi.priming && fi.priming.m4a) || 1024) / (meta.sampleRate || 48000);
        let d = bufs[f] ? sheetShift(bufs[f], t.offset, t.onset) : 0;
        if (Math.abs(d) < 0.003) d = 0; else if (Math.abs(d - prime) < 0.003) d = prime;      // either skipped or kept the priming
        shift[f] = d;
      });
      Object.keys(meta.slots).forEach(key => {
        const s = meta.slots[key], hash = key.lastIndexOf('#'), name = key.slice(0, hash), v = +key.slice(hash + 1), buf = bufs[s.file];
        if (!buf) return;
        (slots[name] = slots[name] || [])[v] = { buf, start: Math.max(0, s.offset + (shift[s.file] || 0)), dur: s.duration, gain: s.gain };
        busOf[name] = sheetBus[s.file] || 'world';
      });
      return true;
    } catch (e) { sheetErr = String((e && e.message) || e); return false; }
  }
  let sheetErr = null;
  // how far a decoded sheet sits from where it was written (seconds, at most ±50 ms)
  function sheetShift(buf, offset, onsetSamples) {
    const sr = buf.sampleRate, d = buf.getChannelData(0), from = Math.max(0, Math.round((offset - 0.05) * sr)), to = Math.min(d.length, Math.round((offset + 0.05) * sr));
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = from; i < to; i++) if (Math.abs(d[i]) > peak * 0.25) return Math.max(-0.05, Math.min(0.05, i / sr - onsetSamples / 48000 - offset));
    return 0;
  }
  // file:// (or blocked fetches): render the recipes themselves
  const db = d => Math.pow(10, d / 20);
  function makeSlot(name, out, gain) {
    const R = window.GOS_SFX, rec = R.RECIPES[name], L = out.L || out, Rt = out.R || L, n = L.length, sr = R.SR || 48000;
    if (!n) return null;
    const b = ctx.createBuffer(2, n, sr);
    b.getChannelData(0).set(L); b.getChannelData(1).set(Rt);
    busOf[name] = sheetBus[rec.bus] || 'world';
    return { buf: b, start: 0, dur: n / sr, gain };      // gain: the kit's own meter, the same one the sheets were levelled with
  }
  // a sound wanted before the idle renderer reached it is rendered on the spot
  function renderSlot(name, v) {
    const R = window.GOS_SFX;
    if (!R || !R.RECIPES || !R.RECIPES[name]) return null;
    const out = R.render(name, v);
    return makeSlot(name, out, R.gainFor ? R.gainFor(name, out) : db(-18));
  }
  function variantsOf(name) {
    if (slots[name]) return slots[name].length;
    const R = window.GOS_SFX, rec = R && R.RECIPES && R.RECIPES[name];
    return rec ? rec.variants || 1 : 0;
  }
  function slotFor(name, v) {
    const list = slots[name] || (slots[name] = []);
    if (!list[v] && sheetsFailed) list[v] = renderSlot(name, v) || undefined;
    return list[v];
  }
  let sheetsFailed = false;
  const PRIORITY = ['ui.press', 'spin.press', 'land.thock', 'spin.dropout', 'spin.lock', 'count.tick', 'win.tick', 'win.chime', 'ui.denied', 'ui.open', 'ui.close', 'toggle.on', 'toggle.off'];
  // every recipe in idle time, most-used first, each in small steps (job) so no frame waits on a long one
  function renderInIdle() {
    const R = window.GOS_SFX;
    if (!R || !R.RECIPES || !R.job) return;
    const names = PRIORITY.filter(n => R.RECIPES[n]).concat(Object.keys(R.RECIPES).filter(n => PRIORITY.indexOf(n) < 0));
    const jobs = [];
    names.forEach(n => { for (let v = 0; v < (R.RECIPES[n].variants || 1); v++) jobs.push([n, v]); });
    const idle = window.requestIdleCallback || (f => setTimeout(() => f({ timeRemaining: () => 8 }), 30));
    let j = null;
    const step = dl => {
      while (dl.timeRemaining() > 3) {
        if (!j) {
          const nx = jobs.shift();
          if (!nx) return;
          if ((slots[nx[0]] || [])[nx[1]]) continue;           // already rendered on demand
          j = R.job(nx[0], nx[1]);
        }
        if (j.step()) { const list = slots[j.name] || (slots[j.name] = []); if (!list[j.variant]) list[j.variant] = makeSlot(j.name, j.out, j.gain) || undefined; j = null; }
      }
      if (jobs.length || j) idle(step);
    };
    idle(step);
  }
  const ready = loadSheets().then(ok => { if (!ok) { sheetsFailed = true; renderInIdle(); } return ok; });

  // ---------------- the voice manager ----------------
  // [name prefix, polyphony, cooldown (s), priority, detune (cents), level jitter (dB)]
  const POLICY = [
    ['ui.', 2, 0.025, 3, 25, 1.5], ['toggle.', 1, 0.02, 3, 0, 1], ['turbo.', 1, 0.02, 3, 0, 1], ['bet.', 1, 0.03, 3, 15, 1],
    ['spin.press', 1, 0.05, 5, 0, 1], ['spin.dropout', 1, 0.1, 2, 15, 1.5], ['spin.lock', 1, 0.08, 3, 0, 1], ['spin.brake', 1, 0.08, 4, 0, 1],
    ['land.thock', 6, 0.015, 2, 15, 1.5], ['tine.', 6, 0.012, 2, 0, 1], ['scatter.lock', 4, 0, 5, 0, 0],
    ['count.tick', 3, 0.028, 1, 20, 1.5], ['win.', 2, 0.05, 3, 0, 1], ['shell.', 3, 0.02, 1, 25, 2],
    ['orb.', 3, 0, 4, 0, 0.5], ['collect', 2, 0, 3, 0, 1], ['slam', 1, 0, 5, 0, 0], ['tumble', 2, 0.04, 2, 15, 1.5],
    ['fs.award', 16, 0, 6, 0, 1], ['fs.', 4, 0, 6, 0, 0], ['tier.', 1, 0, 6, 0, 0], ['maxwin', 1, 0, 7, 0, 0],
  ];
  const DEFAULT = ['', 4, 0, 3, 0, 0], CAP = 32;
  const policy = name => POLICY.find(p => name.startsWith(p[0])) || DEFAULT;
  const live = [], lastAt = {}, lastVar = {};
  function prune() { const t = ctx.currentTime; for (let i = live.length - 1; i >= 0; i--) if (live[i].end < t) live.splice(i, 1); }
  // make room for a new voice; false = the new one should not play
  function admit(name, pol) {
    prune();
    const same = live.filter(v => v.name === name);
    if (same.length >= pol[1]) same[0].stop(0.015);
    if (live.length >= CAP) {
      const victim = live.filter(v => v.pri <= pol[3]).sort((a, b) => a.pri - b.pri || a.t - b.t)[0];
      if (!victim) return false;
      victim.stop(0.015);
    }
    return true;
  }
  function makeVoice(name, src, g, pri, end) {
    const v = { name, pri, t: ctx.currentTime, end, stopped: false,
      stop(fade) {
        if (v.stopped) return; v.stopped = true;
        const n = ctx.currentTime, f = fade || 0.03;
        try { g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + f); src.stop(n + f + 0.01); } catch (e) { /* already stopped */ }
        const i = live.indexOf(v); if (i >= 0) live.splice(i, 1);
      } };
    live.push(v);
    return v;
  }

  /* play(name, { rate, gain, pan (-1..1, screen position), variant, when (context time) })
   * Returns a voice with stop(fade), or a no-op voice when nothing played. */
  const NOVOICE = { stop() {} };
  const warned = {};
  const ALIAS = { click: 'ui.press', denied: 'ui.denied', confirm: 'ui.confirm', tick: 'count.tick' };
  function play(name, opts) {
    if (!sfxOn) return NOVOICE;
    resume();
    opts = opts || {};
    if (ALIAS[name] && variantsOf(ALIAS[name])) { name = ALIAS[name]; opts = Object.assign({}, opts, { rate: 1 }); }
    const n = variantsOf(name);
    if (n) return playKit(name, n, opts);
    const rate = opts.rate || 1, gain = opts.gain != null ? opts.gain : 1;
    if (buffers[name]) { const src = playBuffer(buffers[name], gain, rate, BUS.world); return makeVoice(name, src.src, src.g, 3, ctx.currentTime + buffers[name].duration / rate); }
    if (synths[name]) { synths[name](rate, gain); return NOVOICE; }
    if (!warned[name]) { warned[name] = true; console.warn('AudioEngine: no sound named "' + name + '"'); }
    return NOVOICE;
  }
  function playKit(name, n, opts) {
    const pol = policy(name), now = ctx.currentTime, when = Math.max(now, opts.when || 0);
    if (!opts.when && lastAt[name] != null && now - lastAt[name] < pol[2]) return NOVOICE;
    // round robin that never repeats the last variant
    let v = opts.variant;
    if (v == null) { v = n > 1 ? ((lastVar[name] == null ? 0 : lastVar[name]) + 1 + Math.floor(Math.random() * (n - 1))) % n : 0; }
    v = Math.max(0, Math.min(n - 1, v | 0));
    const sl = slotFor(name, v);
    if (!sl) return NOVOICE;
    if (!admit(name, pol)) return NOVOICE;
    lastAt[name] = now; lastVar[name] = v;
    const cents = pol[4] ? (Math.random() * 2 - 1) * pol[4] : 0, jitter = pol[5] ? db((Math.random() * 2 - 1) * pol[5]) : 1;
    const rate = (opts.rate || 1) * Math.pow(2, cents / 1200);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = sl.buf; src.playbackRate.value = rate;
    g.gain.value = sl.gain * (opts.gain != null ? opts.gain : 1) * jitter;
    src.connect(g);
    let out = g;
    if (opts.pan && canPan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan)) * 0.35; g.connect(p); out = p; }
    out.connect(BUS[busOf[name] || 'world']);
    src.start(when, sl.start, sl.dur);
    return makeVoice(name, src, g, pol[3], when + sl.dur / rate + 0.05);
  }
  const has = name => variantsOf(name) > 0;
  // timing marks a recipe publishes (seconds into the sound), e.g. when its horn notes fall
  const marks = name => { const R = window.GOS_SFX, rec = R && R.RECIPES && R.RECIPES[name]; return (rec && rec.marks) || {}; };
  // a sound's length in seconds (for timing events against it), or the fallback given
  const length = (name, fallback) => { const v = slots[name] && slots[name].find(Boolean); return v ? v.dur : fallback || 0; };

  function playBuffer(buf, gain, rate, dest, loop) {
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = !!loop; src.playbackRate.value = rate || 1;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(dest || sfx);
    src.start();
    return { src, g };
  }

  // ---------------- synth primitives (sounds outside the kit) ----------------
  function tone(freq, t0, dur, type, gain, glideTo, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfx);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function bell(freq, t0, dur, gain) {
    tone(freq, t0, dur, 'sine', gain);
    tone(freq * 2.01, t0, dur * 0.7, 'sine', gain * 0.35);
    tone(freq * 3.0, t0, dur * 0.4, 'sine', gain * 0.16);
  }
  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function noise(t0, dur, gain, freq, type, sweepTo) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer();
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq || 1200, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfx);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.02);
  }
  // everything stays in the game's key (G A Bb C D F): intervals counted up from G
  const G3 = 196, semi = n => Math.pow(2, n / 12);

  // p = pitch multiplier, g = gain. Fallbacks for the kit, and a few sounds outside it.
  const synths = {
    click(p, g) { tone(587.33 * p, ctx.currentTime, 0.04, 'triangle', 0.06 * g); },
    hover(p, g) { tone(1174.66 * p, ctx.currentTime, 0.025, 'sine', 0.02 * g); },
    thunder(p, g) { const t = ctx.currentTime; noise(t, 0.9, 0.3 * g, 380); noise(t + 0.05, 0.6, 0.2 * g, 900); tone(58.27, t, 1.0, 'sine', 0.3 * g, 36.71); },
    whoosh(p, g) { noise(ctx.currentTime, 0.5, 0.14 * g, 300 * p, 'bandpass', 3000 * p); },
    bigwin(p, g) {
      const t = ctx.currentTime;
      [0, 3, 7, 12, 15, 19, 24].forEach((s, i) => bell(G3 * 2 * p * semi(s), t + i * 0.085, 0.6, 0.15 * g));
      tone(98, t, 1.0, 'sine', 0.3 * g, 73.42); noise(t, 0.6, 0.05 * g, 6000, 'highpass');
    },
    tierUp(p, g) { const t = ctx.currentTime; [0, 7, 12, 19].forEach((s, i) => bell(G3 * 2 * p * semi(s), t + i * 0.04, 0.8, 0.14 * g)); tone(98, t, 0.6, 'sine', 0.25 * g, 73.42); },
    achievement(p, g) { const t = ctx.currentTime; [0, 3, 7, 12, 15].forEach((s, i) => bell(G3 * 2 * p * semi(s), t + i * 0.07, 0.5, 0.11 * g)); },
    denied(p, g) { const t = ctx.currentTime; tone(220, t, 0.08, 'triangle', 0.05 * g); tone(174.61, t + 0.07, 0.12, 'triangle', 0.05 * g); },
    confirm(p, g) { const t = ctx.currentTime; bell(587.33 * p, t, 0.12, 0.07 * g); bell(880 * p, t + 0.012, 0.12, 0.05 * g); },
  };

  // rising pressure while the last reels hold back with one scatter missing: D rising to A, in key
  function anticipation() {
    if (!sfxOn) return NOVOICE;
    resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    o.frequency.setValueAtTime(146.83, t); o.frequency.exponentialRampToValueAtTime(220, t + 4);
    o2.frequency.setValueAtTime(146.83 * 1.007, t); o2.frequency.exponentialRampToValueAtTime(220 * 1.007, t + 4);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2400, t + 4); lp.Q.value = 6;
    lfo.frequency.setValueAtTime(5, t); lfo.frequency.linearRampToValueAtTime(14, t + 4); lfoG.gain.value = 0.03;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.4);
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(BUS.world);
    o.start(t); o2.start(t); lfo.start(t);
    let stopped = false;
    const v = {
      stop() {
        if (stopped) return; stopped = true;
        const n = ctx.currentTime;
        g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.25);
        [o, o2, lfo].forEach(x => x.stop(n + 0.3));
        const i = live.indexOf(v); if (i >= 0) live.splice(i, 1);
      },
      name: 'anticipation', pri: 4, t, end: Infinity,
    };
    live.push(v);
    return v;
  }

  // ---------------- music ----------------
  /* Two soundtracks: the base game and free spins. Each file opens with a short
   * intro and then loops its body. The loop points sit on the attack of the
   * hit the file ends on, which is the same hit that opens the body (feature:
   * 112 beats at 128 BPM; base: about 40 bars), so the loop is seamless. The
   * base track picks up where it left off after free spins; the feature track
   * always starts from its intro, timed so its first downbeat (loopStart) can
   * land exactly on the storm breaking. */
  const TRACKS = {
    base: { file: 'music',        gain: 1.5, loopStart: 0.175, loopEnd: 89.058 },
    fs:   { file: 'musicFeature', gain: 1.1, loopStart: 2.396, loopEnd: 54.888, bpm: 128 },
  };
  let musicOn = false, musicTimer = null, mode = 'base', cur = null, nextAt = 0;
  const resumeAt = { base: 0, fs: 0 };
  const CHORDS = [[196.0, 233.08, 293.66], [174.61, 220.0, 261.63], [233.08, 293.66, 349.23], [220.0, 261.63, 349.23]];
  function startTrack(key, fade, at) {
    const tr = TRACKS[key], buf = buffers[tr.file];
    if (!buf) return false;
    const src = ctx.createBufferSource(), g = ctx.createGain(), t = Math.max(ctx.currentTime, at || 0);
    src.buffer = buf; src.loop = true;
    src.loopStart = tr.loopStart; src.loopEnd = Math.min(tr.loopEnd, buf.duration);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(tr.gain, t + Math.max(0.02, fade));
    src.connect(g); g.connect(musicVol);
    const off = Math.min(resumeAt[key], src.loopEnd - 0.05);
    src.start(t, off);
    cur = { key, src, g, t0: t, off, end: src.loopEnd };
    return true;
  }
  // where in the file a playing track is now (follows the loop)
  function position(c) {
    const ls = TRACKS[c.key].loopStart;
    let p = c.off + Math.max(0, ctx.currentTime - c.t0);
    if (p > c.end) p = ls + (p - c.end) % (c.end - ls);
    return p;
  }
  function stopTrack(fade) {
    if (!cur) return;
    const c = cur; cur = null;
    // both tracks remember where they were (a hidden tab or mute resumes in place);
    // a new feature starts the free-spins track from its intro (musicMode)
    resumeAt[c.key] = position(c);
    const t = ctx.currentTime, gn = c.g.gain;
    gn.cancelScheduledValues(t); gn.setValueAtTime(Math.max(0.0001, gn.value), t); gn.linearRampToValueAtTime(0, t + fade);
    try { c.src.stop(t + fade + 0.05); } catch (e) { /* already stopped */ }
  }
  function startSynthMusic() {
    if (musicTimer) return;
    let i = 0;
    const chord = () => {
      const t = ctx.currentTime, c = CHORDS[i++ % CHORDS.length];
      c.forEach(f => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.08, t + 0.8); g.gain.linearRampToValueAtTime(0.0001, t + 3.6);
        o.connect(g); g.connect(musicVol); o.start(t); o.stop(t + 3.8);
      });
    };
    chord(); musicTimer = setInterval(chord, 3600);
  }
  function stopSynthMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
  // (re)start whatever the current mode should be playing: its track, or the synth pad until the file arrives
  function playMode(fadeOut, fadeIn, at) {
    stopTrack(fadeOut);
    if (startTrack(mode, fadeIn, at)) stopSynthMusic(); else startSynthMusic();
  }
  function startMusic() {
    if (musicOn) return;
    musicOn = true; resume();
    playMode(0.05, 1);
  }
  function stopMusic() {
    musicOn = false;
    stopSynthMusic(); stopTrack(0.3);
  }
  /* Free spins get their own track: crossfade to it, and back to the base
   * track afterwards. opts.downbeatAt (context time) starts the feature track
   * so that its first downbeat lands exactly then. */
  function musicMode(m, opts) {
    if (m === mode && !(opts && opts.downbeatAt)) return;      // a downbeat re-cues the track already playing
    mode = m;
    if (m === 'fs') resumeAt.fs = 0;
    if (!musicOn) return;
    const dba = opts && opts.downbeatAt;
    if (m === 'fs' && dba) {
      const lead = TRACKS.fs.loopStart, at = dba - lead;
      if (at >= ctx.currentTime) { stopTrack(Math.max(0.3, at - ctx.currentTime)); if (startTrack('fs', 0.05, at)) stopSynthMusic(); return; }
      resumeAt.fs = Math.min(lead, ctx.currentTime - at);       // too late for the intro: join it in step
      playMode(0.3, 0.05); return;
    }
    playMode(1.2, m === 'fs' ? 0.3 : 1.5);
  }
  // where the playing track is: { key, pos (s into the file), bpm }
  function trackTime() { return cur ? { key: cur.key, pos: position(cur), bpm: TRACKS[cur.key].bpm || 0, startsAt: cur.t0 } : null; }
  // dip the music under a moment, then bring it back
  function duck(depth, seconds) {
    const t = ctx.currentTime, gn = musicDuck.gain;
    gn.cancelScheduledValues(t); gn.setValueAtTime(gn.value, t);
    gn.linearRampToValueAtTime(depth, t + 0.15);
    gn.setValueAtTime(depth, t + Math.max(0.2, seconds));
    gn.linearRampToValueAtTime(1, t + Math.max(0.2, seconds) + 0.8);
  }
  // bring the music back now (a ducked moment was closed early)
  function unduck(fade) {
    const t = ctx.currentTime, gn = musicDuck.gain;
    gn.cancelScheduledValues(t); gn.setValueAtTime(gn.value, t);
    gn.linearRampToValueAtTime(1, t + (fade == null ? 0.6 : fade));
  }
  // muffle the music while the reels tease a feature
  function suspense(on) {
    const f = musicLP.frequency, t = ctx.currentTime;
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(on ? 650 : 18000, t + (on ? 0.6 : 0.9));
  }
  Object.keys(SOUND_FILES).forEach(n => { if (SOUND_FILES[n]) load(n, SOUND_FILES[n]); });

  return { play, anticipation, startMusic, stopMusic, setVolume, setSfx, setSfxVolume, setMusicVolume, resume, suspend, duck, duckFor: duck, unduck, suspense, musicMode,
    trackTime, has, length, marks, ready, now: () => ctx.currentTime, ctx, musicIn: musicVol,
    // read-only state for tests and the dev console
    debug: () => ({ voices: live.map(v => v.name), sfxOn, mute: sfxMute.gain.value, sheets: !sheetsFailed, sheetErr, music: musicOn, track: cur ? cur.key : null }),
    get musicOn() { return musicOn; },
    get musicTrack() { return cur ? cur.key : null; } };
})();

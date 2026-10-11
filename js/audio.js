/* Gates of Sebastian — audio engine
 *
 * Every sound is either a file from SOUND_FILES or a Web Audio synth fallback,
 * so the game has full sound even with no audio files at all. All sounds take
 * an optional pitch (`rate`), which the game uses to make consecutive tumbles,
 * scatter landings and count-ups climb in pitch.
 *
 * Routing:  sfx ─┐
 *                ├─ master ─ compressor ─ out
 *   music ─ lowpass ─ duck ─┘
 * The music lowpass closes during scatter anticipation and the duck gain dips
 * under big-win fanfares.
 */
const AudioEngine = (() => {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = AC ? new AC() : null;

  /* ===================================================================
   * SOUND FILES — set a path (ideally .ogg) to use your own audio for a
   * sound; leave '' to use the built-in synthesized version. 'music' loops.
   * =================================================================== */
  const SOUND_FILES = {
    spin:      'sounds/spin.ogg',
    thunder:   'sounds/thunder.ogg',
    scatter:   'sounds/scatter.ogg',
    freespins: 'sounds/freespins.ogg',
    click:     'sounds/click.ogg',
    music:     'sounds/music.ogg',
  };

  if (!ctx) {
    const noop = () => {};
    return { play: noop, startMusic: noop, stopMusic: noop, setVolume: noop, setSfx: noop, setMusicVolume: noop,
      resume: noop, duck: noop, suspense: noop, anticipation: () => ({ stop: noop }), musicMode: noop };
  }

  const master = ctx.createGain(); master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  const sfx = ctx.createGain(); sfx.connect(master);
  const musicDuck = ctx.createGain(); musicDuck.connect(master);
  const musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 18000; musicLP.Q.value = 0.7;
  musicLP.connect(musicDuck);
  const musicVol = ctx.createGain(); musicVol.gain.value = 0.42; musicVol.connect(musicLP);

  const buffers = {};
  let sfxOn = true;

  function resume() { if (ctx.state === 'suspended') ctx.resume(); }
  function setVolume(v) { master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.02); }
  function setSfx(on) { sfxOn = on; sfx.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02); }
  function setMusicVolume(v) { musicVol.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }

  async function load(name, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
      if (name === 'music' && musicOn && !musicSrc) { stopSynthMusic(); startMusicBuffer(); }
    } catch (e) { /* missing/blocked (e.g. file://) -> synth fallback */ }
  }

  function playBuffer(buf, gain, rate, dest, loop) {
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = !!loop; src.playbackRate.value = rate || 1;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(dest || sfx);
    src.start();
    return src;
  }

  // ---------------- synth primitives ----------------
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

  const MAJOR = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const semi = n => Math.pow(2, n / 12);

  // p = pitch multiplier, g = gain
  const synths = {
    click(p, g) { tone(520 * p, ctx.currentTime, 0.05, 'square', 0.07 * g); },
    hover(p, g) { tone(900 * p, ctx.currentTime, 0.03, 'sine', 0.03 * g); },
    spin(p, g) { const t = ctx.currentTime; noise(t, 0.35, 0.12 * g, 600, 'bandpass', 3800); tone(140 * p, t, 0.35, 'sawtooth', 0.06 * g, 420 * p); },
    land(p, g) { const t = ctx.currentTime; tone(150 * p, t, 0.12, 'triangle', 0.16 * g, 70 * p); noise(t, 0.06, 0.08 * g, 900); },
    scatterLand(p, g) { const t = ctx.currentTime; bell(784 * p, t, 0.7, 0.18 * g); bell(1175 * p, t + 0.06, 0.5, 0.08 * g); },
    win(p, g) { const t = ctx.currentTime; [0, 4, 7, 12].forEach((s, i) => bell(523.25 * p * semi(s), t + i * 0.055, 0.32, 0.13 * g)); },
    tumble(p, g) { const t = ctx.currentTime; noise(t, 0.22, 0.2 * g, 2400, 'lowpass', 300); tone(110 * p, t, 0.2, 'triangle', 0.14 * g, 55); },
    shatter(p, g) { const t = ctx.currentTime; noise(t, 0.12, 0.14 * g, 5000, 'highpass'); [0, 5, 9].forEach((s, i) => tone(1800 * p * semi(s), t + i * 0.02, 0.09, 'sine', 0.04 * g)); },
    orb(p, g) {   // p grows with orb value
      const t = ctx.currentTime;
      tone(1600, t, 0.25, 'sawtooth', 0.05 * g, 180);
      noise(t, 0.25, 0.16 * g, 7000, 'highpass');
      bell(660 * p, t + 0.08, 0.6, 0.16 * g);
      if (p > 1.4) tone(55, t, 0.9, 'sine', 0.3 * g, 35);
    },
    collect(p, g) { const t = ctx.currentTime; noise(t, 0.4, 0.12 * g, 400, 'bandpass', 5000); tone(300 * p, t + 0.05, 0.35, 'sine', 0.08 * g, 1200 * p); },
    slam(p, g) { const t = ctx.currentTime; tone(70, t, 0.7, 'sine', 0.38 * g, 40); noise(t, 0.4, 0.2 * g, 1600, 'lowpass', 200); bell(523.25 * p, t, 0.6, 0.14 * g); bell(784 * p, t + 0.05, 0.6, 0.1 * g); },
    crackle(p, g) { const t = ctx.currentTime; for (let k = 0; k < 5; k++) noise(t + k * 0.045 + Math.random() * 0.02, 0.05, 0.09 * g, 3500 * p, 'highpass'); tone(2400 * p, t, 0.08, 'sawtooth', 0.02 * g, 900); },
    tick(p, g) { tone(1200 * p, ctx.currentTime, 0.035, 'triangle', 0.05 * g); },
    coin(p, g) { const t = ctx.currentTime; tone(1900 * p, t, 0.08, 'square', 0.04 * g); tone(2850 * p, t + 0.04, 0.14, 'sine', 0.05 * g); },
    whoosh(p, g) { noise(ctx.currentTime, 0.5, 0.14 * g, 300 * p, 'bandpass', 3000 * p); },
    thunder(p, g) { const t = ctx.currentTime; noise(t, 0.9, 0.3 * g, 380); noise(t + 0.05, 0.6, 0.2 * g, 900); tone(60, t, 1.0, 'sine', 0.3 * g, 36); },
    scatter(p, g) { const t = ctx.currentTime; [0, 0, 7, 12].forEach((s, i) => tone(660 * p * semi(s), t + i * 0.12, 0.22, 'square', 0.1 * g)); },
    bigwin(p, g) {
      const t = ctx.currentTime;
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => bell(392 * p * semi(s), t + i * 0.085, 0.6, 0.15 * g));
      tone(65, t, 1.0, 'sine', 0.3 * g, 45); noise(t, 0.6, 0.05 * g, 6000, 'highpass');
    },
    freespins(p, g) {
      const t = ctx.currentTime;
      MAJOR.slice(0, 8).forEach((s, i) => bell(523.25 * p * semi(s), t + i * 0.11, 0.5, 0.15 * g));
      tone(65, t, 1.4, 'sine', 0.25 * g);
    },
    tierUp(p, g) { const t = ctx.currentTime; [0, 7, 12, 19].forEach((s, i) => bell(392 * p * semi(s), t + i * 0.04, 0.8, 0.14 * g)); tone(80, t, 0.6, 'sine', 0.25 * g, 50); },
    achievement(p, g) { const t = ctx.currentTime; [0, 4, 7, 12, 16].forEach((s, i) => bell(659.25 * p * semi(s), t + i * 0.07, 0.5, 0.11 * g)); },
    denied(p, g) { const t = ctx.currentTime; tone(220, t, 0.12, 'square', 0.06 * g); tone(165, t + 0.1, 0.18, 'square', 0.06 * g); },
  };

  function play(name, opts) {
    if (!sfxOn) return;
    resume();
    const rate = (opts && opts.rate) || 1, gain = opts && opts.gain != null ? opts.gain : 1;
    if (buffers[name]) { playBuffer(buffers[name], gain, rate); return; }
    (synths[name] || synths.click)(rate, gain);
  }

  // rising suspense drone while the last reels spin with 3 scatters showing
  function anticipation() {
    if (!sfxOn) return { stop() {} };
    resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(330, t + 4);
    o2.frequency.setValueAtTime(110 * 1.007, t); o2.frequency.exponentialRampToValueAtTime(330 * 1.007, t + 4);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2400, t + 4); lp.Q.value = 6;
    lfo.frequency.setValueAtTime(5, t); lfo.frequency.linearRampToValueAtTime(14, t + 4); lfoG.gain.value = 0.03;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.4);
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(sfx);
    o.start(t); o2.start(t); lfo.start(t);
    let stopped = false;
    return {
      stop() {
        if (stopped) return; stopped = true;
        const n = ctx.currentTime;
        g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.25);
        [o, o2, lfo].forEach(x => x.stop(n + 0.3));
      },
    };
  }

  // ---------------- music ----------------
  let musicOn = false, musicSrc = null, musicTimer = null;
  const CHORDS = [[261.63, 329.63, 392.0], [293.66, 349.23, 440.0], [220.0, 277.18, 329.63], [246.94, 311.13, 392.0]];
  function startMusicBuffer() { musicSrc = playBuffer(buffers.music, 1, 1, musicVol, true); }
  function startSynthMusic() {
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
  function startMusic() {
    if (musicOn) return;
    musicOn = true; resume();
    if (buffers.music) startMusicBuffer(); else startSynthMusic();
  }
  function stopMusic() {
    musicOn = false;
    stopSynthMusic();
    if (musicSrc) { try { musicSrc.stop(); } catch (e) { /* already stopped */ } musicSrc = null; }
  }
  // dip the music under a fanfare, then bring it back
  function duck(depth, seconds) {
    const t = ctx.currentTime, gn = musicDuck.gain;
    gn.cancelScheduledValues(t); gn.setValueAtTime(gn.value, t);
    gn.linearRampToValueAtTime(depth, t + 0.15);
    gn.setValueAtTime(depth, t + Math.max(0.2, seconds));
    gn.linearRampToValueAtTime(1, t + Math.max(0.2, seconds) + 0.8);
  }
  // muffle the music while the reels tease a feature
  function suspense(on) {
    const f = musicLP.frequency, t = ctx.currentTime;
    f.cancelScheduledValues(t); f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(on ? 650 : 18000, t + (on ? 0.6 : 0.9));
  }
  // slightly brighter, louder bed during free spins
  function musicMode(mode) { musicVol.gain.setTargetAtTime(mode === 'fs' ? 0.55 : 0.42, ctx.currentTime, 0.4); }

  Object.keys(SOUND_FILES).forEach(n => { if (SOUND_FILES[n]) load(n, SOUND_FILES[n]); });

  return { play, anticipation, startMusic, stopMusic, setVolume, setSfx, setMusicVolume, resume, duck, suspense, musicMode,
    ctx, musicIn: musicVol,
    get musicOn() { return musicOn; } };
})();

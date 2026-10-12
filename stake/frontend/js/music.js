/* Thunder Hunter Sebastian — adaptive music layers.
 *
 * A small Web Audio layer that plays *under* the soundtrack and follows the
 * game: an accelerating heartbeat during a scatter tease and a low rumble that
 * grows with the free-spins storm. Everything is synthesized and routed into
 * the music bus, so the music volume, the suspense filter and the big-win
 * ducking all apply to it.
 *
 * It also has a drum groove (silent while idle, a pulse while the reels spin,
 * building with every cascade). That only plays over the synth pad fallback:
 * the base and free-spins soundtracks have their own beat (108 and 128 BPM),
 * which a fixed-tempo groove would clash with.
 */
(() => {
  'use strict';
  const A = typeof AudioEngine !== 'undefined' ? AudioEngine : null;   // top-level const, not a window property
  const Music = { setIntensity() {}, heartbeat() {}, start() {}, stop() {}, get level() { return 0; } };
  window.GOSMusic = Music;
  if (!A || !A.ctx || !A.musicIn) return;

  const ctx = A.ctx;
  const out = ctx.createGain(); out.gain.value = 0.85;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.6;
  out.connect(lp); lp.connect(A.musicIn);

  const BPM = 104, STEP = 60 / BPM / 4;                     // sixteenth notes

  let intensity = 0, target = 0, running = false, timer = null, nextT = 0, step = 0;
  let beat = false, beatNext = 0, beatRate = 0.8;
  let noiseBuf = null;

  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function env(g, t, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function osc(type, f0, f1, t, dur, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, peak, dur); o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function hiss(t, dur, peak, freq) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer(); f.type = 'highpass'; f.frequency.value = freq;
    env(g, t, peak, dur); s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02);
  }

  function schedule(i, t) {
    const I = intensity;
    if (I < 0.05 || beat || A.musicTrack) return;
    const bar = Math.floor(i / 16) % 4, s16 = i % 16;
    if (s16 % 4 === 0 && I > 0.15) osc('sine', 150, 42, t, 0.32, 0.55 * I);                          // kick
    if (s16 === 10 && I > 0.7) osc('sine', 150, 42, t, 0.28, 0.35 * I);                               // pickup kick
    if (s16 % (I > 0.75 ? 1 : 2) === 0 && I > 0.35) hiss(t, 0.04, (s16 % 4 === 2 ? 0.1 : 0.05) * I, 7500); // hats
    if ((s16 === 4 || s16 === 12) && I > 0.5) { hiss(t, 0.16, 0.18 * I, 1800); osc('triangle', 220, 160, t, 0.1, 0.07 * I); } // snare
    if (I > 0.6 && bar === 3 && s16 >= 12) osc('sine', 190 - (s16 - 12) * 30, 70, t, 0.18, 0.22 * I);   // tom fill into the next phrase
    if (s16 % 8 === 6 && I > 0.3) hiss(t, 0.09, 0.05 * I, 3000);                                       // shaker
  }

  // a low noise rumble under free spins that grows with the storm
  let rumble = null;
  Music.storm = k => {
    if (!running) return;
    if (!rumble && k > 0.02) {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noiseBuffer(); src.loop = true; f.type = 'lowpass'; f.frequency.value = 140; g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(out); src.start();
      rumble = { src, g };
    }
    if (rumble) rumble.g.gain.setTargetAtTime(0.22 * k, ctx.currentTime, 0.5);
  };

  function heartbeatTick() {
    const now = ctx.currentTime;
    if (!beat) return;
    if (beatNext < now) beatNext = now + 0.05;
    while (beatNext < now + 0.15) {
      osc('sine', 70, 40, beatNext, 0.16, 0.6);            // lub
      osc('sine', 62, 38, beatNext + 0.17, 0.14, 0.42);    // dub
      beatNext += beatRate; beatRate = Math.max(0.42, beatRate * 0.93);
    }
  }

  function tick() {
    const now = ctx.currentTime;
    intensity += (target - intensity) * 0.12;              // ~25 ms ticks -> eases over about a second
    if (intensity < 0.01 && target === 0) intensity = 0;
    if (nextT < now - 0.25) nextT = now + 0.05;            // came back from a throttled background tab
    while (nextT < now + 0.12) { schedule(step++, nextT); nextT += STEP; }
    heartbeatTick();
  }

  Music.start = () => {
    if (running) return;
    running = true; nextT = ctx.currentTime + 0.1;
    timer = setInterval(tick, 25);
  };
  Music.stop = () => {
    running = false; clearInterval(timer); timer = null; intensity = 0;
    if (rumble) { try { rumble.src.stop(); } catch (e) { /* already stopped */ } rumble = null; }
  };
  Music.setIntensity = v => { target = Math.max(0, Math.min(1, v)); };
  Music.heartbeat = on => {
    if (on && !beat) { beatNext = ctx.currentTime + 0.05; beatRate = 0.8; }
    beat = !!on;
  };
  Object.defineProperty(Music, 'level', { get: () => intensity });
})();

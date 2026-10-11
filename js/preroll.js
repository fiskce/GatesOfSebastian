/* Thunder Hunter Sebastian — "Only on Stake" preroll.
 *
 * Loaded right after the #preroll markup, before everything else, so the sting
 * is the first thing on screen. The game keeps loading behind it and only
 * shows its loader/splash once window.PREROLL resolves.
 *
 * Fill: the clip covers the whole screen when that keeps the "Only on Stake"
 * text in view (any landscape screen). On narrower screens it is scaled as far
 * as the text allows and a blurred live copy of it fills the rest, so there
 * are never black bars.
 *
 * Sound: browsers only allow sound after the player has tapped the page. It
 * tries to play with sound; if the browser says no, the first frame waits
 * behind "TAP TO START" and the tap starts it, with sound, from the beginning.
 * A player who turned the sound off last time gets it muted with no prompt.
 *
 * It always hands over to the game: when the video ends, fails to load or
 * stalls. It doesn't play at all offline, for a bet replay or in social play.
 */
(() => {
  'use strict';
  const box = document.getElementById('preroll');
  const video = document.getElementById('prerollVideo');
  const back = document.getElementById('prerollBack');
  const tap = document.getElementById('prerollTap');
  let finish;
  window.PREROLL = new Promise(res => { finish = res; });
  if (!box || !video) { finish(); return; }

  let done = false, started = false, waitingTap = false, stall = 0;
  const end = () => {
    if (done) return;
    done = true;
    clearTimeout(stall);
    window.removeEventListener('resize', fit);
    window.removeEventListener('keydown', onKey, true);
    box.classList.add('done');
    setTimeout(() => { box.remove(); }, 450);     // after the fade
    finish();
  };

  // ---- fill the screen ----
  // the text sits in the middle 55% x 20% of the frame; keep 62% x 40% of it on screen
  const SAFE_W = 0.62, SAFE_H = 0.4;
  let framed = false;
  function fit() {
    const W = window.innerWidth, H = window.innerHeight;
    const vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
    const cover = Math.max(W / vw, H / vh), contain = Math.min(W / vw, H / vh);
    const safe = Math.min(W / (vw * SAFE_W), H / (vh * SAFE_H));
    const s = Math.min(cover, Math.max(contain, safe));
    const w = Math.min(W, vw * s), h = Math.min(H, vh * s);
    video.style.width = w + 'px'; video.style.height = h + 'px';
    framed = w < W - 0.5 || h < H - 0.5;
    box.classList.toggle('framed', framed);
    box.classList.toggle('framed-v', h < H - 0.5);
    box.classList.toggle('framed-h', w < W - 0.5);
    if (framed) drawBack();
  }
  // the backdrop: the same frame drawn tiny, then scaled up and blurred by CSS
  const bctx = back && back.getContext ? back.getContext('2d') : null;
  let looping = false;
  function drawBack() {
    if (!bctx || video.readyState < 2) return;
    try { bctx.drawImage(video, 0, 0, back.width, back.height); } catch (e) { /* frame not ready */ }
  }
  function backLoop() {
    if (done || !framed || video.paused) { looping = false; return; }
    drawBack();
    requestAnimationFrame(backLoop);
  }
  const startBackLoop = () => { if (!looping && framed) { looping = true; requestAnimationFrame(backLoop); } };
  fit();
  window.addEventListener('resize', fit);
  video.addEventListener('loadedmetadata', fit);
  video.addEventListener('loadeddata', drawBack);
  video.addEventListener('seeked', drawBack);
  video.addEventListener('play', startBackLoop);

  // offline (e.g. launched from the home screen): the video isn't cached, so skip it at once.
  // Also skipped for a bet replay, and in social play, where "Stake" is a restricted word.
  const q = new URLSearchParams(location.search);
  const social = q.get('social') === 'true' || /^(XSC|XGC|XEC)$/i.test(q.get('currency') || '');
  if (navigator.onLine === false || q.get('replay') === 'true' || social) { end(); return; }
  video.addEventListener('ended', end);
  video.addEventListener('error', end);              // the media element itself failed
  // a failing <source> just moves on to the next one; give up once every source has failed
  const sources = video.querySelectorAll('source');
  let failed = 0;
  sources.forEach(src => src.addEventListener('error', () => { if (++failed >= sources.length) end(); }));
  video.addEventListener('playing', () => {
    started = true;
    clearTimeout(stall);
    // safety net in case 'ended' never arrives
    const left = (isFinite(video.duration) ? video.duration - video.currentTime : 5) + 1.5;
    stall = setTimeout(end, left * 1000);
  });
  // slow network: don't hold the game hostage if the video hasn't started in time
  // (not while it is waiting for the player's tap, which is theirs to give)
  const armStall = () => { clearTimeout(stall); stall = setTimeout(() => { if (!started && !waitingTap) end(); }, 3500); };
  armStall();

  // respect a player who turned the sound off last time (the sting plays outside the game's mixer)
  let soundOff = false;
  try {
    const d = JSON.parse(localStorage.getItem('gos9') || localStorage.getItem('gos8') || localStorage.getItem('gos7') || 'null'), st = d && d.settings;
    if (st) {
      soundOff = (st.sfx === false && st.music === false) || st.volume === 0;
      if (typeof st.volume === 'number') video.volume = Math.max(0, Math.min(1, st.volume));
    }
  } catch (e) { /* storage unavailable */ }

  const play = muted => {
    video.muted = muted;
    const p = video.play();
    return p && p.then ? p : Promise.resolve();
  };
  const blocked = e => e && e.name === 'NotAllowedError';

  // ---- tap to start (sound needs a tap first) ----
  const POSTER_T = 2;
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); go(); }
  }
  function askTap() {
    if (done || waitingTap) return;
    waitingTap = true;
    clearTimeout(stall);
    video.pause();
    // wait on the frame that shows the logo; the tap plays it from the top
    try { video.currentTime = POSTER_T; } catch (e) { /* not seekable yet */ }
    box.classList.add('ask');
    if (tap) tap.hidden = false;
    box.addEventListener('click', go);
    window.addEventListener('keydown', onKey, true);
  }
  function go() {
    if (!waitingTap || done) return;
    waitingTap = false;
    box.removeEventListener('click', go);
    window.removeEventListener('keydown', onKey, true);
    box.classList.remove('ask');
    if (tap) tap.hidden = true;
    // this tap also lets the game's own audio start
    try { if (typeof AudioEngine !== 'undefined') AudioEngine.resume(); } catch (e) { /* not loaded yet */ }
    try { video.currentTime = 0; } catch (e) { /* not seekable yet */ }
    armStall();
    // played from inside the tap, so sound is allowed; if it still refuses, play it muted rather than not at all
    play(soundOff).catch(e => (blocked(e) ? play(true) : Promise.reject(e))).catch(end);
  }

  if (soundOff) play(true).catch(e => (blocked(e) ? askTap() : end()));
  else play(false).catch(e => (blocked(e) ? askTap() : end()));
})();

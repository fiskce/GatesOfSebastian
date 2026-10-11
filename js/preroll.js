/* Gates of Sebastian — "Only on Stake" preroll.
 *
 * Loaded right after the #preroll markup, before everything else, so the sting
 * is the first thing on screen. The game keeps loading behind it and only
 * shows its loader/splash once window.PREROLL resolves.
 *
 * Browsers only allow sound before the first tap in some cases (e.g. an
 * iframe with allow="autoplay", or a site the player uses a lot), so it tries
 * with sound and falls back to muted autoplay. It always hands over to the
 * game: when the video ends, fails to load, can't autoplay or stalls.
 */
(() => {
  'use strict';
  const box = document.getElementById('preroll');
  const video = document.getElementById('prerollVideo');
  let finish;
  window.PREROLL = new Promise(res => { finish = res; });
  if (!box || !video) { finish(); return; }

  let done = false, started = false;
  const end = () => {
    if (done) return;
    done = true;
    box.classList.add('done');
    setTimeout(() => { box.remove(); }, 450);     // after the fade
    finish();
  };

  // offline (e.g. launched from the home screen): the video isn't cached, so skip it at once
  if (navigator.onLine === false) { end(); return; }
  video.addEventListener('ended', end);
  video.addEventListener('error', end);              // the media element itself failed
  // a failing <source> just moves on to the next one; give up once every source has failed
  const sources = video.querySelectorAll('source');
  let failed = 0;
  sources.forEach(src => src.addEventListener('error', () => { if (++failed >= sources.length) end(); }));
  video.addEventListener('playing', () => {
    started = true;
    // safety net in case 'ended' never arrives
    const left = (isFinite(video.duration) ? video.duration - video.currentTime : 5) + 1.5;
    setTimeout(end, left * 1000);
  });
  // slow network: don't hold the game hostage if the video hasn't started in time
  setTimeout(() => { if (!started) end(); }, 3500);

  // respect a player who turned the sound off last time (the sting plays outside the game's mixer)
  let soundOff = false;
  try {
    const d = JSON.parse(localStorage.getItem('gos8') || localStorage.getItem('gos7') || 'null'), st = d && d.settings;
    if (st) {
      soundOff = (st.sfx === false && st.music === false) || st.volume === 0;
      if (typeof st.volume === 'number') video.volume = Math.max(0, Math.min(1, st.volume));
    }
  } catch (e) { /* storage unavailable */ }

  const tryPlay = muted => {
    video.muted = muted;
    const p = video.play();
    return p && p.then ? p : Promise.resolve();
  };
  (soundOff ? tryPlay(true) : tryPlay(false).catch(() => tryPlay(true))).catch(end);
})();

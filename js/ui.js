/* Gates of Sebastian — DOM panels: info/paytable, settings, provably-fair
 * history + verifier, buy confirmation, out-of-credit and the mobile menu.
 */
(() => {
  'use strict';
  const G = window.GOS, E = G.E, B = G.Board, S = G.S;
  const PF = window.ProvablyFair;
  const UI = G.UI = {};
  const $ = id => document.getElementById(id);
  const PANELS = ['info', 'settings', 'fair', 'buy', 'credit', 'menu', 'stats'];
  const revealed = {};   // server hash -> revealed seed
  let lastFocus = null;

  UI.isOpen = () => PANELS.some(p => !$('m-' + p).hidden);
  UI.closeAll = () => {
    PANELS.forEach(p => { $('m-' + p).hidden = true; });
    if (lastFocus && lastFocus.focus) lastFocus.focus(); else G.canvas.focus();
  };
  UI.open = name => {
    if (name === 'buy' && (S.busy || S.inFS)) return;
    PANELS.forEach(p => { $('m-' + p).hidden = p !== name; });
    lastFocus = document.activeElement;
    if (name === 'fair') renderFair();
    if (name === 'stats') G.Stats.renderPanel();
    if (name === 'buy') $('buyPrice').textContent = G.money(G.buyCost());
    if (name === 'credit') $('creditNow').textContent = G.money(S.credit);
    UI.sync();
    const card = $('m-' + name).querySelector('.card');
    card.scrollTop = 0;
    card.focus({ preventScroll: true });
    AudioEngine.play('whoosh', { gain: 0.5, rate: 1.4 });
  };
  UI.fullscreen = () => {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {});
  };
  UI.sync = () => {
    $('volSlider').value = Math.round(G.settings.volume * 100);
    $('musicToggle').checked = G.settings.music;
    $('sfxToggle').checked = G.settings.sfx;
    $('turboToggle').checked = G.settings.turbo;
    $('motionToggle').checked = G.settings.reducedMotion;
    $('dynMusicToggle').checked = G.settings.dynMusic;
    $('qualitySelect').value = G.settings.quality;
    $('qualitySelect').options[0].textContent = 'Auto (' + ['low', 'medium', 'high'][G.Q.level] + ')';
    $('tiltToggle').checked = G.settings.tilt;
    $('hapticsToggle').checked = G.settings.haptics;
    $('hapticsRow').hidden = !navigator.vibrate;     // iOS has no vibration API
  };

  UI.init = () => {
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('pointerdown', e => { if (e.target === m) UI.closeAll(); });
    });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { AudioEngine.play('click'); UI.closeAll(); }));
    document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { AudioEngine.play('click'); UI.open(b.dataset.open); }));
    $('menuFull').addEventListener('click', () => { UI.closeAll(); UI.fullscreen(); });

    // settings
    $('volSlider').addEventListener('input', e => { G.settings.volume = e.target.value / 100; G.Game.applySettings(); G.save(); });
    $('musicToggle').addEventListener('change', e => { G.settings.music = e.target.checked; G.Game.applySettings(); G.save(); });
    $('sfxToggle').addEventListener('change', e => { G.settings.sfx = e.target.checked; G.Game.applySettings(); G.save(); });
    $('turboToggle').addEventListener('change', e => { G.settings.turbo = e.target.checked; G.Game.applySettings(); G.save(); });
    $('motionToggle').addEventListener('change', e => { G.settings.reducedMotion = e.target.checked; G.save(); });
    $('dynMusicToggle').addEventListener('change', e => { G.settings.dynMusic = e.target.checked; G.Game.applySettings(); G.save(); });
    $('qualitySelect').addEventListener('change', e => { G.settings.quality = e.target.value; G.Game.applySettings(); G.save(); UI.sync(); });
    $('tiltToggle').addEventListener('change', e => {
      G.settings.tilt = e.target.checked; G.save();
      if (e.target.checked) G.Game.enableDeviceTilt();        // a user gesture: iOS may ask for permission here
    });
    $('hapticsToggle').addEventListener('change', e => { G.settings.haptics = e.target.checked; G.save(); if (e.target.checked) G.haptic(30); });
    $('resetStats').addEventListener('click', () => {
      if (!confirm('Reset all stats and achievements?')) return;
      G.Stats.reset(); G.Stats.renderPanel();
    });
    $('resetCredit').addEventListener('click', () => { G.Game.resetCredit(); UI.closeAll(); });
    $('creditReset').addEventListener('click', () => { G.Game.resetCredit(); UI.closeAll(); });

    // buy
    $('buyConfirm').addEventListener('click', () => { UI.closeAll(); G.Game.buy(); });

    // fairness
    $('setClientSeed').addEventListener('click', () => {
      if (S.busy) return;
      const v = $('clientSeedInput').value.trim();
      if (!v) return;
      PF.setClientSeed(v); $('clientSeedInput').value = ''; AudioEngine.play('coin'); renderFair();
    });
    $('rotateSeed').addEventListener('click', () => {
      if (S.busy) return;
      const hash = PF.serverHash, seed = PF.rotate();
      revealed[hash] = seed;
      AudioEngine.play('coin');
      $('revealedSeed').innerHTML = `Revealed server seed for <code>${hash.slice(0, 16)}…</code>:<br><code class="seed">${seed}</code>`;
      renderFair();
    });
    $('historyList').addEventListener('click', e => {
      const btn = e.target.closest('button[data-i]');
      if (!btn) return;
      const entry = S.history[+btn.dataset.i];
      const res = G.Game.verify(entry, revealed[entry.serverHash]);
      btn.textContent = res.ok ? '✓ Verified' : '✗ Mismatch';
      btn.className = res.ok ? 'verify ok' : 'verify bad';
      btn.title = `hash ${res.hashOk ? 'ok' : 'BAD'} · board ${res.boardOk ? 'ok' : 'BAD'} · payout ${res.winOk ? 'ok' : 'BAD'} (${res.winX.toFixed(2)}x)`;
    });

    buildPaytable();
    UI.sync();
  };

  function renderFair() {
    $('fairBox').innerHTML = `<b>Server seed hash (SHA-256)</b><br>${PF.serverHash}<br><b>Client seed</b> ${escapeHtml(PF.clientSeed)}<br><b>Next nonce</b> ${PF.nonce + 1}`;
    const rows = S.history.slice(0, 60).map((h, i) => {
      const mode = h.buy ? 'Buy' : h.mode === 'fs' ? 'Free spin' : h.mode === 'ante' ? 'Ante' : 'Base';
      const can = !!revealed[h.serverHash];
      return `<tr><td>#${h.nonce}</td><td>${mode}</td><td>${G.money(h.bet)}</td><td class="${h.winX > 0 ? 'win' : ''}">${h.winX > 0 ? G.xfmt(Math.round(h.winX * 100) / 100) : '—'}</td>`
        + `<td>${can ? `<button class="verify" data-i="${i}">Verify</button>` : '<span class="faint">rotate seed to verify</span>'}</td></tr>`;
    }).join('');
    $('historyList').innerHTML = rows || '<tr><td colspan="5" class="faint">No spins yet.</td></tr>';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  function buildPaytable() {
    const host = $('paytable');
    host.innerHTML = '';
    E.PAY_ORDER.forEach(id => {
      const p = E.SYMBOLS[id].pays;
      const cell = document.createElement('div'); cell.className = 'pt-cell';
      const cv = document.createElement('canvas'); cv.width = cv.height = 96;
      if (B.spr[id]) cv.getContext('2d').drawImage(B.spr[id], 0, 0, 96, 96);
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', G.SYMBOL_NAMES[id]);
      cell.appendChild(cv);
      const rows = document.createElement('div'); rows.className = 'pays';
      rows.innerHTML = `<span>12+</span><b>${p[12]}×</b><span>10-11</span><b>${p[10]}×</b><span>8-9</span><b>${p[8]}×</b>`;
      cell.appendChild(rows);
      host.appendChild(cell);
    });
    const sc = $('scatterIcon');
    if (sc && B.spr.scatter) sc.getContext('2d').drawImage(B.spr.scatter, 0, 0, sc.width, sc.height);
    const orbs = $('orbList');
    if (orbs) orbs.innerHTML = E.ORB_TABLE.map(([v]) => `<span class="orb t${G.orbTier(v)}">${v}×</span>`).join('');
  }
})();

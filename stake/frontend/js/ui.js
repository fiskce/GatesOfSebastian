/* Thunder Hunter Sebastian — DOM panels: rules, settings, provably-fair
 * history + verifier (demo), buy confirmation, balance too low, the mobile
 * menu, and for Stake play: errors, an unfinished round and the replay card.
 */
(() => {
  'use strict';
  const G = window.GOS, E = G.E, B = G.Board, S = G.S, T = G.T, STR = window.GOS_STR;
  const PF = window.ProvablyFair;
  const UI = G.UI = {};
  const $ = id => document.getElementById(id);
  const PANELS = ['info', 'settings', 'fair', 'buy', 'credit', 'menu', 'stats', 'auto', 'bets', 'error', 'resume', 'replay'];
  // cards that can be dismissed get an X in the corner (as well as Esc and the backdrop)
  const CLOSABLE = ['settings', 'fair', 'buy', 'credit', 'menu', 'stats', 'auto', 'bets'];
  const X = '<button type="button" class="x-close" data-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  const revealed = {};   // server hash -> revealed seed
  let lastFocus = null, blocking = false, onResume = null;

  UI.isOpen = () => PANELS.some(p => !$('m-' + p).hidden);
  // a fatal error, an unfinished round and the replay card can't be dismissed
  UI.isBlocking = () => blocking || !$('m-resume').hidden || (!$('m-replay').hidden && G.mode === 'replay');
  UI.closeAll = force => {
    if (UI.isBlocking() && force !== true) return;
    PANELS.forEach(p => { $('m-' + p).hidden = true; });
    if (lastFocus && lastFocus.focus && lastFocus !== document.body) lastFocus.focus(); else G.canvas.focus();
  };
  /* A panel opened by a press (canvas buttons act on pointerdown) must not
   * take that same tap: on phones the browser sends the tap's click to
   * whatever is under the finger when it lifts, which is now a button on the
   * sheet. So the new panel ignores the pointer until that finger is up. */
  let pointerDown = false;
  window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  const up = () => { pointerDown = false; };
  window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  function shieldFromOpeningTap(m) {
    if (!pointerDown) return;
    m.style.pointerEvents = 'none';
    const lift = () => setTimeout(() => { m.style.pointerEvents = ''; }, 120);   // after the tap's own click has been sent
    window.addEventListener('pointerup', lift, { once: true }); window.addEventListener('pointercancel', lift, { once: true });
    setTimeout(() => { m.style.pointerEvents = ''; }, 1500);
  }
  // opts.quiet: the caller makes the one sound for this press itself
  UI.open = (name, opts) => {
    if (blocking) return;
    if (name === 'buy' && (S.busy || S.inFS)) return;
    if ((name === 'auto' || name === 'bets') && (S.busy || S.inFS || S.auto > 0)) return;
    if (name === 'auto') syncAuto();
    if (name === 'bets') renderBets();
    PANELS.forEach(p => { $('m-' + p).hidden = p !== name; });
    lastFocus = document.activeElement;
    if (name === 'fair') renderFair();
    if (name === 'menu') renderSession();
    if (name === 'stats') G.Stats.renderPanel();
    if (name === 'buy') renderBuy();
    if (name === 'credit') $('creditText').innerHTML = T(G.allow('resetBalance') ? 'lowDemo' : 'lowLive', { v: G.money(S.credit) });
    UI.sync();
    const card = $('m-' + name).querySelector('.card');
    card.scrollTop = 0;
    card.focus({ preventScroll: true });
    shieldFromOpeningTap($('m-' + name));
    if (!(opts && opts.quiet)) AudioEngine.play('ui.open');
  };
  // the session facts the RGS asks for, in the menu too (refreshed every second while it is open)
  function renderSession() {
    const el = $('sessionFacts'), facts = G.HUD.sessionFacts();
    el.hidden = !facts.length;
    el.innerHTML = facts.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }
  setInterval(() => { if (!$('m-menu').hidden) renderSession(); }, 1000);
  UI.fullscreen = () => {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {});
  };
  UI.sync = () => {
    $('turboToggle').closest('.row').hidden = !G.allow('turbo');
    $('volSlider').value = Math.round(G.settings.volume * 100);
    $('musicVolSlider').value = Math.round(G.settings.musicVol * 100);
    $('sfxVolSlider').value = Math.round(G.settings.sfxVol * 100);
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

  // ---------------- Stake cards ----------------
  UI.showError = (title, msg, fatal) => {
    PANELS.forEach(p => { $('m-' + p).hidden = p !== 'error'; });
    blocking = !!fatal;
    $('t-error').textContent = title; $('errorText').textContent = msg;
    $('errorClose').hidden = !!fatal;
    $('errorReload').hidden = !fatal;
    $('m-error').querySelector('.card').focus({ preventScroll: true });
  };
  UI.showResume = (amount, go) => {
    onResume = go;
    $('resumeText').innerHTML = T('resumeLead', { v: G.money(amount) });
    PANELS.forEach(p => { $('m-' + p).hidden = p !== 'resume'; });
    $('resumeGo').focus({ preventScroll: true });
  };
  // the replay card: the bet, the mode and its cost before; the win after
  UI.showReplay = (data, win) => {
    const R = G.RGS, mode = R.replay.mode, bet = G.baseBet();
    const cost = data && data.costMultiplier ? data.costMultiplier : (window.GOS_MATH && GOS_MATH.modes[mode] ? GOS_MATH.modes[mode].cost : 1);
    const name = { base: T('modeBase'), ante: T('modeAnte'), bonus: T('modeBonus'), super: T('modeSuper') }[mode] || mode;
    const rows = [[T('replayMode'), name], [T('replayBet'), G.money(bet)]];
    if (Math.abs(cost - 1) > 1e-9) rows.push([T('replayCost'), G.xfmt(cost) + ' · ' + G.money(bet * cost)]);
    if (win != null) rows.push([T('replayTotal'), G.money(win)]);
    $('replayFacts').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('replayGo').textContent = win == null ? T('replayPlay') : T('replayAgain');
    PANELS.forEach(p => { $('m-' + p).hidden = p !== 'replay'; });
    $('replayGo').focus({ preventScroll: true });
  };

  UI.init = () => {
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('pointerdown', e => { if (e.target === m) UI.closeAll(); });
    });
    // things that only exist in the demo (local balance, fairness, stats)
    document.querySelectorAll('.demo-only').forEach(el => { el.hidden = G.mode !== 'demo'; });
    $('menuFull').hidden = !G.allow('fullscreen');
    $('fineText').textContent = G.mode === 'demo' ? T('fineDemo') : T('fineLive');
    $('errorClose').addEventListener('click', () => { UI.closeAll(true); });
    $('errorReload').addEventListener('click', () => location.reload());
    $('resumeGo').addEventListener('click', () => { const go = onResume; onResume = null; UI.closeAll(true); if (go) go(); });
    $('replayGo').addEventListener('click', () => { AudioEngine.resume(); G.Game.startReplay(); });
    CLOSABLE.forEach(p => $('m-' + p).querySelector('.card').insertAdjacentHTML('afterbegin', X));
    buildRules();
    // the rules are in tabs; arrow keys move between them
    $('rulesCard').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) { AudioEngine.play('ui.press'); showTab(t.dataset.tab); } });
    $('rulesCard').addEventListener('keydown', e => {
      const t = e.target.closest('.tab'); if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const tabs = [...$('rulesCard').querySelectorAll('.tab')], i = tabs.indexOf(t), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      showTab(n.dataset.tab); n.focus(); e.preventDefault();
    });
    // autoplay sheet
    $('autoCount').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; AudioEngine.play('ui.press'); autoCfg().n = b.dataset.n; syncAuto(); G.save(); });
    $('autoLoss').addEventListener('change', e => { autoCfg().loss = +e.target.value; G.save(); });
    $('autoWin').addEventListener('change', e => { autoCfg().win = +e.target.value; G.save(); });
    $('autoFeature').addEventListener('change', e => { autoCfg().feature = e.target.checked; G.save(); });
    $('autoStart').addEventListener('click', () => {
      const c = autoCfg(); UI.closeAll();
      G.Game.startAuto(c.n === 'Infinity' ? Infinity : +c.n, { loss: c.loss, win: c.win, feature: c.feature });
    });
    // bet grid
    $('betGrid').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      AudioEngine.play('ui.press'); G.Game.setBet(+b.dataset.i); UI.closeAll();
    });
    // one sound per press: closing has its own; opening sounds in UI.open
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { AudioEngine.play('ui.close'); UI.closeAll(); }));
    document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { UI.open(b.dataset.open); }));
    $('menuFull').addEventListener('click', () => { UI.closeAll(); UI.fullscreen(); });

    // settings
    $('volSlider').addEventListener('input', e => { G.settings.volume = e.target.value / 100; G.Game.applySettings(); G.save(); });
    $('musicVolSlider').addEventListener('input', e => { G.settings.musicVol = e.target.value / 100; G.Game.applySettings(); G.save(); });
    // the effects slider answers with a press at its new level, so it can be set by ear
    $('sfxVolSlider').addEventListener('input', e => { G.settings.sfxVol = e.target.value / 100; G.Game.applySettings(); G.save(); AudioEngine.play('ui.press'); });
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
      if (!window.confirm('Reset all stats and achievements?')) return;
      G.Stats.reset(); G.Stats.renderPanel();
    });
    $('resetCredit').addEventListener('click', () => { G.Game.resetCredit(); UI.closeAll(); });
    $('creditReset').addEventListener('click', () => { G.Game.resetCredit(); UI.closeAll(); });

    // buy: each tier confirms itself
    $('buyConfirm').addEventListener('click', () => { UI.closeAll(); G.Game.buy('bonus'); });
    $('buyConfirmSuper').addEventListener('click', () => { UI.closeAll(); G.Game.buy('super'); });

    // fairness
    $('setClientSeed').addEventListener('click', () => {
      if (S.busy) return;
      const v = $('clientSeedInput').value.trim();
      if (!v) return;
      PF.setClientSeed(v); $('clientSeedInput').value = ''; AudioEngine.play('ui.confirm'); renderFair();
    });
    $('rotateSeed').addEventListener('click', () => {
      if (S.busy) return;
      const hash = PF.serverHash, seed = PF.rotate();
      revealed[hash] = seed;
      AudioEngine.play('ui.confirm');
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
    STR.apply();
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

  // ---------------- autoplay sheet / bet grid ----------------
  const autoCfg = () => G.settings.autoCfg || (G.settings.autoCfg = { n: '25', loss: 0, win: 0, feature: false });
  function syncAuto() {
    const c = autoCfg();
    $('autoCount').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.n === String(c.n))));
    $('autoLoss').value = String(c.loss); $('autoWin').value = String(c.win); $('autoFeature').checked = !!c.feature;
  }
  // the buy menu: both tiers with their price; one the balance can't cover is unlit and says so
  function renderBuy() {
    $('buyPrice').textContent = G.money(G.buyCost());
    $('buyPriceSuper').textContent = G.money(G.superCost());
    $('buyLeadBonus').innerHTML = T('buyFsLead', { n: E.FS_AWARD });
    $('buyLeadSuper').innerHTML = T('buySuperLead', { n: E.FS_AWARD, x: E.SUPER_START });
    for (const [kind, tier, btn, why] of [['bonus', 'buyTierBonus', 'buyConfirm', 'buyWhyBonus'], ['super', 'buyTierSuper', 'buyConfirmSuper', 'buyWhySuper']]) {
      const ok = G.Game.canAfford(kind);
      $(tier).classList.toggle('off', !ok); $(btn).disabled = !ok; $(why).textContent = ok ? '' : T('lowTitle');
    }
  }
  function renderBets() {
    // each level as BET will show it: with Double Chance on, what a spin at that level costs
    const k = S.ante ? E.ANTE_COST : 1;
    $('betGrid').innerHTML = G.BET_STEPS.map((v, i) => `<button type="button" data-i="${i}" aria-pressed="${i === S.betIndex}">${G.money(v * k)}</button>`).join('');
    $('betsNote').textContent = S.ante ? T('betsNote') : '';
  }

  // ---------------- rules ----------------
  function showTab(name) {
    $('rulesCard').querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === name; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    $('rulesCard').querySelectorAll('[role=tabpanel]').forEach(p => { p.hidden = p.dataset.tab !== name; });
    // a new tab starts at its top, just under the stuck tab bar
    const c = $('rulesCard'), p = c.querySelector('[role=tabpanel]:not([hidden])'), tb = c.querySelector('.tabs');
    if (p && tb) c.scrollTop = Math.min(c.scrollTop, Math.max(0, p.offsetTop - tb.offsetHeight - 12));
  }
  // Built from the published math (js/math-info.js), in the right wording for
  // the mode, listing only the controls this mode has.
  function buildRules() {
    const so = STR.social, w = (a, b) => (so ? b : a);
    const M = window.GOS_MATH || { modes: {} }, md = M.modes;
    const bet = w('bet', 'play amount');
    const rtp = m => (md[m] ? md[m].rtp.toFixed(2) : '96.50') + '%';
    const cost = m => (md[m] ? md[m].cost : { base: 1, ante: E.ANTE_COST, bonus: E.BUY_COST_X, super: E.SUPER_COST_X }[m]);
    const fsN = E.FS_AWARD, superName = w('Buy super free spins', 'Get super free spins');
    const maxX = m => ((md[m] && md[m].maxWinX) || E.MAX_WIN_X).toLocaleString('en-US');
    const costs = w('Costs', 'Uses');
    const ctl = [
      [w('Spin', 'Spin') + ' (Space / Enter)', G.allow('slam') ? 'Starts a round. Press again, or tap the board, to hurry the spin along; it also skips win animations.' : 'Starts a round. It also skips win animations.'],
      G.allow('bet') && ['− / + (↓ / ↑)', `Lower or raise the ${bet}; hold to keep stepping.`],
      G.allow('bet') && [w('BET', 'PLAY') + ' (in the bar)', `Tap it to pick from every ${bet} level.`],
      G.allow('ante') && [w('Double chance', 'Double chance'), `Adds 25% to the ${bet} on every spin (${w('BET', 'PLAY')} shows the total) and free spins trigger more often. Wins are still multiples of the ${bet} before the 25%.`],
      G.allow('buy') && [w('Buy free spins', 'Get free spins') + ' (B)', `Opens a menu of two: <b>free spins</b>, ${fsN} free spins straight away for ${cost('bonus')}× the ${bet}, or <b>super free spins</b>, ${fsN} free spins that start with a ×${E.SUPER_START} total multiplier, for ${cost('super')}× the ${bet}. Each has its own confirm button. Double chance must be off.`],
      G.allow('auto') && ['Autoplay (A)', `Plays 10, 25, 50, 100 or unlimited rounds in a row, with optional stops: when the balance drops by a set amount, on a big single win, or when free spins start. Press it again, or press Spin, to stop. It also stops when the balance is too low.`],
      G.allow('turbo') && ['Turbo (T)', 'Faster animations. The outcome is the same.'],
      ['Info (I)', 'These rules.'],
      ['Settings', 'Master, music and effects volume, graphics, motion and more.'],
      ['Unlit controls', 'A control that can’t be used right now is unlit; press it and it says why.'],
      ['Sound (M)', 'Mutes or unmutes the game.'],
      G.allow('fair') && ['History & fairness', 'Your recent spins and the seeds to check them.'],
      G.allow('stats') && ['Stats & achievements', 'Your session and all-time stats.'],
      G.allow('fullscreen') && ['Fullscreen', 'Fills the screen; on phones it lives in the menu.'],
      ['Menu (phones)', 'Info, settings and fullscreen on small screens.'],
      ['Esc', 'Closes a panel.'],
    ].filter(Boolean);
    const modes = [
      ['base', 'Base game', `${costs} 1× the ${bet}.`],
      G.allow('ante') && ['ante', 'Double chance', `${costs} ${cost('ante')}× the ${bet}; free spins trigger more often.`],
      G.allow('buy') && ['bonus', w('Buy free spins', 'Get free spins'), `${costs} ${cost('bonus')}× the ${bet}; starts the free spins straight away.`],
      G.allow('buy') && ['super', superName, `${costs} ${cost('super')}× the ${bet}; starts the free spins straight away, with a ×${E.SUPER_START} total multiplier from the first free spin.`],
    ].filter(Boolean);
    const tab = (k, label, on) => `<button type="button" class="tab" role="tab" data-tab="${k}" aria-selected="${on}" tabindex="${on ? 0 : -1}">${label}</button>`;
    $('rulesCard').innerHTML = `${X}
      <h2 id="t-info">How to play</h2>
      <div class="tabs" role="tablist" aria-label="Rules">${tab('rules', T('rulesTabRules'), true)}${tab('pays', T('rulesTabPays'), false)}${tab('modes', T('rulesTabModes'), false)}${tab('controls', T('rulesTabControls'), false)}</div>
      <section role="tabpanel" data-tab="rules">
      <p><b>${w('Pay anywhere', 'Win anywhere')}.</b> No paylines: land <b>8 or more</b> of the same symbol anywhere on the 6×5 grid to win. Wins are multiples of the ${bet}.</p>
      <p><b>Tumble.</b> Winning symbols shatter, the rest fall and new ones drop in. Tumbling repeats while new wins form, so one spin can chain many wins.</p>
      <p><b>Multiplier orbs.</b> On any winning tumble, Sebastian can fire an orb worth one of these:</p>
      <div id="orbList" class="orb-list"></div>
      <p>Orbs fly into the <b>multiplier</b> collector. When the tumbling stops, its total multiplies the spin's win.</p>
      <p class="with-icon"><canvas id="scatterIcon" width="64" height="64" aria-hidden="true"></canvas>
        <span><b>Free spins.</b> Scatters are counted once all tumbles have finished and don't win on their own. <b>4+ scatters</b> award <b>${fsN} free spins</b>. In the feature, every orb is <b>saved</b> into a total multiplier that applies to every winning spin until the feature ends. <b>3+ scatters</b> in the feature add <b>+${E.FS_RETRIGGER} spins</b>.</span></p>
      ${G.allow('buy') ? `<p><b>Super free spins.</b> The same ${fsN} free spins, but the total multiplier starts at <b>×${E.SUPER_START}</b> and every orb adds to it. Orbs land a little less often than in regular free spins.</p>` : ''}
      <p><b>Max win.</b> A round can win at most <b>${E.MAX_WIN_X.toLocaleString('en-US')}×</b> the ${bet}. Reaching it ends the round straight away, including any free spins left.</p>
      </section>
      <section role="tabpanel" data-tab="modes" hidden>
      <h3>Game modes</h3>
      <div class="facts modes">${modes.map(([m, name, d]) => `<div><span><b>${name}</b> · ${d}</span><b>RTP ${rtp(m)} · max ${maxX(m)}×</b></div>`).join('')}</div>
      <div class="facts">
        <div><span>Max win</span><b>${E.MAX_WIN_X.toLocaleString('en-US')}×</b></div>
        <div><span>Volatility</span><b>Very high</b></div>
      </div>
      <p class="note">RTP (return to player) is the theoretical average over a very large number of rounds. Any one session can return far more or far less.</p>
      </section>
      <section role="tabpanel" data-tab="pays" hidden>
      <h3>${w('Paytable', 'Symbol wins')} <span class="faint">(× ${bet})</span></h3>
      <div id="paytable" class="paytable"></div>
      </section>
      <section role="tabpanel" data-tab="controls" hidden>
      <h3>Controls</h3>
      <dl class="controls">${ctl.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      </section>
      <h3>Disclaimer</h3>
      <p class="note">Malfunction voids all ${w('pays', 'wins')} and plays. A consistent internet connection is required; if the connection drops, reload the game to finish any unfinished round. The expected return is calculated over many plays. The game display is not representative of any physical device and is for illustrative purposes only. ${G.mode === 'demo' ? 'This demo plays with a local balance only.' : 'Winnings are settled according to the amount received from the Remote Game Server and not from events within the web browser.'}</p>
      <p class="note">${STR.T('title')} · © 2026 Fiskce</p>
      <button class="primary" data-close>Close</button>`;
  }

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

/* Thunder Hunter Sebastian — session & lifetime stats, achievements and toasts.
 * game.js reports events (G.Stats.record); unlocked achievements queue a toast
 * that waits until no big overlay is showing. Lifetime stats persist in
 * localStorage under 'gos8.stats'.
 */
(() => {
  'use strict';
  const G = window.GOS, FX = G.FX, S = G.S;
  const Stats = G.Stats = {};
  const KEY = 'gos8.stats';

  const ACH = [
    { id: 'first', name: 'First Strike', desc: 'Land your first win.' },
    { id: 'big', name: 'Big Shot', desc: 'Win 15× on one spin.' },
    { id: 'epic', name: 'Epic Hunter', desc: 'Win 100× on one spin.' },
    { id: 'legend', name: 'Legend', desc: 'Win 500× in one round.' },
    { id: 'chain', name: 'Chain Reaction', desc: 'Tumble 5 times in one spin.' },
    { id: 'thunder', name: 'Bolt from the Blue', desc: 'Land a 100× multiplier orb.' },
    { id: 'wrath', name: 'Wrath of Sebastian', desc: 'Land a 500× multiplier orb.' },
    { id: 'gates', name: 'Into the Storm', desc: 'Trigger free spins with scatters.' },
    { id: 'encore', name: 'Encore', desc: 'Retrigger during free spins.' },
    { id: 'storm', name: 'Storm Caller', desc: 'Reach ×100 total multiplier in free spins.' },
    { id: 'close', name: 'So Close', desc: 'Land exactly 3 scatters 10 times.' },
    { id: 'marathon', name: 'Marathon', desc: 'Play 500 spins.' },
    { id: 'max', name: 'Max Win', desc: 'Hit the 5,000× max win.' },
  ];
  Stats.ACH = ACH;

  const blank = () => ({ spins: 0, freeSpins: 0, wagered: 0, won: 0, bestWin: 0, bestWinX: 0, bestMult: 0, bestOrb: 0,
    longestCascade: 0, features: 0, bought: 0, retriggers: 0, bestFeatureX: 0, nearMisses: 0, maxWins: 0 });
  let life = blank(), ach = {};
  const session = blank();
  Stats.session = session;
  Stats.life = () => life;
  Stats.unlocked = () => ach;

  Stats.load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.v === 1) { life = Object.assign(blank(), d.life); ach = d.ach || {}; }
    } catch (e) { /* storage unavailable */ }
  };
  Stats.save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, life, ach })); } catch (e) { /* storage unavailable */ } };
  Stats.reset = () => { life = blank(); ach = {}; Object.assign(session, blank()); Stats.save(); };

  const both = fn => { fn(session); fn(life); };
  const max = (o, k, v) => { if (v > o[k]) o[k] = v; };

  // the demo only: played through Stake or replaying there are no stats, achievements or toasts
  Stats.record = (ev, d) => {
    if (G.mode !== 'demo') return;
    d = d || {};
    switch (ev) {
      case 'stake': both(o => { o.wagered += d.amount; if (d.buy) o.bought++; }); break;
      case 'spin':
        both(o => {
          if (d.free) o.freeSpins++; else o.spins++;
          o.won += d.win; max(o, 'bestWin', d.win); max(o, 'bestWinX', d.winX); max(o, 'bestMult', d.mult || 0);
          max(o, 'longestCascade', d.cascades); if (d.nearMiss) o.nearMisses++; if (d.maxed) o.maxWins++;
        });
        if (d.win > 0) unlock('first');
        if (d.winX >= 15) unlock('big');
        if (d.winX >= 100) unlock('epic');
        if (d.cascades >= 5) unlock('chain');
        if (life.nearMisses >= 10) unlock('close');
        if (life.spins >= 500) unlock('marathon');
        if (d.maxed) unlock('max');
        break;
      case 'orb': both(o => max(o, 'bestOrb', d.value)); if (d.value >= 100) unlock('thunder'); if (d.value >= 500) unlock('wrath'); break;
      case 'persistent': if (d.value >= 100) unlock('storm'); break;
      case 'feature': both(o => { o.features++; }); if (d.natural) unlock('gates'); break;
      case 'retrigger': both(o => { o.retriggers++; }); unlock('encore'); break;
      case 'featureEnd': both(o => max(o, 'bestFeatureX', d.totalX)); break;
      case 'round': if (d.winX >= 500) unlock('legend'); Stats.save(); break;
    }
  };

  // ---------------- toasts ----------------
  const queue = [];
  let toast = null;
  function unlock(id) {
    if (ach[id]) return;
    ach[id] = Date.now();
    const a = ACH.find(x => x.id === id);
    queue.push(a);
    Stats.save();
  }
  Stats.update = dt => {
    if (toast) { toast.t += dt; if (toast.t > toast.dur) toast = null; }
    if (!toast && queue.length && !G.Overlay.blocking()) {
      const a = queue.shift();
      toast = { a, t: 0, dur: 3.4 };
      AudioEngine.play('achievement');
      G.haptic([20, 30, 20]);
      const live = document.getElementById('live');
      if (live) live.textContent = 'Achievement unlocked: ' + a.name;
    }
  };
  Stats.draw = ctx => {
    if (!toast) return;
    const t = toast.t, inn = G.ease.outBack(G.clamp(t / 0.4, 0, 1)), out = t > toast.dur - 0.35 ? (toast.dur - t) / 0.35 : 1;
    const w = Math.min(360, G.W - 24), h = 64, x = (G.W - w) / 2, y = 10 - (1 - inn) * (h + 20) - (1 - out) * (h + 20);
    ctx.save();
    ctx.globalAlpha = G.clamp(out, 0, 1);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(48,20,90,.97)'); g.addColorStop(1, 'rgba(16,6,34,.97)');
    G.roundRect(ctx, x, y, w, h, 14); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#f2c45a'; ctx.stroke();
    // trophy medallion
    const cx = x + 34, cy = y + h / 2;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.7;
    ctx.drawImage(FX.glowSprite('#ffb02e'), cx - 30, cy - 30, 60, 60);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = G.clamp(out, 0, 1);
    G.HUD.icon(ctx, 'trophy', cx, cy, 30, '#ffe08a');
    G.text(ctx, 'ACHIEVEMENT UNLOCKED', x + 64, y + 22, 11, '#c9b6ee', { weight: 800, align: 'left' });
    G.goldText(ctx, toast.a.name, x + 64, y + 44, 19, { align: 'left', display: false, weight: 800, maxW: w - 76 });
    ctx.restore();
  };

  // ---------------- panel ----------------
  Stats.renderPanel = () => {
    const rows = [
      ['Spins', o => o.spins.toLocaleString('en-US')],
      ['Free spins played', o => o.freeSpins.toLocaleString('en-US')],
      ['Total played', o => G.money(o.wagered)],
      ['Won', o => G.money(o.won)],
      ['Biggest win', o => o.bestWin ? `${G.money(o.bestWin)}` : '—'],
      ['Biggest win (×)', o => o.bestWinX ? G.xfmt(Math.round(o.bestWinX * 100) / 100) : '—'],
      ['Best multiplier', o => o.bestMult ? '×' + o.bestMult : '—'],
      ['Best orb', o => o.bestOrb ? o.bestOrb + '×' : '—'],
      ['Longest tumble chain', o => o.longestCascade || '—'],
      ['Features', o => `${o.features}${o.bought ? ` (${o.bought} instant)` : ''}`],
      ['Retriggers', o => o.retriggers],
      ['Best feature (×)', o => o.bestFeatureX ? G.xfmt(Math.round(o.bestFeatureX * 100) / 100) : '—'],
    ];
    document.getElementById('statsTable').innerHTML =
      '<tr><th></th><th>Session</th><th>All time</th></tr>' +
      rows.map(([label, f]) => `<tr><td>${label}</td><td>${f(session)}</td><td>${f(life)}</td></tr>`).join('');
    const n = ACH.filter(a => ach[a.id]).length;
    document.getElementById('achCount').textContent = `${n} / ${ACH.length}`;
    document.getElementById('achList').innerHTML = ACH.map(a => {
      const when = ach[a.id] ? new Date(ach[a.id]).toLocaleDateString() : '';
      return `<div class="ach ${ach[a.id] ? 'on' : ''}"><span class="medal" aria-hidden="true">${ach[a.id] ? '★' : '☆'}</span>`
        + `<span><b>${a.name}</b><small>${a.desc}${when ? ' · ' + when : ''}</small></span></div>`;
    }).join('');
  };

  Stats.load();
})();

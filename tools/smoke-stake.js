#!/usr/bin/env node
/* Thunder Hunter Sebastian — end-to-end check of the Stake package (stake/), as Stake serves it.
 *
 *   node tools/build-stake.js && node tools/smoke-stake.js            (needs Playwright's Chromium)
 *   node tools/smoke-stake.js --shots <dir>                            also saves screenshots
 *   node tools/smoke-stake.js --only recovery,social                   just those parts
 *     (sizes, session, replays, flags, recovery, social)
 *
 * Two mock RGS processes (tools/mock-rgs.js): one only serves stake/frontend (the "CDN"), the other is
 * the RGS on a different origin, playing stake/math. Input is real (trusted) clicks and key presses.
 * Checks, at Stake's reference sizes (desktop 1200x675, laptop 1024x576, popouts 800x450 and 400x225,
 * mobile 425x812, 375x667, 320x568):
 *   - no intro clip, no service worker, no manifest; authenticate -> play -> end-round, balance right
 *   - requests go only to files of the package or to the RGS's API; nothing at all on the console
 * and once: no session -> a blocking error and no wallet calls; every replay case in
 * replay-events.json plays its exact payout (and a broken/unknown/missing replay says so); the
 * regulated-market flags show net position, RTP and session time; a dropped /wallet/play (win and
 * no win) and a dropped /wallet/end-round recover without a reload; social wording through
 * social=true, an XSC currency and the RGS's socialCasino flag alone.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'stake');
const A = (() => { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; return o; })();
const CDN_PORT = +A.cdn || 8141, RGS_PORT = +A.rgs || 8142;
const CDN = `http://127.0.0.1:${CDN_PORT}`, RGS = `http://127.0.0.1:${RGS_PORT}`, RGS_HOST = `127.0.0.1:${RGS_PORT}`;
const SIZES = [[1200, 675], [1024, 576], [800, 450], [400, 225], [425, 812], [375, 667], [320, 568]];
const API = new Set(['/wallet/authenticate', '/wallet/play', '/wallet/end-round', '/wallet/balance']);
const EV = JSON.parse(fs.readFileSync(path.join(PKG, 'replay-events.json'), 'utf8'));

const ONLY = A.only ? String(A.only).split(',') : null, part = name => !ONLY || ONLY.includes(name);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const post = (p, b) => fetch(RGS + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));

function start(port, root) {
  return new Promise((ok, ko) => {
    const p = cp.spawn(process.execPath, [path.join(__dirname, 'mock-rgs.js'), '--port', String(port), '--root', root, '--math', path.join(PKG, 'math')], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', d => { if (/mock RGS \+ game on/.test(String(d))) ok(p); });
    p.on('exit', c => ko(new Error('mock exited ' + c)));
  });
}

// one page with every network request and console message recorded
async function open(browser, url, vp, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: !!o.touch, isMobile: !!o.touch });
  const page = await ctx.newPage();
  const rec = { console: [], requests: [], bad: [] };
  page.on('console', m => rec.console.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => rec.console.push('pageerror: ' + e.message));
  page.on('request', r => rec.requests.push(r.url()));
  page.on('response', r => {
    const u = new URL(r.url());
    if (u.origin === CDN && r.status() >= 400) rec.bad.push(r.status() + ' ' + u.pathname);
  });
  // canvas text, single characters joined back into their strings (numbers are drawn a digit at a time)
  await page.addInitScript(() => {
    window.__texts = new Set(); let run = null;
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) {
      const s = String(t); window.__texts.add(s);
      if (s.length === 1) { if (run && run.y === a[1] && run.font === this.font && a[0] > run.x) run.s += s; else run = { s, y: a[1], font: this.font }; run.x = a[0]; window.__texts.add(run.s); }
      else run = null;
      return orig.call(this, t, ...a);
    };
  });
  await page.goto(url);
  return { ctx, page, rec };
}
async function play(page) {
  await page.waitForFunction(() => document.getElementById('splash').classList.contains('show'), null, { timeout: 30000 });
  await page.click('#playBtn', { force: true });         // it breathes, so it is never 'stable'
  await page.waitForFunction(() => window.GOS && GOS.S.started, null, { timeout: 10000 });
  await sleep(300);
}
const idle = page => page.waitForFunction(() => { if (GOS.Overlay.blocking()) GOS.Overlay.skip(); return GOS.S.started && !GOS.S.busy; }, null, { timeout: 120000, polling: 100 });
// every request was to a file of the package or to the RGS API
function stray(rec) {
  return rec.requests.filter(u => {
    const x = new URL(u);
    if (x.protocol === 'data:' || x.protocol === 'blob:') return false;
    if (x.origin === CDN) return !fs.existsSync(path.join(PKG, 'frontend', decodeURIComponent(x.pathname === '/' ? '/index.html' : x.pathname)));
    if (x.origin === RGS) return !API.has(x.pathname) && !x.pathname.startsWith('/bet/replay/');
    return true;
  });
}
const session = (id, extra) => post('/mock/session', Object.assign({ sessionID: id }, extra || {}));
const stakeUrl = (id, extra) => `${CDN}/?sessionID=${id}&rgs_url=${RGS_HOST}&lang=en&device=desktop${extra || ''}`;
// the game's wallet calls for a session (the harness's own balance checks carry harness: true)
const walletCalls = async id => (await (await fetch(RGS + '/mock/log')).json()).filter(l => l.body && l.body.sessionID === id && !l.body.harness).map(l => l.path);
const balanceOf = async id => (await post('/wallet/balance', { sessionID: id, harness: true })).balance.amount;

(async () => {
  if (!fs.existsSync(path.join(PKG, 'frontend', 'index.html'))) { console.error('no stake/ package: run node tools/build-stake.js first'); process.exit(2); }
  const procs = [await start(CDN_PORT, path.join(PKG, 'frontend')), await start(RGS_PORT, path.join(PKG, 'frontend'))];
  const browser = await chromium.launch();
  const shots = A.shots ? path.resolve(A.shots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    // ---- a round at every reference size
    if (part('sizes')) for (const vp of SIZES) {
      const id = 's' + vp.join('x'), touch = vp[0] < vp[1];
      await session(id, { force: { base: EV.base.normalWin.event } });
      const before = await balanceOf(id);
      const { ctx, page, rec } = await open(browser, stakeUrl(id), vp, { touch });
      await play(page);
      const st0 = await page.evaluate(async () => ({
        preroll: !!document.getElementById('preroll') || !!document.querySelector('video'),
        manifest: !!document.querySelector('link[rel=manifest]'),
        sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
        scroll: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        target: window.GOS_BUILD && GOS_BUILD.target, bet: GOS.betMicro(),
      }));
      await page.keyboard.press('Space');
      await page.waitForFunction(() => GOS.S.busy, null, { timeout: 5000 }).catch(() => {});
      await idle(page);
      const st = await page.evaluate(() => ({ micro: GOS.RGS.balanceMicro, locked: GOS.S.locked }));
      const calls = await walletCalls(id);
      const win = Math.round(st0.bet * EV.base.normalWin.payoutMultiplier);
      if (shots) await page.screenshot({ path: path.join(shots, `round_${vp.join('x')}.png`) });
      check(`${vp.join('x')}: no intro, no service worker, no manifest, no scrolling`, !st0.preroll && !st0.sw && !st0.manifest && !st0.scroll && st0.target === 'stake', JSON.stringify(st0));
      check(`${vp.join('x')}: authenticate -> play -> end-round, balance right`, calls.join() === '/wallet/authenticate,/wallet/play,/wallet/end-round' && st.micro === before - st0.bet + win && !st.locked, `${calls.join()} ${st.micro} vs ${before - st0.bet + win}`);
      const s = stray(rec);
      check(`${vp.join('x')}: only package files and the RGS API, nothing on the console`, !s.length && !rec.bad.length && !rec.console.length, [...s, ...rec.bad, ...rec.console].slice(0, 4).join(' | '));
      await ctx.close();
    }

    // ---- no session: a blocking error, no wallet calls, no demo
    if (part('session')) {
      const { ctx, page, rec } = await open(browser, CDN + '/', [1200, 675]);
      await page.waitForFunction(() => !document.getElementById('m-error').hidden, null, { timeout: 30000 }).catch(() => {});
      const st = await page.evaluate(() => ({ err: !document.getElementById('m-error').hidden, text: document.getElementById('errorText').textContent, mode: GOS.mode }));
      check('no session: a blocking error, never the demo', st.err && /without a game session/.test(st.text) && st.mode === 'rgs', JSON.stringify(st));
      check('no session: no request to anything but the package', !rec.requests.some(u => new URL(u).origin !== CDN) && !rec.console.length, rec.console.join(' | '));
      await ctx.close();
    }

    // ---- replays: every case of every mode plays its exact payout, with no wallet calls
    if (part('replays')) {
      const { ctx, page, rec } = await open(browser, 'about:blank', [1200, 675]);
      for (const mode of Object.keys(EV)) for (const k of Object.keys(EV[mode])) {
        const e = EV[mode][k];
        rec.requests.length = 0; rec.console.length = 0;
        await page.goto(`${CDN}/?replay=true&rgs_url=${RGS_HOST}&game=ths&version=1&mode=${mode}&event=${e.event}&amount=1000000&currency=USD`);
        await play(page);
        await page.waitForFunction(() => !document.getElementById('m-replay').hidden, null, { timeout: 10000 });
        const card = await page.evaluate(() => document.getElementById('m-replay').innerText);
        await page.click('#replayGo').catch(() => page.evaluate(() => GOS.Game.startReplay()));
        await page.waitForFunction(() => GOS.S.busy, null, { timeout: 5000 }).catch(() => {});
        await idle(page);
        const won = await page.evaluate(() => GOS.S.roundWin);
        const onlyReplay = rec.requests.filter(u => new URL(u).origin === RGS).every(u => new URL(u).pathname.startsWith('/bet/replay/'));
        const costOk = mode === 'base' || /\$/.test(card) && (mode !== 'bonus' || /100/.test(card));
        check(`replay ${mode} ${k} (event ${e.event}): pays ${e.payoutMultiplier}x, shows the cost`, Math.abs(won - e.payoutMultiplier) < 1e-6 && onlyReplay && costOk && !rec.console.length, `won ${won}; ${rec.console.slice(0, 2).join(' | ')}`);
      }
      for (const [name, q, want] of [
        ['missing event', 'game=ths&version=1&mode=base', /incomplete/],
        ['unknown mode', 'game=ths&version=1&mode=turbo&event=1', /incomplete/],
        ['no such event', 'game=ths&version=1&mode=base&event=99999999', /couldn.t be found/],
      ]) {
        await page.goto(`${CDN}/?replay=true&rgs_url=${RGS_HOST}&${q}`);
        await page.waitForFunction(() => !document.getElementById('m-error').hidden, null, { timeout: 30000 }).catch(() => {});
        const t = await page.evaluate(() => document.getElementById('errorText').textContent);
        check(`replay, ${name}: says so`, want.test(t), t);
      }
      await ctx.close();
    }

    // ---- regulated-market flags: net position, RTP, session time
    if (part('flags')) for (const vp of [[1200, 675], [400, 225]]) {
      const id = 'flags' + vp[0];
      await session(id, { force: { base: EV.base.loss.event }, jurisdiction: { displayNetPosition: true, displayRTP: true, displaySessionTimer: true } });
      const { ctx, page, rec } = await open(browser, stakeUrl(id), vp);
      await play(page);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => GOS.S.busy, null, { timeout: 5000 }).catch(() => {});
      await idle(page);
      await sleep(400);
      const st = await page.evaluate(() => ({ facts: GOS.HUD.sessionFacts(), bet: GOS.baseBet(), texts: [...window.__texts].filter(t => /NET|RTP|SESSION/.test(t)) }));
      const net = st.facts.find(f => f[0] === 'NET');
      if (shots) await page.screenshot({ path: path.join(shots, `flags_${vp.join('x')}.png`) });
      check(`${vp.join('x')}: net position, RTP and session time on screen`, st.facts.length === 3 && net && net[1] === '−' + '$' + st.bet.toFixed(2) && st.texts.length > 0 && !rec.console.length, JSON.stringify(st));
      await ctx.close();
    }

    // ---- recovery: answers lost on the way back
    if (part('recovery')) for (const [name, book, fail, expect] of [
      ['a dropped /wallet/play (a win)', EV.base.normalWin, { path: '/wallet/play', after: true, drop: true }, 'played'],
      ['a dropped /wallet/play (no win)', EV.base.loss, { path: '/wallet/play', after: true, drop: true }, 'recovered'],
      ['a dropped /wallet/end-round', EV.base.normalWin, { path: '/wallet/end-round', after: true, drop: true }, 'played'],
    ]) {
      const id = 'rec' + Math.random().toString(36).slice(2, 7);
      await session(id, { force: { base: book.event } });
      const before = await balanceOf(id);
      const { ctx, page } = await open(browser, stakeUrl(id), [1200, 675]);
      await play(page);
      const bet = await page.evaluate(() => GOS.betMicro());
      await session(id, { fail });
      await page.keyboard.press('Space');
      await page.waitForFunction(() => GOS.S.busy, null, { timeout: 5000 }).catch(() => {});
      await idle(page);
      await sleep(500);
      const st = await page.evaluate(() => ({ micro: GOS.RGS.balanceMicro, locked: GOS.S.locked, won: GOS.S.roundWin,
        err: document.getElementById('m-error').hidden ? '' : document.getElementById('errorText').textContent }));
      const after = await balanceOf(id), win = Math.round(bet * book.payoutMultiplier);
      const ok = !st.locked && st.micro === after && after === before - bet + win &&
        (expect === 'played' ? Math.abs(st.won - book.payoutMultiplier * bet / 1e6) < 1e-6 : /balance is up to date/.test(st.err));
      check(`recovery: ${name}`, ok, JSON.stringify(st) + ` server ${after}, expected ${before - bet + win}`);
      // after recovering, the next round plays normally
      await session(id, { force: { base: EV.base.loss.event } });
      if (st.err) await page.click('#errorClose').catch(() => page.evaluate(() => GOS.UI.closeAll(true)));
      await page.keyboard.press('Space');
      await page.waitForFunction(() => GOS.S.busy, null, { timeout: 5000 }).catch(() => {});
      await idle(page);
      const again = await page.evaluate(() => GOS.RGS.balanceMicro);
      check(`recovery: ${name}, then another round plays`, again === await balanceOf(id) && again === after - bet, `${again}`);
      await ctx.close();
    }

    // ---- social wording, three ways in
    if (part('social')) for (const [name, extra, jur] of [['social=true', '&social=true', null], ['an XSC currency', '&currency=XSC', null], ['the socialCasino flag alone', '', { socialCasino: true }]]) {
      const id = 'soc' + Math.random().toString(36).slice(2, 7);
      await session(id, Object.assign({ force: { base: EV.base.normalWin.event } }, name === 'an XSC currency' ? { currency: 'XSC' } : {}, jur ? { jurisdiction: jur } : {}));
      const { ctx, page } = await open(browser, stakeUrl(id, extra), [1200, 675]);
      await play(page);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => GOS.S.busy, null, { timeout: 5000 }).catch(() => {});
      await idle(page);
      await page.evaluate(() => GOS.UI.open('info'));
      const bad = await page.evaluate(() => {
        const re = new RegExp('\\b(' + GOS_STR.RESTRICTED.map(w => w.replace(/ /g, '\\s+')).join('|') + ')\\b', 'i');
        const texts = [...window.__texts, document.body.innerText];
        return { social: GOS_STR.social, hits: texts.filter(t => re.test(t)).map(t => t.slice(0, 60)).slice(0, 5) };
      });
      check(`social wording via ${name}`, bad.social && !bad.hits.length, JSON.stringify(bad));
      await ctx.close();
    }
  } finally {
    await browser.close();
    procs.forEach(p => p.kill());
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Thunder Hunter Sebastian — the Stake Engine upload package.
 *
 *   node tools/build-stake.js                  # writes stake/ and copies it to the game host repo
 *   node tools/build-stake.js --no-host        # stake/ only
 *   node tools/build-stake.js --out <dir> --version 10.3 --host <dir>
 *
 * stake/
 *   frontend/            upload this folder on the game's Files page (index.html at its root)
 *   math/                index.json + lookUpTable_<mode>_0.csv + books_<mode>.jsonl.zst (publish as the math)
 *   replay-events.json   per mode, a book for each case Stake's replay review asks for
 *   build.json           version, math hash, size and sha256 of every file (no timestamps: reproducible)
 *
 * The front end is the web build minus what Stake doesn't allow or need: the demo-only blocks of
 * index.html and the stylesheet (the "Only on Stake" intro, the installable-app metas), the service
 * worker, the manifest and its icons, the video, docs/art/tools/math. js/build.js says target 'stake',
 * so the package never falls back to the local demo. Every other file is a byte-for-byte copy.
 * Needs Node 22.15+ (zstd, to read the books). tools/test.js checks the package against this script.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { refs, all } = require('./assets.js');

const ROOT = path.join(__dirname, '..');
const VERSION = '10.3';
const MAX_X100 = 500000;
// never in the Stake package
const FORBIDDEN = [/^sw\.js$/, /^manifest\.json$/, /^assets\/icons\/(icon-|apple-touch)/, /^assets\/video\//, /^js\/preroll\.js$/,
  /^docs\//, /^art\//, /^tools\//, /^math\//, /^stake\//, /^README/i, /\.md$/];

// ---------------- pure parts (tools/test.js uses these) ----------------
// drop every <!-- demo-only:start --> … <!-- demo-only:end --> block (and its line breaks)
function stripHtml(html) {
  const out = html.replace(/[ \t]*<!-- demo-only:start[\s\S]*?<!-- demo-only:end -->[ \t]*\r?\n?/g, '');
  for (const bad of ['demo-only:', 'preroll', 'only-on-stake', 'apple-mobile-web-app', 'apple-touch-icon']) {
    if (out.includes(bad)) throw new Error('index.html still has "' + bad + '" after the demo-only blocks were removed');
  }
  return out;
}
function stripCss(css) {
  const out = css.replace(/\/\* demo-only:start[\s\S]*?\/\* demo-only:end \*\/\r?\n?/g, '');
  if (out.includes('demo-only:') || out.includes('#preroll')) throw new Error('style.css still has demo-only styles');
  return out;
}
// every file the package holds, besides index.html, the stylesheet and js/build.js (written, not copied)
function frontendFiles(root) {
  const html = stripHtml(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const css = stripCss(fs.readFileSync(path.join(root, 'css/style.css'), 'utf8'));
  const files = all(refs(root, { html, css })).filter(f => f !== 'css/style.css' && f !== 'js/build.js');
  files.push('assets/fonts/OFL.txt', 'LICENSE');                // the fonts' licence and the game's
  for (const f of files) {
    if (FORBIDDEN.some(re => re.test(f))) throw new Error('not allowed in the Stake package: ' + f);
    if (!fs.existsSync(path.join(root, f))) throw new Error('referenced file missing: ' + f);
  }
  return { html, css, files: [...new Set(files)].sort() };
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// the math files index.json names, in order
function mathFiles(mathDir) {
  const index = JSON.parse(fs.readFileSync(path.join(mathDir, 'index.json'), 'utf8'));
  return ['index.json'].concat(...index.modes.map(m => [m.weights, m.events]));
}
// one hash over the math files' names and contents: ties a front end to the books it was tested with
function mathHash(mathDir) {
  const h = crypto.createHash('sha256');
  for (const f of mathFiles(mathDir).slice().sort()) h.update(f + '\0' + sha(fs.readFileSync(path.join(mathDir, f))) + '\n');
  return h.digest('hex').slice(0, 12);
}
const buildJs = (version, hash) => `/* Written by tools/build-stake.js: the Stake Engine package. The game only plays through the RGS (or a replay). */\nwindow.GOS_BUILD = ${JSON.stringify({ target: 'stake', version, mathHash: hash })};\n`;

// per mode, the first book (lowest id) for each case Stake's replay review asks for
function replayEvents(mathDir) {
  const index = JSON.parse(fs.readFileSync(path.join(mathDir, 'index.json'), 'utf8'));
  const out = {};
  for (const m of index.modes) {
    const rows = fs.readFileSync(path.join(mathDir, m.weights), 'utf8').trim().split('\n').map(l => l.split(',').map(Number));
    const books = zlib.zstdDecompressSync(fs.readFileSync(path.join(mathDir, m.events))).toString().trim().split('\n');
    const crit = id => JSON.parse(books[id - 1]).criteria;
    const x = pm => pm / 100, cost = m.cost, bonus = m.name === 'bonus';
    const find = pred => { for (const [id, , pm] of rows) if (pred(id, pm)) return id; return null; };
    const minPm = rows.reduce((m, r) => Math.min(m, r[2]), Infinity);
    const cases = {
      loss: find((id, pm) => pm === minPm),
      normalWin: bonus ? find((id, pm) => x(pm) >= 0.5 * cost && x(pm) <= 1.5 * cost) : find((id, pm) => x(pm) >= cost && x(pm) <= 5 * cost && crit(id) === 'basegame'),
      bigWin: bonus ? find((id, pm) => x(pm) >= 15 * cost && pm < MAX_X100) : find((id, pm) => x(pm) >= 15 && pm < MAX_X100 && crit(id) === 'basegame') || find((id, pm) => x(pm) >= 15 && pm < MAX_X100),
      bonusTrigger: bonus ? rows[0][0] : find(id => crit(id) === 'freegame'),
      winCap: find((id, pm) => pm === MAX_X100),
    };
    out[m.name] = {};
    for (const k in cases) {
      const id = cases[k];
      if (id == null) throw new Error(`${m.name}: no book for the "${k}" replay case`);
      const pm = rows[id - 1][2];
      const q = `replay=true&game={game}&version={mathVersion}&mode=${m.name}&event=${id}&amount=1000000&currency=USD`;
      out[m.name][k] = {
        event: id, payoutMultiplier: x(pm), criteria: crit(id),
        mock: `http://localhost:8125/?replay=true&rgs_url=localhost:8125&game=ths&version=1&mode=${m.name}&event=${id}&amount=1000000`,
        stake: `https://{team}.cdn.stake-engine.com/{game}/{version}/index.html?${q}&rgs_url={rgs_url}`,
      };
    }
  }
  return out;
}

// ---------------- the build ----------------
function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return o;
}
function preflight(mathDir) {
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('needs Node 22.15+ (zlib zstd); this is ' + process.version);
  const index = JSON.parse(fs.readFileSync(path.join(mathDir, 'index.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(mathDir, 'summary.json'), 'utf8'));
  for (const m of index.modes) {
    for (const f of [m.weights, m.events]) if (!fs.existsSync(path.join(mathDir, f))) throw new Error('math file missing: ' + f);
    const s = summary.modes && summary.modes[m.name];
    if (!s || Math.abs(s.rtp - 96.5) > 0.001) throw new Error(`${m.name}: summary RTP ${s && s.rtp}, expected 96.5`);
    if (s.reweight != null && Math.abs(s.reweight - 1) > 0.03) throw new Error(`${m.name}: re-weighting k=${s.reweight} is more than 3% from natural`);
    for (const l of fs.readFileSync(path.join(mathDir, m.weights), 'utf8').trim().split('\n')) {
      const pm = +l.split(',')[2];
      if (pm % 10 !== 0 || (pm !== 0 && pm < 10)) throw new Error(`${m.name}: payout ${pm} is not a whole 0.1x step`);
    }
  }
}
// clear a folder we own (never the repo itself, never outside the output)
function clear(dir, out) {
  const d = path.resolve(dir);
  if (!d.startsWith(path.resolve(out) + path.sep) || d === ROOT) throw new Error('refusing to clear ' + d);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
function listing(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { const b = fs.readFileSync(f); out[path.relative(dir, f).split(path.sep).join('/')] = { bytes: b.length, sha256: sha(b) }; }
    }
  })(dir);
  return out;
}

function main() {
  const o = args();
  const OUT = path.resolve(o.out || path.join(ROOT, 'stake'));
  const version = String(o.version || VERSION);
  const MATH = path.join(ROOT, 'math');
  if (OUT === ROOT || ROOT.startsWith(OUT + path.sep)) throw new Error('--out must be a folder of its own, not ' + OUT);
  preflight(MATH);

  // front end
  const fe = frontendFiles(ROOT), hash = mathHash(MATH);
  clear(path.join(OUT, 'frontend'), OUT);
  for (const f of fe.files) put(path.join(OUT, 'frontend', f), fs.readFileSync(path.join(ROOT, f)));
  put(path.join(OUT, 'frontend', 'index.html'), fe.html);
  put(path.join(OUT, 'frontend', 'css', 'style.css'), fe.css);
  put(path.join(OUT, 'frontend', 'js', 'build.js'), buildJs(version, hash));
  // math: index.json and exactly the files it names (no summary.json)
  clear(path.join(OUT, 'math'), OUT);
  for (const f of mathFiles(MATH)) put(path.join(OUT, 'math', f), fs.readFileSync(path.join(MATH, f)));
  put(path.join(OUT, 'replay-events.json'), JSON.stringify(replayEvents(MATH), null, 2) + '\n');
  const build = { game: 'Thunder Hunter Sebastian', version, mathHash: hash, frontend: listing(path.join(OUT, 'frontend')), math: listing(path.join(OUT, 'math')) };
  put(path.join(OUT, 'build.json'), JSON.stringify(build, null, 2) + '\n');

  const size = l => Object.values(l).reduce((a, f) => a + f.bytes, 0);
  console.log(`stake/frontend  ${Object.keys(build.frontend).length} files, ${(size(build.frontend) / 1048576).toFixed(1)} MB`);
  console.log(`stake/math      ${Object.keys(build.math).length} files, ${(size(build.math) / 1048576).toFixed(1)} MB   math hash ${hash}`);

  // the same package in the game host repo, checked file by file
  if (!o['no-host']) {
    const host = path.resolve(o.host || path.join(ROOT, '..', 'fiskce-game-host-api', 'stake', 'thunderhuntersebastian'));
    if (!fs.existsSync(path.dirname(path.dirname(host)))) { console.log('game host repo not found, skipped: ' + host); return; }
    fs.rmSync(host, { recursive: true, force: true });
    for (const part of ['frontend', 'math', 'replay-events.json', 'build.json']) fs.cpSync(path.join(OUT, part), path.join(host, part), { recursive: true });
    if (fs.existsSync(path.join(ROOT, 'STAKE.md'))) fs.copyFileSync(path.join(ROOT, 'STAKE.md'), path.join(host, 'STAKE.md'));
    const a = JSON.stringify(listing(OUT)), b = JSON.stringify(Object.fromEntries(Object.entries(listing(host)).filter(([f]) => f !== 'STAKE.md')));
    if (a !== b) throw new Error('the copy in the game host repo differs from stake/');
    console.log('copied to ' + host);
  }
}

module.exports = { stripHtml, stripCss, frontendFiles, mathFiles, mathHash, buildJs, replayEvents, FORBIDDEN, VERSION };
if (require.main === module) {
  try { main(); } catch (e) { console.error('build-stake: ' + e.message); process.exit(1); }
}

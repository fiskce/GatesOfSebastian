/* Thunder Hunter Sebastian — service worker (offline play, installable).
 *
 * The demo only: played through Stake or replaying, game.js never registers it.
 *
 * Scope is this folder, so it also works when the game is served from a
 * sub-path (e.g. fiskce.com/gatesofsebastianv9/). Cache Storage is shared by
 * the whole origin, so this worker only ever touches this game's caches ('gos<N>-core/-media').
 *  - code (html/js/css/json): network first, cache as fallback -> online
 *    players always get the latest build
 *  - art, fonts, sounds: cache first
 * Bump VERSION on every release.
 */
const VERSION = 'gos10-core-1';
const MEDIA = 'gos10-media';
const CORE = [
  './',
  'manifest.json',
  'css/style.css',
  'js/preroll.js',
  'js/strings.js',
  'js/math-info.js',
  'js/seb-frames.js',
  'js/engine.js',
  'js/fair.js',
  'js/symbols.js',
  'js/audio.js',
  'js/music.js',
  'js/core.js',
  'js/rgs.js',
  'js/fx.js',
  'js/scene.js',
  'js/board.js',
  'js/sebastian.js',
  'js/hud.js',
  'js/overlays.js',
  'js/stats.js',
  'js/ui.js',
  'js/game.js',
  'assets/fonts/cinzel-latin-700-normal.woff2',
  'assets/fonts/cinzel-latin-900-normal.woff2',
  'assets/fonts/outfit-latin-500-normal.woff2',
  'assets/fonts/outfit-latin-700-normal.woff2',
  'assets/fonts/outfit-latin-800-normal.woff2',
  'assets/sebastian/idle.webp',
  'assets/sebastian/shoot.webp',
  'assets/sebastian/splash.webp',
  'assets/symbols/blue.png',
  'assets/symbols/chalice.png',
  'assets/symbols/crown.png',
  'assets/symbols/glass.png',
  'assets/symbols/gold.png',
  'assets/symbols/green.png',
  'assets/symbols/purple.png',
  'assets/symbols/red.png',
  'assets/symbols/ring.png',
  'assets/symbols/scatter.png',
  'assets/icons/apple-touch-180.png',
  'assets/icons/favicon-16.png',
  'assets/icons/favicon-32.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'sounds/click.ogg',
  'sounds/freespins.ogg',
  'sounds/scatter.ogg',
  'sounds/spin.ogg',
  'sounds/thunder.ogg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => /^gos\d+-(core|media)/.test(k) && k !== VERSION && k !== MEDIA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// a navigation must not be answered with a redirected response (some hosts redirect index.html -> ./)
function clean(res) {
  if (!res || !res.redirected) return res;
  return res.blob().then(body => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }));
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (res && res.ok) cache.put(req, res.clone());
    return clean(res);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('./'));
    if (hit) return clean(hit);
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) (await caches.open(MEDIA)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  const path = new URL(req.url).pathname;
  if (/\.(mp4|webm)$/.test(path)) return;      // video streams need real range responses; leave them to the network
  const code = req.mode === 'navigate' || /\.(html|js|css|json)$/.test(path) || path.endsWith('/');
  e.respondWith(code ? networkFirst(req) : cacheFirst(req));
});

/* Thunder Hunter Sebastian — the files the game loads, read from its own sources.
 *
 * Shared by tools/test.js (everything the web build loads is precached by sw.js) and
 * tools/build-stake.js (the Stake package holds exactly what the game loads), so the two can't drift.
 *
 *   refs(root, { html, css })  -> { html, css, images, sounds, sheets }   (paths relative to root)
 *
 * html/css default to index.html and css/style.css on disk; pass transformed text (the Stake package's)
 * to get that build's references instead.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function refs(root, o) {
  o = o || {};
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const html = o.html != null ? o.html : read('index.html');
  const css = o.css != null ? o.css : read('css/style.css');
  const out = {
    // src/href in the page (scripts, the stylesheet, favicons, preloaded fonts, images, the intro clip)
    html: [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map(m => m[1]),
    // url(../…) in the stylesheet (the fonts)
    css: [...css.matchAll(/url\(\.\.\/([^)]+)\)/g)].map(m => m[1]),
    // symbol art and Sebastian's sheets, named in board.js
    images: [...read('js/board.js').matchAll(/'(assets\/[^']+\.(?:png|webp))'/g)].map(m => m[1]),
    // audio files named in audio.js (thunder and the music, .ogg and .m4a), and the sheet index
    sounds: [...read('js/audio.js').matchAll(/'(sounds\/[^']+)'/g)].map(m => m[1]),
    // the sound sheets sfx.json lists, in every format
    sheets: [],
  };
  const sfx = JSON.parse(read('sounds/sfx.json'));
  for (const k in sfx.files) for (const fmt of ['ogg', 'm4a']) if (sfx.files[k][fmt]) out.sheets.push(sfx.files[k][fmt]);
  return out;
}
const all = r => [...new Set([].concat(r.html, r.css, r.images, r.sounds, r.sheets))].sort();

module.exports = { refs, all };

#!/usr/bin/env node
/* Thunder Hunter Sebastian — AAC (.m4a) twins of the Ogg Vorbis music and thunder.
 *
 *   node tools/encode-m4a.js
 *
 * Safari can't decode Ogg Vorbis, so it would get the synth pad instead of the music. This encodes
 * sounds/music-base.m4a, sounds/music-feature.m4a and sounds/thunder.m4a from their .ogg sources
 * (AAC-LC, bit-exact flags as in render-sfx.js), then checks each one lines up with its source:
 * ffmpeg decodes both, and the cross-correlation of the openings must peak at zero lag. It also prints
 * the encoder priming a browser may leave in (js/audio.js measures and removes it at runtime).
 * Authoring tool: needs ffmpeg with the native aac encoder. The game itself has no build step.
 */
'use strict';
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const FILES = [['sounds/music-base.ogg', 160], ['sounds/music-feature.ogg', 160], ['sounds/thunder.ogg', 128]];

const run = argv => cp.execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error'].concat(argv), { maxBuffer: 1 << 28 });
// mono float samples of a file's first seconds, as ffmpeg decodes it (edit lists honoured unless asked not to)
function pcm(file, seconds, extra) {
  const b = run((extra || []).concat(['-i', file, '-t', String(seconds), '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']));
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}
// the lag (in samples) at which b best matches a, searched within +-max
function lag(a, b, max) {
  let best = 0, bestV = -Infinity;
  const n = Math.min(a.length, b.length) - max;
  for (let d = -max; d <= max; d++) {
    let s = 0;
    for (let i = max; i < n; i += 2) s += a[i] * b[i + d];
    if (s > bestV) { bestV = s; best = d; }
  }
  return best;
}
const dur = file => +cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();

for (const [src, kbps] of FILES) {
  const ogg = path.join(ROOT, src), m4a = ogg.replace(/\.ogg$/, '.m4a');
  run(['-y', '-i', ogg, '-c:a', 'aac', '-b:a', kbps + 'k', '-movflags', '+faststart',
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', m4a]);
  const a = pcm(ogg, 4), b = pcm(m4a, 4), raw = pcm(m4a, 4, ['-ignore_editlist', '1']);
  const l = lag(a, b, 2400), lr = lag(a, raw, 2400);
  if (l !== 0) throw new Error(`${path.basename(m4a)} is ${l} samples out of line with its source`);
  console.log(`${path.relative(ROOT, m4a)}  ${(fs.statSync(m4a).size / 1024).toFixed(0)} KB  ${dur(m4a).toFixed(3)} s (source ${dur(ogg).toFixed(3)} s)` +
    `  lined up; priming without the edit list ${lr} samples (${(lr / 48).toFixed(1)} ms)`);
}

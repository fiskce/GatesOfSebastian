/* Gates of Sebastian — symbol artwork
 * Every symbol is hand-built inline SVG so it renders crisp at any size and
 * looks like a real faceted gemstone / gold object (no emoji, no image files).
 * Exposes window.SYMBOL_SVG[id] = "<svg>…</svg>".
 */
(() => {
  'use strict';

  const lerp = (a, b, t) => a + (b - a) * t;
  const ptsStr = pts => pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  const centroid = pts => {
    let x = 0, y = 0;
    pts.forEach(p => { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  };

  // ---- Faceted cut-gem generator ----
  function gem(name, hue, sat, pts) {
    const c = centroid(pts);
    const inner = pts.map(p => [lerp(c[0], p[0], 0.5), lerp(c[1], p[1], 0.5)]);
    const n = pts.length;
    let facets = '';
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const quad = [pts[i], pts[j], inner[j], inner[i]];
      const L = 36 + (i % 2) * 16;                 // alternate facet brightness
      facets += `<polygon points="${ptsStr(quad)}" fill="hsl(${hue} ${sat}% ${L}%)" `
              + `stroke="hsl(${hue} ${sat}% 20%)" stroke-width="0.6" stroke-linejoin="round"/>`;
    }
    const tbl = `tbl_${name}`, clip = `clip_${name}`;
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`
      + `<defs>`
      + `<radialGradient id="${tbl}" cx="40%" cy="32%" r="72%">`
      + `<stop offset="0%" stop-color="hsl(${hue} ${sat}% 86%)"/>`
      + `<stop offset="50%" stop-color="hsl(${hue} ${sat}% 56%)"/>`
      + `<stop offset="100%" stop-color="hsl(${hue} ${sat}% 36%)"/>`
      + `</radialGradient>`
      + `<clipPath id="${clip}"><polygon points="${ptsStr(pts)}"/></clipPath>`
      + `</defs>`
      + `<polygon points="${ptsStr(pts)}" fill="hsl(${hue} ${sat}% 28%)"/>`
      + facets
      + `<polygon points="${ptsStr(inner)}" fill="url(#${tbl})" stroke="hsl(${hue} ${sat}% 26%)" stroke-width="0.6"/>`
      + `<g clip-path="url(#${clip})">`
      + `<ellipse cx="35" cy="25" rx="20" ry="8" fill="rgba(255,255,255,.5)" transform="rotate(-28 35 25)"/>`
      + `<ellipse cx="29" cy="21" rx="8" ry="3.5" fill="rgba(255,255,255,.85)" transform="rotate(-28 29 21)"/>`
      + `</g>`
      + `<polygon points="${ptsStr(pts)}" fill="none" stroke="hsl(${hue} ${sat}% 90%)" stroke-width="1.1" opacity=".55"/>`
      + `</svg>`;
  }

  // gem shapes
  const PENTAGON = [[50, 6], [93.8, 37.8], [77, 89.2], [23, 89.2], [6.2, 37.8]];
  const HEXAGON = [[27, 10.2], [73, 10.2], [96, 50], [73, 89.8], [27, 89.8], [4, 50]];
  const DIAMOND = [[50, 4], [92, 50], [50, 96], [8, 50]];
  const TRI_UP = [[50, 6], [94, 90], [6, 90]];
  const TRI_DN = [[6, 10], [94, 10], [50, 94]];

  // ---- Shared gold gradient block (per-svg id to stay valid) ----
  const gold = id => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0%" stop-color="#fff0a8"/><stop offset="45%" stop-color="#f4c430"/>`
    + `<stop offset="100%" stop-color="#8a6209"/></linearGradient>`;
  const goldH = id => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">`
    + `<stop offset="0%" stop-color="#8a6209"/><stop offset="50%" stop-color="#ffe98a"/>`
    + `<stop offset="100%" stop-color="#8a6209"/></linearGradient>`;
  const svg = inner => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

  // ---- High-pay jewelry ----
  function crown() {
    return svg(
      `<defs>${gold('gC')}<radialGradient id="rGem" cx="50%" cy="40%" r="60%">`
      + `<stop offset="0%" stop-color="#ff9aa2"/><stop offset="100%" stop-color="#9e0b2b"/></radialGradient></defs>`
      + `<path d="M14,74 L22,40 L37,60 L50,32 L63,60 L78,40 L86,74 Z" fill="url(#gC)" stroke="#6e4e08" stroke-width="2.5" stroke-linejoin="round"/>`
      + `<rect x="14" y="70" width="72" height="18" rx="4" fill="url(#gC)" stroke="#6e4e08" stroke-width="2.5"/>`
      + `<circle cx="22" cy="40" r="5.5" fill="#2aa7c4" stroke="#fff" stroke-width="1"/>`
      + `<circle cx="50" cy="32" r="7" fill="url(#rGem)" stroke="#fff" stroke-width="1.2"/>`
      + `<circle cx="78" cy="40" r="5.5" fill="#3ad06b" stroke="#fff" stroke-width="1"/>`
      + `<circle cx="32" cy="79" r="4.5" fill="#e6325a" stroke="#fff" stroke-width=".8"/>`
      + `<circle cx="50" cy="79" r="4.5" fill="#2aa7c4" stroke="#fff" stroke-width=".8"/>`
      + `<circle cx="68" cy="79" r="4.5" fill="#3ad06b" stroke="#fff" stroke-width=".8"/>`
      + `<path d="M16,72 L84,72" stroke="#fff5cc" stroke-width="1" opacity=".5"/>`);
  }
  function ring() {
    return svg(
      `<defs>${goldH('gR')}<radialGradient id="pGem" cx="40%" cy="35%" r="70%">`
      + `<stop offset="0%" stop-color="#ffd1ec"/><stop offset="55%" stop-color="#e83b8f"/>`
      + `<stop offset="100%" stop-color="#9c1457"/></radialGradient></defs>`
      + `<ellipse cx="50" cy="64" rx="29" ry="29" fill="none" stroke="url(#gR)" stroke-width="11"/>`
      + `<ellipse cx="50" cy="64" rx="29" ry="29" fill="none" stroke="#6e4e08" stroke-width="11" opacity=".25"/>`
      + `<path d="M40,40 L60,40 L54,26 L46,26 Z" fill="url(#gR)" stroke="#6e4e08" stroke-width="1.5"/>`
      + `<circle cx="50" cy="24" r="16" fill="url(#pGem)" stroke="#fff" stroke-width="1.5"/>`
      + `<polygon points="50,10 60,22 50,24 40,22" fill="rgba(255,255,255,.35)"/>`
      + `<ellipse cx="44" cy="18" rx="5" ry="2.5" fill="rgba(255,255,255,.85)" transform="rotate(-25 44 18)"/>`);
  }
  function hourglass() {
    return svg(
      `<defs>${gold('gH')}<linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0%" stop-color="#bdf5c4"/><stop offset="100%" stop-color="#1f9d4c"/></linearGradient></defs>`
      + `<path d="M28,22 L72,22 L53,50 L52,50 Z" fill="url(#sand)" stroke="#13743a" stroke-width="1"/>`
      + `<path d="M47,50 L53,50 L72,78 L28,78 Z" fill="url(#sand)" stroke="#13743a" stroke-width="1"/>`
      + `<ellipse cx="50" cy="50" rx="4" ry="2" fill="#0d5e2c"/>`
      + `<rect x="20" y="14" width="60" height="9" rx="4" fill="url(#gH)" stroke="#6e4e08" stroke-width="1.8"/>`
      + `<rect x="20" y="77" width="60" height="9" rx="4" fill="url(#gH)" stroke="#6e4e08" stroke-width="1.8"/>`
      + `<rect x="24" y="22" width="4" height="56" rx="2" fill="url(#gH)"/>`
      + `<rect x="72" y="22" width="4" height="56" rx="2" fill="url(#gH)"/>`
      + `<path d="M24,18 L76,18" stroke="#fff5cc" stroke-width="1" opacity=".6"/>`);
  }
  function chalice() {
    return svg(
      `<defs>${gold('gG')}<radialGradient id="bGem" cx="45%" cy="35%" r="70%">`
      + `<stop offset="0%" stop-color="#bfe6ff"/><stop offset="55%" stop-color="#2a7bd6"/>`
      + `<stop offset="100%" stop-color="#123e8a"/></radialGradient></defs>`
      + `<path d="M26,24 L74,24 L66,46 Q50,58 34,46 Z" fill="url(#gG)" stroke="#6e4e08" stroke-width="2"/>`
      + `<ellipse cx="50" cy="30" rx="22" ry="8" fill="url(#bGem)" stroke="#fff" stroke-width="1"/>`
      + `<rect x="46" y="56" width="8" height="16" fill="url(#gG)" stroke="#6e4e08" stroke-width="1.5"/>`
      + `<path d="M32,80 Q50,70 68,80 L68,86 L32,86 Z" fill="url(#gG)" stroke="#6e4e08" stroke-width="2"/>`
      + `<ellipse cx="42" cy="28" rx="6" ry="2.5" fill="rgba(255,255,255,.8)" transform="rotate(-12 42 28)"/>`);
  }

  // ---- Scatter: Sebastian medallion with lightning ----
  function scatter() {
    return svg(
      `<defs><radialGradient id="scGlow" cx="50%" cy="50%" r="55%">`
      + `<stop offset="0%" stop-color="#fff3c0"/><stop offset="60%" stop-color="#ffae00"/>`
      + `<stop offset="100%" stop-color="#b8430a"/></radialGradient>${gold('scRim')}</defs>`
      + `<circle cx="50" cy="50" r="46" fill="url(#scGlow)" stroke="url(#scRim)" stroke-width="4"/>`
      + `<circle cx="50" cy="50" r="46" fill="none" stroke="#6e4e08" stroke-width="1"/>`
      // little Sebastian head
      + `<circle cx="50" cy="46" r="20" fill="#e3bd8f"/>`
      + `<path d="M31,44 Q33,24 50,23 Q67,24 69,44 Q66,33 50,32 Q34,33 31,44Z" fill="#7a4a24"/>`
      + `<circle cx="43" cy="46" r="2.4" fill="#3a2a18"/><circle cx="57" cy="46" r="2.4" fill="#3a2a18"/>`
      + `<path d="M40,55 Q50,75 60,55 Q56,66 50,66 Q44,66 40,55Z" fill="#8a5a2e"/>`
      // lightning across
      + `<path d="M58,8 L40,40 L52,40 L44,64 L70,30 L56,30 Z" fill="#fff" stroke="#ffd000" stroke-width="1.5" opacity=".9"/>`);
  }

  window.SYMBOL_SVG = {
    blue:    gem('blue', 205, 85, DIAMOND),
    green:   gem('green', 135, 62, TRI_UP),
    purple:  gem('purple', 280, 62, TRI_DN),
    red:     gem('red', 5, 80, PENTAGON),
    gold:    gem('gold', 45, 88, HEXAGON),
    chalice: chalice(),
    glass:   hourglass(),
    ring:    ring(),
    crown:   crown(),
    scatter: scatter(),
  };
})();

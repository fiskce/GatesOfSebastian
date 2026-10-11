/* Gates of Sebastian — Provably Fair RNG (security)
 * Standard commit-reveal scheme (as used by major crypto casinos):
 *   • A 256-bit server seed is generated with a CSPRNG (crypto.getRandomValues).
 *   • Its SHA-256 hash is published BEFORE you play (the commitment shown on
 *     screen) so the operator cannot change outcomes after the fact.
 *   • Each spin's randomness is HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`),
 *     consumed 4 bytes at a time as a uint32/2^32 float in [0,1).
 *   • "New Seed" reveals the old server seed (so any past spin can be re-derived
 *     and checked against the published hash) and commits a fresh one.
 * Everything is synchronous so the game engine can draw numbers on demand.
 * Exposes window.ProvablyFair (or module.exports in Node).
 */
(function (root, factory) {
  const PF = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = PF;
  else root.ProvablyFair = PF;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- SHA-256 (compact, operates on / returns Uint8Array) ----
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);

  function sha256(msg) {
    const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const l = msg.length;
    const withOne = l + 1;
    const k = (((withOne + 8) + 63) & ~63);            // total padded length (mult of 64)
    const m = new Uint8Array(k);
    m.set(msg); m[l] = 0x80;
    const bitLen = l * 8;
    // 64-bit big-endian length (high 32 bits assumed 0 for our sizes)
    const dv = new DataView(m.buffer);
    dv.setUint32(k - 4, bitLen >>> 0, false);
    dv.setUint32(k - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < k; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
        const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
      }
      let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        hh=g; g=f; f=e; e=(d + t1) >>> 0; d=c; c=b; b=a; a=(t1 + t2) >>> 0;
      }
      h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
      h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
    }
    const out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
    return out;
  }

  function hmacSha256(key, msg) {
    const B = 64;
    if (key.length > B) key = sha256(key);
    const k = new Uint8Array(B); k.set(key);
    const ip = new Uint8Array(B + msg.length), op = new Uint8Array(B + 32);
    for (let i = 0; i < B; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
    ip.set(msg, B);
    const inner = sha256(ip);
    op.set(inner, B);
    return sha256(op);
  }

  // ---- helpers ----
  const enc = new TextEncoder();
  const strToBytes = s => enc.encode(s);
  function bytesToHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; }
  function hexToBytes(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function randHex(n) { const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return bytesToHex(a); }

  // ---- provably fair state ----
  const ProvablyFair = (() => {
    let serverSeed, serverHash, clientSeed, nonce;
    function init(keepClient) {
      serverSeed = randHex(32);
      serverHash = bytesToHex(sha256(strToBytes(serverSeed)));
      if (!keepClient) clientSeed = randHex(8);
      nonce = 0;
    }
    // deterministic float stream for one spin (nonce)
    function makeStream(ss, cs, n) {
      const key = hexToBytes(ss);
      let cursor = 0, buf = new Uint8Array(0), bi = 0;
      function refill() { buf = hmacSha256(key, strToBytes(`${cs}:${n}:${cursor}`)); bi = 0; cursor++; }
      return function () {
        if (bi + 4 > buf.length) refill();
        let v = 0; for (let i = 0; i < 4; i++) v = v * 256 + buf[bi++];
        return v / 4294967296;
      };
    }
    function nextRng() { nonce++; return makeStream(serverSeed, clientSeed, nonce); }
    const hashOf = seed => bytesToHex(sha256(strToBytes(seed)));
    function rotate() { const revealed = serverSeed; init(true); return revealed; }   // reveal old, keep client seed
    function setClientSeed(s) { if (s) { clientSeed = String(s).slice(0, 64); nonce = 0; } }
    init(false);
    return {
      nextRng, rotate, setClientSeed, makeStream, hashOf,
      get serverHash() { return serverHash; },
      get clientSeed() { return clientSeed; },
      get nonce() { return nonce; },
      // expose primitives so anyone can verify outcomes independently
      _sha256: sha256, _hmac: hmacSha256, _hex: bytesToHex, _bytes: strToBytes,
    };
  })();

  return ProvablyFair;
});

/* Which build this is. The repo (and fiskce.com) is the 'web' build: the local demo runs when there is
 * no RGS session in the URL. tools/build-stake.js writes target 'stake' into the Stake Engine package,
 * where the game only ever plays through the RGS (or a replay) and never falls back to the demo. */
window.GOS_BUILD = window.GOS_BUILD || { target: 'web' };

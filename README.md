# Thunder Hunter Sebastian ⚡

A tumbling, pay-anywhere slot (v10 "Forged Storm", formerly *Gates of Sebastian*). Sebastian the hunter stands on a cloud, shotgun in one hand and his fox in the other, and fires multiplier orbs into the board. Everything is drawn on a single HTML5 canvas, with no build step and no dependencies.

It runs two ways:

- **Demo** (no URL parameters, as on fiskce.com): a local balance, outcomes from a provably-fair random stream, installable and playable offline.
- **Stake Engine** (`?sessionID=…&rgs_url=…`): every round comes from Stake's RGS, played from the math files this repo exports. Bet replays work too (`?replay=true…`).

![Base game: lightning links a winning cluster](docs/base-game.jpg)
![Free spins: the storm grows with the multiplier](docs/free-spins.jpg)
<img src="docs/phone.jpg" alt="Phone: Sebastian fires over the board" width="260">

## Play

Serve the folder and open it in a browser:

```bash
python3 -m http.server 8000      # then visit http://localhost:8000
```

Opening `index.html` straight from disk also works, but the browser then blocks the fonts and sound files, so you get fallback fonts, and the sound effects are rendered in the browser from the same recipes the sound sheets were made from (the music stays silent). Offline/install support also needs it to be served (https or localhost).

**Controls:** Space or Enter spins (and presses PLAY on the splash). Press Space again, or tap the board, to hurry a spin. ↑/↓ change the bet (hold − / + to keep stepping; tap BET to pick any level), T toggles turbo, B buys free spins, A opens autoplay, M mutes and I opens the rules. Taps skip win celebrations. A control that can't be used right now is unlit and says why when pressed. The rules list every control.

## What's new in v10.2: ready for Stake Engine

v10.2 makes the game ready to upload to Stake Engine: `node tools/build-stake.js` writes the upload package into `stake/`, and [STAKE.md](STAKE.md) covers uploading it, the launch and replay URLs, and how the game meets Stake's approval checklist.

- **Math in 0.1× steps.** Stake's math verification only accepts payouts that are whole tenths of the bet. Topaz paid 0.25× and 0.75×; it now pays 0.3× and 0.8× (2× for 12+ is unchanged). The orb chances are retuned to keep the RTP (base 0.15 → 0.1427 per winning tumble, free spins 0.543 → 0.528), and the books are exported again: every mode is exactly 96.50%, and the exporter, the tests and the package build all check the 0.1× steps.
- **The package** (`stake/frontend`, `stake/math`, `stake/replay-events.json`, `stake/build.json`): the game without the fiskce.com intro (no Stake branding), the service worker, the manifest or the video, plus the math, a book per replay case and mode for the review, and the size and sha256 of every file. It never runs the local demo. A copy goes to the game host repo. `tools/test.js` fails if the package is stale, and `tools/smoke-stake.js` plays it end to end at Stake's seven reference sizes, with the CDN and the RGS on separate origins.
- **Lost answers recover**, a **refresh keeps the bet**, **replays validate** their link and their round, and every round's events are checked before they play (see the Stake section below).
- **Regulated markets**: net position, RTP and session time when the RGS asks for them.
- **Currencies** as Stake lists them; Stake's full social-mode list of words and phrases ("loss limit", "cost of" and the rest) is checked; nothing is written to the console.
- **Safari music**: AAC twins of the music and thunder (`tools/encode-m4a.js`), picked where Vorbis can't play, with the encoder's priming measured and removed.

## What's new in v10: "Forged Storm"

A major refinement, not a new game: the same board, Sebastian, dusk-to-storm sky and Greek-key lintel, made into one consistent physical object with its own sound.

**One material library, one light** (`js/materials.js`)
- One gold ramp, one key light from the upper left, and a mood fill from below (violet at dusk, amber in the storm). Micro-surface tiles (grain, brushed metal, pitting, velvet), inner shadows, engraving, raised bevelled strokes, all baked once per layout. Detail is decided in device pixels, so small screens get fewer, larger cues instead of shrunken noise.
- **The frame** is cast and polished gold: the lintel keeps its exact key rhythm, now raised bevelled bars in a sunken bronze channel with a polished lip, ±4% variation per key and rubbed wear towards the ends; round rails bend round the corners; the rosettes have grooved petals, a milgrain bezel and a faceted ruby. Lightning catches every polished edge, and a column that lands glints the lintel above it. It is baked as small strips over two frames, so a resize never stalls.
- **The tray** is velvet with glass wells, engraved column grooves and gold pins. Symbols cast contact shadows that tighten as they land; losers go unlit (darker, greyer, still solid) instead of see-through; gems get a lit edge and the gold high pays a brushed finish.
- **Storm-glass orbs**: a fresnel rim instead of a white outline, a plasma core turning inside, a caustic under them, and a gold cage on the 100×+ tier.
- **The world**: the temple gates and marble columns are gone. A lightning-rod lookout tower stands on the summit (its rod flares on strikes), timber lodge posts with brass straps and storm lanterns frame the screen, and storm-lit pines line the ridges. The sky has a baked grain against banding.

**Sound: three families in one key** (`js/sfx-recipes.js`, `tools/render-sfx.js`, `sounds/sfx-*.ogg/.m4a`)
- Every tonal sound uses only G A Bb C D F (safe over both soundtracks) and Sebastian's horn call D–A–D. *Brass Detent* for the chrome (a dry ~50 ms switch with a felt thock, toggles in on/off pairs), *Breech & Roll* for Spin (a steel breech clack the instant the round commits, before the network answers; column lands with in-key crystal tines; a seat lock; a brass brake on slam) and *The Storm Breaks* for free spins (the scatters lock, a reversed thunder charges for exactly the soundtrack's intro, and the break, a D-minor brass stab and the horn land on the feature track's first downbeat as the sky turns).
- 118 sounds rendered from code into three sound sheets, loudness-normalised per category. The same recipes render in the browser when the sheets can't be fetched.
- A real mix: UI, world, stinger and ambience buses, bus glue, a limiter and one shared room; a voice manager with polyphony, cooldowns and priorities; round-robin variants with slight pitch and level variation; screen panning. Master, music and effects volume sliders. Wins are graded by what they pay against the bet: a neutral tick below it, an in-key chime from it, coins from 5×, tier beds for big wins (the music steps back instead of dropping out).

**Chrome: machined ink steel** (`js/hud.js`, `css/style.css`)
- Every control is one material: brushed ink-steel plates with a 1 px chamfer and a slim gold inlay; pressing sinks a plate; hover is the light catching its bevel. Gold is kept for money, Spin and the frame; Buy is ruby lacquer in a gold bezel.
- The console reads **BALANCE · WIN · BET** in recessed readouts with fixed-advance digits. BET is always the bet level (the Double Chance module shows its extra cost on its own) and opens a grid of every bet level. Wins land in WIN first, then the balance rolls up; at rest every amount is the server's, shown with the currency's own decimals (never three: $16.125 reads $16.13). Messages have their own lane and never show money.
- The Spin button is the one loud element: a knurled gold ring round an enamel dome (violet at dusk, amber in the storm) that sinks under a press, arrows that cock, run and settle, STOP while a round can be hurried, and a tick ring counting down free spins.
- The multiplier collector is an engraved empty socket until orbs charge it (no more "x0"). The plaque is an enamel cartouche of fixed width. Cluster pays sit on smoked pills.
- Text is never under 11 px (8 px at 400×225), small controls have 44 px touch areas (36 px in the compact layout), and the canvas keeps clear of notches.

**Big moments and sheets**
- Big wins stamp each tier on its own enamel plate, show the ladder of tiers passed, and pour coins behind the amount; holds are shorter (2.2 s).
- Free spins: the award counts in on brass shell clicks on an amber cartouche, which then shrinks into the Spin button; a band of light wipes the sky from dusk to storm.
- Cards are ink steel with an X in the corner (and Esc, and the backdrop); on phones held upright they rise as bottom sheets. The rules are in tabs. Autoplay has its own sheet: 10/25/50/100/∞ rounds, and optional stops when the balance drops by a set amount, on a single big win, or when free spins start.

**Honest and respectful**: no near-miss messages or reactions, no teasing a feature that is already decided or was bought, turbo shortens presentations but never below 600 ms of legible time, bet buttons sound the same at every level, mute silences every bus, and every flash goes through one limiter.

### v10.1: review fixes

A five-lens review of v10 (game flow, Stake fit, audio, rendering, DOM), each finding reproduced and fixed:
- **STOP can no longer hang a round.** The drop physics runs in steps of at most 1/120 s, so gems always settle, whatever the frame rate or pace (before, a STOP at 60 Hz could leave them bouncing forever with the round open).
- **WIN is the round's running total**, the trigger spin included; it never steps back, not even when a big win re-counts on its own plate.
- **Phones:** a bottom sheet ignores the tap that opened it, so the button that slides in under the finger isn't pressed too.
- **Stake check sizes:** BALANCE, WIN and BET shrink or stack instead of disappearing; messages that don't fit the console float under the board at 11 px; every control has a full touch target (44 px, 36 px compact, 400×225 included).
- **Controls:** turbo follows the jurisdiction everywhere; Buy with Double Chance on, and AUTO during a round, are unlit and say why; one sound per press; "stop when free spins start" stops at the trigger.
- **Sound:** nothing plays while the tab is hidden; the music comes back as soon as a big win or the feature outro closes; the award clicks keep pace under turbo.
- **Offline:** the media cache turns over with each release, and a sound sheet whose size doesn't match `sfx.json` is refused (the recipes play instead), so a stale sheet can never play the wrong sounds. The worker clears only older releases of its own version, since fiskce.com serves every version side by side, and it hands a worker left at an old address (`/gatesofsebastianvN/`) the host's forwarding stand-in.
- **New scatter symbol, "Storm Seal":** a forged gold medallion with a milled rim, a dusk-storm enamel field and a gold bolt that breaks out over the rim, and **SCATTER** on a ruby ribbon across it, in Cinzel. It reads as a word on the 1280×720 board and as a gold disc with a red band at 400×225; it is drawn in code (`tools/draw-scatter.js`). Idle scatters now turn less (82% at most) so the word keeps reading.
- **Amounts:** never more decimals than the currency has (two for USD), so a sub-cent amount such as 3.025 shows as $3.03; the balance and wins stay exact underneath.
- **Rendering:** enamel plates are freed on resize and bake their shadow at low resolution; brushed texture reaches the plates' edges; big-win coins still in the air finish their fall over the board.

## What's new in v9

**Playable on Stake Engine** (`js/rgs.js`)
- With `sessionID` and `rgs_url` in the URL the game signs in with `/wallet/authenticate` while it loads. The balance, currency, bet levels, default bet and jurisdiction flags all come from the RGS. If the RGS can't be reached it says so and stops; it never falls back to the demo. The Stake package (below) has no demo at all: opened without a session it says so and stops.
- A round is one `/wallet/play {sessionID, amount, mode}` (`base`, `ante` or `bonus`). Its book events are rebuilt by `Engine.expandSpin` and checked before they play: every spin must rebuild, and the wins must add up to the final win and the round's payout. They are animated by exactly the same code as a demo spin. `/wallet/end-round` is sent only for a round that is still open, and is retried if it fails. `/wallet/play` is never retried: a lost answer may already have been charged.
- **Lost answers recover without a reload.** If `/wallet/play`'s answer is lost, the game asks the RGS where things stand (`/wallet/authenticate` again): a round it holds open is played out, at its own bet; otherwise the balance it reports is the true one and the game says so. If `/wallet/end-round`'s answer is lost and the retry is refused, a round the RGS no longer holds open was settled. The game only locks if a round is really still open. `/bet/event` isn't used: every round is in its book, and a resumed round replays from its start.
- An unfinished round (a closed tab, a dropped connection) is offered first on the next launch. It plays out at its original bet and is then closed.
- The balance is checked before every round, autoplay and buy, and nothing is sent when it is too low. Saved balances are ignored in Stake play; a refresh keeps the bet (the open or last round's, else the one last chosen in that currency).
- **Regulated markets:** when the RGS asks (`displayNetPosition`, `displayRTP`, `displaySessionTimer`), the session's net position, the mode's RTP and the session time stay on screen (under the board, or in the top corners at 400×225) and in the menu.
- Jurisdiction flags hide autoplay, turbo, the buy feature, fullscreen, slam-stop and Space to spin, and a minimum round length is honoured.
- **Replay** (`?replay=true&game=&version=&mode=&event=&amount=`) fetches `/bet/replay/…` and shows the mode, the bet and, for ante and bonus, the real cost. Then it plays the round and offers to play it again. No wallet calls, no balance. A link missing a parameter or naming an unknown mode, an event the RGS can't find (`NOT_FOUND`) and a round that doesn't add up each get their own message.
- **Social casino wording** (`social=true`, an XSC/XGC currency or the RGS's `socialCasino` flag): every visible string comes from `js/strings.js`, which has a neutral or social variant for bet, buy, credit, stake, pay and paytable.
- **Currencies:** every currency on Stake's list with its symbol, side and decimals (JPY, KRW, IDR, VND and CLP with none; SC/GC after the amount, never with "$"), plus a few more. No amount ever shows more decimals than its currency has.
- **Rules** are built from the published math: RTP per mode, max win, how the cap ends a round, a guide to every control and the standard disclaimer. The odds claims are gone.
- A **compact layout** for very short windows (Stake checks 400×225), and a splash that fits without scrolling.
- No service worker, manifest, provably-fair panel, stats or "reset balance" in Stake or replay play, and nothing written to the console (`?debug=1` turns diagnostics on).

**Stake math files** (`tools/export-math.js`, output in `math/`)
- Books are played by this repo's engine, so they are exactly what the demo plays: `index.json`, `lookUpTable_<mode>_0.csv` and `books_<mode>.jsonl.zst` for `base` (cost 1), `ante` (1.25) and `bonus` (100).
- Books are sampled in buckets (0 / base-game win / free spins / max win) with their natural probabilities. Max-win rounds are found by search, so 5,000× is in every mode. Weights are then scaled so each mode's RTP is exactly **96.50%** (the scaling stays within 3% of natural). The exporter reads every file back from disk and checks ids, weights, payouts and every event against the engine.
- `js/math-info.js` (generated) carries the RTP and max win the rules show.

| Mode | Books | RTP | Hit rate | Max |
|---|---|---|---|---|
| base | 95,010 | 96.5000% | 26.2% | 5,000× |
| ante | 95,006 | 96.5000% | 26.2% | 5,000× |
| bonus | 30,020 | 96.5000% | 99.3% | 5,000× |

```bash
node tools/export-math.js                 # ~5 minutes on 4 cores, writes math/ and js/math-info.js
node tools/export-math.js --scale 4       # 4x the books per bucket
```

**A local RGS for testing** (`tools/mock-rgs.js`): it serves the game and the books and implements the wallet and replay endpoints, with switches for bet levels, balances, forced books, injected errors and lost responses.

```bash
node tools/mock-rgs.js     # then open http://localhost:8125/?sessionID=demo1&rgs_url=localhost:8125
```

**New Sebastian.** He is now hand-drawn artwork with two animations (`art/sebastian_idle.gif`, `art/sebastian_shoot.gif`). In the idle loop he breathes, blinks and the fox sways. For every orb he raises the shotgun over the edge of the board, winks, and fires on the frame with the muzzle flash, so the bolt leaves the barrel. Then the smoke clears and he lowers the gun. `tools/build-sebastian.py` packs the clips into sprite sheets.

**Also new**
- The "Only on Stake" sting fills the screen (a blurred copy fills around it on narrow screens). It plays with sound, and when the browser blocks sound it waits behind TAP TO START. It is skipped offline, in replays and in social play.
- New soundtracks for the base game and free spins, looped on the hit each file ends with. Free spins crossfade to their own track.
- No camera zoom when rolling into a feature.
- Renamed **Thunder Hunter Sebastian**, with local favicons.

## v8

Presentation only: the payout math is byte-for-byte the v7 engine (`tools/test.js` pins it with a fingerprint of 5,000 spins).

**A living board and camera**
- Gems breathe: light sweeps across them, now and then one turns over in 3D, and a glint runs diagonally across every freshly landed board.
- **Lightning chains** link every symbol of a winning cluster. When they shatter, their sparks **stream into the TUMBLE WIN plaque**, which counts up as each one lands.
- During a scatter tease the world darkens and a heartbeat takes over the music (v8 also pushed the camera in; v9 dropped that).
- **Slow motion** when a 100×+ orb lands and when the scatter that completes a trigger drops.
- **Phone tilt** (opt-in in Settings): the board and sky shift against each other as you tilt your phone.

**Sebastian comes alive**
- He leans in during teases, wiggles his head on a near miss and **jumps** at every big-win tier.
- On big wins he **slides in over the celebration**.
- **Speech bubbles** ("Bullseye!", "Hold my fox…", "So close…"), rate-limited so he never nags. None of them suggest a win is due.

**Bigger free spins**
- The **storm grows with the total multiplier**: more lightning, a crimson sky, faster clouds, slanting rain and a low rumble.
- **Milestones** at ×25, ×50, ×100, ×250 and ×500 total multiplier get their own headline, thunder and a quip.
- **Adaptive music**: a heartbeat during teases and a storm rumble in free spins under the soundtrack.

**Polish and reach**
- **Installable and offline** (PWA): add it to a home screen and it runs without a connection.
- **Adaptive quality**: it measures its own frame time and trims effects, particles and resolution on weak devices (and steps back up when there's headroom). Settings: Auto / High / Medium / Low.
- **Stats and achievements**: session and all-time stats, 13 achievements with toasts (the trophy icon).
- **Vibration** on big moments (Android), plus settings for dynamic music, phone tilt and reduced motion (which also turns off shake, zoom, push-in, tilt and flips).
- Lightning and flashes are capped at 3 strong flashes per second (WCAG 2.3.1).

## v7: the rebuild from v6

**Look and feel**
- A painted world: an Olympus skyline with golden gates on the summit, nebula, twinkling stars, drifting clouds, a slowly turning light fan and random sky lightning. It's pre-rendered per resize and cross-fades from **violet dusk** in the base game to a **golden storm** in free spins.
- An ornate board: a gold frame with Greek-key lintels and ruby rosettes, glass slots and column dividers.
- Real fonts (Cinzel and Outfit, bundled) and vector icons instead of emoji, so it looks the same on every OS.
- Layouts for desktop, ultrawide, tablet and phone in both orientations. Portrait gives spare height to Sebastian and the logo.

**More dynamic play**
- **Column-by-column reel stops.** When enough scatters are showing to tease a feature, the remaining columns are held back. They spin with motion blur under a golden light while a suspense riser plays and the music muffles.
- **Squash and stretch** when symbols land, with a dust puff and a thud per column. Each landed scatter rings higher in pitch.
- **Wins:** non-winners dim, winners pulse and glow, and each cluster gets a floating "$2.50 / 8 × Amethyst" label. Winners then **shatter into shards** in their own colour. Win chimes climb with every cascade.
- **Multiplier orbs** come in four colour tiers. Sebastian fires each one as a forked lightning bolt from his shotgun barrel, with recoil and a muzzle flash. The orb lands with a shockwave and then **flies into the multiplier collector**. When the tumbling stops, the collector's value **slams** into the win, with a screen shake, a zoom punch and a count-up.
- **Big wins** count up through **Big → Mega → Epic → Legendary → Max** with rays, a coin fountain and music ducking. A tap skips to the total.
- **Free spins** get an intro and an outro, a persistent TOTAL MULTI that the orbs keep charging, retrigger banners, and a spin counter on the spin button.
- **Turbo**, **slam-stop**, **autoplay** (10/25/50/100/∞) and a buy-feature confirmation.

**Under the hood**
- All animation waits run on a **game clock**. Turbo and slam-stop simply speed the clock up, and a hidden tab freezes everything together.
- Particles are pooled, drawn from cached sprites and advanced with the real frame delta, so they look the same at 30, 60 or 144 Hz. v6 tied them to 60 fps.
- Credit, bet and settings persist in `localStorage`. There is a "Reset demo balance" button, and a reduce-motion setting that defaults from `prefers-reduced-motion`.
- The **5,000× max win** is enforced across the whole round, including the feature. v6 only capped single spins.

## The math, honestly measured

v6's README claimed 96.5% RTP. Simulating its engine gave a different picture. Its **Ante mode returned ~106%**, paying more than it cost, and **Buy Free Spins returned ~89%**. v7 fixes both. The feature now uses its own scatter rate, so it is worth the same however you reach it. The scatter and orb rates were then re-tuned with `tools/sim.js`, which measures RTP in parts: `RTP = (base-spin return + trigger rate × feature value) / stake`. That gives far tighter numbers than raw full rounds of a very volatile game.

From 16 million base spins and 800,000 features (`node tools/sim.js --spins 1.6e7 --features 8e5`):

| | v7 |
|---|---|
| RTP, base game | **96.67% ± 0.27** |
| RTP, Double Chance (1.25× stake) | **96.56% ± 0.26** |
| RTP, Buy Free Spins (100× stake) | **96.35% ± 0.24** |
| Hit frequency | 25.6% |
| Free spins trigger | 1 in 273 (1 in 157 with ante, 1.74×) |
| Average feature | 96.2× bet, 17.6 spins (0.52 retriggers per feature) |
| Feature spread | 35% under 20× · 16% 100–250× · 0.9% over 1,000× |
| Volatility (σ per round) | 17.5× bet |
| Max win | 5,000× (1 in ~7,000 features) |

The browser and the simulator call the same `Engine.evaluate()`, so the payout on screen is exactly what was measured.

## Provably fair

Each spin draws its randomness from `HMAC-SHA256(serverSeed, "clientSeed:nonce:cursor")`. The SHA-256 hash of the server seed is shown under the board **before** you play. In the history panel (the clock icon), **Rotate seed** reveals the old seed, and **Verify** re-derives any spin played on it in the browser. It checks the hash, the exact starting board and the payout. You can set your own client seed too. `tools/test.js` checks the built-in SHA-256 and HMAC against Node's `crypto`.

## Game rules

- **Pay anywhere:** 8+ of a symbol anywhere on the 6×5 grid pays. Tiers are 8–9, 10–11 and 12+.
- **Tumble:** winners are removed, the rest fall and new symbols drop in. This repeats while wins keep forming.
- **Multiplier orbs:** 2, 3, 4, 5, 6, 8, 10, 25, 50, 100, 250 or 500×. In the base game, the orbs from one spin add up and multiply that spin.
- **Free spins:** 4+ scatters award 15 spins. Every orb is saved into a total multiplier that applies to each winning spin. 3+ scatters in the feature add +5.
- **Double Chance:** costs 1.25× the bet; free spins trigger more often. **Buy:** 100× bet, with ante off.
- **Max win:** 5,000× the bet per round; reaching it ends the round, free spins included.
- Scatters are counted once all tumbles have finished and don't win on their own.

## Customising

| What | Where |
|---|---|
| Symbol art | Replace PNGs in `assets/symbols/` (keep the names), or edit `SYMBOL_IMAGES` in `js/board.js`. Use `''` for the built-in vector gem. The scatter is drawn by `node tools/draw-scatter.js` (colours, word and layout are parameters at the top). |
| Sebastian | Replace `art/sebastian_idle.gif` / `art/sebastian_shoot.gif` (930×825, transparent, feet on the same line) and run `python3 tools/build-sebastian.py` (needs Pillow). The barrel-tip table `TIP` and the frame numbers for aim/fire in `js/sebastian.js` are measured on the current shoot clip. |
| Wording | `js/strings.js`: every player-visible string, with its social-casino variant. |
| Currencies | `CURRENCIES` in `js/core.js`. |
| Quips | `LINES` in `js/sebastian.js`. |
| Achievements | `ACH` in `js/stats.js`. |
| Offline cache | `CORE` in `sw.js`; bump `VERSION` on every release. `node tools/test.js` fails if a file the game loads is missing from it. |
| Sound effects | Edit a recipe in `js/sfx-recipes.js`, then `node tools/render-sfx.js` (needs ffmpeg) to re-render the sheets and `sounds/sfx.json`; `node tools/test-sfx.js` checks onsets, key, levels and that every slot fits. |
| Music & thunder | `SOUND_FILES` in `js/audio.js`; the loop points are in `TRACKS`. |
| Materials | `G.Mat` in `js/materials.js`: the gold ramp, the light, the micro-surface tiles and the level-of-detail thresholds. |
| Math | `CONFIG` in `js/engine.js`. Re-run `node tools/sim.js` after any change, then `node tools/export-math.js` for Stake. |

## Files

| File | Purpose |
|---|---|
| `js/engine.js` | Pure game math (no DOM): board, tumbles, orbs, evaluate, feature, round; book events and `expandSpin`. Runs in Node too. |
| `js/rgs.js` | Stake Engine: launch parameters, wallet calls, bet levels, jurisdiction flags, replay, book-event spin source |
| `js/strings.js` | Player-facing wording, normal and social casino |
| `js/math-info.js` | Generated: RTP and max win per mode, for the rules |
| `js/seb-frames.js` | Generated: Sebastian's frames in the sprite sheets |
| `js/preroll.js` | The "Only on Stake" sting: fill, sound, tap to start |
| `js/fair.js` | Provably-fair commit/reveal RNG with a built-in SHA-256 and HMAC |
| `js/core.js` | Namespace, game clock (turbo, slow-mo), adaptive quality, springs, easing, formatting (fixed-advance digits), persistence, responsive layout |
| `js/materials.js` | The material library: gold ramps, light rig, micro-surface tiles, relief helpers, level of detail |
| `js/scene.js` | The world behind the board, in two moods |
| `js/board.js` | Sprites and their material pass, tumble physics, contact shadows, the forged frame and velvet tray, anticipation columns, storm-glass orbs |
| `js/fx.js` | Particles, lightning, floating text; camera shake, zoom, push-in, tilt; flash limiter |
| `js/sebastian.js` | Sebastian: idle and shoot clips, aim and fire timing, lean, jump, speech bubbles, big-win cut-in |
| `js/hud.js` | Ink-steel chrome: side panels, logo, cartouche plaque, the console and its readouts, the Spin button, reason chips, vector icons, hit regions |
| `js/overlays.js` | Big win, free-spins intro and outro, banners, milestones, multiplier slam |
| `js/stats.js` | Session and all-time stats, achievements, toasts |
| `js/game.js` | Spin orchestration, camera, input, render loop, boot, service-worker registration |
| `js/ui.js` | DOM panels: rules and paytable, settings, fairness and history, stats, buy, menu |
| `js/audio.js` | Web Audio engine: sound sheets (or recipes rendered in the browser), buses, limiter, shared room, voice manager, music tracks and their timing, ducking, suspense filter |
| `js/sfx-recipes.js` | Every sound effect as a deterministic recipe (Node and browser render the same samples) |
| `js/music.js` | Heartbeat and storm rumble under the soundtrack (a drum layer over the synth fallback) |
| `sw.js`, `manifest.json` | Offline cache and install metadata |
| `tools/sim.js` | Multi-threaded RTP simulator |
| `tools/test.js` | Crypto, determinism, engine invariants, math fingerprint, book events round-trip, offline-cache coverage, sound and string coverage |
| `tools/render-sfx.js`, `tools/test-sfx.js` | Render the sound sheets from the recipes; check them |
| `tools/build-stake.js`, `tools/assets.js` | The Stake Engine upload package (`stake/`); the files the game loads |
| `tools/smoke-stake.js` | The package end to end against two mock RGS processes (Playwright) |
| `tools/encode-m4a.js` | AAC twins of the music and thunder, for Safari |
| `STAKE.md`, `stake/` | Uploading to Stake Engine and the approval checklist; the package itself |
| `tools/draw-scatter.js` | Draws the SCATTER symbol (`assets/symbols/scatter.png`) in headless Chromium; every layer is a parameter at the top |
| `tools/export-math.js` | Stake Engine math files (books, lookup tables, index) |
| `tools/mock-rgs.js` | Local stand-in for Stake's RGS, serving the game and the books |
| `tools/build-sebastian.py` | Sebastian's sprite sheets from `art/` |
| `math/` | The exported Stake math files |

> The demo is for entertainment only: demo credits, no real-money gambling. Played through Stake Engine, the operator's terms apply.

Fonts: Cinzel and Outfit, SIL Open Font License (`assets/fonts/OFL.txt`). Code: GPL-3.0 (`LICENSE`).

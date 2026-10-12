# Thunder Hunter Sebastian on Stake Engine

How to rebuild, upload and submit the game, and how it meets Stake's approval checklist. Version **10.2**.

## What to upload

`node tools/build-stake.js` writes the package into `stake/` (committed, so it can be downloaded from GitHub as is), and copies it to `fiskce-game-host-api/stake/thunderhuntersebastian/`.

| Folder | What it is | Where it goes |
|---|---|---|
| `stake/frontend/` | The game: a static build with `index.html` at its root, 59 files, 10.1 MB | The game's **Files** page: import the whole folder, then **Publish Game → Front End** |
| `stake/math/` | `index.json`, `lookUpTable_<mode>_0.csv` and `books_<mode>.jsonl.zst` for `base`, `ante` and `bonus`, 49.3 MB | The game's **Files** page: import the folder, then **Publish Game → Math** |
| `stake/replay-events.json` | One book per replay case and mode (below) | Paste into the approval request |
| `stake/build.json` | Version, math hash, size and sha256 of every file | For your records: proves which files were submitted |

The front end carries `js/build.js` with `target: 'stake'` and the hash of the math it was tested with (`684d406e5d36`).

## Rebuilding

Needs **Node 22.15+** (its built-in zstd), and Playwright's Chromium for the smoke test.

```bash
node tools/sim.js                     # optional: measure RTP in parts after changing the math
node tools/export-math.js --scale 1.5 # the books (~9 minutes on 4 cores), writes math/ and js/math-info.js
node tools/test.js                    # unit checks, including the published math and the package
node tools/build-stake.js             # stake/ and the copy in the game host repo
node tools/smoke-stake.js             # the package, end to end, at Stake's sizes (about 20 minutes; --only recovery,social runs parts)
```

`tools/test.js` fails if `stake/` is stale (any file differs from what `build-stake.js` would make from the repo), so rebuild the package after every change. Stake freezes the math after approval: the export you submit is final.

## The math

Each mode's RTP is exactly **96.50%** (weights scaled from the engine's natural odds; the scaling stays within 3%). Every payout is a whole 0.1× step (Stake's math verification rejects anything else), and 5,000× is reachable in every mode.

| Mode | Cost | Books | RTP | Hit rate | Max win | Max win odds |
|---|---|---|---|---|---|---|
| `base` | 1× | 142,512 | 96.50% | 26.1% (1 in 3.8) | 5,000× | 1 in 2,022,238 spins |
| `ante` (Double Chance) | 1.25× | 142,509 | 96.50% | 26.0% (1 in 3.8) | 5,000× | 1 in 1,154,175 spins |
| `bonus` (buy free spins) | 100× | 45,024 | 96.50% | 99.2% | 5,000× | 1 in 7,476 buys |

Free spins trigger about 1 in 276 base spins and 1 in 158 with Double Chance. The books were sampled at `--scale 1.5` and re-weighted to the exact RTP by 0.986 (base), 0.978 (ante) and 1.023 (bonus).

**Stake's verification script** (`utils/rgs_verification.py` from StakeEngine/math-sdk) passes on `stake/math`: no assertion, books and lookup tables agree; RTP 0.965 in every mode, smallest win 0.3×, max 5,000×. It prints one warning, for `bonus`: `etl40b` 1.62 against a limit of 0.9 (base 0.52 and ante 0.71 are within it). That's a 3-star volatility guideline, not a rule; a 100× buy in a game with 500× orbs has a heavy top end by design. (The v10.1 math, with Topaz at 0.25×/0.75×, fails it: "Payout values must be in increments of 10.")

## Launching

Stake opens the game as `https://{team}.cdn.stake-engine.com/{game}/{version}/index.html?sessionID=…&rgs_url=…&lang=…&currency=…&device=…&social=…`.

- `sessionID` and `rgs_url` are required. Without a session the game shows "opened without a game session" and stops; the package never runs the local demo.
- `currency` comes from the RGS balance (the URL's is used until then). Every currency on Stake's list is shown with its own symbol, side and decimals; SC and GC read "10.00 SC", never with a "$".
- `social=true`, an XSC/XGC currency or the RGS's `socialCasino` flag switches every visible string to the social wording.
- `lang`: English only (Stake requires only English); other values don't break anything.

**Replays:** `index.html?replay=true&game={game UUID}&version={math version}&mode={base|ante|bonus}&event={book id}&rgs_url=…[&amount=…&currency=…&social=…]`. All of `game`, `version`, `mode` and `event` are required. A missing one, an unknown mode, an event the RGS can't find (`NOT_FOUND`) and a round that doesn't add up each get their own message.

## Replay events for the review

Book ids per mode (also in `stake/replay-events.json`, with ready-made mock and Stake URLs):

| Mode | Loss | Normal win | Big win (15×+) | Bonus trigger | Win cap (5,000×) |
|---|---|---|---|---|---|
| `base` | 1 (0×) | 30001 (4.8×) | 30113 (23×) | 120001 (7.4×) | 142501 |
| `ante` | 1 (0×) | 30003 (6×) | 30103 (18.6×) | 120001 (39.1×) | 142501 |
| `bonus` | 262 (0×) | 1 (145.8×) | 384 (1,960.1×) | 1 (every buy) | 45001 |

## Jurisdiction flags

| Flag | What the game does |
|---|---|
| `socialCasino` | Social wording everywhere (as `social=true`) |
| `disabledBuyFeature` | No buy button, no B key, not in the rules |
| `disabledAutoplay` | No autoplay button, no A key, not in the rules |
| `disabledTurbo` | No turbo, and a saved turbo setting is ignored |
| `disabledSuperTurbo` | Read; the game has no super turbo |
| `disabledSlamstop` | Spin doesn't hurry a spin, and no STOP |
| `disabledSpacebar` | Space doesn't spin |
| `disabledFullscreen` | No fullscreen button |
| `minimumRoundDuration` | Each round lasts at least that long (milliseconds; small numbers are read as seconds) |
| `displayNetPosition`, `displayRTP`, `displaySessionTimer` | The session's net position, the mode's RTP and the session time stay on screen (under the board; in the top corners at 400×225) and in the menu |

## Approval checklist

How the game meets the items of Stake's checklist (docs: approval).

| Item | How |
|---|---|
| [181] Authenticates on launch | `/wallet/authenticate` while the game loads; nothing plays before it answers |
| [183] Bet sends a play request | Spin (or Space) sends `/wallet/play {sessionID, amount, mode}` |
| [190] Unique title | "Thunder Hunter Sebastian" |
| [12] No offensive assets | A cartoon storm hunter, his fox, gems and lightning |
| [48]–[52] Math | 96.50% in every mode (90–98% and within 0.5% of base); max win reachable (odds above); hit rate about 1 in 4 |
| [59] [63] [191] Bet levels | Only the RGS's `betLevels` (or min/max/step), its default first; the bet shown is the level, Double Chance's extra cost is shown on its own |
| [187] Refresh keeps the bet | The open or last round's bet, else the last one chosen in that currency |
| [66] Uses `rgs_url` | Every call goes to `rgs_url`; nothing is hard-coded |
| [24]–[29] Rules | Every symbol's wins, the RTP and max win of each mode, how wins form, each mode's description and cost, free spins and retriggers, the multiplier orbs |
| [185] Disclaimer | Malfunction voids plays, reload resumes, long-run RTP, illustrative display, the RGS settles wins, © notice |
| [193]–[195] Desktop, mobile, popouts | Checked at 1200×675, 1024×576, 800×450, 400×225, 425×812, 375×667 and 320×568: nothing scrolls, text at least 11 px (8 px at 400×225), touch targets 44 px (36 px compact) |
| [31] Confirm modes over 2× | Buying free spins (100×) opens a confirmation first |
| [104] Autoplay | Its own sheet with a Start button; limits on loss, single win and free spins; one click never starts more than the chosen rounds |
| [107] Sound off | M, the sound button and the settings (master, music and effects volume) |
| [44] Space spins | Space or Enter (unless `disabledSpacebar`) |
| [43] Wins match the paytable | The books are played by the same engine the paytable is built from |
| No logged data, no network errors | Nothing on the console; the only requests are the package's files and the RGS |
| [77] [88]–[97] [188] Stake.US wording | Every string has a social variant; Stake's restricted words and phrases are checked by `tools/test.js` and `tools/smoke-stake.js` |
| [79] SC/GC display | "10.00 SC", no "$" |
| [171]–[174] Replay | Plays the requested event; optional parameters; play again at the end; shows the bet, the cost multiplier and the real cost |
| No Stake branding | The "Only on Stake" intro of the fiskce.com demo isn't in the package |

## Still needed in the Stake admin panel

- Create the game (title "Thunder Hunter Sebastian"): its slug, the game UUID and the math version go into the replay URLs.
- Tile art: a bright background without text, and a foreground (Sebastian with his fox, `assets/sebastian/splash.webp` is the source), plus the provider logo, to Stake's template.
- Bet-level templates, including the `us_` one for Stake.US.
- Upload the two folders, publish, and open the approval request with the replay events above.

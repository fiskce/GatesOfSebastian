/* Thunder Hunter Sebastian — player-facing wording.
 *
 * Stake's social casino (stake.us) may not use gambling words such as bet,
 * buy, credit, stake, pay or paytable. Every string the player can see that
 * would otherwise contain one comes from here: [normal, social]. A single
 * entry is the same in both. Social mode is on with ?social=true, a social
 * currency (XSC/XGC/XEC) or the RGS's jurisdiction.socialCasino flag.
 *
 * GOS_STR.RESTRICTED is the list the tests scan every visible string for in
 * social mode.
 */
window.GOS_STR = (() => {
  'use strict';
  const S = {
    title: 'Thunder Hunter Sebastian',
    titleTop: 'THUNDER HUNTER', titleMain: 'SEBASTIAN',
    // canvas HUD
    buy: ['BUY', 'GET'],
    superShort: 'SUPER',
    freeSpins: 'FREE SPINS',
    bet: ['BET', 'PLAY'],
    betAnte: ['BET +25%', 'PLAY +25%'],
    balance: 'BALANCE',
    doubleChance: 'DOUBLE CHANCE',
    doubleChanceSub: 'MORE FREE SPINS',
    antePlus: ['+25% BET', '+25% PLAY'],
    multiplier: 'MULTIPLIER', totalMulti: 'TOTAL MULTI',
    winUpTo: 'WIN UP TO 5,000×',
    tumbleWin: 'TUMBLE WIN',
    freeSpinOf: 'FREE SPINS {a} / {b}',
    win: 'WIN', featureWin: 'FREE SPINS WIN',
    fsLeft: 'FREE SPINS · {n} LEFT',
    goodLuck: 'GOOD LUCK!',
    idle: ['PLACE YOUR BET!', 'PRESS SPIN TO PLAY!'],
    autoplay: 'AUTOPLAY', auto: 'AUTO', turbo: 'TURBO', stop: 'STOP', free: 'FREE', on: 'ON', off: 'OFF',
    replay: 'REPLAY',
    // why a control is unlit (shown when it is pressed anyway)
    msMultiApplied: 'MULTIPLIER ×{x} APPLIED',
    reasonRound: 'WAIT FOR THE ROUND TO END',
    reasonFS: 'NOT DURING FREE SPINS',
    reasonAuto: 'STOP AUTOPLAY FIRST',
    reasonMinBet: ['THIS IS THE LOWEST BET', 'THIS IS THE LOWEST PLAY AMOUNT'],
    reasonMaxBet: ['THIS IS THE HIGHEST BET', 'THIS IS THE HIGHEST PLAY AMOUNT'],
    // game messages
    msgAutoStopped: 'AUTOPLAY STOPPED',
    msgAutoLow: 'AUTOPLAY STOPPED — BALANCE TOO LOW',
    msgAutoLoss: ['AUTOPLAY STOPPED — LOSS LIMIT REACHED', 'AUTOPLAY STOPPED — STOP LIMIT REACHED'],
    msgAutoWin: 'AUTOPLAY STOPPED — WIN LIMIT REACHED',
    msgAutoFeature: 'AUTOPLAY STOPPED — FREE SPINS',
    msgAnteFirst: ['TURN OFF DOUBLE CHANCE TO BUY FREE SPINS', 'TURN OFF DOUBLE CHANCE TO GET FREE SPINS'],
    msgAnteOn: ['DOUBLE CHANCE ON · BET {v}', 'DOUBLE CHANCE ON · PLAY AMOUNT {v}'],
    msgAnteOff: ['DOUBLE CHANCE OFF · BET {v}', 'DOUBLE CHANCE OFF · PLAY AMOUNT {v}'],
    msgBet: ['BET {v}', 'PLAY AMOUNT {v}'],
    msgFreeSpin: 'FREE SPIN {a} OF {b}',
    msgFeatureDone: 'FREE SPINS WIN {v}',
    msgNear: 'SO CLOSE — ONE MORE SCATTER!',
    msgRetrigger: 'RETRIGGER?', msgOneMore: 'ONE MORE SCATTER…',
    msgTurboOn: 'TURBO ON', msgTurboOff: 'TURBO OFF',
    msgBalanceReset: 'BALANCE RESET TO {v}',
    msgTooLow: 'BALANCE TOO LOW',
    msgBuyLocked: ['FREE SPINS CAN’T BE BOUGHT RIGHT NOW', 'FREE SPINS AREN’T AVAILABLE RIGHT NOW'],
    msgResume: 'FINISHING YOUR LAST ROUND',
    msgRecovered: 'CONNECTION RESTORED — FINISHING YOUR ROUND',
    msgRoundDone: 'ROUND COMPLETE',
    msgPaused: 'PAUSED',
    // regulated markets: shown only when the RGS asks for them
    sessNet: 'NET', sessRtp: 'RTP', sessTime: 'SESSION',
    // overlays
    xBet: '×',
    maxWin: 'MAX WIN', maxReached: '{x} REACHED',
    fsSaved: 'Every multiplier is saved and stacks for the whole feature',
    fsAwarded: 'FREE SPINS', fsMore: '+{n} FREE SPINS', fsRetrigger: 'RETRIGGER!',
    fsComplete: 'FEATURE COMPLETE', youWon: 'YOU WON', inSpins: 'IN {n} FREE SPINS', fsTotal: 'TOTAL',
    superFs: 'SUPER FREE SPINS', fsStartAt: 'STARTING AT ×{x} TOTAL MULTI',
    tapContinue: 'TAP TO CONTINUE', tapSkip: 'TAP TO SKIP', tapStart: 'TAP TO START',
    tierBig: 'BIG WIN', tierMega: 'MEGA WIN', tierEpic: 'EPIC WIN', tierLegend: 'LEGENDARY', tierMax: 'MAX WIN',
    congrats: 'CONGRATULATIONS!',
    tumbleCount: 'TUMBLE × {n}',
    msMulti: '×{x} TOTAL MULTI', msRaging: 'THE STORM IS RAGING', msGrows: 'THE STORM GROWS',
    // DOM
    playBtn: 'PLAY',
    fineDemo: ['Demo credits only · Not real-money gambling · Sound on', 'Demo coins only · For fun · Sound on'],
    fineLive: 'Sound on',
    buyTitle: ['Buy free spins', 'Get free spins'],
    buyFsName: 'Free spins',
    buyFsLead: '<b>{n} free spins</b>',
    buySuperName: 'Super free spins',
    buySuperLead: '<b>{n} free spins</b> starting at <b>×{x}</b> total multi',
    buyConfirm: ['Buy', 'Confirm'],
    lowTitle: 'Balance too low',
    lowDemo: ['Balance: <b>{v}</b>. Lower the bet, or reset the demo balance.', 'Balance: <b>{v}</b>. Lower the play amount, or reset the demo balance.'],
    lowLive: ['Balance: <b>{v}</b>. Lower the bet to keep playing.', 'Balance: <b>{v}</b>. Lower the play amount to keep playing.'],
    menuRules: ['How to play & paytable', 'How to play & symbol wins'],
    autoTitle: 'Autoplay', autoRounds: 'Rounds', autoStart: 'Start autoplay', cancel: 'Cancel',
    autoLoss: 'Stop if the balance drops by', autoWin: 'Stop on a single win of', autoFeature: 'Stop when free spins start', autoNoLimit: 'No limit',
    autoNote: ['Limits are multiples of the bet. Autoplay also stops when the balance is too low, and Spin stops it at any time.',
      'Limits are multiples of the play amount. Autoplay also stops when the balance is too low, and Spin stops it at any time.'],
    betsTitle: ['Choose your bet', 'Choose your play amount'],
    betsNote: ['Double chance is on: each amount includes the extra 25%.', 'Double chance is on: each play amount includes the extra 25%.'],
    rulesTabRules: 'How to play', rulesTabPays: ['Paytable', 'Symbol wins'], rulesTabModes: 'Modes & RTP', rulesTabControls: 'Controls',
    // Stake RGS
    errTitle: 'Something went wrong',
    errStartTitle: 'Can’t start the game',
    errRetry: 'Try again', errReload: 'Reload', errClose: 'Close',
    errIPB: ['Your balance is too low for this bet.', 'Your balance is too low for this play.'],
    errGLE: ['You have reached a gambling limit on your account.', 'You have reached a play limit on your account.'],
    errSession: 'Your session has expired. Please reload the game.',
    errLoc: 'This game isn’t available in your location.',
    errVal: 'The game server rejected the request. Please reload the game.',
    errMaint: 'The game server is under maintenance. Please try again later.',
    errNet: 'Can’t reach the game server. Check your connection and try again.',
    errNoRgs: 'The game was opened without a game session. Please start it again from the lobby.',
    errNetRecovered: 'The connection dropped. Your balance is up to date.',
    errReplayParams: 'This replay link is incomplete, so the round can’t be shown.',
    errReplayNotFound: 'This round couldn’t be found.',
    errReplayState: 'This round couldn’t be replayed.',
    errState: 'This round couldn’t be shown. It has been settled; your balance is up to date.',
    errGen: 'The game server had a problem. Please try again.',
    errEndRound: 'Your last round couldn’t be finished. Reload the game to complete it.',
    resumeTitle: 'Unfinished round',
    resumeLead: ['Your last round didn’t finish. It plays out now at its original bet of <b>{v}</b>.', 'Your last round didn’t finish. It plays out now at its original play amount of <b>{v}</b>.'],
    resumeGo: 'Continue',
    replayTitle: 'Replay',
    replayBet: ['Bet', 'Play amount'], replayMode: 'Mode', replayCost: ['Cost', 'Played for'], replayWin: 'Win', replayTotal: 'Total win',
    replayPlay: 'Play replay', replayAgain: 'Replay again',
    replayLoading: 'Loading the round…',
    modeBase: 'Base game', modeAnte: 'Double chance', modeBonus: ['Buy free spins', 'Get free spins'], modeSuper: ['Buy super free spins', 'Get super free spins'],
    canvasLabel: ['Thunder Hunter Sebastian slot game. Space to spin, arrow keys change the bet, T toggles turbo, B buys free spins, A opens autoplay, M mutes, I opens the rules.',
      'Thunder Hunter Sebastian game. Space to spin, arrow keys change the play amount, T toggles turbo, B gets free spins, A opens autoplay, M mutes, I opens the rules.'],
  };
  // Stake's social-mode list (docs: reference/social-mode), single words and phrases
  const RESTRICTED = ['bet', 'bets', 'betting', 'buy', 'buys', 'bought', 'purchase', 'credit', 'credits', 'stake', 'staked',
    'wager', 'wagered', 'wagering', 'paytable', 'pay', 'pays', 'paid', 'payout', 'payer', 'money', 'cash', 'gamble', 'gambling',
    'deposit', 'withdraw', 'casino', 'currency', 'profit', 'rebet', 'win feature', 'loss limit', 'loss streak', 'cost of',
    'pay table', 'total bet', 'place your bets', 'bonus buy', 'buy bonus', 'paid out', 'pay out', 'pays out'];

  const q = new URLSearchParams(location.search);
  const socialCurrency = c => /^(XSC|XGC|XEC)$/i.test(c || '');
  let social = q.get('social') === 'true' || socialCurrency(q.get('currency'));

  function T(key, vars) {
    const v = S[key];
    if (v == null) return key;
    let s = Array.isArray(v) ? v[social ? 1 : 0] : v;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }
  // static HTML: elements carry data-t="key" (text) or data-th="key" (HTML), data-ta="key" (aria-label)
  function apply(root) {
    (root || document).querySelectorAll('[data-t]').forEach(el => { el.textContent = T(el.dataset.t); });
    (root || document).querySelectorAll('[data-th]').forEach(el => { el.innerHTML = T(el.dataset.th); });
    (root || document).querySelectorAll('[data-ta]').forEach(el => { el.setAttribute('aria-label', T(el.dataset.ta)); });
  }
  return {
    T, apply, RESTRICTED, socialCurrency,
    get social() { return social; },
    setSocial(on) { social = !!on; apply(); document.documentElement.classList.toggle('social', social); },
  };
})();

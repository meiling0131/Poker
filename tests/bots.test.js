// Bot decisions in set spots, run headless (see tools/headless.js): a pair on the board is everyone's, a
// four-flush board scares a lone pair, a stack that is all but in calls an all-in, and the bigger stack's All in
// stops at what the other player can call. Also the preflop charts parse to sane ranges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../tools/headless.js';
import { cards } from './helpers.js';
const state = await import('../js/state.js');
const { enterBots } = await import('../js/modes.js');
const { botDecide, ownStrength, texture } = await import('../js/bots.js');
const { doAction } = await import('../js/engine.js');
const { handFields, maxRaiseTo, canRaise } = await import('../js/table.js');
const { tidyTarget } = await import('../js/chips.js');
const { RFI, VS_OPEN, VS_3BET, VS_4BET, range } = await import('../js/preflop.js');

test('ownStrength: what the hole cards add to the board', () => {
  const own = (h, b) => ownStrength(cards(h), cards(b));
  assert.equal(own('Ah 7d', '9s 9d Kc 4h 2s'), 0, 'the pair of nines is the board\'s: ace high');
  assert.equal(own('Kh 7d', '9s 9d Kc 4h 2s'), 1, 'kings and the board\'s nines: one pair of its own');
  assert.equal(own('9h 7d', '9s 9d Kc 4h 2s'), 3, 'trips with a nine in hand');
  assert.equal(own('Ah 7d', '9s 9d 9c 4h 2s'), 0, 'trips on the board are everyone\'s');
  assert.equal(own('4d 4c', '9s 9d 9c 4h 2s'), 6, 'a full house of its own');
  assert.equal(own('Qh Jd', 'Ts 9d 8c 7h 6s'), 4, 'a higher straight than the board\'s');
  assert.equal(own('2h 3d', 'Ts 9d 8c 7h 6s'), 0, 'playing the board\'s straight');
  assert.equal(own('Ts 9s', 'Kh Th 6h 2h 3c'), 1, 'a pair on a four-flush board is still a pair');
  assert.equal(own('Ah 7d', 'Kc Kd'), 0, 'before the flop: nothing');
});

test('texture: the straights and flushes the board itself threatens', () => {
  const t = b => texture(cards(b));
  assert.equal(t('Kh Th 6h 2h 3c').flush4, true);
  assert.ok(t('Kh Th 6h 2h 3c').scary >= 2, 'four to a flush');
  assert.equal(t('Ts 9d 8c 2h 2s').straight3, true);
  assert.equal(t('Ts 9d 8c 7h 2s').straight4, true);
  assert.equal(t('9s 9d Kc').paired, true);
  assert.equal(t('Kd 7c 2s').scary, 0, 'a dry rainbow flop threatens nothing');
});

// Seat 0 (you) against one bot; everyone else is out. `you` and `bot` give each player's bet this round,
// chips behind and total in the hand; the bot is the one to act.
function spot({ bot, hole, board = '', you, me, raises, youHist = [], botHist = [] }) {
  const S = state.S, bd = board ? cards(board) : [];
  S.seats.forEach(p => Object.assign(p, handFields(), { stack: 1000, chips: tidyTarget(1000) }));
  const h = S.seats[0], b = S.seats[bot];
  Object.assign(h, { inHand: true, bet: you.bet, stack: you.stack, total: you.total, allIn: you.stack === 0, hist: youHist });
  Object.assign(b, { inHand: true, bet: me.bet, stack: me.stack, total: me.total, hist: botHist });
  h.chips = tidyTarget(h.stack); b.chips = tidyTarget(b.stack);
  Object.assign(S, { board: bd, street: ['preflop', '', '', 'flop', 'turn', 'river'][bd.length],
    currentBet: Math.max(you.bet, me.bet), minRaise: Math.max(2, Math.abs(you.bet - me.bet)), raises, fullRaiseId: 1,
    dealer: 0, sbPos: 0, bbPos: bot, pfAgg: 0, prevAgg: 0, curAgg: 0, actor: bot, hand: 99 });
  const H = []; H[0] = cards('2c 3d'); H[bot] = cards(hole); state.setH(H);
  return b;
}
const bots = () => state.S.seats.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'bot');
function tally(bot, setup, n) {
  const out = { fold: 0, call: 0, raise: 0 };
  for (let k = 0; k < n; k++) {
    const b = spot({ bot, ...setup });
    const d = botDecide(b, bot);
    out[d.type === 'check' ? 'call' : d.type]++;
  }
  return out;
}

test('a stack that is all but in calls an all-in: 20 behind against 2000', () => {
  state.setSPEED(0);
  enterBots('practice');
  // before the flop: the bot 3-bet to 180 and has 20 left; you move in
  const pre = { hole: '7h 2d', you: { bet: 2000, stack: 0, total: 2000 }, me: { bet: 180, stack: 20, total: 180 }, raises: 4,
    youHist: [{ s: 0, t: 'raise', r: 1, b: 6 }, { s: 0, t: 'raise', r: 3, b: 2000 }], botHist: [{ s: 0, t: 'raise', r: 2, b: 180 }] };
  // on the flop: 100 each before it, the bot bet 80 of its last 100; you raise all in
  const flop = { hole: '8s 8d', board: 'Kd 7c 2s', you: { bet: 2000, stack: 0, total: 2100 }, me: { bet: 80, stack: 20, total: 180 }, raises: 2,
    youHist: [{ s: 0, t: 'raise', r: 1, b: 6 }, { s: 3, t: 'raise', r: 1, b: 2000 }], botHist: [{ s: 0, t: 'call', r: 2, b: 6 }, { s: 3, t: 'raise', r: 0, b: 80 }] };
  for (const { p, i } of bots()) {
    for (const [name, setup] of [['preflop', pre], ['flop', flop]]) {
      const t = tally(i, setup, 12);
      assert.equal(t.fold, 0, `${p.name} ${name}: 20 into a pot of 2000 is always called (${JSON.stringify(t)})`);
    }
  }
});

test('a pair on the board is everyone\'s: ace high folds to a big river bet more than a real pair does', () => {
  enterBots('practice');
  const river = hole => ({ hole, board: '9s 9d Kc 4h 2s', you: { bet: 100, stack: 800, total: 150 }, me: { bet: 0, stack: 900, total: 50 }, raises: 1,
    youHist: [{ s: 0, t: 'raise', r: 1, b: 6 }, { s: 3, t: 'check', r: 0, b: 0 }, { s: 4, t: 'check', r: 0, b: 0 }, { s: 5, t: 'raise', r: 0, b: 100 }],
    botHist: [{ s: 0, t: 'call', r: 2, b: 6 }, { s: 3, t: 'check', r: 0, b: 0 }, { s: 4, t: 'check', r: 0, b: 0 }] });
  let ace = 0, king = 0, n = 0;
  for (const { i } of bots()) {
    const a = tally(i, river('Ah 7d'), 15), k = tally(i, river('Kh 7d'), 15);
    ace += a.call + a.raise; king += k.call + k.raise; n += 15;
  }
  assert.ok(ace / n < 0.5, `ace high on 99K42 calls a pot-sized river bet ${Math.round(ace / n * 100)}% of the time`);
  assert.ok(king > ace, `kings up calls more often than ace high (${king} vs ${ace} of ${n})`);
});

test('a lone pair on a four-flush board folds a big river bet more than on a dry board', () => {
  enterBots('practice');
  const river = board => ({ hole: 'Ts 9s', board, you: { bet: 100, stack: 800, total: 150 }, me: { bet: 0, stack: 900, total: 50 }, raises: 1,
    youHist: [{ s: 0, t: 'raise', r: 1, b: 6 }, { s: 3, t: 'raise', r: 0, b: 10 }, { s: 4, t: 'check', r: 0, b: 0 }, { s: 5, t: 'raise', r: 0, b: 100 }],
    botHist: [{ s: 0, t: 'call', r: 2, b: 6 }, { s: 3, t: 'call', r: 1, b: 10 }, { s: 4, t: 'check', r: 0, b: 0 }] });
  let wet = 0, dry = 0, n = 0;
  for (const { i } of bots()) {
    const w = tally(i, river('Kh Th 6h 2h 3c'), 15), d = tally(i, river('Kd Tc 6s 2h 3c'), 15);
    wet += w.call + w.raise; dry += d.call + d.raise; n += 15;
  }
  assert.ok(wet / n < 0.4, `second pair on a four-flush board calls a pot-sized river bet ${Math.round(wet / n * 100)}% of the time`);
  assert.ok(dry > wet, `the same pair calls more on a dry board (${dry} vs ${wet} of ${n})`);
});

test('All in from the bigger stack is the other player\'s whole stack', () => {
  enterBots('practice');
  const S = state.S, bot = bots()[0].i;
  // the bot raised to 180 and has 20 behind; you have 2000
  spot({ bot, hole: 'Ah Kd', you: { bet: 2, stack: 2000, total: 2 }, me: { bet: 180, stack: 20, total: 180 }, raises: 2,
    botHist: [{ s: 0, t: 'raise', r: 1, b: 180 }] });
  S.actor = 0; S.currentBet = 180;
  const me = S.seats[0];
  assert.equal(canRaise(me), true);
  assert.equal(maxRaiseTo(me), 200, 'as far as the bot\'s 200 can follow');
  doAction(me, 'raise', me.bet + me.stack);
  assert.equal(me.bet, 200, 'the raise stops at 200');
  assert.equal(me.stack, 2002 - 200, 'the rest stays in front of you');
  assert.equal(me.allIn, false);
  assert.match(me.last, /^全下 200/, 'it still reads All in');
  // with the bot all in for less than the bet, nobody can raise any more
  const b = S.seats[bot]; b.bet = 200; b.stack = 0; b.allIn = true;
  assert.equal(canRaise(me), false);
});

test('preflop charts: every hand at most once, sane range sizes', () => {
  const share = text => { let n = 0; for (const [h, f] of range(text)) n += f * (h.length === 2 ? 6 : h[2] === 's' ? 4 : 12); return n / 1326; };
  const near = (x, lo, hi, what) => assert.ok(x >= lo && x <= hi, `${what}: ${(x * 100).toFixed(1)}%`);
  near(share(RFI.UTG), 0.12, 0.2, 'UTG opens'); near(share(RFI.BTN), 0.38, 0.55, 'the button opens');
  near(share(VS_OPEN.BB.BTN.call) + share(VS_OPEN.BB.BTN.raise), 0.4, 0.65, 'the big blind defends against the button');
  for (const t of [RFI.UTG, RFI.LJ, RFI.HJ, RFI.CO, RFI.BTN, RFI.SB, VS_3BET.ip.call, VS_4BET.call])
    for (const [, f] of range(t)) assert.ok(f > 0 && f <= 1);
  // a hand in both the 3-bet and the call range never adds up past 100%
  for (const pos of Object.keys(VS_OPEN)) for (const [g, ch] of Object.entries(VS_OPEN[pos])) {
    const r = range(ch.raise), c = range(ch.call);
    for (const [h, f] of r) assert.ok(f + (c.get(h) || 0) <= 1.0001, `${pos} vs ${g}: ${h}`);
  }
});

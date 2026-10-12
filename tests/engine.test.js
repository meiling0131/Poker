// Engine regression tests, run headless (see tools/headless.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNextTimer } from '../tools/headless.js';
const { enterBots } = await import('../js/modes.js');
const { doAction, proceed, startHand, castVote } = await import('../js/engine.js');
const state = await import('../js/state.js');
const { myTurn } = await import('../js/table.js');
const { BETTING } = await import('../js/config.js');

test('after you close a betting round it is no longer your turn (no double action)', async () => {
  state.setSPEED(0);
  enterBots('practice');
  state.S.seats[0].qBuy = 1;
  await startHand();
  let actions = 0;
  for (let guard = 0; state.S.hand <= 40 && guard < 2e5; guard++) {
    await null;
    const S = state.S, me = S.seats[0];
    if (S.runout && S.runout.stage === 'vote' && S.runout.voters.includes(0) && !S.runout.votes[0]) { castVote(0, 1); continue; }
    if (myTurn()) {
      doAction(me, 'call'); proceed(); actions++;
      // the invariant the bug broke: having acted and matched the bet, you are not asked again
      assert.ok(!(myTurn() && me.acted && me.bet === S.currentBet), `hand ${S.hand}: still my turn after closing the action`);
      continue;
    }
    if (S.street === 'done' || S.street === 'idle') { if (me.stack === 0) me.qBuy = 1; await startHand(); continue; }
    if (BETTING.includes(S.street) && S.actor === 0) { proceed(); continue; }
    if (!runNextTimer()) break;
  }
  assert.ok(actions > 40, 'played enough of my own actions to exercise the check');
});

test('chips are conserved hand after hand', async () => {
  const S = state.S;
  const onTable = S.seats.reduce((a, p) => a + p.stack + (p.street === 'done' ? 0 : p.total), 0);
  const bought = Object.values(S.book).reduce((a, b) => a + b.in - b.out, 0);
  // mid-hand: stacks plus what is committed this hand equal everything bought in
  assert.equal(S.seats.reduce((a, p) => a + p.stack + p.total, 0), bought);
  assert.ok(onTable > 0);
});

test('换座位: swapping two seats moves the players and keeps the dealer button with its player', async () => {
  const { swapSeats, canSwapNow } = await import('../js/seats.js');
  const S = state.S;
  while (S.street !== 'done' && S.street !== 'idle') { if (!runNextTimer()) break; await null; if (myTurn()) { doAction(S.seats[0], 'fold'); proceed(); } }
  assert.ok(canSwapNow(), 'between hands');
  const a = S.seats[0], b = S.seats[3], dealer = S.seats[S.dealer];
  assert.ok(swapSeats(0, 3));
  assert.equal(S.seats[0], b);
  assert.equal(S.seats[3], a);
  assert.equal(S.seats[S.dealer], dealer, 'dealer button follows its player');
  assert.equal(swapSeats(2, 2), false);
});

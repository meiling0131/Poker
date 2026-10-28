// Your buttons at a practice table, run headless (see tools/headless.js): what Call, the raise slider and Bet
// put in when the stack is a fresh buy-in of 25s, the confirmations before Fold and All in, 整理, and how your own
// action shows at once at a table the server deals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNextTimer } from '../tools/headless.js';
const { enterBots } = await import('../js/modes.js');
const { proceed, startHand, doAction } = await import('../js/engine.js');
const actions = await import('../js/actions.js');
const state = await import('../js/state.js');
const { BETTING } = await import('../js/config.js');
const { csum, tidied } = await import('../js/chips.js');
const { canRaise, maxRaiseTo, minRaiseTo, myTurn } = await import('../js/table.js');
state.view.renderHero = () => {};   // no page to draw on

// Play the bots' turns until it is yours and `ok` holds; check whenever that is free and `ok` doesn't hold yet.
async function myDecision(ok) {
  for (let guard = 0; guard < 2e5; guard++) {
    await null;
    const S = state.S, me = S.seats[0];
    if (myTurn()) {
      if (ok(me, S)) return me;
      doAction(me, S.currentBet > me.bet ? 'fold' : 'check'); proceed(); continue;
    }
    if (S.street === 'done' || S.street === 'idle') { if (me.stack === 0) me.qBuy = 1; await startHand(); continue; }
    if (S.runout && S.runout.stage === 'vote') { for (const i of S.runout.voters) S.runout.votes[i] = 1; }
    if (!runNextTimer()) break;
  }
  throw new Error('never got the decision');
}
// a fresh buy-in: 200 in 25s, nothing small to make change with
const allTwentyFives = me => { me.stack = 200; me.chips = { 1: 0, 5: 0, 10: 0, 25: 8 }; };

test('Call with only 25s calls and takes change back; it does not raise to 25', async () => {
  state.setSPEED(0);
  enterBots('practice');
  state.S.seats[0].qBuy = 1;
  await startHand();
  const me = await myDecision((p, S) => BETTING.includes(S.street) && S.currentBet - p.bet > 0 && S.currentBet - p.bet < 25);
  allTwentyFives(me);
  const S = state.S, cur = S.currentBet, toCall = cur - me.bet, before = me.bet;
  actions.selectCall();
  const L = actions.actionLabels(me);
  assert.equal(csum(state.PUSH), 25, 'Call picks one 25');
  assert.equal(L.betType, 'call');
  assert.equal(L.betAmt, toCall);
  assert.equal(L.change, 25 - toCall);
  actions.placeBet();
  assert.equal(me.bet, cur, 'matched the bet');
  assert.equal(S.currentBet, cur, 'nobody raised');
  assert.equal(me.stack, 200 - (cur - before));
  assert.equal(csum(me.chips), me.stack, 'the change came back as chips');
});

test('the raise slider raises to its amount with 25s, not to the chips pushed', async () => {
  const me = await myDecision((p, S) => BETTING.includes(S.street) && canRaise(p) && minRaiseTo(p) <= 37);
  allTwentyFives(me);
  const S = state.S;
  actions.openBetMenu();
  actions.setRaiseAt(37);
  actions.commitRaise();
  assert.equal(csum(state.PUSH), 50, 'two 25s pushed');
  const L = actions.actionLabels(me);
  assert.deepEqual([L.betType, L.to, L.change], ['raise', 37, 50 - (37 - me.bet)]);
  actions.placeBet();
  assert.equal(me.bet, 37);
  assert.equal(S.currentBet, 37);
  assert.equal(csum(me.chips), me.stack);
});

test('chips you push yourself are the bet: two 25s raise to 50', async () => {
  const me = await myDecision((p, S) => BETTING.includes(S.street) && canRaise(p) && minRaiseTo(p) <= 50 && p.bet === 0);
  allTwentyFives(me);
  state.setPUSH({ 1: 0, 5: 0, 10: 0, 25: 2 });
  const L = actions.actionLabels(me);
  assert.deepEqual([L.betOk, L.betType, L.to, L.change], [true, 'raise', 50, 0]);
  actions.placeBet();
  assert.equal(me.bet, 50);
});

test('Fold and All in ask once more; 取消 leaves you in the hand', async () => {
  let me = await myDecision((p, S) => BETTING.includes(S.street) && S.currentBet > p.bet);
  actions.requestAction('fold');
  assert.ok(actions.pendingIsCurrent(), 'Fold waits for 确认');
  assert.equal(me.folded, false);
  actions.cancelAction();
  assert.equal(me.folded, false);
  actions.requestAction('fold');
  actions.confirmAction();
  assert.equal(me.folded, true);

  me = await myDecision((p, S) => BETTING.includes(S.street) && canRaise(p) && p.stack > 0);
  const stack = me.stack, bet = me.bet;
  actions.openBetMenu();
  actions.setRaiseAt(maxRaiseTo(me));
  actions.commitRaise();
  assert.equal(actions.actionLabels(me).betAllIn, true);
  actions.placeBet();
  assert.ok(actions.pendingIsCurrent(), 'All in waits for 确认');
  assert.equal(me.bet, bet, 'nothing went in yet');
  actions.confirmAction();
  assert.equal(me.allIn, true);
  assert.equal(me.bet, bet + stack);
});

test('整理 works in the middle of a hand, on your turn too, and puts the picked chips back', async () => {
  const me = await myDecision((p, S) => BETTING.includes(S.street) && p.stack > 0);
  allTwentyFives(me);
  actions.selectCall();
  assert.ok(csum(state.PUSH) > 0, 'chips picked');
  await actions.tidy();
  assert.equal(csum(state.PUSH), 0, 'picked chips went back');
  assert.deepEqual(me.chips, tidied({ 1: 0, 5: 0, 10: 0, 25: 8 }));
  assert.equal(csum(me.chips), 200);
  assert.ok(myTurn(), 'still your turn');
});

test('at a table the server deals, your action shows at once and goes out with the turn it was played on', async () => {
  const me = await myDecision((p, S) => BETTING.includes(S.street) && S.currentBet > p.bet && p.stack > S.currentBet - p.bet);
  const S = state.S, turn = S.turn, hand = S.hand, cur = S.currentBet, stack = me.stack, bet = me.bet;
  const sent = [];
  const realRef = state.myRef;
  state.setmyRef({ update: async v => { sent.push(v); } });
  state.M.host = false;
  try {
    actions.selectCall();
    actions.placeBet();
    assert.deepEqual(sent.map(v => [v.act.type, v.act.turn, v.act.hand]), [['call', turn, hand]], 'sent once, for the turn it was played on');
    assert.equal(me.bet, cur, 'the call is on the table already');
    assert.equal(me.stack, stack - (cur - bet), 'and out of the stack');
    assert.equal(S.actor, -1, 'nobody is to act until the server says who');
    assert.equal(myTurn(), false);
    actions.placeBet();
    assert.equal(sent.length, 1, 'a second tap sends nothing');
  } finally {
    state.M.host = true;
    state.setmyRef(realRef);
  }
});

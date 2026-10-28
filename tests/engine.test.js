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

test('bots sit by their player id; their book and stats are kept under it', async () => {
  const { BOT_PLAYERS, BOT_NAMES } = await import('../js/config.js');
  const bots = state.S.seats.filter(p => p.kind === 'bot');
  assert.deepEqual(bots.map(p => p.id), BOT_PLAYERS.map(b => b.id));
  assert.ok(bots.every(p => p.name === BOT_NAMES[p.id]));
  const keys = Object.keys(state.S.book).filter(k => k.startsWith('ubot'));
  assert.ok(keys.length > 0 && keys.every(k => BOT_NAMES[k]));
  assert.ok(!Object.keys(state.S.book).some(k => k.startsWith('bot:')));
});

test('a practice table keeps the database\'s counts too, for the player cards', async () => {
  for (const [k, st] of Object.entries(state.S.stats)) {
    assert.equal(st.hands, st.h, `${k}: one per hand dealt`);
    assert.equal(st.vpip, st.vp, `${k}: vpip`);
    assert.equal(st.pfr, st.pr, `${k}: pfr`);
    assert.ok(st.wsd <= st.wtsd && st.wwsf <= st.saw_flop && st.ats <= st.ats_opp && st.hands_won <= st.hands);
    if (st.biggest_win_amount) assert.match(st.biggest_win_hand, /^(([2-9TJQKA][shdc]|NA),){4}([2-9TJQKA][shdc]|NA)$/);
  }
});

test('chips are conserved hand after hand', async () => {
  const S = state.S;
  const onTable = S.seats.reduce((a, p) => a + p.stack + (p.street === 'done' ? 0 : p.total), 0);
  const bought = Object.values(S.book).reduce((a, b) => a + b.in - b.out, 0);
  // mid-hand: stacks plus what is committed this hand equal everything bought in
  assert.equal(S.seats.reduce((a, p) => a + p.stack + p.total, 0), bought);
  assert.ok(onTable > 0);
});

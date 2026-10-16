// The games table: what one hand records for each seat (handRows in js/stats.js), driven seat by seat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNextTimer } from '../tools/headless.js';
const { enterBots } = await import('../js/modes.js');
const { doAction, proceed, startHand } = await import('../js/engine.js');
const state = await import('../js/state.js');
const { BETTING } = await import('../js/config.js');
const { handRows } = await import('../js/stats.js');
const { cardCode } = await import('../js/cards.js');
const { card } = await import('./helpers.js');

// Play one hand where `choose(i, S)` picks each action, then return the rows and the seat roles.
async function playHand(choose) {
  const S0 = state.S;
  if (!S0 || S0.street === 'done' || S0.street === 'idle') { for (const p of state.S.seats) if (!p.stack) p.qBuy = 1; await startHand(); }
  const S = state.S, n = S.seats.length;
  let co = -1;
  for (let k = 1; k < n; k++) { const j = (S.dealer - k + n) % n; if (S.seats[j].inHand) { co = j; break; } }
  const roles = { btn: S.dealer, sb: S.sbPos, bb: S.bbPos, co };
  for (let guard = 0; S.street !== 'done' && guard < 1e5; guard++) {
    await null;
    if (S.runout && S.runout.stage === 'vote') { for (const i of S.runout.voters) S.runout.votes[i] = 1; }
    if (BETTING.includes(S.street) && S.actor >= 0) {
      const p = S.seats[S.actor], [type, to] = choose(S.actor, S, roles);
      doAction(p, type, to || 0); proceed(); continue;
    }
    if (!runNextTimer()) break;
  }
  assert.equal(S.street, 'done');
  return { rows: handRows(S), roles, S };
}
const rowOf = (res, i) => res.rows.find(r => r.player_id === (res.S.seats[i].kind === 'bot' ? res.S.seats[i].id : res.S.seats[i].uid));

test('card codes: rank uppercase with T for ten, suit lowercase', () => {
  assert.equal(cardCode(card('As')), 'As');
  assert.equal(cardCode(card('Td')), 'Td');
  assert.equal(cardCode(card('2c')), '2c');
  assert.equal(cardCode(card('Kh')), 'Kh');
});

test('a cutoff steal, 3-bet by the button and called, goes to showdown', async () => {
  state.setSPEED(0);
  enterBots('practice');
  let raised = 0;
  const res = await playHand((i, S, r) => {
    if (S.street !== 'preflop') return ['check'];
    if (i === r.co) { raised++; return raised === 1 ? ['raise', 6] : ['call']; }
    if (i === r.btn) return ['raise', 18];
    return ['fold'];
  });
  const { roles: r } = res, co = rowOf(res, r.co), btn = rowOf(res, r.btn), sb = rowOf(res, r.sb), bb = rowOf(res, r.bb);
  assert.equal(res.rows.length, res.S.seats.filter(p => p.inHand).length, 'one row per seat dealt in');
  assert.ok(res.rows.every(x => x.mode === 'regular'));
  assert.deepEqual([co.ats_opp, co.ats, co['3bet'], co.vpip, co.pfr], [1, 1, 0, 1, 1], 'the cutoff stole');
  assert.deepEqual([btn.ats_opp, btn.ats, btn['3bet'], btn.vpip, btn.pfr], [0, 0, 1, 1, 1], 'the button 3-bet; not folded to, so no steal spot');
  assert.deepEqual([sb.ats_opp, sb.vpip, sb.saw_flop, sb.wtsd, sb.won], [0, 0, 0, 0, 0], 'the small blind folded');
  assert.deepEqual([bb.vpip, bb.saw_flop], [0, 0], 'posting a blind is not vpip');
  for (const x of [co, btn]) { assert.equal(x.saw_flop, 1); assert.equal(x.wtsd, 1); assert.equal(x.wsd, x.won); assert.equal(x.wwsf, x.won); }
  const winners = [co, btn].filter(x => x.won);
  assert.ok(winners.length >= 1);
  assert.equal(winners.reduce((a, x) => a + x.won_amount, 0), 18 + 18 + 1 + 2, 'the whole pot, split or not');
  for (const x of winners) {
    assert.equal(x.won_pot, '[0]');
    assert.match(x.won_hand, /^([2-9TJQKA][shdc],){4}[2-9TJQKA][shdc]$/);
    assert.equal(x.won_chop, winners.length > 1 ? 1 : 0);
  }
  for (const x of res.rows.filter(x => !x.won)) { assert.equal(x.won_pot, '[]'); assert.equal(x.won_hand, ''); assert.equal(x.won_amount, 0); }
});

test('a button steal the blinds fold to: won with nothing shown, uncalled chips left out', async () => {
  const res = await playHand((i, S, r) => (i === r.btn ? ['raise', 6] : ['fold']));
  const btn = rowOf(res, res.roles.btn);
  assert.deepEqual([btn.ats_opp, btn.ats, btn.won, btn.wtsd, btn.wsd, btn.saw_flop, btn.wwsf], [1, 1, 1, 0, 0, 0, 0]);
  assert.equal(btn.won_pot, '[0]');
  assert.equal(btn.won_hand, 'NA,NA,NA,NA,NA');
  assert.equal(btn.won_amount, 2 + 1 + 2, 'its own matched 2 and the blinds; the 4 nobody called is not a win');
  for (const i of [res.roles.sb, res.roles.bb]) assert.equal(rowOf(res, i).ats_opp, 0, 'facing a raise is no steal spot');
});

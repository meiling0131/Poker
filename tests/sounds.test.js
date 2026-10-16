// The table's sounds (fx.js sfx, triggered from ui/anim.js): which plays when, heard through a spy while
// practice hands are played and the table is "drawn" after every change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNextTimer } from '../tools/headless.js';
globalThis.document.querySelector = () => null;
const { spySfx } = await import('../js/fx.js');
const { sync, after } = await import('../js/ui/anim.js');
const { enterBots } = await import('../js/modes.js');
const { doAction, proceed, startHand } = await import('../js/engine.js');
const state = await import('../js/state.js');
const { myTurn } = await import('../js/table.js');

test('cards dealt, board cards, every action and the payout each make their sound', async () => {
  const heard = [];
  spySfx(name => heard.push(name));
  state.setSPEED(0);
  enterBots('practice');
  state.S.seats[0].qBuy = 1;
  const draw = () => { sync(); after(); };
  await startHand(); draw();
  let hands = 0, dealt = 0, boardCards = 0, actions = { fold: 0, check: 0, chips: 0 };
  const seen = new Map();
  for (let guard = 0; hands < 12 && guard < 2e5; guard++) {
    await null;
    const S = state.S;
    // count what really happened, to compare with what was heard
    if (!seen.has(S.hand)) { seen.set(S.hand, { board: 0, hist: S.seats.map(() => 0) }); dealt += S.seats.filter(p => p.inHand).length * 2; }
    const h = seen.get(S.hand);
    boardCards += Math.max(0, S.board.length - h.board); h.board = S.board.length;
    S.seats.forEach((p, i) => { for (const e of (p.hist || []).slice(h.hist[i])) actions[e.t === 'fold' ? 'fold' : e.t === 'check' ? 'check' : 'chips']++; h.hist[i] = (p.hist || []).length; });
    if (myTurn()) { doAction(S.seats[0], 'call'); proceed(); draw(); continue; }
    if (S.street === 'done' || S.street === 'idle') { hands++; if (S.seats[0].stack === 0) S.seats[0].qBuy = 1; await startHand(); draw(); continue; }
    if (!runNextTimer()) break;
    draw();
  }
  spySfx(null);
  const n = name => heard.filter(x => x === name).length;
  assert.ok(hands >= 10, `played ${hands} hands`);
  assert.equal(n('card-drop'), boardCards, 'one card-drop per board card');
  assert.equal(n('fold-card'), actions.fold + dealt, 'one fold-card per fold, and one per hole card dealt (the deal uses it too)');
  assert.equal(n('check'), actions.check, 'one check per check');
  assert.equal(n('place-bet') + n('allin'), actions.chips, 'one place-bet or allin per call or raise');
  assert.ok(n('collect-chips') >= hands - 1 && n('collect-chips') <= hands + 1, 'collect-chips once per hand paid out');
  assert.equal(n('notify') + n('notify-allin'), 0, 'the prompts are not table sounds');
});

test('游戏音效 off silences every sound, prompts included', async () => {
  const { sfx, setSOUND } = await import('../js/fx.js');
  const heard = [];
  spySfx(name => heard.push(name));
  setSOUND(false);
  for (const n of ['notify', 'notify-allin', 'notify-bank-complete', 'check', 'place-bet', 'allin', 'fold-card', 'card-drop', 'collect-chips']) sfx(n);
  setSOUND(true);
  sfx('check');
  spySfx(null);
  assert.deepEqual(heard, ['check']);
});

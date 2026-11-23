// turing at the 单挑 (heads-up) practice table, run headless with its real WebAssembly engine and blueprints
// (js/turing/): you and turing alone, turing plays every one of its actions from the engine (never the bots' core),
// the actions are legal, chips are conserved, and each finished hand reaches turing's opponent model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runNextTimer } from '../tools/headless.js';
const state = await import('../js/state.js');
const { isTuring, loadTuringFrom, turingReady } = await import('../js/turing.js');
const { enterHU } = await import('../js/modes.js');
const { castVote, doAction, proceed, startHand } = await import('../js/engine.js');
const { BETTING } = await import('../js/config.js');
const { myTurn } = await import('../js/table.js');

const read = f => fs.readFileSync(new URL('../js/turing/' + f, import.meta.url));

test('turing loads its engine and its six blueprints', async () => {
  assert.equal(await loadTuringFrom(read('turing.wasm'), read('blueprints.bin')), 6);
  assert.ok(turingReady());
});

test('单挑: you and turing alone; turing plays from its engine, legally, and chips are conserved', async () => {
  state.setSPEED(0);
  await enterHU();                                     // the engine is in already: nothing to fetch
  let S = state.S;
  assert.equal(S.hu, true);
  assert.equal(S.seats.length, 2);
  assert.ok(isTuring(S.seats[1]), 'the other seat is turing');
  let core = 0, mine = 0, its = 0, raises = 0;
  globalThis.__botTrace = p => { if (isTuring(p)) core++; };   // bots.js calls this for every core decision
  S.seats[0].qBuy = 1;
  await startHand();
  const count = () => { for (const a of S.acts || []) { if (a.k === 1) { its++; if (a.t === 'raise') raises++; } else mine++; } };
  for (let guard = 0; state.S.hand <= 120 && guard < 4e5; guard++) {
    await null;
    S = state.S;
    const me = S.seats[0];
    if (S.runout && S.runout.stage === 'vote' && S.runout.voters.includes(0) && !S.runout.votes[0]) { castVote(0, 1); continue; }
    if (myTurn()) {
      const r = Math.random();
      doAction(me, r < .12 ? 'fold' : r < .75 ? 'call' : 'raise', Math.max(S.currentBet * 3, S.stakes.bb * 3));
      proceed();
      continue;
    }
    if (S.street === 'done' || S.street === 'idle') {
      if (S.street === 'done') count();
      if (me.stack === 0) me.qBuy = 1;
      await startHand();
      continue;
    }
    if (BETTING.includes(S.street) && S.actor === 0) { proceed(); continue; }
    if (!runNextTimer()) break;
  }
  delete globalThis.__botTrace;
  assert.ok(state.S.hand > 100, `played ${state.S.hand} hands`);
  assert.equal(core, 0, 'turing never fell back to the bots\' core');
  assert.ok(its > 100 && mine > 100, `turing acted ${its} times, you ${mine}`);
  assert.ok(raises > 10, 'turing raises too');
  const bought = Object.values(state.S.book).reduce((a, b) => a + b.in - b.out, 0);
  assert.equal(state.S.seats.reduce((a, p) => a + p.stack + p.total, 0), bought, 'chips are conserved');
});

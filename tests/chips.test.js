import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z, csum, exactPick, takeChips, payChips, giveFromPot, tidyChips, chipBreakdown, BUY_CHIPS } from '../js/chips.js';

const chips = (o) => Object.assign(Z(), o);

test('a buy-in is 200 in the standard mix', () => {
  assert.equal(csum(BUY_CHIPS()), 200);
  assert.deepEqual(chipBreakdown(200), BUY_CHIPS());
});

test('exact payment prefers large chips and finds non-greedy sets', () => {
  assert.deepEqual(exactPick(chips({ 25: 2, 10: 3, 5: 1 }), 55), chips({ 25: 2, 5: 1 }));
  assert.deepEqual(exactPick(chips({ 25: 1, 10: 3 }), 30), chips({ 10: 3 })); // greedy 25 would fail
  assert.equal(exactPick(chips({ 25: 2 }), 30), null);
});

test('takeChips breaks a chip only when no exact set exists', () => {
  const pool = chips({ 25: 2 });
  const out = takeChips(pool, 30);
  assert.equal(csum(out), 30);
  assert.equal(csum(pool), 20);
});

test('winning ten 10s keeps ten 10s', () => {
  const p = { stack: 0, chips: Z() }, pool = chips({ 10: 10 });
  giveFromPot(p, 100, pool);
  assert.deepEqual(p.chips, chips({ 10: 10 }));
  assert.equal(p.stack, 100);
  assert.equal(csum(pool), 0);
});

test('paying with pushed chips returns the change from those chips', () => {
  const p = { chips: chips({ 25: 1, 10: 2 }) };
  const out = payChips(p, 10, chips({ 25: 1 }));
  assert.equal(csum(out), 10);
  assert.equal(csum(p.chips), 35); // 45 - 10
});

test('tidy rebuilds 8×25 into the buy-in mix', () => {
  const p = { chips: chips({ 25: 8 }) };
  assert.equal(tidyChips(p), true);
  assert.deepEqual(p.chips, BUY_CHIPS());
  assert.equal(tidyChips(p), false); // already tidy
});

test('fuzz: takeChips always pays the exact amount and conserves value', () => {
  for (let k = 0; k < 2000; k++) {
    const pool = chips({ 1: rnd(12), 5: rnd(8), 10: rnd(8), 25: rnd(8) }), total = csum(pool);
    if (!total) continue;
    const amt = 1 + rnd(total);
    const out = takeChips(pool, amt);
    assert.equal(csum(out), amt);
    assert.equal(csum(pool), total - amt);
    assert.ok(Object.values(pool).every(n => n >= 0));
  }
});
function rnd(n) { return Math.floor(Math.random() * n); }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z, csum, exactPick, takeChips, payChips, giveFromPot, tidyChips, tidied, chipBreakdown, BUY_CHIPS } from '../js/chips.js';

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

test('tidy: 白10 红6 蓝6 first, the rest in 绿25', () => {
  const p = { chips: chips({ 25: 8 }) };
  assert.equal(tidyChips(p), true);
  assert.deepEqual(p.chips, BUY_CHIPS());                                // 200 → the buy-in mix
  assert.equal(tidyChips(p), false);                                     // already tidy
  assert.deepEqual(tidied(chips({ 1: 60 })), chips({ 1: 10, 5: 6, 10: 2 }));           // many whites merge up
  assert.deepEqual(tidied(chips({ 1: 120 })), chips({ 1: 10, 5: 6, 10: 8 }));                // 20 left: two more 10s
  assert.deepEqual(tidied(chips({ 1: 1, 5: 1, 10: 5, 25: 8 })), chips({ 1: 11, 5: 7, 10: 6, 25: 6 })); // 256
  assert.deepEqual(tidied(chips({ 10: 100 })), chips({ 1: 10, 5: 6, 10: 6, 25: 36 }));  // 1000
});

test('fuzz: tidy keeps the total and is stable', () => {
  for (let k = 0; k < 3000; k++) {
    const c = chips({ 1: rnd(60), 5: rnd(20), 10: rnd(20), 25: rnd(20) });
    const t = tidied(c);
    assert.equal(csum(t), csum(c));
    assert.deepEqual(tidied(t), t);
    if (csum(c) >= 100) assert.ok(t[1] >= 10 && t[5] >= 6 && t[10] >= 6, JSON.stringify(t));
  }
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

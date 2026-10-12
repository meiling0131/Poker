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

test('tidy rebuilds 8×25 into the buy-in mix', () => {
  const p = { chips: chips({ 25: 8 }) };
  assert.equal(tidyChips(p), true);
  assert.deepEqual(p.chips, BUY_CHIPS());
  assert.equal(tidyChips(p), false); // already tidy
});

test('tidy never merges small chips into big ones', () => {
  // 60 white chips stay 60; the two 25s are broken into 10s, nothing is merged upward
  assert.deepEqual(tidied(chips({ 1: 60, 25: 2 })), chips({ 1: 60, 10: 5 }));
  const p = { chips: chips({ 1: 60, 10: 5 }) };
  assert.equal(tidyChips(p), false);                          // already tidy: unchanged
});

test('tidy breaks big chips for a short stack too', () => {
  assert.deepEqual(tidied(chips({ 25: 3 })), chips({ 1: 10, 5: 7, 10: 3 })); // 75 → small chips
  assert.deepEqual(tidied(chips({ 10: 1 })), chips({ 1: 10 }));               // 10 → 10 whites
});

test('tidy keeps what is already small and only breaks the surplus', () => {
  // 256 = 8×25 + 5×10 + 1×5 + 1×1: two 25s and some 10s are broken toward 白10 红6 蓝6
  const out = tidied(chips({ 25: 8, 10: 5, 5: 1, 1: 1 }));
  assert.equal(csum(out), 256);
  assert.ok(out[1] >= 1 && out[5] >= 1 && out[10] >= 5);
  assert.ok(out[25] < 8);
});

test('fuzz: tidy conserves value, never merges, and is stable', () => {
  for (let k = 0; k < 3000; k++) {
    const c = chips({ 1: rnd(40), 5: rnd(20), 10: rnd(20), 25: rnd(20) });
    const t = tidied(c);
    assert.equal(csum(t), csum(c));
    for (const d of [5, 10, 25]) {                          // value held in chips ≥ d never goes up
      const big = x => [5, 10, 25].filter(e => e >= d).reduce((a, e) => a + e * x[e], 0);
      assert.ok(big(t) <= big(c), JSON.stringify({ c, t, d }));
    }
    assert.deepEqual(tidied(t), t);                            // a second tap changes nothing
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

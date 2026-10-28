import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BB, SB, buyOf, adoptStake, validStake } from '../js/settings.js';
import { BUY } from '../js/config.js';
import { setS } from '../js/state.js';

test('stakes: a table\'s blinds and minimum buy-in come from its own stakes', () => {
  assert.equal(buyOf({ sb: 1, bb: 2 }), 200);
  assert.equal(buyOf({ sb: 2, bb: 5 }), 500);
  assert.equal(buyOf({ sb: 5, bb: 10 }), 1000);
  assert.equal(buyOf(null), 200);
  for (const [sb, bb, buy] of [[2, 5, 500], [5, 10, 1000], [1, 2, 200]]) {
    setS({ mode: 'bots', stakes: { sb, bb } });
    adoptStake();
    assert.deepEqual([SB, BB, BUY], [sb, bb, buy]);
  }
  setS(null);
});

test('stakes: small blind ≥ 1, big blind above it, at most 100', () => {
  assert.equal(validStake(1, 2), true);
  assert.equal(validStake(5, 10), true);
  assert.equal(validStake(0, 2), false);
  assert.equal(validStake(2, 2), false);
  assert.equal(validStake(1, 101), false);
  assert.equal(validStake(1.5, 3), false);
});

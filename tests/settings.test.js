import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validStake } from '../js/settings.js';

test('stakes: small blind ≥ 1, big blind above it, at most 100', () => {
  assert.equal(validStake(1, 2), true);
  assert.equal(validStake(5, 10), true);
  assert.equal(validStake(0, 2), false);
  assert.equal(validStake(2, 2), false);
  assert.equal(validStake(1, 101), false);
  assert.equal(validStake(1.5, 3), false);
});

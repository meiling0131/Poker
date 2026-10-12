import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPots } from '../js/pots.js';

const seat = (total, folded = false) => ({ total, inHand: true, folded });

test('one pot when everyone put in the same', () => {
  assert.deepEqual(buildPots([seat(50), seat(50), seat(50)]), [{ amount: 150, elig: [0, 1, 2] }]);
});

test('short all-in creates a side pot', () => {
  // A all-in 20, B and C 100 each
  assert.deepEqual(buildPots([seat(20), seat(100), seat(100)]), [
    { amount: 60, elig: [0, 1, 2] },
    { amount: 160, elig: [1, 2] },
  ]);
});

test('folded money stays in, folded seat is not eligible', () => {
  assert.deepEqual(buildPots([seat(30, true), seat(50), seat(50)]), [{ amount: 130, elig: [1, 2] }]);
});

test('uncalled excess becomes its own single-player pot', () => {
  const pots = buildPots([seat(40), seat(100)]);
  assert.deepEqual(pots, [{ amount: 80, elig: [0, 1] }, { amount: 60, elig: [1] }]);
});

test('value is conserved', () => {
  const seats = [seat(7), seat(250), seat(90, true), seat(250), seat(33)];
  const sum = buildPots(seats).reduce((a, p) => a + p.amount, 0);
  assert.equal(sum, seats.reduce((a, s) => a + s.total, 0));
});

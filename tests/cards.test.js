import { test } from 'node:test';
import assert from 'node:assert/strict';
import { best7, handName, describe, rankOf, suitOf, shuffledDeck, cardTxt } from '../js/cards.js';
import { cards, card } from './helpers.js';

const score = s => best7(cards(s));

test('card encoding', () => {
  assert.equal(rankOf(card('As')), 14);
  assert.equal(suitOf(card('Kh')), 1);
  assert.equal(cardTxt(card('Td')), '10♦');
});

test('hand categories rank in order', () => {
  const ladder = [
    'As Kd 9h 7c 4s 3d 2c', // high card
    'As Ad 9h 7c 4s 3d 2c', // pair
    'As Ad 9h 9c 4s 3d 2c', // two pair
    'As Ad Ah 9c 4s 3d 2c', // trips
    '9s Td Jh Qc Ks 3d 2c', // straight
    'As Ks 9s 7s 4s 3d 2c', // flush
    'As Ad Ah 9c 9s 3d 2c', // full house
    'As Ad Ah Ac 9s 3d 2c', // quads
    '9s Ts Js Qs Ks 3d 2c', // straight flush
  ];
  for (let i = 1; i < ladder.length; i++) assert.ok(score(ladder[i]) > score(ladder[i - 1]), ladder[i]);
});

test('names', () => {
  assert.equal(handName(score('As Ks Qs Js Ts 3d 2c')), '皇家同花顺');
  assert.equal(handName(score('As Ad Ah 9c 9s 3d 2c')), '葫芦 A带9');
  assert.equal(handName(score('As 2d 3h 4c 5s 9d Jc')), '顺子 到5'); // the wheel
});

test('wheel loses to a six-high straight', () => {
  assert.ok(score('2s 3d 4h 5c 6s Kd Jc') > score('As 2d 3h 4c 5s Kd Jc'));
});

test('kickers decide equal pairs; the board can play', () => {
  assert.ok(score('As Ad Kh 9c 4s 3d 2c') > score('As Ad Qh 9c 4s 3d 2c'));
  assert.equal(score('2h 3h As Ks Qs Js Ts'), score('4c 5c As Ks Qs Js Ts'));
});

test('preflop description', () => {
  assert.equal(describe(cards('As Ks'), []), 'AK 同花');
  assert.equal(describe(cards('9h 9c'), []), '一对 9');
});

test('shuffled deck is a permutation of 52', () => {
  const d = shuffledDeck();
  assert.equal(d.length, 52);
  assert.deepEqual([...d].sort((a, b) => a - b), [...Array(52).keys()]);
});

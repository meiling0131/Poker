import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stamped } from '../tools/stamp.js';

test('index.html import map matches the current modules (run `node tools/stamp.js`)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(stamped(html), html);
});

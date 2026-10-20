import assert from 'node:assert/strict';
import { test } from 'node:test';
import { average, median } from '../src/stats.ts';

test('average of a few values', () => {
  assert.equal(average([2, 4, 9]), 5);
});

test('median of an odd number of values', () => {
  assert.equal(median([3, 1, 2]), 2);
});

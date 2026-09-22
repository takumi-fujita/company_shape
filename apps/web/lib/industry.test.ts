import assert from 'node:assert/strict';
import { test } from 'vitest';
import { hasIndustry, UNKNOWN_INDUSTRY } from './industry';

test('分類なしは業種として扱わない', () => {
  assert.equal(hasIndustry(UNKNOWN_INDUSTRY), false);
  assert.equal(hasIndustry('unknown'), false);
});

test('実在の業種コードは通す', () => {
  assert.equal(hasIndustry('5250'), true);
  assert.equal(hasIndustry('0050'), true);
});

test('欠損は業種なしとして扱う', () => {
  assert.equal(hasIndustry(null), false);
  assert.equal(hasIndustry(undefined), false);
  assert.equal(hasIndustry(''), false);
});

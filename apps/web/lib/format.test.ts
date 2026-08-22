import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EM_DASH, count, months, normalize, num, salary, signed, signedPercent, tenure } from './format';

test('欠損は必ず「—」になり、単位を付けない', () => {
  assert.equal(num(null), EM_DASH);
  assert.equal(salary(null), EM_DASH);
  assert.equal(tenure(null), EM_DASH);
  assert.equal(months(null), EM_DASH);
  assert.equal(num(NaN), EM_DASH);
});

test('数字と単位の間は半角スペース', () => {
  assert.equal(count(12), '12 件');
  assert.equal(salary(6480), '6,480 千円');
  assert.equal(tenure(5.8), '5.8 年');
  assert.equal(months(4.8), '4.8 ヶ月');
});

test('符号付きはマイナスに U+2212 を使う', () => {
  assert.equal(signed(3.21), '+3.2');
  assert.equal(signed(-3.21), '−3.2');
  assert.equal(signedPercent(-12.34), '−12.3%');
});

test('検索の正規化: 全半角・かな・大小文字を吸収する', () => {
  assert.equal(normalize('ミナト'), normalize('みなと'));
  assert.equal(normalize('ＡＢＣ１２３'), 'abc123');
  assert.equal(normalize('クレイン・テクノロジー'), 'クレインテクノロジー');
});

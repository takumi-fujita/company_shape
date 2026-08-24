import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  isMulti,
  SALARY_OPTIONS,
  selectedValues,
  SIZE_OPTIONS,
  TENURE_OPTIONS,
} from './filters';

test('従業員数の区切りは指定どおり', () => {
  assert.deepEqual(
    SIZE_OPTIONS.map((o) => o.label),
    [
      '〜30 名',
      '31〜50 名',
      '51〜100 名',
      '101〜300 名',
      '301〜500 名',
      '501〜1,000 名',
      '1,001〜3,000 名',
      '3,001 名〜',
    ],
  );
});

test('従業員数の区切りに穴も重なりも無い', () => {
  for (const n of [1, 30, 31, 50, 51, 100, 101, 300, 301, 500, 501, 1000, 1001, 3000, 3001, 99999]) {
    const hits = SIZE_OPTIONS.filter((o) => o.test(n));
    assert.equal(hits.length, 1, `${n} 名が ${hits.length} 個の区分に該当`);
  }
});

test('従業員数が欠損ならどの区分にも入らない', () => {
  assert.equal(SIZE_OPTIONS.filter((o) => o.test(null)).length, 0);
});

test('平均年収は 300 万円から 2,000 万円まで 100 万円刻み', () => {
  assert.equal(SALARY_OPTIONS.length, 18);
  assert.equal(SALARY_OPTIONS[0].label, '300 万円以上');
  assert.equal(SALARY_OPTIONS[17].label, '2,000 万円以上');
});

test('平均年収は千円単位の DB 値で判定する', () => {
  const over600 = SALARY_OPTIONS.find((o) => o.label === '600 万円以上')!;
  assert.equal(over600.test(6000), true); // 600 万円
  assert.equal(over600.test(5999), false);
  assert.equal(over600.test(null), false);
  const over2000 = SALARY_OPTIONS[17];
  assert.equal(over2000.test(20000), true);
  assert.equal(over2000.test(19999), false);
});

test('勤続年数は 3/5/8/10/15/20 年以上', () => {
  assert.deepEqual(
    TENURE_OPTIONS.map((o) => o.label),
    ['3 年以上', '5 年以上', '8 年以上', '10 年以上', '15 年以上', '20 年以上'],
  );
  const over8 = TENURE_OPTIONS[2];
  assert.equal(over8.test(8), true);
  assert.equal(over8.test(7.9), false);
  assert.equal(over8.test(null), false);
});

test('複数選択は業種だけ', () => {
  assert.equal(isMulti('industry'), true);
  for (const k of ['size', 'salary', 'tenure', 'market'] as const) {
    assert.equal(isMulti(k), false, `${k} が複数選択になっている`);
  }
});

test('selectedValues は単一選択も配列で返す', () => {
  assert.deepEqual(selectedValues({}, 'industry'), []);
  assert.deepEqual(selectedValues({ market: 'プライム' }, 'market'), ['プライム']);
  assert.deepEqual(selectedValues({ industry: ['A', 'B'] }, 'industry'), ['A', 'B']);
});

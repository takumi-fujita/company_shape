import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  applyPicksToParams,
  hasAnyPick,
  industryOptions,
  isMulti,
  MARKET_OPTIONS,
  matches,
  parsePicks,
  PICK_KEYS,
  SALARY_OPTIONS,
  selectedValues,
  SIZE_OPTIONS,
  TENURE_OPTIONS,
  type Picks,
} from './filters';
import type { SearchIndexEntry } from './types';

const INDUSTRIES = industryOptions([
  { industryCode: '5250', industryLabel: '情報・通信業', companyCount: 1, medianSalary: null, medianTenure: null },
  { industryCode: '6100', industryLabel: '小売業', companyCount: 1, medianSalary: null, medianTenure: null },
]);

const entry = (o: Partial<SearchIndexEntry> = {}): SearchIndexEntry => ({
  edinetCode: 'E00001', name: 'テスト', nameKana: null, secCode: '1234',
  industryCode: '5250', industryLabel: '情報・通信業', market: 'プライム',
  employees: 200, avgSalary: 6500, avgTenure: 10, runway: 12, ...o,
});

test('従業員数の区切りは指定どおり', () => {
  assert.deepEqual(SIZE_OPTIONS.map((o) => o.label), [
    '〜30 名', '31〜50 名', '51〜100 名', '101〜300 名',
    '301〜500 名', '501〜1,000 名', '1,001〜3,000 名', '3,001 名〜',
  ]);
});

test('従業員数の区切りに穴も重なりも無い', () => {
  for (const n of [1, 30, 31, 50, 51, 100, 101, 300, 301, 500, 501, 1000, 1001, 3000, 3001, 99999]) {
    assert.equal(SIZE_OPTIONS.filter((o) => o.test(n)).length, 1, `${n} 名`);
  }
  assert.equal(SIZE_OPTIONS.filter((o) => o.test(null)).length, 0);
});

test('平均年収は 300〜2,000 万円の 100 万円刻み', () => {
  assert.equal(SALARY_OPTIONS.length, 18);
  assert.equal(SALARY_OPTIONS[0].label, '300 万円以上');
  assert.equal(SALARY_OPTIONS[17].label, '2,000 万円以上');
  const over600 = SALARY_OPTIONS.find((o) => o.id === '600')!;
  assert.equal(over600.test(6000), true);
  assert.equal(over600.test(5999), false);
  assert.equal(over600.test(null), false);
});

test('勤続年数は 3/5/8/10/15/20 年以上', () => {
  assert.deepEqual(TENURE_OPTIONS.map((o) => o.label),
    ['3 年以上', '5 年以上', '8 年以上', '10 年以上', '15 年以上', '20 年以上']);
});

test('複数選択は業種だけ', () => {
  assert.equal(isMulti('industry'), true);
  for (const k of ['size', 'salary', 'tenure', 'market'] as const) assert.equal(isMulti(k), false);
});

// --- URL との往復 -------------------------------------------------------------

test('URL には安定した id が出る（表示ラベルではない）', () => {
  const sp = new URLSearchParams();
  applyPicksToParams(sp, { industry: ['5250', '6100'], size: ['101-300'], salary: ['600'], market: ['prime'] });
  assert.equal(sp.toString(), 'industry=5250%2C6100&size=101-300&salary=600&market=prime');
});

test('URL → picks → URL で元に戻る', () => {
  const original = 'industry=5250%2C6100&size=101-300&salary=600&tenure=5&market=prime';
  const picks = parsePicks(new URLSearchParams(original), INDUSTRIES);
  const sp = new URLSearchParams();
  applyPicksToParams(sp, picks);
  assert.equal(sp.toString(), original);
});

test('知らない id は捨てる（URL は誰でも書き換えられる）', () => {
  const picks = parsePicks(new URLSearchParams('industry=5250,9999&size=でたらめ&market=xxx'), INDUSTRIES);
  assert.deepEqual(picks.industry, ['5250']);
  assert.equal(picks.size, undefined);
  assert.equal(picks.market, undefined);
});

test('単一選択に複数渡されても先頭だけ採る', () => {
  const picks = parsePicks(new URLSearchParams('salary=600,700'), INDUSTRIES);
  assert.deepEqual(picks.salary, ['600']);
});

test('重複した id は畳む', () => {
  const picks = parsePicks(new URLSearchParams('industry=5250,5250,6100'), INDUSTRIES);
  assert.deepEqual(picks.industry, ['5250', '6100']);
});

test('空の picks はパラメータを消す', () => {
  const sp = new URLSearchParams('industry=5250&size=101-300');
  applyPicksToParams(sp, {});
  assert.equal(sp.toString(), '');
});

test('絞り込みが無ければ全件通る', () => {
  assert.equal(matches(entry(), {}), true);
  assert.equal(hasAnyPick({}), false);
});

// --- 絞り込みの判定 -----------------------------------------------------------

test('業種は複数選択の OR', () => {
  const picks: Picks = { industry: ['5250', '6100'] };
  assert.equal(matches(entry({ industryCode: '5250' }), picks), true);
  assert.equal(matches(entry({ industryCode: '6100' }), picks), true);
  assert.equal(matches(entry({ industryCode: '0050' }), picks), false);
});

test('市場は id からラベルに直して突き合わせる', () => {
  assert.equal(matches(entry({ market: 'プライム' }), { market: ['prime'] }), true);
  assert.equal(matches(entry({ market: 'グロース' }), { market: ['prime'] }), false);
});

test('数値レンジは欠損を必ず外す', () => {
  assert.equal(matches(entry({ employees: null }), { size: ['101-300'] }), false);
  assert.equal(matches(entry({ avgSalary: null }), { salary: ['600'] }), false);
  assert.equal(matches(entry({ avgTenure: null }), { tenure: ['5'] }), false);
});

test('複数の条件は AND', () => {
  const picks: Picks = { industry: ['5250'], size: ['101-300'], salary: ['600'] };
  assert.equal(matches(entry(), picks), true);
  assert.equal(matches(entry({ employees: 5000 }), picks), false);
  assert.equal(matches(entry({ avgSalary: 4000 }), picks), false);
});

test('PICK_KEYS と selectedValues の整合', () => {
  const picks: Picks = { industry: ['5250'] };
  for (const k of PICK_KEYS) assert.ok(Array.isArray(selectedValues(picks, k)));
  assert.equal(MARKET_OPTIONS.length, 3);
});

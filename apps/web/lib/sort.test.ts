import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DEFAULT_SORT, parseSort, SORTS, sortEntries, type SortKey } from './sort';
import type { SearchIndexEntry } from './types';

const e = (
  edinetCode: string,
  v: { employees?: number | null; avgSalary?: number | null; avgTenure?: number | null; runway?: number | null },
): SearchIndexEntry => ({
  edinetCode,
  name: edinetCode,
  nameKana: null,
  secCode: null,
  industryCode: 'x',
  industryLabel: 'x',
  market: null,
  employees: v.employees ?? null,
  avgSalary: v.avgSalary ?? null,
  avgTenure: v.avgTenure ?? null,
  runway: v.runway ?? null,
});

const codes = (rows: SearchIndexEntry[]) => rows.map((r) => r.edinetCode);

test('降順と昇順が項目ごとに揃っている', () => {
  const fields = ['emp', 'sal', 'ten', 'run'];
  for (const f of fields) {
    assert.ok(SORTS.some((s) => s.key === f), `${f} の降順が無い`);
    assert.ok(SORTS.some((s) => s.key === `${f}-asc`), `${f} の昇順が無い`);
  }
  assert.equal(SORTS.length, 8);
});

test('従業員数の昇順・降順', () => {
  const rows = [e('a', { employees: 300 }), e('b', { employees: 100 }), e('c', { employees: 200 })];
  assert.deepEqual(codes(sortEntries(rows, 'emp')), ['a', 'c', 'b']);
  assert.deepEqual(codes(sortEntries(rows, 'emp-asc')), ['b', 'c', 'a']);
});

test('平均年収・勤続年数・余力も昇順が効く', () => {
  const rows = [
    e('a', { avgSalary: 900, avgTenure: 9, runway: 90 }),
    e('b', { avgSalary: 300, avgTenure: 3, runway: 30 }),
  ];
  assert.deepEqual(codes(sortEntries(rows, 'sal-asc')), ['b', 'a']);
  assert.deepEqual(codes(sortEntries(rows, 'ten-asc')), ['b', 'a']);
  assert.deepEqual(codes(sortEntries(rows, 'run-asc')), ['b', 'a']);
});

test('値が無い会社は昇順でも最後に置く', () => {
  // 「平均年収が低い順」で欠損を先頭に出すと、記載が無いだけの会社が
  // 最も年収が低い会社として並んでしまう。
  const rows = [e('none', {}), e('low', { avgSalary: 300 }), e('high', { avgSalary: 900 })];
  assert.deepEqual(codes(sortEntries(rows, 'sal-asc')), ['low', 'high', 'none']);
  assert.deepEqual(codes(sortEntries(rows, 'sal')), ['high', 'low', 'none']);
});

test('元の配列を壊さない', () => {
  const rows = [e('a', { employees: 1 }), e('b', { employees: 2 })];
  sortEntries(rows, 'emp');
  assert.deepEqual(codes(rows), ['a', 'b']);
});

test('URL の並び順は既知の id だけ通す', () => {
  assert.equal(parseSort('sal'), 'sal');
  assert.equal(parseSort('sal-asc'), 'sal-asc');
  assert.equal(parseSort('nope'), DEFAULT_SORT);
  assert.equal(parseSort(null), DEFAULT_SORT);
  assert.equal(parseSort('emp-desc' as SortKey), DEFAULT_SORT);
});

test('既存の URL（降順の id）は従来どおり動く', () => {
  for (const k of ['emp', 'sal', 'ten', 'run']) assert.equal(parseSort(k), k);
});

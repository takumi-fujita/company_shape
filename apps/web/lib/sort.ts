/**
 * 一覧の並び替え。
 *
 * 並び順は URL に持つ（?sort=sal）。id は変えないこと。
 * 昇順は既存 id に `-asc` を付けた形にして、これまでの URL を壊さない。
 */
import type { SearchIndexEntry } from './types';

export type SortField = 'emp' | 'sal' | 'ten' | 'run';
export type SortKey = SortField | `${SortField}-asc`;

export const DEFAULT_SORT: SortKey = 'emp';

const VALUE: Record<SortField, (e: SearchIndexEntry) => number | null> = {
  emp: (e) => e.employees,
  sal: (e) => e.avgSalary,
  ten: (e) => e.avgTenure,
  run: (e) => e.runway,
};

/** 表示順。降順と昇順を項目ごとに並べる。 */
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'emp', label: '従業員数が多い順' },
  { key: 'emp-asc', label: '従業員数が少ない順' },
  { key: 'sal', label: '平均年収が高い順' },
  { key: 'sal-asc', label: '平均年収が低い順' },
  { key: 'ten', label: '勤続年数が長い順' },
  { key: 'ten-asc', label: '勤続年数が短い順' },
  { key: 'run', label: '手元資金の余力が長い順' },
  { key: 'run-asc', label: '手元資金の余力が短い順' },
];

const KEYS = new Set<string>(SORTS.map((s) => s.key));

export function parseSort(value: string | null): SortKey {
  return value && KEYS.has(value) ? (value as SortKey) : DEFAULT_SORT;
}

/**
 * 値が無い会社は昇順でも降順でも最後に置く。
 *
 * 「平均年収が低い順」で欠損を先頭に出すと、記載が無いだけの会社が
 * 最も年収が低い会社として並ぶ。数値が取れた会社だけを順に並べ、
 * 取れなかった会社はその後ろにまとめる。
 */
export function compare(sort: SortKey, a: SearchIndexEntry, b: SearchIndexEntry): number {
  const ascending = sort.endsWith('-asc');
  const field = (ascending ? sort.slice(0, -4) : sort) as SortField;
  const av = VALUE[field](a);
  const bv = VALUE[field](b);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return ascending ? av - bv : bv - av;
}

export function sortEntries(entries: SearchIndexEntry[], sort: SortKey): SearchIndexEntry[] {
  return entries.slice().sort((a, b) => compare(sort, a, b));
}

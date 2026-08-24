/**
 * 一覧の絞り込み条件。
 *
 * 条件は URL に持つ。詳細ページから戻ったときに同じ画面へ戻すため、
 * また絞り込んだ結果をそのまま共有できるようにするため。
 *
 * URL には**表示ラベルではなく固定の id** を載せる。ラベルは表記の見直しで
 * 変わりうるが、それで過去の URL が壊れると困る。
 *
 * 静的エクスポートなので `/companies/?industry=...` はすべて同じ 1 枚の HTML を返し、
 * canonical も `/companies/` 固定。パラメータ違いのページが量産されることはない。
 */
import type { IndustryStat, SearchIndexEntry } from './types';

export interface FilterOption {
  /** URL に出る値。変えないこと。 */
  id: string;
  label: string;
}

/** 数値レンジの選択肢。 */
export interface RangeOption extends FilterOption {
  test: (v: number | null) => boolean;
}

const jp = (n: number) => n.toLocaleString('ja-JP');

/** 従業員数の区切り。null は「値なし」なので常に外れる。 */
export const SIZE_BOUNDS = [30, 50, 100, 300, 500, 1000, 3000];
const SIZE_TOP = SIZE_BOUNDS[SIZE_BOUNDS.length - 1];

export const SIZE_OPTIONS: RangeOption[] = [
  ...SIZE_BOUNDS.map((upper, i): RangeOption => {
    const lower = i === 0 ? null : SIZE_BOUNDS[i - 1] + 1;
    return {
      id: lower == null ? `-${upper}` : `${lower}-${upper}`,
      label: lower == null ? `〜${jp(upper)} 名` : `${jp(lower)}〜${jp(upper)} 名`,
      test: (v) => v != null && (lower == null || v >= lower) && v <= upper,
    };
  }),
  {
    id: `${SIZE_TOP + 1}-`,
    label: `${jp(SIZE_TOP + 1)} 名〜`,
    test: (v) => v != null && v > SIZE_TOP,
  },
];

/** 平均年収は 300 万円から 100 万円刻み。DB は千円単位なので 300 万円 = 3,000。 */
export const SALARY_OPTIONS: RangeOption[] = Array.from({ length: 18 }, (_, i): RangeOption => {
  const man = 300 + i * 100;
  return {
    id: String(man),
    label: `${jp(man)} 万円以上`,
    test: (v) => v != null && v >= man * 10,
  };
});

export const TENURE_OPTIONS: RangeOption[] = [3, 5, 8, 10, 15, 20].map(
  (years): RangeOption => ({
    id: String(years),
    label: `${years} 年以上`,
    test: (v) => v != null && v >= years,
  }),
);

/** 市場区分。id は URL 用の英字、label は表示とデータの突き合わせ用。 */
export const MARKET_OPTIONS: FilterOption[] = [
  { id: 'prime', label: 'プライム' },
  { id: 'standard', label: 'スタンダード' },
  { id: 'growth', label: 'グロース' },
];

export type PickKey = 'industry' | 'size' | 'salary' | 'tenure' | 'market';
export const PICK_KEYS: PickKey[] = ['industry', 'size', 'salary', 'tenure', 'market'];

/** 業種のみ複数選択。ほかは単一選択。 */
export const MULTI_KEYS: PickKey[] = ['industry'];
export const isMulti = (key: PickKey) => MULTI_KEYS.includes(key);

/** 選んだ id の集合。単一選択でも配列で持ち、扱いを揃える。 */
export type Picks = Partial<Record<PickKey, string[]>>;

export function selectedValues(picks: Picks, key: PickKey): string[] {
  return picks[key] ?? [];
}

export function hasAnyPick(picks: Picks): boolean {
  return PICK_KEYS.some((k) => selectedValues(picks, k).length > 0);
}

/** 業種の選択肢はデータから作る。id は業種コード（/industry/[code] と同じ）。 */
export function industryOptions(stats: IndustryStat[]): FilterOption[] {
  return stats
    .map((s) => ({ id: s.industryCode, label: s.industryLabel }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}

// --- URL との変換 -------------------------------------------------------------

/** 複数選択はカンマ区切り。`?industry=5250,6100` */
const SEP = ',';

export function parsePicks(
  params: { get(key: string): string | null },
  industries: FilterOption[],
): Picks {
  const valid: Record<PickKey, Set<string>> = {
    industry: new Set(industries.map((o) => o.id)),
    size: new Set(SIZE_OPTIONS.map((o) => o.id)),
    salary: new Set(SALARY_OPTIONS.map((o) => o.id)),
    tenure: new Set(TENURE_OPTIONS.map((o) => o.id)),
    market: new Set(MARKET_OPTIONS.map((o) => o.id)),
  };

  const picks: Picks = {};
  for (const key of PICK_KEYS) {
    const raw = params.get(key);
    if (!raw) continue;
    // 知らない id は捨てる。URL は誰でも書き換えられる。
    const ids = raw
      .split(SEP)
      .map((s) => s.trim())
      .filter((s) => valid[key].has(s));
    const unique = [...new Set(ids)];
    if (unique.length) picks[key] = isMulti(key) ? unique : [unique[0]];
  }
  return picks;
}

export function applyPicksToParams(sp: URLSearchParams, picks: Picks): void {
  for (const key of PICK_KEYS) {
    const ids = selectedValues(picks, key);
    if (ids.length) sp.set(key, ids.join(SEP));
    else sp.delete(key);
  }
}

// --- 絞り込み -----------------------------------------------------------------

export function matches(entry: SearchIndexEntry, picks: Picks): boolean {
  const industries = selectedValues(picks, 'industry');
  if (industries.length && !industries.includes(entry.industryCode)) return false;

  const market = selectedValues(picks, 'market')[0];
  if (market) {
    const label = MARKET_OPTIONS.find((o) => o.id === market)?.label;
    if (entry.market !== label) return false;
  }

  const ranges: [PickKey, RangeOption[], number | null][] = [
    ['size', SIZE_OPTIONS, entry.employees],
    ['salary', SALARY_OPTIONS, entry.avgSalary],
    ['tenure', TENURE_OPTIONS, entry.avgTenure],
  ];
  for (const [key, options, value] of ranges) {
    const id = selectedValues(picks, key)[0];
    if (!id) continue;
    const option = options.find((o) => o.id === id);
    if (option && !option.test(value)) return false;
  }
  return true;
}

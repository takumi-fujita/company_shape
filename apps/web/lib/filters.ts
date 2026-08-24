/**
 * 数値レンジのフィルタ。業種・市場はデータから生成する（33 業種でも増やさないため）。
 * 選択肢は多いので、ポップオーバーは高さを固定してスクロールさせる。
 */
export interface RangeOption {
  label: string;
  test: (v: number | null) => boolean;
}

/** 従業員数の区切り。null は「値なし」なので常に外れる。 */
export const SIZE_BOUNDS = [30, 50, 100, 300, 500, 1000, 3000];
const SIZE_TOP = SIZE_BOUNDS[SIZE_BOUNDS.length - 1];
const jp = (n: number) => n.toLocaleString('ja-JP');

export const SIZE_OPTIONS: RangeOption[] = [
  ...SIZE_BOUNDS.map((upper, i): RangeOption => {
    const lower = i === 0 ? null : SIZE_BOUNDS[i - 1] + 1;
    return {
      label: lower == null ? `〜${jp(upper)} 名` : `${jp(lower)}〜${jp(upper)} 名`,
      test: (v: number | null) =>
        v != null && (lower == null || v >= lower) && v <= upper,
    };
  }),
  {
    label: `${jp(SIZE_TOP + 1)} 名〜`,
    test: (v: number | null) => v != null && v > SIZE_TOP,
  },
];

/** 平均年収は 300 万円から 100 万円刻み。DB は千円単位なので 300 万円 = 3,000。 */
export const SALARY_OPTIONS: RangeOption[] = Array.from({ length: 18 }, (_, i): RangeOption => {
  const man = 300 + i * 100;
  return {
    label: `${jp(man)} 万円以上`,
    test: (v: number | null) => v != null && v >= man * 10,
  };
});

export const TENURE_OPTIONS: RangeOption[] = [3, 5, 8, 10, 15, 20].map((years): RangeOption => ({
  label: `${years} 年以上`,
  test: (v: number | null) => v != null && v >= years,
}));

export type PickKey = 'industry' | 'size' | 'salary' | 'tenure' | 'market';

/** 業種のみ複数選択。ほかは単一選択。 */
export const MULTI_KEYS: PickKey[] = ['industry'];
export const isMulti = (key: PickKey) => MULTI_KEYS.includes(key);

/** 単一選択は文字列、複数選択は文字列の配列。 */
export type Picks = Partial<Record<PickKey, string | string[]>>;


export function selectedValues(picks: Picks, key: PickKey): string[] {
  const v = picks[key];
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

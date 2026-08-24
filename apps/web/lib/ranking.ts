/**
 * ランキングページの指標定義。
 * 並べ替えの軸を提示するだけで、順位が高い＝良いという評価は与えない。
 *
 * 「手元資金の余力」は当サイトの言い換えで、その語で検索されることがない。
 * 同じ業種の 4 ページが並び順しか違わない状態を招くだけなので指標から外した
 * （値そのものは一覧と詳細ページに出ている）。
 */
import { num, unit } from './format';
import type { SearchIndexEntry } from './types';

export const METRICS = {
  salary: {
    slug: 'salary',
    heading: '平均年収が高い順',
    label: '平均年収',
    value: (e: SearchIndexEntry) => e.avgSalary,
    format: (v: number) => unit(v, '千円'),
    source: '有価証券報告書の「従業員の状況」に記載された、提出会社の平均年間給与です。賞与と基準外賃金を含み、連結子会社の従業員は含みません。',
  },
  tenure: {
    slug: 'tenure',
    heading: '平均勤続年数が長い順',
    label: '平均勤続年数',
    value: (e: SearchIndexEntry) => e.avgTenure,
    format: (v: number) => unit(v, '年', 1),
    source: '有価証券報告書の「従業員の状況」に記載された、提出会社の平均勤続年数です。中途採用が多い会社では短く出ます。',
  },
  employees: {
    slug: 'employees',
    heading: '従業員数が多い順',
    label: '従業員数',
    value: (e: SearchIndexEntry) => e.employees,
    format: (v: number) => unit(v, '名'),
    source: '有価証券報告書に記載された連結の従業員数です。臨時雇用者は含みません。',
  },
} as const;

export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

/** ランキングの slug は `{industryCode}-{metric}`。業種コードにハイフンは使わない。 */
export function parseRankingSlug(slug: string): { industryCode: string; metric: MetricKey } | null {
  const i = slug.lastIndexOf('-');
  if (i <= 0) return null;
  const industryCode = slug.slice(0, i);
  const metric = slug.slice(i + 1) as MetricKey;
  if (!METRIC_KEYS.includes(metric)) return null;
  return { industryCode, metric };
}

export function rankingSlug(industryCode: string, metric: MetricKey): string {
  return `${industryCode}-${metric}`;
}

/** null は常に最下位。 */
export function sortByMetric(entries: SearchIndexEntry[], metric: MetricKey): SearchIndexEntry[] {
  const get = METRICS[metric].value;
  return entries.slice().sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x;
  });
}


/** 指標ごとの内訳。ランキングページの本文を業種・指標で変えるために使う。 */
export interface MetricSummary {
  /** 値が取れている会社数 */
  counted: number;
  /** 全体の会社数 */
  total: number;
  median: string;
  top: { name: string; value: string }[];
}

export function summarize(
  entries: SearchIndexEntry[],
  metric: MetricKey,
  topCount = 3,
): MetricSummary {
  const get = METRICS[metric].value;
  const fmt = METRICS[metric].format;
  const withValue = entries
    .map((e) => ({ e, v: get(e) }))
    .filter((x): x is { e: SearchIndexEntry; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v);

  const median =
    withValue.length === 0
      ? '—'
      : fmt(
          withValue.length % 2
            ? withValue[(withValue.length - 1) / 2].v
            : (withValue[withValue.length / 2 - 1].v + withValue[withValue.length / 2].v) / 2,
        );

  return {
    counted: withValue.length,
    total: entries.length,
    median,
    top: withValue.slice(0, topCount).map((x) => ({ name: x.e.name, value: fmt(x.v) })),
  };
}

/** ランキングとして成立する最小の社数。これ未満は noindex にする。 */
export const MIN_RANKED = 10;

export { num };

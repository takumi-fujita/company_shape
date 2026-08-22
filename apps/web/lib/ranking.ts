/**
 * ランキングページの指標定義。33 業種 × 4 指標 = 132 ページ。
 * 並べ替えの軸を提示するだけで、順位が高い＝良いという評価は与えない。
 */
import type { SearchIndexEntry } from './types';

export const METRICS = {
  salary: {
    slug: 'salary',
    heading: '平均年収が高い順',
    label: '平均年収',
    value: (e: SearchIndexEntry) => e.avgSalary,
  },
  tenure: {
    slug: 'tenure',
    heading: '平均勤続年数が長い順',
    label: '平均勤続年数',
    value: (e: SearchIndexEntry) => e.avgTenure,
  },
  employees: {
    slug: 'employees',
    heading: '従業員数が多い順',
    label: '従業員数',
    value: (e: SearchIndexEntry) => e.employees,
  },
  runway: {
    slug: 'runway',
    heading: '手元資金の余力が長い順',
    label: '手元資金の余力',
    value: (e: SearchIndexEntry) => e.runway,
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

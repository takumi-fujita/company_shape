'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import CompanyTable from './CompanyTable';
import styles from './CompanyBrowser.module.css';
import { count, normalize, num } from '@/lib/format';
import { PAGE_SIZE } from '@/lib/thresholds';
import type { IndustryStat, SearchIndexEntry } from '@/lib/types';

type SortKey = 'emp' | 'sal' | 'ten' | 'run';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'emp', label: '従業員数が多い順' },
  { key: 'sal', label: '平均年収が高い順' },
  { key: 'ten', label: '勤続年数が長い順' },
  { key: 'run', label: '手元資金の余力が長い順' },
];

/** 数値レンジのフィルタ。業種・市場はデータから生成する（33 業種でも増やさないため）。 */
const SIZE_OPTIONS = [
  { label: '〜300 名', test: (v: number | null) => v != null && v < 300 },
  { label: '300〜1,000 名', test: (v: number | null) => v != null && v >= 300 && v < 1000 },
  { label: '1,000 名〜', test: (v: number | null) => v != null && v >= 1000 },
];
const SALARY_OPTIONS = [
  { label: '600 万円以上', test: (v: number | null) => v != null && v >= 6000 },
  { label: '700 万円以上', test: (v: number | null) => v != null && v >= 7000 },
];
const TENURE_OPTIONS = [
  { label: '5 年以上', test: (v: number | null) => v != null && v >= 5 },
  { label: '8 年以上', test: (v: number | null) => v != null && v >= 8 },
];

type PickKey = 'industry' | 'size' | 'salary' | 'tenure' | 'market';
type Picks = Partial<Record<PickKey, string>>;

/** null は常に最下位。降順ソート。 */
function desc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

interface Props {
  industryStats: IndustryStat[];
}

export default function CompanyBrowser({ industryStats }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get('q') ?? '';

  const [entries, setEntries] = useState<SearchIndexEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<SortKey>('emp');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [picks, setPicks] = useState<Picks>({});
  const [openFilter, setOpenFilter] = useState<PickKey | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/search-index.json')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<SearchIndexEntry[]>;
      })
      .then((d) => alive && setEntries(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // 検索語が変わったら表示件数を戻す。
  useEffect(() => setShown(PAGE_SIZE), [query]);

  const medianByIndustry = useMemo(() => {
    const m = new Map<string, IndustryStat>();
    industryStats.forEach((s) => m.set(s.industryCode, s));
    return m;
  }, [industryStats]);

  const industries = useMemo(
    () => industryStats.map((s) => s.industryLabel).sort((a, b) => a.localeCompare(b, 'ja')),
    [industryStats],
  );

  const markets = useMemo(() => {
    const set = new Set<string>();
    entries?.forEach((e) => e.market && set.add(e.market));
    return ['プライム', 'スタンダード', 'グロース'].filter((m) => set.has(m));
  }, [entries]);

  const groups = useMemo(
    () => [
      { key: 'industry' as const, label: '業種', options: industries },
      { key: 'size' as const, label: '従業員数', options: SIZE_OPTIONS.map((o) => o.label) },
      { key: 'salary' as const, label: '平均年収', options: SALARY_OPTIONS.map((o) => o.label) },
      { key: 'tenure' as const, label: '勤続年数', options: TENURE_OPTIONS.map((o) => o.label) },
      { key: 'market' as const, label: '市場', options: markets },
    ],
    [industries, markets],
  );

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = normalize(query.trim());
    return entries.filter((e) => {
      if (picks.industry && e.industryLabel !== picks.industry) return false;
      if (picks.market && e.market !== picks.market) return false;
      const size = SIZE_OPTIONS.find((o) => o.label === picks.size);
      if (size && !size.test(e.employees)) return false;
      const sal = SALARY_OPTIONS.find((o) => o.label === picks.salary);
      if (sal && !sal.test(e.avgSalary)) return false;
      const ten = TENURE_OPTIONS.find((o) => o.label === picks.tenure);
      if (ten && !ten.test(e.avgTenure)) return false;
      if (q) {
        const hit =
          normalize(e.name).includes(q) ||
          (e.nameKana ? normalize(e.nameKana).includes(q) : false) ||
          e.secCode === query.trim();
        if (!hit) return false;
      }
      return true;
    });
  }, [entries, picks, query]);

  const sorted = useMemo(() => {
    const key = {
      emp: (e: SearchIndexEntry) => e.employees,
      sal: (e: SearchIndexEntry) => e.avgSalary,
      ten: (e: SearchIndexEntry) => e.avgTenure,
      run: (e: SearchIndexEntry) => e.runway,
    }[sort];
    return filtered.slice().sort((a, b) => desc(key(a), key(b)));
  }, [filtered, sort]);

  const visible = sorted.slice(0, shown);

  function pick(key: PickKey, value: string) {
    setPicks((p) => ({ ...p, [key]: value }));
    setOpenFilter(null);
    setShown(PAGE_SIZE);
  }

  function toggle(key: PickKey) {
    if (picks[key]) {
      setPicks((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      setOpenFilter(null);
      setShown(PAGE_SIZE);
    } else {
      setOpenFilter((o) => (o === key ? null : key));
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <h1 className={styles.h1}>会社をさがす</h1>
        <p className={styles.lead}>
          従業員数・平均年収・勤続年数・手元資金の余力を、有価証券報告書からそのまま並べています。会計の知識はいりません。
        </p>
      </div>

      <div className={styles.filters}>
        {groups.map((g) => {
          const active = picks[g.key];
          return (
            <div key={g.key} className={styles.chipWrap}>
              <button
                type="button"
                className={`${styles.chip}${active ? ` ${styles.chipActive}` : ''}`}
                aria-expanded={openFilter === g.key}
                onClick={() => toggle(g.key)}
              >
                {active ?? g.label}
                <span className={styles.marker}>{active ? '×' : '⌄'}</span>
              </button>
              {openFilter === g.key && (
                <div className={styles.popover}>
                  {g.options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      className={`${styles.option}${active === o ? ` ${styles.optionActive}` : ''}`}
                      onClick={() => pick(g.key, o)}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {(Object.keys(picks).length > 0 || query) && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              setPicks({});
              setOpenFilter(null);
              setShown(PAGE_SIZE);
              if (query) router.push('/companies/');
            }}
          >
            条件をすべて外す
          </button>
        )}
      </div>

      <div className={styles.toolbar}>
        <span className={styles.counts}>
          表示件数: <span className={styles.countNum}>{num(visible.length)}</span> 件 / 該当{' '}
          <span className={styles.countNum}>{num(filtered.length)}</span> 件
        </span>
        <label className={styles.sortLabel}>
          並び順
          <select
            className={styles.select}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        <div className={styles.empty}>
          データを取得できませんでした。時間をおいて再度お試しください。
        </div>
      ) : entries === null ? (
        <div className={styles.empty}>読み込み中...</div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>条件に当てはまる会社は {count(0)} でした。</div>
      ) : (
        <>
          <CompanyTable entries={visible} statsByIndustry={medianByIndustry} />

          {sorted.length > shown && (
            <div className={styles.moreWrap}>
              <button
                type="button"
                className={styles.more}
                onClick={() => setShown((s) => s + PAGE_SIZE)}
              >
                さらに表示
              </button>
            </div>
          )}
        </>
      )}

      <p className={styles.note}>数値は有価証券報告書からの機械抽出です。評価・解釈は含みません。</p>
    </main>
  );
}

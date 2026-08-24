'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import CompanyTable from './CompanyTable';
import styles from './CompanyBrowser.module.css';
import { count, normalize, num } from '@/lib/format';
import {
  isMulti,
  SALARY_OPTIONS,
  selectedValues,
  SIZE_OPTIONS,
  TENURE_OPTIONS,
  type PickKey,
  type Picks,
} from '@/lib/filters';
import {
  buildPageItems,
  clampPage,
  PAGE_SIZE_OPTIONS,
  pageRange,
  parsePageSize,
  totalPages,
} from '@/lib/pagination';
import type { IndustryStat, SearchIndexEntry } from '@/lib/types';

type SortKey = 'emp' | 'sal' | 'ten' | 'run';

const SORT_KEYS: SortKey[] = ['emp', 'sal', 'ten', 'run'];
const DEFAULT_SORT: SortKey = 'emp';

function parseSort(value: string | null): SortKey {
  return SORT_KEYS.includes(value as SortKey) ? (value as SortKey) : DEFAULT_SORT;
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'emp', label: '従業員数が多い順' },
  { key: 'sal', label: '平均年収が高い順' },
  { key: 'ten', label: '勤続年数が長い順' },
  { key: 'run', label: '手元資金の余力が長い順' },
];


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
  const perPage = parsePageSize(params.get('per'));
  // 並び順も URL に持つ。ページ番号だけ URL にあると、共有した URL や
  // ブラウザバックで「別の並びの N ページ目」が開いてしまう。
  const sort = parseSort(params.get('sort'));

  const [entries, setEntries] = useState<SearchIndexEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picks, setPicks] = useState<Picks>({});
  const [openFilter, setOpenFilter] = useState<PickKey | null>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  // ポップオーバーの外側をクリックしたら閉じる。Esc でも閉じる。
  useEffect(() => {
    if (openFilter === null) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!filtersRef.current?.contains(e.target as Node)) setOpenFilter(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFilter(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openFilter]);

  /**
   * 検索語・ページ・件数は URL に持つ。詳細ページからブラウザバックで戻ったときに
   * 同じ画面へ戻せるようにするため（ハンドオフ「一覧の検索条件は保持」）。
   * ページ送りで履歴が積み上がらないよう replace で入れ替える。
   */
  function updateUrl(next: { q?: string; page?: number; per?: number; sort?: SortKey }) {
    const sp = new URLSearchParams(params.toString());
    const set = (key: string, value: string | undefined) => {
      if (value) sp.set(key, value);
      else sp.delete(key);
    };
    if ('q' in next) set('q', next.q?.trim() || undefined);
    if ('per' in next) set('per', next.per === undefined ? undefined : String(next.per));
    if ('sort' in next) set('sort', next.sort && next.sort !== DEFAULT_SORT ? next.sort : undefined);
    if ('page' in next) set('page', !next.page || next.page === 1 ? undefined : String(next.page));
    const qs = sp.toString();
    router.replace(qs ? `/companies/?${qs}` : '/companies/', { scroll: false });
  }

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
    const industries_ = selectedValues(picks, 'industry');
    const market = selectedValues(picks, 'market')[0];
    const size = SIZE_OPTIONS.find((o) => o.label === selectedValues(picks, 'size')[0]);
    const sal = SALARY_OPTIONS.find((o) => o.label === selectedValues(picks, 'salary')[0]);
    const ten = TENURE_OPTIONS.find((o) => o.label === selectedValues(picks, 'tenure')[0]);

    return entries.filter((e) => {
      // 業種は複数選択。1 つでも一致すれば通す。
      if (industries_.length && !industries_.includes(e.industryLabel)) return false;
      if (market && e.market !== market) return false;
      if (size && !size.test(e.employees)) return false;
      if (sal && !sal.test(e.avgSalary)) return false;
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

  const pageCount = totalPages(sorted.length, perPage);
  // URL のページ番号は信用しない。件数やフィルタが変われば範囲外になる。
  const page = clampPage(params.get('page'), pageCount);
  const visible = sorted.slice((page - 1) * perPage, page * perPage);
  const span = pageRange(page, perPage, sorted.length);
  const pageItems = buildPageItems(page, pageCount);

  function goToPage(next: number) {
    updateUrl({ page: clampPage(next, pageCount) });
  }

  function pick(key: PickKey, value: string) {
    setPicks((p) => {
      const next = { ...p };
      if (isMulti(key)) {
        // 複数選択は付け外し。ポップオーバーは開いたままにして続けて選べるようにする。
        const current = selectedValues(p, key);
        const updated = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        if (updated.length) next[key] = updated;
        else delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    if (!isMulti(key)) setOpenFilter(null);
    // 絞り込みが変われば件数が変わるので、先頭ページへ戻す。
    updateUrl({ page: 1 });
  }

  /** チップ本体のクリック。開閉だけを行う（解除は × から）。 */
  function toggle(key: PickKey) {
    setOpenFilter((o) => (o === key ? null : key));
  }

  /** チップの × のクリック。その条件だけ外す。 */
  function clearPick(key: PickKey) {
    setPicks((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
    setOpenFilter(null);
    updateUrl({ page: 1 });
  }

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <h1 className={styles.h1}>会社をさがす</h1>
        <p className={styles.lead}>
          従業員数・平均年収・勤続年数・手元資金の余力を、有価証券報告書からそのまま並べています。会計の知識はいりません。
        </p>
      </div>

      <div className={styles.filters} ref={filtersRef}>
        {groups.map((g) => {
          const chosen = selectedValues(picks, g.key);
          const active = chosen.length > 0;
          // 複数選択のチップは「ソフトウェア開発 他2件」のように畳む。
          const label = !active
            ? g.label
            : chosen.length === 1
              ? chosen[0]
              : `${chosen[0]} 他${chosen.length - 1}件`;
          return (
            <div key={g.key} className={styles.chipWrap}>
              <button
                type="button"
                className={`${styles.chip}${active ? ` ${styles.chipActive}` : ''}`}
                aria-expanded={openFilter === g.key}
                onClick={() => toggle(g.key)}
              >
                {label}
                <span
                  className={styles.marker}
                  role={active ? 'button' : undefined}
                  aria-label={active ? `${g.label}の条件を外す` : undefined}
                  onClick={
                    active
                      ? (e) => {
                          // チップ本体の開閉に伝播させない。
                          e.stopPropagation();
                          clearPick(g.key);
                        }
                      : undefined
                  }
                >
                  {active ? '×' : '⌄'}
                </span>
              </button>
              {openFilter === g.key && (
                <div className={styles.popover}>
                  {g.options.map((o) => {
                    const on = chosen.includes(o);
                    return (
                      <button
                        key={o}
                        type="button"
                        className={`${styles.option}${on ? ` ${styles.optionActive}` : ''}`}
                        aria-pressed={isMulti(g.key) ? on : undefined}
                        onClick={() => pick(g.key, o)}
                      >
                        {isMulti(g.key) && (
                          <span className={styles.check} aria-hidden="true">
                            {on ? '✓' : ''}
                          </span>
                        )}
                        {o}
                      </button>
                    );
                  })}
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
              updateUrl({ q: undefined, page: 1 });
            }}
          >
            条件をすべて外す
          </button>
        )}
      </div>

      <div className={styles.toolbar}>
        <span className={styles.counts}>
          該当 <span className={styles.countNum}>{num(sorted.length)}</span> 件中{' '}
          <span className={styles.countNum}>{num(span.from)}</span>〜
          <span className={styles.countNum}>{num(span.to)}</span> 件
        </span>
        <span className={styles.toolbarControls}>
          <label className={styles.sortLabel}>
            表示件数
            <select
              className={styles.select}
              value={perPage}
              onChange={(e) => updateUrl({ per: Number(e.target.value), page: 1 })}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} 件
                </option>
              ))}
            </select>
          </label>
          <label className={styles.sortLabel}>
            並び順
            <select
              className={styles.select}
              value={sort}
              onChange={(e) => updateUrl({ sort: e.target.value as SortKey, page: 1 })}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </span>
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

          {pageCount > 1 && (
            <nav className={styles.pagination} aria-label="ページ送り">
              <button
                type="button"
                className={styles.pageNav}
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                aria-label="前のページ"
              >
                ‹
              </button>
              {pageItems.map((item, i) =>
                item === 'ellipsis' ? (
                  <span key={`e${i}`} className={styles.pageGap} aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`${styles.pageNum}${item === page ? ` ${styles.pageCurrent}` : ''}`}
                    onClick={() => goToPage(item)}
                    aria-label={`${item} ページ目`}
                    aria-current={item === page ? 'page' : undefined}
                  >
                    {num(item)}
                  </button>
                ),
              )}
              <button
                type="button"
                className={styles.pageNav}
                onClick={() => goToPage(page + 1)}
                disabled={page === pageCount}
                aria-label="次のページ"
              >
                ›
              </button>
            </nav>
          )}
        </>
      )}

      <p className={styles.note}>数値は有価証券報告書からの機械抽出です。評価・解釈は含みません。</p>
    </main>
  );
}

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import CompanyTable from './CompanyTable';
import { useBrowseNav } from './browse-nav';
import styles from './CompanyBrowser.module.css';
import { count, normalize, num } from '@/lib/format';
import {
  applyPicksToParams,
  hasAnyPick,
  industryOptions,
  isMulti,
  MARKET_OPTIONS,
  matches,
  parsePicks,
  SALARY_OPTIONS,
  selectedValues,
  SIZE_OPTIONS,
  TENURE_OPTIONS,
  type FilterOption,
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

const LIST_PATH = '/companies';

/**
 * 一覧にいるあいだの検索パラメータを覚えておく。
 *
 * 詳細をドロワーで重ねているあいだ URL は /company/[code]/ になり、
 * 絞り込みのパラメータは URL から消える。そのまま読むと背後の一覧の条件が
 * 外れてしまうので、一覧を離れたら最後の値を持ち続ける。
 *
 * 詳細の URL に条件を引きずらせる手もあるが、それだと 4,290 本の正規 URL に
 * クエリ付きの別 URL が生えることになる。URL は今までどおり素のままにする。
 */
function useListParams(): URLSearchParams {
  const params = useSearchParams();
  const pathname = usePathname();
  const onList = pathname === LIST_PATH || pathname === `${LIST_PATH}/`;
  const qs = params.toString();
  const held = useRef<URLSearchParams>(new URLSearchParams(qs));
  // 中身が変わったときだけ作り直す。毎回作ると picks から order までの
  // useMemo が総崩れになり、順番を報告する effect が延々と再発火する。
  if (onList && held.current.toString() !== qs) held.current = new URLSearchParams(qs);
  return held.current;
}

export default function CompanyBrowser() {
  const router = useRouter();
  const nav = useBrowseNav();
  const params = useListParams();
  const query = params.get('q') ?? '';
  const perPage = parsePageSize(params.get('per'));
  // 並び順も URL に持つ。ページ番号だけ URL にあると、共有した URL や
  // ブラウザバックで「別の並びの N ページ目」が開いてしまう。
  const sort = parseSort(params.get('sort'));

  const [entries, setEntries] = useState<SearchIndexEntry[] | null>(null);
  const [industryStats, setIndustryStats] = useState<IndustryStat[]>([]);
  const [failed, setFailed] = useState(false);
  const [openFilter, setOpenFilter] = useState<PickKey | null>(null);

  const industries = useMemo(() => industryOptions(industryStats), [industryStats]);
  // 絞り込み条件も URL に持つ。詳細ページから戻ったときに同じ画面へ戻すため。
  const picks = useMemo(() => parsePicks(params, industries), [params, industries]);
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
  function updateUrl(next: {
    q?: string;
    page?: number;
    per?: number;
    sort?: SortKey;
    picks?: Picks;
  }) {
    const sp = new URLSearchParams(params.toString());
    const set = (key: string, value: string | undefined) => {
      if (value) sp.set(key, value);
      else sp.delete(key);
    };
    if ('q' in next) set('q', next.q?.trim() || undefined);
    if ('per' in next) set('per', next.per === undefined ? undefined : String(next.per));
    if ('sort' in next) set('sort', next.sort && next.sort !== DEFAULT_SORT ? next.sort : undefined);
    if (next.picks) applyPicksToParams(sp, next.picks);
    if ('page' in next) set('page', !next.page || next.page === 1 ? undefined : String(next.page));
    const qs = sp.toString();
    router.replace(qs ? `/companies/?${qs}` : '/companies/', { scroll: false });
  }

  /**
   * 会社の一覧と業種中央値。どちらもここでしか使わないので実行時に取りに行く。
   * サーバー側で埋め込むと、同じレイアウトに属する詳細ページ 4,290 枚すべてに
   * 載ってしまう（詳細から見れば要らないデータ）。
   */
  useEffect(() => {
    let alive = true;
    const load = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    };
    Promise.all([
      load('/search-index.json') as Promise<SearchIndexEntry[]>,
      load('/industry-stats.json') as Promise<IndustryStat[]>,
    ])
      .then(([index, stats]) => {
        if (!alive) return;
        setIndustryStats(stats);
        setEntries(index);
      })
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

  const groups: { key: PickKey; label: string; options: FilterOption[] }[] = useMemo(
    () => [
      { key: 'industry', label: '業種', options: industries },
      { key: 'size', label: '従業員数', options: SIZE_OPTIONS },
      { key: 'salary', label: '平均年収', options: SALARY_OPTIONS },
      { key: 'tenure', label: '勤続年数', options: TENURE_OPTIONS },
      { key: 'market', label: '市場', options: MARKET_OPTIONS },
    ],
    [industries],
  );

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = normalize(query.trim());
    return entries.filter((e) => {
      if (!matches(e, picks)) return false;
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

  const order = useMemo(() => sorted.map((e) => e.edinetCode), [sorted]);

  const pageCount = totalPages(sorted.length, perPage);
  // ドロワーで開いている会社が背後の一覧にも見えているように、その会社を
  // 含むページへ寄せる。前へ / 次へ でページをまたいでも一覧がついてくる。
  const openAt = nav?.currentCode ? order.indexOf(nav.currentCode) : -1;
  // URL のページ番号は信用しない。件数やフィルタが変われば範囲外になる。
  const page =
    openAt >= 0 ? Math.floor(openAt / perPage) + 1 : clampPage(params.get('page'), pageCount);
  const visible = sorted.slice((page - 1) * perPage, page * perPage);
  const span = pageRange(page, perPage, sorted.length);
  const pageItems = buildPageItems(page, pageCount);

  /** ドロワーを閉じたときの戻り先。いま見えている一覧そのもの。 */
  const listHref = useMemo(() => {
    const sp = new URLSearchParams(params.toString());
    if (page > 1) sp.set('page', String(page));
    else sp.delete('page');
    const qs = sp.toString();
    return qs ? `${LIST_PATH}/?${qs}` : `${LIST_PATH}/`;
  }, [params, page]);

  const report = nav?.report;
  useEffect(() => {
    report?.({ order, listHref });
  }, [report, order, listHref]);

  function goToPage(next: number) {
    updateUrl({ page: clampPage(next, pageCount) });
  }

  function pick(key: PickKey, id: string) {
    const next: Picks = { ...picks };
    if (isMulti(key)) {
      // 複数選択は付け外し。ポップオーバーは開いたままにして続けて選べるようにする。
      const current = selectedValues(picks, key);
      const updated = current.includes(id)
        ? current.filter((v) => v !== id)
        : [...current, id];
      if (updated.length) next[key] = updated;
      else delete next[key];
    } else {
      next[key] = [id];
    }
    if (!isMulti(key)) setOpenFilter(null);
    // 絞り込みが変われば件数が変わるので、先頭ページへ戻す。
    updateUrl({ picks: next, page: 1 });
  }

  /** チップ本体のクリック。開閉だけを行う（解除は × から）。 */
  function toggle(key: PickKey) {
    setOpenFilter((o) => (o === key ? null : key));
  }

  /** チップの × のクリック。その条件だけ外す。 */
  function clearPick(key: PickKey) {
    const next: Picks = { ...picks };
    delete next[key];
    setOpenFilter(null);
    updateUrl({ picks: next, page: 1 });
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
          const labelOf = (id: string) => g.options.find((o) => o.id === id)?.label ?? id;
          // 複数選択のチップは「ソフトウェア開発 他2件」のように畳む。
          const label = !active
            ? g.label
            : chosen.length === 1
              ? labelOf(chosen[0])
              : `${labelOf(chosen[0])} 他${chosen.length - 1}件`;
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
                    const on = chosen.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={`${styles.option}${on ? ` ${styles.optionActive}` : ''}`}
                        aria-pressed={isMulti(g.key) ? on : undefined}
                        onClick={() => pick(g.key, o.id)}
                      >
                        {isMulti(g.key) && (
                          <span className={styles.check} aria-hidden="true">
                            {on ? '✓' : ''}
                          </span>
                        )}
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {(hasAnyPick(picks) || query) && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              setOpenFilter(null);
              updateUrl({ q: undefined, picks: {}, page: 1 });
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
          <CompanyTable
            entries={visible}
            statsByIndustry={medianByIndustry}
            activeCode={nav?.currentCode ?? null}
            keepScroll={nav !== null}
          />

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

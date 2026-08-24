'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CompanyBrowser from './CompanyBrowser';
import { BrowseNavContext, type BrowseNavInfo } from './browse-nav';
import styles from './BrowseShell.module.css';
import { num } from '@/lib/format';

/**
 * 一覧と詳細をまとめる殻。
 *
 * 一覧をレイアウト側に置くことで、詳細へ移っても一覧はアンマウントされない。
 * 詳細はその上に重なるドロワーとして出る。Intercepting Routes は静的
 * エクスポートで使えないが、レイアウトが遷移をまたいで生き残る性質だけで
 * 同じ見え方が作れる。
 *
 * 詳細ページに検索から直接来た場合は一覧を描かない（standalone）。
 * 一覧は search-index.json を 126KB（gzip 後）取りに行くので、検索流入の大半を占める
 * 詳細ページにその負担を乗せると Core Web Vitals がそのぶん悪くなる。
 * 一覧を一度でも通っていれば index は手元にあるので、追加の取得は発生しない。
 */

const DETAIL_PATH = /^\/company\/([^/]+)\/?$/;

function codeOf(pathname: string): string | null {
  return DETAIL_PATH.exec(pathname)?.[1] ?? null;
}

interface Props {
  children: React.ReactNode;
}

export default function BrowseShell({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const currentCode = codeOf(pathname);

  // 初回が一覧なら一覧を描く。詳細で始まったら、一覧へ寄るまで描かない。
  const [listReady, setListReady] = useState(() => currentCode === null);
  useEffect(() => {
    if (currentCode === null) setListReady(true);
  }, [currentCode]);

  const [info, setInfo] = useState<BrowseNavInfo>({ order: [], listHref: '/companies/' });
  const report = useCallback((next: BrowseNavInfo) => setInfo(next), []);
  const nav = useMemo(() => ({ currentCode, report }), [currentCode, report]);

  const open = listReady && currentCode !== null;

  const shellRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);

  // scroll: false が要る。既定では遷移のたびに先頭へ飛ばされ、
  // せっかく残した一覧の読み位置が失われる。
  const close = useCallback(() => {
    router.push(info.listHref, { scroll: false });
  }, [router, info.listHref]);

  // 開いているあいだは、ドロワーの外側をすべて無効化する。ヘッダーの検索や
  // 背後の一覧にフォーカスが抜けると、見えていない場所を操作できてしまう。
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const root = document.documentElement;
    // 背後の一覧が動かないように止める。読み位置は閉じるときに戻す。
    listScroll.current = window.scrollY;
    const prevOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const outside = Array.from(body.children).filter(
      (el) => el !== shellRef.current && !el.hasAttribute('inert'),
    );
    outside.forEach((el) => el.setAttribute('inert', ''));
    return () => {
      root.style.overflow = prevOverflow;
      outside.forEach((el) => el.removeAttribute('inert'));
      window.scrollTo(0, listScroll.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // 開いた直後と、前へ / 次へ で会社が変わったとき。読み位置は先頭に戻す。
  useEffect(() => {
    if (!open) return;
    drawerRef.current?.focus({ preventScroll: true });
    bodyRef.current?.scrollTo({ top: 0 });
  }, [open, currentCode]);

  // 検索から詳細へ直接来た人には、今までどおりの 1 枚のページを返す。
  if (!listReady) return <>{children}</>;

  const at = currentCode ? info.order.indexOf(currentCode) : -1;
  const prev = at > 0 ? info.order[at - 1] : null;
  const next = at >= 0 && at + 1 < info.order.length ? info.order[at + 1] : null;
  const go = (code: string) => router.push(`/company/${code}/`, { scroll: false });

  return (
    <BrowseNavContext.Provider value={nav}>
      <div className={styles.shell} ref={shellRef}>
        {/* useSearchParams を使うので境界が要る。詳細（children）はこの外にあるので、
            詳細ページの静的 HTML はこれまでどおり丸ごと出力される。 */}
        <div className={styles.behind} inert={open || undefined} aria-hidden={open || undefined}>
          <Suspense>
            <CompanyBrowser />
          </Suspense>
        </div>

        {open && (
          <>
            <div className={styles.scrim} onClick={close} aria-hidden="true" />
            <div
              className={styles.drawer}
              role="dialog"
              aria-modal="true"
              aria-label="会社の詳細"
              tabIndex={-1}
              ref={drawerRef}
            >
              <div className={styles.bar}>
                <div className={styles.steps}>
                  <button
                    type="button"
                    className={styles.step}
                    onClick={() => prev && go(prev)}
                    disabled={!prev}
                  >
                    <span aria-hidden="true">‹</span> 前へ
                  </button>
                  <button
                    type="button"
                    className={styles.step}
                    onClick={() => next && go(next)}
                    disabled={!next}
                  >
                    次へ <span aria-hidden="true">›</span>
                  </button>
                </div>
                {at >= 0 && (
                  <span className={styles.position}>
                    {num(at + 1)} / {num(info.order.length)} 件
                  </span>
                )}
                <button
                  type="button"
                  className={styles.close}
                  onClick={close}
                  aria-label="閉じて一覧に戻る"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
              <div className={styles.body} ref={bodyRef}>
                {children}
              </div>
            </div>
          </>
        )}
      </div>
    </BrowseNavContext.Provider>
  );
}

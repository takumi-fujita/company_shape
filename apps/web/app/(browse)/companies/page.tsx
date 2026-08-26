import type { Metadata } from 'next';
import CompanyRows from '@/components/CompanyRows';
import { buildSearchIndex, getIndustryStats } from '@/lib/db';
import { num } from '@/lib/format';
import { openGraph } from '@/lib/site';
import styles from '@/components/CompanyBrowser.module.css';

export const metadata: Metadata = {
  title: '会社をさがす｜従業員数・平均年収・勤続年数で上場企業を比較',
  description:
    '上場企業を従業員数・平均年収・平均勤続年数・手元資金の余力で絞り込めます。数値は有価証券報告書からの機械抽出で、評価・解釈は含みません。',
  alternates: { canonical: '/companies/' },
  openGraph: openGraph({ path: '/companies/' }),
};

/** 静的 HTML に載せる初期表示分。絞り込みは JS 側で行う。 */
const SEED = 30;

/**
 * 一覧の初期表示。
 *
 * 絞り込みは search-index.json を実行時に取得してクライアントで行うため、
 * このページは静的エクスポートで丸ごと空になっていた（body の可視部分が
 * ヘッダーだけ、会社へのリンク 0 本）。クローラから見て中身が無い状態なので、
 * 先頭 30 社をビルド時に書き出す。
 *
 * ここで描いたものは BrowseShell の Suspense fallback として出る。
 * search-index.json が届くと CompanyBrowser の描画に置き換わる。
 * 並び順は CompanyBrowser の既定（従業員数の多い順）に合わせてある。
 */
export default function CompaniesPage() {
  const stats = getIndustryStats();
  const statsByIndustry = new Map(stats.map((s) => [s.industryCode, s]));
  const entries = buildSearchIndex()
    .slice()
    .sort((a, b) => {
      if (a.employees == null && b.employees == null) return 0;
      if (a.employees == null) return 1;
      if (b.employees == null) return -1;
      return b.employees - a.employees;
    })
    .slice(0, SEED);

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <h1 className={styles.h1}>会社をさがす</h1>
        <p className={styles.lead}>
          従業員数・平均年収・勤続年数・手元資金の余力を、有価証券報告書からそのまま並べています。会計の知識はいりません。
        </p>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.counts}>
          従業員数の多い順に <span className={styles.countNum}>{num(SEED)}</span> 件
        </span>
      </div>

      <CompanyRows entries={entries} statsByIndustry={statsByIndustry} />

      <p className={styles.note}>数値は有価証券報告書からの機械抽出です。評価・解釈は含みません。</p>
    </main>
  );
}

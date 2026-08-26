import { openGraph } from '@/lib/site';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CompanyRows from '@/components/CompanyRows';
import { buildSearchIndex, getIndustryStat, getIndustryStats } from '@/lib/db';
import { METRIC_KEYS, METRICS, rankingSlug } from '@/lib/ranking';
import { count, num } from '@/lib/format';
import styles from '@/app/hub.module.css';

export const dynamicParams = false;

export function generateStaticParams() {
  return getIndustryStats().map((s) => ({ code: s.industryCode }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const stat = getIndustryStat(code);
  if (!stat) return {};
  return {
    title: `${stat.industryLabel}の会社一覧｜平均年収・勤続年数・従業員数`,
    description: `${stat.industryLabel}の上場企業 ${num(stat.companyCount)} 社の平均年収・平均勤続年数・従業員数・手元資金の余力を、有価証券報告書のデータで一覧にしています。`,
    alternates: { canonical: `/industry/${code}/` },
    openGraph: openGraph({ path: `/industry/${code}/` }),
  };
}

export default async function IndustryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const stat = getIndustryStat(code);
  if (!stat) notFound();

  const stats = new Map(getIndustryStats().map((s) => [s.industryCode, s]));
  const entries = buildSearchIndex()
    .filter((e) => e.industryCode === code)
    .sort((a, b) => (b.employees ?? 0) - (a.employees ?? 0));

  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="パンくず">
        <Link href="/companies/">会社をさがす</Link>
        <span>/</span>
        <span className={styles.current}>{stat.industryLabel}</span>
      </nav>
      <h1 className={styles.h1}>{stat.industryLabel}の会社</h1>
      <p className={styles.lead}>
        {stat.industryLabel}に分類される上場企業 {count(stat.companyCount)}。
        平均年収の業種中央値は {num(stat.medianSalary)} 千円、平均勤続年数の業種中央値は{' '}
        {num(stat.medianTenure, 1)} 年です。
      </p>

      <div className={styles.links}>
        {METRIC_KEYS.map((m) => (
          <Link key={m} className={styles.linkPill} href={`/ranking/${rankingSlug(code, m)}/`}>
            {METRICS[m].heading}
          </Link>
        ))}
      </div>

      <CompanyRows entries={entries} statsByIndustry={stats} />

      <div className={styles.links}>
        {[...stats.values()]
          .filter((s) => s.industryCode !== code)
          .map((s) => (
            <Link key={s.industryCode} className={styles.linkPill} href={`/industry/${s.industryCode}/`}>
              {s.industryLabel}
            </Link>
          ))}
      </div>

      <p className={styles.note}>数値は有価証券報告書からの機械抽出です。評価・解釈は含みません。</p>
    </main>
  );
}

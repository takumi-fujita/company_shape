import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CompanyTable from '@/components/CompanyTable';
import { buildSearchIndex, getIndustryStat, getIndustryStats } from '@/lib/db';
import {
  METRIC_KEYS,
  METRICS,
  MIN_RANKED,
  parseRankingSlug,
  rankingSlug,
  sortByMetric,
  summarize,
} from '@/lib/ranking';
import { count } from '@/lib/format';
import styles from '../../companies/hub.module.css';

export const dynamicParams = false;

export function generateStaticParams() {
  return getIndustryStats().flatMap((s) =>
    METRIC_KEYS.map((m) => ({ slug: rankingSlug(s.industryCode, m) })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseRankingSlug(slug);
  const stat = parsed && getIndustryStat(parsed.industryCode);
  if (!parsed || !stat) return {};
  const metric = METRICS[parsed.metric];
  const entries = buildSearchIndex().filter((e) => e.industryCode === parsed.industryCode);
  const sum = summarize(entries, parsed.metric);
  return {
    title: `${stat.industryLabel}の${metric.heading}｜${metric.label}で並べた上場企業一覧`,
    description:
      `${stat.industryLabel}の上場企業 ${sum.total} 社を${metric.label}で並べた一覧です。` +
      `${metric.label}の中央値は ${sum.median}。` +
      '数値は有価証券報告書からの機械抽出で、評価・解釈は含みません。',
    alternates: { canonical: `/ranking/${slug}/` },
    // 数社しかない業種は「ランキング」として成立しないので検索対象から外す。
    robots: sum.total < MIN_RANKED ? { index: false, follow: true } : undefined,
  };
}

export default async function RankingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = parseRankingSlug(slug);
  if (!parsed) notFound();
  const stat = getIndustryStat(parsed.industryCode);
  if (!stat) notFound();

  const metric = METRICS[parsed.metric];
  const stats = new Map(getIndustryStats().map((s) => [s.industryCode, s]));
  const all = buildSearchIndex().filter((e) => e.industryCode === parsed.industryCode);
  const entries = sortByMetric(all, parsed.metric);
  const sum = summarize(all, parsed.metric);

  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="パンくず">
        <Link href="/companies/">会社をさがす</Link>
        <span>/</span>
        <Link href={`/industry/${parsed.industryCode}/`}>{stat.industryLabel}</Link>
        <span>/</span>
        <span className={styles.current}>{metric.heading}</span>
      </nav>
      <h1 className={styles.h1}>
        {stat.industryLabel}の{metric.heading}
      </h1>
      <p className={styles.lead}>
        {stat.industryLabel}の上場企業 {count(sum.total)} を{metric.label}で並べています。
        並べ替えの軸を示しているだけで、順位に評価の意味はありません。
      </p>

      {/* 指標ごとに変わる内訳。同じ業種の各ページが並び順しか違わない状態を避ける。 */}
      <dl className={styles.summary}>
        <div className={styles.summaryItem}>
          <dt className={styles.summaryLabel}>{metric.label}の中央値</dt>
          <dd className={styles.summaryValue}>{sum.median}</dd>
        </div>
        <div className={styles.summaryItem}>
          <dt className={styles.summaryLabel}>記載のあった会社</dt>
          <dd className={styles.summaryValue}>
            {count(sum.counted)} / {count(sum.total)}
          </dd>
        </div>
      </dl>

      {sum.top.length > 0 && (
        <p className={styles.lead}>
          {metric.label}が大きい順に{' '}
          {sum.top.map((t, i) => (
            <span key={t.name}>
              {i > 0 && '、'}
              {t.name}（{t.value}）
            </span>
          ))}
          。{metric.source}
        </p>
      )}

      <p className={styles.note}>
        {metric.label}が有価証券報告書から取得できなかった会社は末尾に置いています。
      </p>

      <div className={styles.links}>
        {METRIC_KEYS.filter((m) => m !== parsed.metric).map((m) => (
          <Link
            key={m}
            className={styles.linkPill}
            href={`/ranking/${rankingSlug(parsed.industryCode, m)}/`}
          >
            {METRICS[m].heading}
          </Link>
        ))}
        <Link className={styles.linkPill} href={`/industry/${parsed.industryCode}/`}>
          {stat.industryLabel}の会社一覧
        </Link>
      </div>

      <CompanyTable entries={entries} statsByIndustry={stats} />

      <p className={styles.note}>数値は有価証券報告書からの機械抽出です。評価・解釈は含みません。</p>
    </main>
  );
}

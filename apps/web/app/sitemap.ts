import type { MetadataRoute } from 'next';
import { getAllCompanies, getIndustryStats, isThin } from '@/lib/db';
import { METRIC_KEYS, rankingSlug } from '@/lib/ranking';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

/**
 * 1 ファイル 5 万 URL が上限。種別ごとに分割し、Next が sitemap index を生成する。
 * 企業ページは 5 万件を超えうるのでチャンクに割る。
 */
const CHUNK = 20000;

type SitemapId = string;

export function generateSitemaps(): { id: SitemapId }[] {
  const chunks = Math.max(1, Math.ceil(getAllCompanies().length / CHUNK));
  return [
    { id: 'static' },
    { id: 'industries' },
    { id: 'rankings' },
    ...Array.from({ length: chunks }, (_, i) => ({ id: `companies-${i}` })),
  ];
}

export default async function sitemap({ id }: { id: SitemapId }): Promise<MetadataRoute.Sitemap> {
  if (id === 'static') {
    return [
      { url: `${SITE_URL}/companies/`, changeFrequency: 'daily', priority: 1 },
      { url: `${SITE_URL}/removal-request/`, changeFrequency: 'yearly', priority: 0.1 },
    ];
  }

  if (id === 'industries') {
    return getIndustryStats().map((s) => ({
      url: `${SITE_URL}/industry/${s.industryCode}/`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  }

  if (id === 'rankings') {
    return getIndustryStats().flatMap((s) =>
      METRIC_KEYS.map((m) => ({
        url: `${SITE_URL}/ranking/${rankingSlug(s.industryCode, m)}/`,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
    );
  }

  const index = Number(id.replace('companies-', ''));
  return getAllCompanies()
    // 薄いページ（noindex）は sitemap にも載せない。
    .filter((c) => !isThin(c))
    .slice(index * CHUNK, (index + 1) * CHUNK)
    .map((c) => ({
      url: `${SITE_URL}/company/${c.edinetCode}/`,
      lastModified: c.updatedAt,
      changeFrequency: 'yearly' as const,
      priority: 0.8,
    }));
}

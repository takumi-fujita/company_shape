import { Suspense } from 'react';
import type { Metadata } from 'next';
import CompanyBrowser from '@/components/CompanyBrowser';
import { getIndustryStats } from '@/lib/db';

export const metadata: Metadata = {
  title: '会社をさがす｜従業員数・平均年収・勤続年数で上場企業を比較',
  description:
    '上場企業を従業員数・平均年収・平均勤続年数・手元資金の余力で絞り込めます。数値は有価証券報告書からの機械抽出で、評価・解釈は含みません。',
  alternates: { canonical: '/companies/' },
};

export default function CompaniesPage() {
  // 業種中央値だけビルド時に埋め込む。会社の一覧は search-index.json を実行時に取得する。
  const industryStats = getIndustryStats();
  return (
    <Suspense>
      <CompanyBrowser industryStats={industryStats} />
    </Suspense>
  );
}

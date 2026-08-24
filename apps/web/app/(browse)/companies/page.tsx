import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '会社をさがす｜従業員数・平均年収・勤続年数で上場企業を比較',
  description:
    '上場企業を従業員数・平均年収・平均勤続年数・手元資金の余力で絞り込めます。数値は有価証券報告書からの機械抽出で、評価・解釈は含みません。',
  alternates: { canonical: '/companies/' },
};

/**
 * 一覧の中身はレイアウト側（BrowseShell）が描く。詳細へ移っても
 * アンマウントさせないため。このページはメタデータだけを担う。
 */
export default function CompaniesPage() {
  return null;
}

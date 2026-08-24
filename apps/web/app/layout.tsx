import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}｜${SITE_TAGLINE}`,
    template: `%s - ${SITE_NAME}`,
  },
  description:
    '上場企業の有価証券報告書から従業員数・平均年収・平均勤続年数・手元資金の余力を機械的に抽出し、会計の知識なしで読める形にまとめています。',
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'ja_JP',
    url: '/',
    images: [{ url: '/ogp.png', width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME}｜${SITE_TAGLINE}`,
    description:
      '上場企業の有価証券報告書から従業員数・平均年収・平均勤続年数・手元資金の余力を機械的に抽出し、会計の知識なしで読める形にまとめています。',
    images: ['/ogp.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';

// 静的エクスポートでは redirect() が使えないため、Cloudflare Pages 側は public/_redirects で
// 301、それが効かない環境向けにこのページが meta refresh でフォールバックする。
export const metadata: Metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: '/companies/' },
};

export default function Home() {
  return (
    <main style={{ maxWidth: 'var(--content-width)', margin: '0 auto', padding: '28px 20px' }}>
      <meta httpEquiv="refresh" content="0;url=/companies/" />
      <p>
        <Link href="/companies/">会社をさがす</Link>
      </p>
    </main>
  );
}

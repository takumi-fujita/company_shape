import Link from 'next/link';
import type { Metadata } from 'next';
import styles from '@/app/hub.module.css';
import { CONTACT_EMAIL, openGraph, SITE_NAME, SITE_TAGLINE } from '@/lib/site';

export const metadata: Metadata = {
  title: '運営者情報',
  description: `${SITE_NAME}の運営方針と、掲載しているデータの取得元についてのご案内です。`,
  alternates: { canonical: '/about/' },
  openGraph: openGraph({ path: '/about/' }),
};

export default function AboutPage() {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="パンくず">
        <Link href="/companies/">会社をさがす</Link>
        <span>/</span>
        <span className={styles.current}>運営者情報</span>
      </nav>
      <h1 className={styles.h1}>運営者情報</h1>

      <section className={styles.panel}>
        <h2 className={styles.h2}>運営</h2>
        <div className={styles.body}>
          <p>
            {SITE_NAME}は、個人が運営している非営利の情報サイトです。法人・団体による運営ではありません。
          </p>
          <p>
            特定の企業・業界団体・人材紹介事業者からの依頼や出資は受けておらず、
            掲載順や掲載内容が対価によって変わることはありません。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>このサイトの目的</h2>
        <div className={styles.body}>
          <p>
            「{SITE_TAGLINE}」を掲げています。
            有価証券報告書には、働くうえで参考になる数値（従業員数、平均年収、平均勤続年数、
            手元資金の余力など）が載っていますが、会計の知識がないと読み取りづらい形式です。
          </p>
          <p>
            これらを機械的に抽出し、会計の知識がなくても比べられる形に整えて公開しています。
            企業の評価・格付け・将来予測は行わず、就職や転職を勧めることもありません。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>データの取得元</h2>
        <div className={styles.body}>
          <ul className={styles.list}>
            <li>
              金融庁 EDINET（有価証券報告書）—{' '}
              <a href="https://disclosure2.edinet-fsa.go.jp/" target="_blank" rel="noopener noreferrer">
                disclosure2.edinet-fsa.go.jp ↗
              </a>
            </li>
            <li>
              経済産業省 gBizINFO（補助金の交付決定）—{' '}
              <a href="https://info.gbiz.go.jp/" target="_blank" rel="noopener noreferrer">
                info.gbiz.go.jp ↗
              </a>
            </li>
            <li>
              日本取引所グループ（上場銘柄の業種区分）—{' '}
              <a href="https://www.jpx.co.jp/" target="_blank" rel="noopener noreferrer">
                jpx.co.jp ↗
              </a>
            </li>
          </ul>
          <p>
            いずれも公開されている一次情報です。独自の取材・推計・アンケートは行っていません。
            データは日次で更新しています。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>ご連絡</h2>
        <div className={styles.body}>
          <p>
            掲載内容についてのご連絡、訂正・削除のご依頼は{' '}
            <Link href="/removal-request/">お問い合わせ・削除依頼</Link> から承ります。
          </p>
          {CONTACT_EMAIL ? (
            <p>
              メール: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

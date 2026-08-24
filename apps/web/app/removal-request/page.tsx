import Link from 'next/link';
import type { Metadata } from 'next';
import styles from '@/app/hub.module.css';
import { REMOVAL_FORM_URL, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: '掲載内容に関するご連絡・削除依頼',
  description: `${SITE_NAME}に掲載している数値の訂正・削除のご依頼と、掲載データの取得元・更新頻度についてのご案内です。`,
  alternates: { canonical: '/removal-request/' },
};

export default function RemovalRequestPage() {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="パンくず">
        <Link href="/companies/">会社をさがす</Link>
        <span>/</span>
        <span className={styles.current}>掲載内容に関するご連絡・削除依頼</span>
      </nav>
      <h1 className={styles.h1}>掲載内容に関するご連絡・削除依頼</h1>

      <section className={styles.panel}>
        <h2 style={{ fontSize: 17, fontWeight: 500 }}>掲載しているデータについて</h2>
        <div className={styles.body}>
          <p>
            当サイトの数値は、金融庁 EDINET で公開されている有価証券報告書と、
            経済産業省 gBizINFO の公開データを機械的に抽出・集計したものです。独自の取材や推計は行っておらず、
            企業の評価・格付け・将来予測は一切掲載していません。
          </p>
          <p>
            抽出はプログラムによる自動処理のため、転記の誤り、単位の取り違え、決算期変更にともなう
            期間の不一致が生じる場合があります。数値に相違がある場合は、下記の窓口までご連絡ください。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 style={{ fontSize: 17, fontWeight: 500 }}>訂正・削除のご依頼</h2>
        <div className={styles.body}>
          <p>下のフォームからご連絡ください。確認のうえ、順次対応します。</p>
          <ul style={{ margin: 0, paddingLeft: '1.4em' }}>
            <li>対象ページの URL</li>
            <li>該当する項目名（例: 平均年収、平均勤続年数）</li>
            <li>正しい数値と、その根拠となる公開資料（有価証券報告書の該当箇所など）</li>
            <li>ご連絡先</li>
          </ul>
          {REMOVAL_FORM_URL ? (
            <p>
              <a
                className={styles.formButton}
                href={REMOVAL_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                訂正・削除の依頼フォームを開く ↗
              </a>
            </p>
          ) : (
            <p className={styles.pending}>
              現在、依頼フォームを準備しています。
            </p>
          )}
          <p>
            公開データの記載そのものに誤りがある場合は、一次情報の発行元（EDINET / gBizINFO）での
            訂正後、当サイトの次回更新時に反映されます。
          </p>
        </div>
      </section>

      <p className={styles.note}>数値は有価証券報告書からの機械抽出です。評価・解釈は含みません。</p>
    </main>
  );
}

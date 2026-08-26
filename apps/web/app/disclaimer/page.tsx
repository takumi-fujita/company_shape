import Link from 'next/link';
import type { Metadata } from 'next';
import styles from '@/app/hub.module.css';
import { openGraph, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: '免責事項',
  description: `${SITE_NAME}に掲載している数値の性質と、ご利用にあたってのお願いです。`,
  alternates: { canonical: '/disclaimer/' },
  openGraph: openGraph({ path: '/disclaimer/' }),
};

export default function DisclaimerPage() {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="パンくず">
        <Link href="/companies/">会社をさがす</Link>
        <span>/</span>
        <span className={styles.current}>免責事項</span>
      </nav>
      <h1 className={styles.h1}>免責事項</h1>

      <section className={styles.panel}>
        <h2 className={styles.h2}>掲載している数値の性質</h2>
        <div className={styles.body}>
          <p>
            {SITE_NAME}に掲載している数値は、金融庁 EDINET で公開されている有価証券報告書、
            および経済産業省 gBizINFO の公開データから、プログラムによって機械的に抽出したものです。
          </p>
          <p>
            当サイトは、これらの数値に対する<strong>評価・解釈・格付け・将来予測を一切行いません</strong>。
            また、特定の企業への投資を勧めるもの、就職や転職を勧めたり避けるよう促したりするものでもありません。
            表示している比較やランキングは、公開数値をそのまま並べ替えたものであり、
            企業の優劣を示すものではありません。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>誤りが含まれる可能性</h2>
        <div className={styles.body}>
          <p>
            抽出は自動処理のため、次のような理由で実際の開示内容と異なる場合があります。
          </p>
          <ul className={styles.list}>
            <li>提出書類における項目名やタグ付けの違いによる、転記の誤り</li>
            <li>単位（円・千円・百万円）の取り違え</li>
            <li>決算期の変更にともなう、対象期間の不一致</li>
            <li>連結・単体の別による、集計範囲の違い</li>
            <li>提出後の訂正報告書が反映されていないこと</li>
          </ul>
          <p>
            <strong>
              重要な判断を行う際は、必ず有価証券報告書などの一次情報をご自身でご確認ください。
            </strong>{' '}
            各ページには出典元へのリンクを掲載しています。
          </p>
          <p>
            数値に相違を見つけられた場合は{' '}
            <Link href="/removal-request/">掲載内容に関するご連絡・削除依頼</Link> からお知らせください。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>責任の範囲</h2>
        <div className={styles.body}>
          <p>
            当サイトの情報を利用したことによって生じたいかなる損害についても、
            運営者は責任を負いません。情報の正確性、完全性、有用性、最新性について、
            明示・黙示を問わず保証するものではありません。
          </p>
          <p>
            当サイトからリンクしている外部サイトの内容についても、運営者は責任を負いません。
          </p>
          <p>
            掲載内容は予告なく変更・削除される場合があります。
            また、システムの不具合や保守により、予告なく利用できなくなる場合があります。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>著作権</h2>
        <div className={styles.body}>
          <p>
            出典としている EDINET および gBizINFO の公開データは、各提供機関の利用条件に従っています。
            当サイトが作成した文章・図表の引用にあたっては、出典として当サイトの URL を明記してください。
          </p>
        </div>
      </section>
    </main>
  );
}

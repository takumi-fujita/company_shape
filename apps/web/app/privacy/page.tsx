import Link from 'next/link';
import type { Metadata } from 'next';
import styles from '@/app/hub.module.css';
import { CONTACT_EMAIL, openGraph, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'プライバシーポリシー',
  description: `${SITE_NAME}における個人情報の取り扱い、アクセス解析、Cookie、広告配信についてのご案内です。`,
  alternates: { canonical: '/privacy/' },
  openGraph: openGraph({ path: '/privacy/' }),
};

export default function PrivacyPage() {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="パンくず">
        <Link href="/companies/">会社をさがす</Link>
        <span>/</span>
        <span className={styles.current}>プライバシーポリシー</span>
      </nav>
      <h1 className={styles.h1}>プライバシーポリシー</h1>

      <section className={styles.panel}>
        <h2 className={styles.h2}>個人情報の取り扱い</h2>
        <div className={styles.body}>
          <p>
            {SITE_NAME}（以下「当サイト」）は、閲覧にあたって氏名・住所・電話番号などの
            個人情報の入力を求めることはありません。会員登録の仕組みもありません。
          </p>
          <p>
            お問い合わせや訂正・削除のご依頼をいただいた場合に限り、
            ご連絡先とご依頼内容をお預かりします。これらは対応の目的にのみ利用し、
            法令に基づく場合を除いて第三者へ提供することはありません。対応の完了後は、
            記録として必要な範囲を除いて削除します。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>アクセス解析</h2>
        <div className={styles.body}>
          <p>
            当サイトでは、今後 Google アナリティクス 4（GA4）の導入を予定しています。
            導入した場合、閲覧されたページ、滞在時間、参照元、おおよその地域、
            ブラウザや端末の種類といった情報が Cookie を通じて収集されます。
            これらは統計的に処理されるもので、個人を特定するものではありません。
          </p>
          <p>
            GA4 における情報の取り扱いについては{' '}
            <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
              Google のポリシーと規約 ↗
            </a>{' '}
            をご確認ください。収集を望まれない場合は{' '}
            <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
              Google アナリティクス オプトアウト アドオン ↗
            </a>{' '}
            をご利用いただけます。
          </p>
          <p>
            なお、本ポリシー記載時点では解析ツールは導入されておらず、
            当サイトが独自に閲覧者の行動を記録することはありません。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>Cookie について</h2>
        <div className={styles.body}>
          <p>
            Cookie は、閲覧したサイトから端末に保存される小さなテキストデータです。
            当サイトの機能そのものは Cookie を必要としません。
            前述のアクセス解析や広告配信を導入した場合、それらの事業者が Cookie を利用します。
          </p>
          <p>
            Cookie の受け入れは、お使いのブラウザの設定から拒否・削除できます。
            拒否された場合でも、当サイトの閲覧に支障はありません。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>広告配信</h2>
        <div className={styles.body}>
          <p>
            当サイトでは、第三者配信の広告サービス（Google AdSense を含む）の利用を検討しています。
            利用する場合、広告配信事業者はユーザーの興味に応じた広告を表示するために Cookie を使用し、
            当サイトや他サイトへのアクセス情報を参照することがあります。氏名・住所・メールアドレス・
            電話番号は含まれません。
          </p>
          <p>
            パーソナライズ広告は{' '}
            <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">
              広告設定 ↗
            </a>{' '}
            から無効にできます。第三者配信事業者による Cookie の使用については{' '}
            <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">
              Google の広告に関するポリシー ↗
            </a>{' '}
            をご覧ください。
          </p>
          <p>
            現時点では広告は掲載していません。掲載を開始する際は、本ページを更新します。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>掲載している企業情報について</h2>
        <div className={styles.body}>
          <p>
            当サイトが掲載しているのは、金融庁 EDINET および経済産業省 gBizINFO で
            公開されている法人に関する情報です。個人に関する情報は掲載していません。
          </p>
          <p>
            掲載内容の訂正・削除のご依頼は{' '}
            <Link href="/removal-request/">掲載内容に関するご連絡・削除依頼</Link> から承ります。
          </p>
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>お問い合わせ窓口</h2>
        <div className={styles.body}>
          {CONTACT_EMAIL ? (
            <p>
              本ポリシーに関するお問い合わせは{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> までご連絡ください。
            </p>
          ) : (
            <p>
              本ポリシーに関するお問い合わせは{' '}
              <Link href="/removal-request/">お問い合わせ・削除依頼</Link> から承ります。
            </p>
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>改定について</h2>
        <div className={styles.body}>
          <p>
            本ポリシーは、法令の変更やサービス内容の変更に応じて予告なく改定することがあります。
            改定後の内容は、本ページに掲載した時点から適用されます。
          </p>
        </div>
      </section>
    </main>
  );
}

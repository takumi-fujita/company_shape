import Link from 'next/link';
import styles from './SiteFooter.module.css';
import { SITE_NAME } from '@/lib/site';

/**
 * 全ページ共通のフッター。
 *
 * 出典と免責の 1 行は各ページ内にもあるが、そちらはそのページの数値に
 * かかる注記。ここはサイト全体としての出典・免責と、各規程への導線を持つ。
 */
const LINKS = [
  { href: '/about/', label: '運営者情報' },
  { href: '/privacy/', label: 'プライバシーポリシー' },
  { href: '/disclaimer/', label: '免責事項' },
  // 問い合わせ窓口は削除依頼ページが兼ねる。窓口を 2 つに分けない。
  { href: '/removal-request/', label: 'お問い合わせ' },
];

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.links} aria-label="サイト情報">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
        <span className={styles.note}>
          出典: 金融庁 EDINET / 経済産業省 gBizINFO。数値は公開情報からの機械抽出で、評価・解釈・投資判断・就職や転職の勧誘を含みません。
        </span>
        <span className={styles.note}>© 2026 {SITE_NAME}</span>
      </div>
    </footer>
  );
}

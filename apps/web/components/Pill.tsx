import styles from './Pill.module.css';
import type { Pill as PillData } from '@/lib/detail';

/** 閾値超過時のみ描画する。正常時は何も出さない（正常＝無彩色）。 */
export default function Pill({ pill }: { pill: PillData | null }) {
  if (!pill) return null;
  return <span className={`${styles.pill} ${styles[pill.level]}`}>{pill.text}</span>;
}

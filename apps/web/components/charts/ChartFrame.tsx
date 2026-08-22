import type { ReactNode } from 'react';
import styles from './ChartFrame.module.css';
import type { ChartLabel } from '@/lib/chart/labels';

/**
 * グラフのラベルは SVG <text> ではなく絶対配置した HTML <span> で描く。
 * viewBox の拡大率に関わらず本文フォントの実 px サイズを保つため。
 */
interface Props {
  viewBox: string;
  ariaLabel: string;
  labels: ChartLabel[];
  children: ReactNode;
}

export default function ChartFrame({ viewBox, ariaLabel, labels, children }: Props) {
  return (
    <div className={styles.frame}>
      <svg viewBox={viewBox} className={styles.svg} role="img" aria-label={ariaLabel}>
        {children}
      </svg>
      <div className={styles.labels}>
        {labels.map((l, i) => (
          <span
            key={i}
            className={`${styles.label}${l.chip ? ` ${styles.chip}` : ''}`}
            style={{
              left: l.left,
              top: l.top,
              transform: l.transform,
              color: l.color,
              fontSize: l.size,
            }}
          >
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
}

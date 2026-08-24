import type { ReactNode } from 'react';
import styles from './ChartFrame.module.css';
import ChartHotspots from './ChartHotspots';
import type { ChartLabel } from '@/lib/chart/labels';
import type { Hotspot } from '@/lib/chart/hotspot';

/**
 * グラフのラベルは SVG <text> ではなく絶対配置した HTML <span> で描く。
 * viewBox の拡大率に関わらず本文フォントの実 px サイズを保つため。
 */
interface Props {
  viewBox: string;
  ariaLabel: string;
  labels: ChartLabel[];
  /** マウスオーバーで数値を出す当たり判定。省略すると静的なグラフのまま。 */
  hotspots?: Hotspot[];
  children: ReactNode;
}

export default function ChartFrame({ viewBox, ariaLabel, labels, hotspots, children }: Props) {
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
      {hotspots && hotspots.length > 0 && <ChartHotspots hotspots={hotspots} />}
    </div>
  );
}

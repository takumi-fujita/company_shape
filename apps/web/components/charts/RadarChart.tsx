import ChartFrame from './ChartFrame';
import styles from './RadarChart.module.css';
import { buildRadar } from '@/lib/chart/radar';
import type { Percentiles } from '@/lib/types';

/**
 * 「会社のかたち」。プロットするのは業種内パーセンタイル(0-100)のみ。
 * 金額や年数の生値は軸ごとに単位が違うため使用不可。
 */
export default function RadarChart({ percentiles }: { percentiles: Percentiles }) {
  const r = buildRadar(percentiles);
  return (
    <div className={styles.wrap}>
      <ChartFrame
        viewBox={r.viewBox}
        ariaLabel="業種内パーセンタイルのレーダーチャート"
        labels={r.labels}
      hotspots={r.hotspots}
      >
        <polygon points={r.outer} fill="none" stroke="var(--hairline)" strokeWidth="1" />
        {r.spokes.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke="var(--hairline)"
            strokeWidth="1"
          />
        ))}
        {/* 業種のまんなか = 全軸 50% */}
        <polygon
          points={r.mid}
          fill="none"
          stroke="var(--chart-mid)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <polygon
          points={r.self}
          fill="var(--accent)"
          fillOpacity="0.22"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        {r.dots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3.2" fill="var(--accent)" />
        ))}
      </ChartFrame>
    </div>
  );
}

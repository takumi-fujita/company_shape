import ChartFrame from './ChartFrame';
import { buildSegmentChart } from '@/lib/chart/series';
import type { FiscalPeriod } from '@/lib/types';

/** セグメント別営業利益の積み上げ棒。 */
export default function SegmentChart({ periods }: { periods: FiscalPeriod[] }) {
  const c = buildSegmentChart(periods);
  return (
    <ChartFrame viewBox={c.viewBox} ariaLabel="セグメント別営業利益" labels={c.labels}
      hotspots={c.hotspots}>
      {c.grid.map((g, i) => (
        <line key={i} x1={g.x1} x2={g.x2} y1={g.y} y2={g.y} stroke="var(--hairline)" strokeWidth="1" />
      ))}
      {c.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.color} rx="2" />
      ))}
    </ChartFrame>
  );
}

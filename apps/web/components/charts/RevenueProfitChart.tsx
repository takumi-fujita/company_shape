import ChartFrame from './ChartFrame';
import { buildRevenueProfitChart } from '@/lib/chart/series';
import type { FiscalPeriod } from '@/lib/types';

/** 売上（棒・最新期を最濃）と営業利益（線）の 5 期推移。 */
export default function RevenueProfitChart({ periods }: { periods: FiscalPeriod[] }) {
  const c = buildRevenueProfitChart(periods);
  return (
    <ChartFrame viewBox={c.viewBox} ariaLabel="売上と営業利益の5期推移" labels={c.labels}
      hotspots={c.hotspots}>
      {c.grid.map((g, i) => (
        <line key={i} x1={g.x1} x2={g.x2} y1={g.y} y2={g.y} stroke="var(--hairline)" strokeWidth="1" />
      ))}
      {c.bars.map((b, i) => (
        <path key={i} d={b.d} fill={b.color} />
      ))}
      <path
        d={c.linePath}
        fill="none"
        stroke="var(--chart-line)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {c.points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="3.8"
          fill="var(--panel)"
          stroke="var(--chart-line)"
          strokeWidth="2.5"
        />
      ))}
    </ChartFrame>
  );
}

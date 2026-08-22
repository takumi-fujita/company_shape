import ChartFrame from './ChartFrame';
import { buildHeadcountSalaryChart } from '@/lib/chart/series';
import type { FiscalPeriod } from '@/lib/types';

/** 実線 = 従業員数（名・左軸）、破線 = 平均年収（千円・右軸）。年収欠損なら破線は描かない。 */
export default function HeadcountSalaryChart({ periods }: { periods: FiscalPeriod[] }) {
  const c = buildHeadcountSalaryChart(periods);
  return (
    <ChartFrame viewBox={c.viewBox} ariaLabel="従業員数と平均年収の推移" labels={c.labels}>
      {c.grid.map((g, i) => (
        <line key={i} x1={g.x1} x2={g.x2} y1={g.y} y2={g.y} stroke="var(--hairline)" strokeWidth="1" />
      ))}
      <path
        d={c.employeePath}
        fill="none"
        stroke="var(--chart-teal-3)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {c.salaryPath && (
        <path
          d={c.salaryPath}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinejoin="round"
        />
      )}
      {c.employeeDots.map((p, i) => (
        <circle key={`e${i}`} cx={p.x} cy={p.y} r="3" fill="var(--chart-teal-3)" />
      ))}
      {c.salaryDots.map((p, i) => (
        <circle key={`s${i}`} cx={p.x} cy={p.y} r="3" fill="var(--chart-line)" />
      ))}
    </ChartFrame>
  );
}

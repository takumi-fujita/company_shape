/**
 * 5 期系列の 3 グラフ（複合・2 軸・積み上げ）の幾何計算。
 *
 * - 欠損期は棒を描かず、折れ線もそこで切る（推定で埋めない）。
 * - 営業利益は赤字なら負になる。軸は 0 を必ず含み、棒は 0 を基点に上下へ伸ばす。
 */
import { EM_DASH, num, unit } from '../format';
import { clampBand, pct, type Hotspot } from './hotspot';
import { GRID_TICKS, niceScale, topBarPath, type Scale } from './nice';
import { labeler, type ChartLabel } from './labels';
import type { FiscalPeriod } from '../types';

/** null を含む点列を、欠損で切った複数のサブパスにする。 */
function polyline(pts: ({ x: number; y: number } | null)[]): string {
  const out: string[] = [];
  let open = false;
  for (const p of pts) {
    if (!p) {
      open = false;
      continue;
    }
    out.push(`${open ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    open = true;
  }
  return out.join(' ');
}

function finite(values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v));
}

/** 値 → y 座標。scale.min が下端、scale.max が上端。 */
function projector(scale: Scale, top: number, height: number) {
  const span = scale.max - scale.min || 1;
  return (value: number) => top + height - ((value - scale.min) / span) * height;
}

/** 系列の上下に余白を足した軸レンジ。headroom は 0 から離れる方向にだけ効かせる。 */
function padded(values: number[], headroom: number): [number, number] {
  if (values.length === 0) return [0, 0];
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  return [lo * headroom, hi * headroom];
}

export interface GridLine {
  x1: number;
  x2: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 1. 売上と利益はどう動いた？（棒＋線）
// ---------------------------------------------------------------------------
const W1 = 720;
const H1 = 280;
const L1 = 62;
const R1 = 54;
const T1 = 22;
const B1 = 32;
const BAR_W1 = 44;
/** 棒の上部角丸（README: 上部のみ 7px）。 */
const BAR_RADIUS = 7;
/** 古い期から最新期へ。最新期を最濃にする。グレーの棒は使わない。 */
const BAR_TONES = [
  'var(--chart-teal-1)',
  'var(--chart-teal-1)',
  'var(--chart-teal-2)',
  'var(--chart-teal-2)',
  'var(--chart-teal-3)',
];

export interface RevenueProfitChart {
  viewBox: string;
  grid: GridLine[];
  bars: { d: string; color: string }[];
  linePath: string;
  points: { x: number; y: number }[];
  labels: ChartLabel[];
  hotspots: Hotspot[];
}

export function buildRevenueProfitChart(fy: FiscalPeriod[]): RevenueProfitChart {
  const pw = W1 - L1 - R1;
  const ph = H1 - T1 - B1;
  const step = pw / 5;
  const lab = labeler(W1, H1);

  const revScale = niceScale(...padded(finite(fy.map((f) => f.revenue)), 1.1));
  const opScale = niceScale(...padded(finite(fy.map((f) => f.operatingProfit)), 1.5));
  const yRev = projector(revScale, T1, ph);
  const yOp = projector(opScale, T1, ph);
  const baseline = yRev(0);

  const grid = GRID_TICKS.map((t) => ({ x1: L1, x2: W1 - R1, y: T1 + ph - t * ph }));

  const barGeom = fy.map((f, i) => {
    const cx = L1 + step * i + step / 2;
    if (f.revenue == null) return { cx, top: null as number | null, d: null, color: BAR_TONES[i] };
    // 0 を基点に伸ばす。売上が負になることは無いが、基点を固定しておけば桁が変わっても崩れない。
    const y = yRev(f.revenue);
    const top = Math.min(y, baseline);
    const h = Math.abs(baseline - y);
    return {
      cx,
      top,
      d: topBarPath(cx - BAR_W1 / 2, top, BAR_W1, h, BAR_RADIUS),
      color: BAR_TONES[i],
    };
  });

  const pts = fy.map((f, i) => {
    const x = L1 + step * i + step / 2;
    if (f.operatingProfit == null) return null;
    return { x, y: yOp(f.operatingProfit) };
  });

  const labels: ChartLabel[] = [];
  grid.forEach((g, i) => {
    labels.push(lab(L1 - 10, g.y, num(revScale.ticks[i]), 'var(--ink-muted)', 10, 'right'));
    labels.push(lab(W1 - R1 + 10, g.y, num(opScale.ticks[i]), 'var(--ink-muted)', 10, 'left'));
  });
  fy.forEach((f, i) => {
    const b = barGeom[i];
    if (b.top != null) {
      labels.push(lab(b.cx, b.top - 10, num(f.revenue), 'var(--ink-sub)', 11));
    }
    labels.push(lab(b.cx, H1 - 12, f.label, 'var(--ink-muted)', 11));
  });
  pts.forEach((p, i) => {
    if (!p) return;
    const barTop = barGeom[i].top;
    // 棒に重なる期は点の下へ退避する。
    const below = barTop != null && p.y > barTop - 26;
    labels.push(
      lab(
        p.x,
        below ? p.y + 15 : p.y - 13,
        num(fy[i].operatingProfit),
        'var(--ink-sub)',
        10,
        'center',
        true,
      ),
    );
  });

  const hotspots: Hotspot[] = fy.map((f, i) => {
    const [from, to] = clampBand(L1 + step * i, L1 + step * (i + 1), W1);
    const tops = [barGeom[i].top, pts[i]?.y].filter((v): v is number => v != null);
    return {
      left: pct(from, W1),
      top: pct(T1, H1),
      width: pct(to - from, W1),
      height: pct(ph, H1),
      anchorLeft: pct(barGeom[i].cx, W1),
      anchorTop: pct(tops.length ? Math.min(...tops) : T1 + ph / 2, H1),
      title: `${f.label}期`,
      rows: [
        { name: '売上高', value: f.revenue == null ? EM_DASH : unit(f.revenue, '百万円'), color: BAR_TONES[i] },
        {
          name: '営業利益',
          value: f.operatingProfit == null ? EM_DASH : unit(f.operatingProfit, '百万円'),
          color: 'var(--chart-line)',
        },
      ],
    };
  });

  return {
    viewBox: `0 0 ${W1} ${H1}`,
    grid,
    bars: barGeom
      .filter((b): b is typeof b & { d: string } => b.d != null)
      .map((b) => ({ d: b.d, color: b.color })),
    linePath: polyline(pts),
    points: pts.filter((p): p is { x: number; y: number } => p != null),
    labels,
    hotspots,
  };
}

// ---------------------------------------------------------------------------
// 2. 人とお給料の動き（2 軸折れ線）
// ---------------------------------------------------------------------------
const W2 = 520;
const H2 = 230;
const L2 = 50;
const R2 = 52;
const T2 = 16;
const B2 = 28;

export interface HeadcountSalaryChart {
  viewBox: string;
  grid: GridLine[];
  employeePath: string;
  salaryPath: string;
  employeeDots: { x: number; y: number }[];
  salaryDots: { x: number; y: number }[];
  labels: ChartLabel[];
  hotspots: Hotspot[];
}

export function buildHeadcountSalaryChart(fy: FiscalPeriod[]): HeadcountSalaryChart {
  const pw = W2 - L2 - R2;
  const ph = H2 - T2 - B2;
  const step = pw / 4;
  const lab = labeler(W2, H2);

  const empScale = niceScale(...padded(finite(fy.map((f) => f.employees)), 1.15));
  const salScale = niceScale(...padded(finite(fy.map((f) => f.avgSalary)), 1.15));
  const yEmp = projector(empScale, T2, ph);
  const ySal = projector(salScale, T2, ph);

  const grid = GRID_TICKS.map((t) => ({ x1: L2, x2: W2 - R2, y: T2 + ph - t * ph }));
  const x = (i: number) => L2 + step * i;

  const ePts = fy.map((f, i) => (f.employees == null ? null : { x: x(i), y: yEmp(f.employees) }));
  const sPts = fy.map((f, i) => (f.avgSalary == null ? null : { x: x(i), y: ySal(f.avgSalary) }));

  const labels: ChartLabel[] = [];
  grid.forEach((g, i) => {
    labels.push(lab(L2 - 10, g.y, num(empScale.ticks[i]), 'var(--ink-muted)', 10, 'right'));
    labels.push(lab(W2 - R2 + 10, g.y, num(salScale.ticks[i]), 'var(--ink-muted)', 10, 'left'));
  });
  fy.forEach((f, i) => labels.push(lab(x(i), H2 - 10, f.label, 'var(--ink-muted)', 11)));

  const hotspots: Hotspot[] = fy.map((f, i) => {
    const [from, to] = clampBand(x(i) - step / 2, x(i) + step / 2, W2);
    const tops = [ePts[i]?.y, sPts[i]?.y].filter((v): v is number => v != null);
    return {
      left: pct(from, W2),
      top: pct(T2, H2),
      width: pct(to - from, W2),
      height: pct(ph, H2),
      anchorLeft: pct(x(i), W2),
      anchorTop: pct(tops.length ? Math.min(...tops) : T2 + ph / 2, H2),
      title: `${f.label}期`,
      rows: [
        { name: '従業員数', value: f.employees == null ? EM_DASH : unit(f.employees, '名'), color: 'var(--chart-teal-3)' },
        { name: '平均年収', value: f.avgSalary == null ? EM_DASH : unit(f.avgSalary, '千円'), color: 'var(--chart-line)' },
      ],
    };
  });

  return {
    viewBox: `0 0 ${W2} ${H2}`,
    grid,
    hotspots,
    employeePath: polyline(ePts),
    // 年収が全期欠損なら破線は描かない。
    salaryPath: sPts.every((p) => p == null) ? '' : polyline(sPts),
    employeeDots: ePts.filter((p): p is { x: number; y: number } => p != null),
    salaryDots: sPts.filter((p): p is { x: number; y: number } => p != null),
    labels,
  };
}

// ---------------------------------------------------------------------------
// 3. どの事業で稼いでいる？（積み上げ棒）
// ---------------------------------------------------------------------------
const W3 = 520;
const H3 = 230;
const L3 = 50;
const R3 = 14;
const T3 = 20;
const B3 = 28;
const BAR_W3 = 38;

export const SEGMENT_COLORS = [
  'var(--chart-teal-3)',
  'var(--chart-teal-2)',
  'var(--chart-teal-1)',
];

export interface SegmentChart {
  viewBox: string;
  grid: GridLine[];
  blocks: { x: number; y: number; w: number; h: number; color: string }[];
  labels: ChartLabel[];
  hotspots: Hotspot[];
}

export function buildSegmentChart(fy: FiscalPeriod[]): SegmentChart {
  const pw = W3 - L3 - R3;
  const ph = H3 - T3 - B3;
  const step = pw / 5;
  const lab = labeler(W3, H3);

  // 赤字セグメントは 0 の下へ積む。切り捨てると内訳が合わなくなる。
  const stacks = fy.map((f) => ({
    positive: f.segments.filter((s) => s.value > 0).reduce((a, s) => a + s.value, 0),
    negative: f.segments.filter((s) => s.value < 0).reduce((a, s) => a + s.value, 0),
    total: f.segments.reduce((a, s) => a + s.value, 0),
    hasData: f.segments.length > 0,
  }));

  const scale = niceScale(
    Math.min(0, ...stacks.map((s) => s.negative)) * 1.25,
    Math.max(0, ...stacks.map((s) => s.positive)) * 1.25,
  );
  const y = projector(scale, T3, ph);
  const zero = y(0);

  const grid = GRID_TICKS.map((t) => ({ x1: L3, x2: W3 - R3, y: T3 + ph - t * ph }));
  const blocks: SegmentChart['blocks'] = [];
  const labels: ChartLabel[] = [];

  grid.forEach((g, i) => {
    labels.push(lab(L3 - 10, g.y, num(scale.ticks[i]), 'var(--ink-muted)', 10, 'right'));
  });

  fy.forEach((f, i) => {
    const cx = L3 + step * i + step / 2;
    let up = 0;
    let down = 0;
    f.segments.forEach((s, k) => {
      const color = SEGMENT_COLORS[k % SEGMENT_COLORS.length];
      if (s.value >= 0) {
        const top = y(up + s.value);
        blocks.push({ x: cx - BAR_W3 / 2, y: top, w: BAR_W3, h: Math.abs(y(up) - top), color });
        up += s.value;
      } else {
        const bottom = y(down + s.value);
        blocks.push({ x: cx - BAR_W3 / 2, y: y(down), w: BAR_W3, h: Math.abs(bottom - y(down)), color });
        down += s.value;
      }
    });
    if (stacks[i].hasData) {
      const topY = up > 0 ? y(up) : zero;
      labels.push(lab(cx, topY - 9, num(stacks[i].total), 'var(--ink-sub)', 11));
    }
    labels.push(lab(cx, H3 - 10, f.label, 'var(--ink-muted)', 11));
  });

  const hotspots: Hotspot[] = fy.map((f, i) => {
    const cx = L3 + step * i + step / 2;
    const [from, to] = clampBand(L3 + step * i, L3 + step * (i + 1), W3);
    const top = stacks[i].positive > 0 ? y(stacks[i].positive) : zero;
    return {
      left: pct(from, W3),
      top: pct(T3, H3),
      width: pct(to - from, W3),
      height: pct(ph, H3),
      anchorLeft: pct(cx, W3),
      anchorTop: pct(top, H3),
      title: `${f.label}期`,
      rows: f.segments.length
        ? [
            ...f.segments.map((seg, k) => ({
              name: seg.name,
              value: unit(seg.value, '百万円'),
              color: SEGMENT_COLORS[k % SEGMENT_COLORS.length],
            })),
            { name: '合計', value: unit(stacks[i].total, '百万円') },
          ]
        : [{ name: 'セグメントの内訳', value: EM_DASH }],
    };
  });

  return { viewBox: `0 0 ${W3} ${H3}`, grid, blocks, labels, hotspots };
}

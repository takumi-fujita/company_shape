/**
 * レーダー「会社のかたち」の幾何。
 * 中心 (130,112) / 半径 78 / 頂点角 -90° + i*72°（上から時計回り）。
 * プロットする値は業種内パーセンタイル(0-100)のみ。金額や年数の生値は単位が違うため使用不可。
 */
import { RADAR_SUMMARY } from '../thresholds';
import type { Percentiles } from '../types';
import { clampBand, pct, type Hotspot } from './hotspot';
import { labeler, type ChartLabel } from './labels';

export const RADAR_W = 260;
export const RADAR_H = 224;
const CX = 130;
const CY = 112;
const R = 78;
/** 0% でも頂点が中心に潰れないための最小表示比率。 */
const MIN_RATIO = 0.12;
/** 軸ラベルは外周の 1.24 倍の位置。 */
const LABEL_RATIO = 1.24;

export const RADAR_AXES = [
  { key: 'salary', label: '給与' },
  { key: 'tenure', label: '定着' },
  { key: 'growth', label: '成長' },
  { key: 'scale', label: '規模' },
  { key: 'finance', label: '財務' },
] as const satisfies ReadonlyArray<{ key: keyof Percentiles; label: string }>;

interface Point {
  x: number;
  y: number;
}

function angle(i: number): number {
  return ((-90 + i * 72) * Math.PI) / 180;
}

function point(i: number, ratio: number): Point {
  return {
    x: CX + Math.cos(angle(i)) * R * ratio,
    y: CY + Math.sin(angle(i)) * R * ratio,
  };
}

function polygon(ratios: number[]): string {
  return ratios
    .map((r, i) => {
      const p = point(i, r);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
}

export interface RadarGeometry {
  viewBox: string;
  outer: string;
  mid: string;
  self: string;
  spokes: { x1: number; y1: number; x2: number; y2: number }[];
  dots: Point[];
  labels: ChartLabel[];
  hotspots: Hotspot[];
}

/** 当たり判定の一辺（viewBox 単位）。頂点が中心付近でも重なりすぎない大きさ。 */
const HOTSPOT_SIZE = 40;

export function buildRadar(p: Percentiles): RadarGeometry {
  const values = RADAR_AXES.map((a) => p[a.key]);
  const lab = labeler(RADAR_W, RADAR_H);
  return {
    viewBox: `0 0 ${RADAR_W} ${RADAR_H}`,
    outer: polygon(values.map(() => 1)),
    mid: polygon(values.map(() => 0.5)),
    self: polygon(values.map((v) => Math.max(MIN_RATIO, v / 100))),
    spokes: values.map((_, i) => {
      const q = point(i, 1);
      return { x1: CX, y1: CY, x2: q.x, y2: q.y };
    }),
    dots: values.map((v, i) => point(i, Math.max(MIN_RATIO, v / 100))),
    labels: RADAR_AXES.map((a, i) => {
      const q = point(i, LABEL_RATIO);
      return lab(q.x, q.y, a.label, 'var(--ink-sub)', 11);
    }),
    // 当たり判定は軸ラベルの位置に置く。頂点そのものだと、値が小さい会社で
    // 5 つが中心に集まって重なってしまう。
    hotspots: RADAR_AXES.map((a, i): Hotspot => {
      const anchor = point(i, LABEL_RATIO);
      const [x0, x1] = clampBand(anchor.x - HOTSPOT_SIZE / 2, anchor.x + HOTSPOT_SIZE / 2, RADAR_W);
      const [y0, y1] = clampBand(anchor.y - HOTSPOT_SIZE / 2, anchor.y + HOTSPOT_SIZE / 2, RADAR_H);
      return {
        left: pct(x0, RADAR_W),
        top: pct(y0, RADAR_H),
        width: pct(x1 - x0, RADAR_W),
        height: pct(y1 - y0, RADAR_H),
        anchorLeft: pct(anchor.x, RADAR_W),
        anchorTop: pct(y0, RADAR_H),
        title: a.label,
        rows: [
          { name: '業種内の順位', value: `${values[i]} / 100`, color: 'var(--accent)' },
          { name: '業種のまんなか', value: '50 / 100', color: 'var(--chart-mid)' },
        ],
      };
    }),
  };
}

/**
 * サマリ文の機械生成。55 以上を「上」、45 以下を「下」とするだけで、評価語は使わない。
 * LLM を通さない（ハンドオフ §9-3）。
 */
export function radarSummary(p: Percentiles): string {
  const above = RADAR_AXES.filter((a) => p[a.key] >= RADAR_SUMMARY.above).map((a) => a.label);
  const below = RADAR_AXES.filter((a) => p[a.key] <= RADAR_SUMMARY.below).map((a) => a.label);
  if (above.length === 0 && below.length === 0) {
    return '5 つの角度すべてが業種のまんなか付近です。';
  }
  return (
    (above.length ? `${above.join('・')}は業種のまんなかより上。` : '') +
    (below.length ? `${below.join('・')}は業種のまんなかより下。` : '')
  );
}

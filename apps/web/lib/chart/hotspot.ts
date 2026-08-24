/**
 * グラフのマウスオーバー領域。
 *
 * SVG はサーバー側で書き出したまま触らず、上に透明な当たり判定を重ねる。
 * 値の整形はここ（サーバー側）で済ませ、クライアントには文字列だけ渡す。
 * ブラウザに数値整形のコードを送らずに済むうえ、表記もサーバーと必ず一致する。
 */
export interface HotspotRow {
  name: string;
  /** 整形済みの表示文字列。欠損は「—」。 */
  value: string;
  /** 凡例と同じ色。系列のないものは省く。 */
  color?: string;
}

export interface Hotspot {
  /** 当たり判定の帯（% 座標）。 */
  left: string;
  top: string;
  width: string;
  height: string;
  /** ツールチップの基準点（% 座標）。 */
  anchorLeft: string;
  anchorTop: string;
  title: string;
  rows: HotspotRow[];
}

/** viewBox 座標 → % 文字列。 */
export function pct(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(2)}%`;
}

/** 帯を viewBox の範囲に収める。 */
export function clampBand(from: number, to: number, max: number): [number, number] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(max, Math.max(from, to));
  return [lo, Math.max(lo, hi)];
}

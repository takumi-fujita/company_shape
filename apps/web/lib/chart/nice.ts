/**
 * 軸の目盛を「丸い数字」にする。会社ごとに桁が違うため固定値は使えない。
 * ステップは 1 / 2 / 2.5 / 5 × 10^n。分割数は 4（グリッド線 5 本）。
 */

/** raw 以上で最小の「丸い」値。 */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return (([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag);
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  /** min から max まで、分割数 + 1 本ぶんの目盛値。 */
  ticks: number[];
}

/**
 * [lo, hi] を含む目盛を作る。必ず 0 を含む（棒の基点になるため）。
 *
 * 営業利益は赤字なら負になる。負の値を切り捨てると折れ線が viewBox の外へ飛ぶので、
 * 下限も丸めて軸に入れること。0 は step の倍数になるため、必ず目盛線が 0 を通る。
 */
export function niceScale(lo: number, hi: number, divisions = 4): Scale {
  let low = Number.isFinite(lo) ? Math.min(0, lo) : 0;
  let high = Number.isFinite(hi) ? Math.max(0, hi) : 0;
  if (low === 0 && high === 0) high = 1;

  let step = niceStep((high - low) / divisions);
  for (let guard = 0; guard < 32; guard += 1) {
    const min = Math.floor(low / step) * step;
    const max = min + step * divisions;
    if (max >= high - 1e-9) {
      const ticks = Array.from({ length: divisions + 1 }, (_, i) => min + step * i);
      return { min, max, step, ticks };
    }
    step = niceStep(step * 1.5);
  }
  // ここには来ない（step は単調増加する）が、軸を壊さないための保険。
  const ticks = Array.from({ length: divisions + 1 }, (_, i) => low + ((high - low) / divisions) * i);
  return { min: low, max: high, step: (high - low) / divisions, ticks };
}

/** 0 起点の軸の上限。正の値しか取らない系列（売上・従業員数）用。 */
export function niceMax(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 4;
  return niceScale(0, v).max;
}

/** 上部だけ角丸の棒（README: 棒グラフは上部のみ 7px）。 */
export function topBarPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return (
    `M ${x} ${y + h} L ${x} ${y + rr}` +
    ` Q ${x} ${y} ${x + rr} ${y}` +
    ` L ${x + w - rr} ${y}` +
    ` Q ${x + w} ${y} ${x + w} ${y + rr}` +
    ` L ${x + w} ${y + h} Z`
  );
}

/** 0 / 0.25 / 0.5 / 0.75 / 1 の 4 分割グリッド比率。 */
export const GRID_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * 閾値の唯一の定義箇所。
 *
 * ここに書かれているのは「どの数値で表示を切り替えるか」だけであり、
 * 企業の良し悪しの判定ではない。UI 側には評価語を出さない（README 配色の絶対ルール 2、
 * ハンドオフ §9）。閾値を変えるときは必ずここだけを変えること。
 */

/** 手元のお金で払える月数（現預金 ÷ 毎月の費用）。 */
export const RUNWAY = {
  /** 12 ヶ月 = 1 会計年度。1 期を通して手元資金だけで賄えるかどうかの境目。 */
  warn: 12,
  /** 6 ヶ月 = 有報の提出間隔（四半期報告 2 回分）。次の開示までの期間の目安。 */
  danger: 6,
} as const;

/** 平均年収。業種中央値に対する比率で表示を切り替える。 */
export const SALARY = {
  /** 中央値の 85% 未満。中央値からの乖離が丸め誤差では説明できない水準。 */
  warnRatio: 0.85,
} as const;

/** 平均勤続年数。 */
export const TENURE = {
  /** 中央値の 60% 未満。 */
  warnRatio: 0.6,
} as const;

/** 従業員数の前期比。 */
export const HEADCOUNT = {
  /** 前期比マイナス。 */
  warnPercent: 0,
  /** 前期比 -10% 未満。 */
  dangerPercent: -10,
} as const;

/** パーセンタイルのサマリ文を機械生成する境目（README: 55 以上を「上」、45 以下を「下」）。 */
export const RADAR_SUMMARY = {
  above: 55,
  below: 45,
} as const;

export type Level = 'alert' | 'warn' | null;

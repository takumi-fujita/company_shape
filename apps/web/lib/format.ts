/**
 * 表示整形の唯一の入口。欠損は必ず「—」、数字と単位の間は半角スペース。
 * ここ以外で toLocaleString を呼ばないこと。
 */

export const EM_DASH = '—';

/** 数値を ja-JP 桁区切りで。null / NaN は「—」。 */
export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return v.toLocaleString('ja-JP', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 数値 + 単位。欠損時は単位を付けずに「—」だけを返す。 */
export function unit(v: number | null | undefined, u: string, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return `${num(v, digits)} ${u}`;
}

/** 符号付き。マイナスは全角相当の「−」(U+2212) で桁を揃える。 */
export function signed(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return (v >= 0 ? '+' : '−') + num(Math.abs(v), digits);
}

export const employees = (v: number | null | undefined) => unit(v, '名');
export const salary = (v: number | null | undefined) => unit(v, '千円');
export const tenure = (v: number | null | undefined) => unit(v, '年', 1);
export const yen = (v: number | null | undefined) => unit(v, '百万円');
export const months = (v: number | null | undefined) => unit(v, 'ヶ月', 1);
export const count = (v: number | null | undefined) => unit(v, '件');

export function percent(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return `${num(v, digits)}%`;
}

export function signedPercent(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return EM_DASH;
  return `${signed(v, digits)}%`;
}

/** YYYY-MM-DD → YYYY/MM/DD。 */
export function date(v: string | null | undefined): string {
  if (!v) return EM_DASH;
  return v.replaceAll('-', '/');
}

/** YYYY-MM → YYYY年M月期。 */
export function fiscalPeriodLabel(v: string | null | undefined): string {
  if (!v) return EM_DASH;
  const [y, m] = v.split('-');
  if (!y || !m) return EM_DASH;
  return `${y}年${Number(m)}月期`;
}

/**
 * 検索用の正規化。全角英数→半角、ひらがな→カタカナ、大文字→小文字。
 * 検索インデックス生成時とクライアント側の入力の両方で同じ関数を通すこと。
 */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s　・･,、.。]/g, '');
}

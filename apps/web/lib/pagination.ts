/**
 * 一覧のページネーション。
 *
 * 3,706 社を 10 件ずつにすると 371 ページになるので、全ページ番号は並べられない。
 * 先頭・末尾・現在地の前後だけを出し、間を省略する。
 */

/** 1 ページの件数の選択肢。 */
export const PAGE_SIZE_OPTIONS = [10, 50, 100] as const;

/** 既定の件数。テーブルは 1 行 56px 前後なので、スクロールして見る量として 50 が扱いやすい。 */
export const DEFAULT_PAGE_SIZE = 50;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type PageItem = number | 'ellipsis';

export function isPageSize(v: unknown): v is PageSize {
  return PAGE_SIZE_OPTIONS.includes(Number(v) as PageSize);
}

/** URL から受け取った値を安全な件数に丸める。 */
export function parsePageSize(value: string | null | undefined): PageSize {
  return isPageSize(value) ? (Number(value) as PageSize) : DEFAULT_PAGE_SIZE;
}

export function totalPages(totalItems: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

/** URL から受け取ったページ番号を 1..total に丸める。 */
export function clampPage(value: string | number | null | undefined, total: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, total));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

/**
 * 表示するページ番号の並び。
 *
 * siblings=1 なら最大 7 個（1 … 7 [8] 9 … 371）。
 * 34px のピル 7 個 + 隙間で 380px にも収まる幅。
 */
export function buildPageItems(current: number, total: number, siblings = 1): PageItem[] {
  const last = Math.max(1, total);
  const cur = Math.min(Math.max(1, current), last);

  // 先頭 + 省略 + (現在地の前後) + 省略 + 末尾
  const maxItems = siblings * 2 + 5;
  if (last <= maxItems) return range(1, last);

  const left = Math.max(cur - siblings, 1);
  const right = Math.min(cur + siblings, last);
  const hasLeftGap = left > 2;
  const hasRightGap = right < last - 1;

  if (!hasLeftGap && hasRightGap) {
    return [...range(1, Math.max(right, siblings * 2 + 3)), 'ellipsis', last];
  }
  if (hasLeftGap && !hasRightGap) {
    return [1, 'ellipsis', ...range(Math.min(left, last - (siblings * 2 + 2)), last)];
  }
  return [1, 'ellipsis', ...range(left, right), 'ellipsis', last];
}

/** 「該当 M 件中 X〜Y 件」の X と Y。 */
export function pageRange(page: number, pageSize: number, totalItems: number) {
  if (totalItems === 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(page * pageSize, totalItems) };
}

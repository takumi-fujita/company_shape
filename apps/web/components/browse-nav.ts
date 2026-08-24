'use client';

import { createContext, useContext } from 'react';

/**
 * 一覧（レイアウト側）とドロワー（BrowseShell）のあいだの受け渡し。
 *
 * 一覧は絞り込み後の並び順を持っているが、前へ / 次へ を出すのはドロワー側。
 * 逆にドロワーは「いまどの会社を開いているか」を知っているが、背後の一覧は
 * その会社を含むページを表示していてほしい。双方向に 1 つずつ渡している。
 */
export interface BrowseNav {
  /** ドロワーで開いている会社。一覧を見ているときは null。 */
  currentCode: string | null;
  /** 一覧側から、絞り込み後の並び順と「戻り先の URL」を伝える。 */
  report: (info: BrowseNavInfo) => void;
}

export interface BrowseNavInfo {
  /** 絞り込み・並び替え後の全件。ページをまたいで前へ / 次へ で辿る。 */
  order: string[];
  /** 閉じたときに戻る URL。絞り込みとページ番号を含む。 */
  listHref: string;
}

export const BrowseNavContext = createContext<BrowseNav | null>(null);

/** シェルの外（業種ページなど）では null。 */
export function useBrowseNav(): BrowseNav | null {
  return useContext(BrowseNavContext);
}

'use client';

import { useRouter } from 'next/navigation';
import CompanyRows from './CompanyRows';
import styles from './CompanyBrowser.module.css';
import type { IndustryStat, SearchIndexEntry } from '@/lib/types';

/**
 * 行のどこを押しても会社を開ける一覧。ドロワーを持つ /companies 専用。
 *
 * 行ごとに onClick を置くと、その行がすべてクライアントコンポーネントになる。
 * 一覧は 1 ページ最大 100 件なので問題ないが、同じ部品を使うランキングページは
 * 596 社 × 2 = 1,192 行あり、ハイドレーションの費用が見合わない。
 * ここでは包む側で 1 つだけ受けて、押された行の data-href へ飛ばす。
 */
interface Props {
  entries: SearchIndexEntry[];
  statsByIndustry: Map<string, IndustryStat>;
  activeCode?: string | null;
  keepScroll?: boolean;
}

export default function CompanyTable({ keepScroll = false, ...rest }: Props) {
  const router = useRouter();

  return (
    <div
      className={styles.rowsWrap}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        // リンクそのものを押したときは Link に任せる（二重遷移を避ける）。
        if (el.closest('a')) return;
        const href = el.closest<HTMLElement>('[data-href]')?.dataset.href;
        if (href) router.push(href, { scroll: !keepScroll });
      }}
    >
      <CompanyRows {...rest} keepScroll={keepScroll} />
    </div>
  );
}

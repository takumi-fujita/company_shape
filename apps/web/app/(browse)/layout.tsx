import BrowseShell from '@/components/BrowseShell';

/**
 * 一覧と詳細で共有するレイアウト。
 *
 * 一覧をここに置くのが要点。App Router のレイアウトは遷移をまたいで
 * 生き残るので、詳細へ移っても一覧は再描画されず、絞り込みも読み位置も
 * そのまま残る。詳細はその上に重なるドロワーとして出る。
 *
 * ルートグループ (browse) は URL に出ない。/companies/ も
 * /company/[edinetCode]/ もパスは変わらない。
 *
 * ここでは DB を読まない。読むと 4,290 の詳細ページすべてに、一覧しか
 * 使わないデータが載る。一覧が必要なものは一覧が実行時に取りに行く。
 */
export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return <BrowseShell>{children}</BrowseShell>;
}

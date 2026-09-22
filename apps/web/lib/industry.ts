/**
 * 業種が引けているかどうか。
 *
 * EDINET には有報を出す会社がすべて載るが、業種は JPX の「東証上場銘柄一覧」から
 * 引いている。そのため**東証に上場していない会社**には業種が付かない（4,290 社中 606 社）。
 * 札証・福証などの単独上場が中心で、上場廃止や取りこぼしではない。
 *
 * その 606 社は industry_code = 'unknown' / industry_label = '分類なし' でまとめられるが、
 * これは業種ではなく「東証以外」という括りにすぎない。バス会社と建設会社と銀行が
 * 同居しているので、この母集団での順位・中央値比較には意味がない。
 *
 * よって業種内の相対評価（レーダー、中央値との比較、業種ランキング）は出さない。
 * 会社ごとの実数そのものは問題なく出せるので、ページ自体は通常どおり作る。
 */
export const UNKNOWN_INDUSTRY = 'unknown';

/** 業種内の比較を出してよいか。pipeline/industries.py の UNKNOWN と対応する。 */
export function hasIndustry(industryCode: string | null | undefined): boolean {
  return !!industryCode && industryCode !== UNKNOWN_INDUSTRY;
}

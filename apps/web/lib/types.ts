// README「データ契約」の型。data/companies.db のスキーマと 1:1 で対応する。
// 単位: 金額=百万円 / 給与=千円 / 勤続=年 / 余力=月。フロントで単位変換はしない。

export interface Segment {
  name: string;
  value: number; // 百万円
}

export interface FiscalPeriod {
  label: string; // "26/3"
  seq: number; // 0=最古 .. 4=最新
  revenue: number | null; // 百万円
  operatingProfit: number | null; // 百万円
  employees: number | null;
  avgSalary: number | null; // 千円
  segments: Segment[]; // 最大 3
}

export interface Subsidy {
  year: number;
  name: string;
  amount: number; // 百万円
  ratio: number | null; // 売上比 %
  source: string; // gbizinfo
}

/**
 * 補助金テーブルの 1 行。同じ年度の同じ制度をまとめたもの。
 * count は元になった交付決定の件数（1 なら「（N件）」は出さない）。
 */
export interface SubsidyRow extends Subsidy {
  count: number;
}

/** 業種内パーセンタイル 0-100。ETL 側で確定済み。欠損は 50。 */
export interface Percentiles {
  salary: number;
  tenure: number;
  growth: number;
  scale: number;
  finance: number;
}

export interface Company {
  edinetCode: string;
  corpNumber: string | null;
  name: string;
  nameKana: string | null;
  market: string | null; // プライム / スタンダード / グロース
  secCode: string | null;
  industryCode: string;
  industryLabel: string;
  fiscalEnd: string | null; // YYYY-MM
  filedAt: string | null; // YYYY-MM-DD
  consolidated: boolean;
  employees: number | null;
  avgSalary: number | null; // 千円
  avgTenure: number | null; // 年
  cash: number | null; // 百万円
  monthlyCost: number | null; // 百万円
  runway: number | null; // 月
  growth: number | null; // 5期売上CAGR %
  summary: string | null;
  tags: string[] | null;
  updatedAt: string;
  fiscalPeriods: FiscalPeriod[];
  subsidies: Subsidy[];
  percentiles: Percentiles;
}

export interface IndustryStat {
  industryCode: string;
  industryLabel: string;
  companyCount: number;
  medianSalary: number | null; // 千円
  medianTenure: number | null; // 年
}

/** /companies が読む検索インデックスの 1 行。フィールドを増やさないこと（gzip 2MB 上限）。 */
export interface SearchIndexEntry {
  edinetCode: string;
  name: string;
  nameKana: string | null;
  secCode: string | null;
  industryCode: string;
  industryLabel: string;
  market: string | null;
  employees: number | null;
  avgSalary: number | null;
  avgTenure: number | null;
  runway: number | null;
}

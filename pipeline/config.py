"""ETL の設定と勘定科目マッピング。

抽出対象の要素名を変えるときはここだけを触る。
"""
import os

# --- EDINET API v2 -----------------------------------------------------------
EDINET_BASE = "https://api.edinet-fsa.go.jp/api/v2"
#: API v2 は購読キー必須。環境変数から読む（リポジトリに書かない）。
EDINET_API_KEY = os.environ.get("EDINET_API_KEY")
#: 有価証券報告書
DOC_TYPE_ASR = "120"
#: 様式コード。030000 = 有価証券報告書（内国会社）。
#: 投資信託や外国会社は別の様式コードなので、ここで事業会社に絞る。
FORM_CODE_ASR = "030000"

#: API 失敗時は指数バックオフで 3 回リトライ。それでも駄目ならその会社だけスキップして続行。
MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 2.0
REQUEST_TIMEOUT = 60

# --- gBizINFO -----------------------------------------------------------------
GBIZINFO_BASE = "https://info.gbiz.go.jp/hojin/v1"
#: 法人番号キーの補助金情報。トークン必須（環境変数から読む）。
GBIZINFO_API_TOKEN = os.environ.get("GBIZINFO_API_TOKEN")

#: 補助金テーブルに出す年度数（README「合計（直近 4 年度）」）。
SUBSIDY_YEARS = 4

# --- 単位 --------------------------------------------------------------------
#: XBRL の金額は円。DB 投入時点で百万円に確定させる。
YEN_PER_MILLION = 1_000_000
#: 平均年収は円で報告される。千円に確定させる。
YEN_PER_THOUSAND = 1_000

# --- 勘定科目マッピング -------------------------------------------------------
# 名前空間接頭辞は無視し、ローカル名で引く（EDINET のタクソノミ年度差を吸収するため）。

#: 文書・企業情報（jpdei_cor）
DEI = {
    "edinet_code": "EDINETCodeDEI",
    "name": "FilerNameInJapaneseDEI",
    "sec_code": "SecurityCodeDEI",
    "corp_number": "JapaneseCorporateNumberDEI",
    "fiscal_year_end": "CurrentFiscalYearEndDateDEI",
    "consolidated": "WhetherConsolidatedFinancialStatementsArePreparedDEI",
}

#: 「主要な経営指標等の推移」。1 通の有報で 5 期分が取れる唯一の場所。
SUMMARY = {
    "revenue": [
        "NetSalesSummaryOfBusinessResults",
        "RevenuesIFRSSummaryOfBusinessResults",
        "OperatingRevenue1SummaryOfBusinessResults",
    ],
    "employees": ["NumberOfEmployees"],
}

#: 財務諸表本表（jppfs_cor）。当期と前期の 2 期しか取れない。
STATEMENTS = {
    "revenue": ["NetSales", "OperatingRevenue1", "RevenueIFRS", "NetSalesOfCompletedConstructionContracts"],
    "operating_profit": ["OperatingIncome", "OperatingIncomeLoss", "OperatingProfitLossIFRS"],
    "cash": ["CashAndDeposits", "CashAndCashEquivalents", "CashAndDepositsAtEnd"],
}

#: 「従業員の状況」（jpcrp_cor）。当期のみ。
EMPLOYEES = {
    "employees": ["NumberOfEmployees"],
    "avg_salary": [
        "AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees",
    ],
    "avg_tenure_years": [
        "AverageLengthOfServiceYearsInformationAboutReportingCompanyInformationAboutEmployees",
    ],
    "avg_tenure_months": [
        "AverageLengthOfServiceMonthsInformationAboutReportingCompanyInformationAboutEmployees",
    ],
    "avg_age_years": [
        "AverageAgeYearsInformationAboutReportingCompanyInformationAboutEmployees",
    ],
}

#: AI 要約の入力になる原文。
TEXT_BLOCKS = {
    "description_of_business": ["DescriptionOfBusinessTextBlock"],
}

#: セグメント情報。次元（Member）付きの営業利益を拾う。
SEGMENT = {
    "operating_profit": ["OperatingIncomeLoss", "OperatingIncome", "SegmentProfitLoss"],
}

#: セグメント内訳から落とす標準タクソノミのメンバー（ローカル名の完全一致）。
#: これらは事業ではなく集計行・調整額。内訳として並べると、報告セグメント計が
#: 最大の「事業」として出てしまい、何で稼いでいるのかを読み違えさせる。
#:
#: 完全一致で見ること。提出会社が自前で立てるメンバーは
#: "CoreReportableSegmentsMember" のように接頭辞が付くので、
#: 部分一致にすると実在の事業まで落ちる。
SEGMENT_AGGREGATE_MEMBERS = {
    "ReportableSegmentsMember",  # 報告セグメント計
    "ReconcilingItemsMember",    # 調整額
}

#: 標準タクソノミのメンバーは提出書類のラベルリンクベースに含まれないため、
#: label_for_member では名前が引けない。表示名をここで与える。
SEGMENT_MEMBER_LABELS = {
    "OperatingSegmentsNotIncludedInReportableSegmentsAndOtherRevenueGeneratingBusinessActivitiesMember": "その他",
    "OtherReportableSegmentsMember": "その他",
}

#: 保持する期数。
PERIODS = 5

# --- 妥当性の範囲 -------------------------------------------------------------
# 提出会社側の XBRL タグ付けに誤りがあり、平均年間給与を 1000 倍・1/1000 で
# 出している会社が実在する（例: 4,950 円 / 8,759,000,000 円）。
# 桁を推測して直すと「原文に無い数値」を出すことになるので、**補正はしない**。
# 範囲の外に出た値は欠損として扱い、UI では「—」になる。
#
# 範囲は「上場企業として現実に取り得る幅」で、境界の会社を落とさないよう広めに取る。
SANE_RANGES = {
    # 千円。100 万円〜5,000 万円。最低賃金水準の下限と、M&A 系など高額企業の上限。
    "avg_salary": (1000, 50000),
    # 年。設立直後は 0.1 年、老舗でも 40 年台が上限。
    "avg_tenure": (0.1, 60),
    # 名。
    "employees": (1, 1000000),
}

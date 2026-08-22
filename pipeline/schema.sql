-- 会社のかたち / SQLite スキーマ
-- これがフロント(apps/web)と ETL(pipeline)の唯一の境界。
-- 単位はこの時点で確定させる: 金額=百万円 / 給与=千円 / 期間=月・年。
-- フロント側では単位変換を一切行わない。

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS companies (
  edinet_code     TEXT PRIMARY KEY,
  corp_number     TEXT,
  name            TEXT NOT NULL,
  name_kana       TEXT,
  market          TEXT,          -- プライム / スタンダード / グロース
  sec_code        TEXT,
  industry_code   TEXT NOT NULL, -- 33業種分類
  industry_label  TEXT NOT NULL,
  fiscal_end      TEXT,          -- YYYY-MM
  filed_at        TEXT,          -- YYYY-MM-DD 有報提出日
  consolidated    INTEGER,       -- 1=連結 / 0=単体。5期で一貫させること(5.1)
  employees       INTEGER,
  avg_salary      INTEGER,       -- 千円 / null 可
  avg_tenure      REAL,          -- 年 / null 可
  cash            INTEGER,       -- 百万円
  monthly_cost    INTEGER,       -- 百万円
  runway          REAL,          -- 月数 / null 可 (monthly_cost <= 0 なら null)
  growth          REAL,          -- 5期売上CAGR % / null 可
  summary         TEXT,          -- AI要約 / null 可 (ガード不合格は null)
  tags            TEXT,          -- JSON配列 / null 可
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  edinet_code      TEXT NOT NULL,
  label            TEXT NOT NULL,   -- "26/3"
  seq              INTEGER NOT NULL,-- 0=最古 .. 4=最新
  revenue          INTEGER,         -- 百万円
  operating_profit INTEGER,         -- 百万円
  employees        INTEGER,
  avg_salary       INTEGER,         -- 千円
  segments         TEXT,            -- JSON [{name, value}] 最大3
  PRIMARY KEY (edinet_code, seq)
);

CREATE TABLE IF NOT EXISTS subsidies (
  edinet_code TEXT NOT NULL,
  year        INTEGER NOT NULL,
  name        TEXT NOT NULL,
  amount      INTEGER NOT NULL,     -- 百万円
  ratio       REAL,                 -- 売上比 % / 売上不明の年度は null
  source      TEXT                  -- gbizinfo
);

-- レーダー用。ビルド時ではなく ETL 側で算出して確定値を持つ。
-- 0-100。欠損は 50。母集団 10 社未満の業種は大分類にフォールバック(5.4)。
CREATE TABLE IF NOT EXISTS percentiles (
  edinet_code TEXT PRIMARY KEY,
  salary      INTEGER NOT NULL,
  tenure      INTEGER NOT NULL,
  growth      INTEGER NOT NULL,
  scale       INTEGER NOT NULL,
  finance     INTEGER NOT NULL
);

-- 業種内中央値。スコアカードの「業種中央値との差」に使う。
CREATE TABLE IF NOT EXISTS industry_stats (
  industry_code  TEXT PRIMARY KEY,
  industry_label TEXT NOT NULL,
  company_count  INTEGER NOT NULL,
  median_salary  INTEGER,           -- 千円 / null 可
  median_tenure  REAL               -- 年 / null 可
);

CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry_code);
CREATE INDEX IF NOT EXISTS idx_periods_company    ON fiscal_periods(edinet_code);
CREATE INDEX IF NOT EXISTS idx_subsidies_company  ON subsidies(edinet_code);

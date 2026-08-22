#!/usr/bin/env python3
"""Phase 0: ダミー 14 社から fixtures/companies.json と data/companies.db を生成する。

このスクリプトが Phase 0 のデータ源。実データ投入(Phase 2)以降は
pipeline/main.py が同じスキーマに書き込み、本スクリプトは開発用フィクスチャ専用になる。

重要:
- 5 期の系列をここで合成しているのは「ダミーだから」であって、本番 ETL では
  実データのみを入れる。フロント側には合成ロジックを一切持たせない。
- パーセンタイル・業種中央値・runway・growth の算出はすべてこちら(ETL 側)の責務。
  フロントは算出済みの確定値を読むだけ。
- 算出ロジックの本体は transform/ にある。ここはフィクスチャの素材を持つだけ。
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from transform import subsidy as subsidy_tx  # noqa: E402
from transform.derive import cagr, derive_runway  # noqa: E402
from transform.percentile import median, percentile  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "companies.db")
JSON_PATH = os.path.join(ROOT, "fixtures", "companies.json")
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")

INDUSTRIES = {
    "software": "ソフトウェア開発",
    "si": "SI・受託開発",
    "web": "Webサービス",
    "telecom": "情報通信インフラ",
}

# name, kana, industry, market, sec_code, emp, salary(千円), tenure(年),
# cash(百万円), monthly_cost(百万円), growth(%), summary, tags
BASE = [
    dict(name="株式会社ミナトソフトウェア", kana="ミナトソフトウエア", ind="software", market="グロース",
         code="4213", emp=312, sal=6480, ten=5.8, cash=2180, cost=118, growth=10.1,
         summary="企業向けの受託システム開発が売上の約 7 割。残りは自社パッケージの保守と運用サポート。取引先は金融と製造が中心で、大手 SIer の下請けではなく元請けで入る案件が多い。近年は自社プロダクトの比率を少しずつ増やしている。",
         tags=["受託開発", "元請け中心", "金融・製造", "自社製品あり"]),
    dict(name="クレイン・テクノロジー株式会社", kana="クレインテクノロジー", ind="software", market="プライム",
         code="3822", emp=401, sal=6910, ten=8.4, cash=1420, cost=151, growth=6.4,
         summary="通信キャリア向けの基幹システム開発が主力。長期の保守契約が売上の半分を占め、残りはクラウド移行支援。海外拠点はなく、国内大手 3 社との取引に集中している。",
         tags=["通信向け", "長期保守", "大口取引"]),
    dict(name="株式会社アオイシステムズ", kana="アオイシステムズ", ind="si", market="スタンダード",
         code="2947", emp=268, sal=6320, ten=9.1, cash=1980, cost=92, growth=4.8,
         summary="自治体・公共向けの業務システムの受託開発が中心。案件は入札経由が多く、年度後半に売上が偏る。5 年以上の継続案件が売上の 6 割。",
         tags=["公共向け", "入札案件", "継続比率高"]),
    dict(name="株式会社ノースブリッジ", kana="ノースブリッジ", ind="web", market="グロース",
         code="4477", emp=196, sal=5840, ten=3.9, cash=460, cost=96, growth=17.5,
         summary="個人向けサブスクリプション型 Web サービスを 2 本運営。広告費が費用の約 4 割を占め、売上は会員数の増減に連動する。法人向けは今期から開始。",
         tags=["toC", "サブスク", "広告費が大きい"]),
    # 要約なし(AI 要約カードごと非表示)
    dict(name="セキネ情報システム株式会社", kana="セキネジヨウホウシステム", ind="si", market="プライム",
         code="9713", emp=1342, sal=6180, ten=12.6, cash=6100, cost=377, growth=3.6),
    # 補助金 0 件
    dict(name="株式会社リヴァータイド", kana="リヴアータイド", ind="web", market="グロース",
         code="4092", emp=158, sal=6050, ten=4.2, cash=690, cost=53, growth=14.2, no_subsidy=True),
    dict(name="ハヤカワ通信工業株式会社", kana="ハヤカワツウシンコウギヨウ", ind="telecom", market="プライム",
         code="1908", emp=2860, sal=7240, ten=15.2, cash=18400, cost=742, growth=2.4),
    # 平均年収 null（有報に記載なし）
    dict(name="株式会社コトブキデジタル", kana="コトブキデジタル", ind="web", market="スタンダード",
         code="3771", emp=342, sal=None, ten=6.1, cash=1240, cost=111, growth=8.2),
    # 5 期揃わない（決算期変更で最古期の売上・利益が取れない）
    dict(name="サガミ・ソリューションズ株式会社", kana="サガミソリユーシヨンズ", ind="si", market="スタンダード",
         code="2688", emp=512, sal=5720, ten=10.4, cash=2460, cost=168, growth=5.1, gap_oldest=True),
    # 従業員数が前期比 -10% 超（alert）
    dict(name="株式会社トウカイラボ", kana="トウカイラボ", ind="software", market="グロース",
         code="4386", emp=121, sal=6740, ten=3.2, cash=380, cost=68, growth=15.8, emp_trend=-1),
    dict(name="ミヤコネットワークス株式会社", kana="ミヤコネツトワークス", ind="telecom", market="プライム",
         code="1922", emp=1810, sal=6960, ten=14.1, cash=9800, cost=497, growth=3.1),
    # 営業費用が抽出できず runway = null
    dict(name="株式会社シラハマデータ", kana="シラハマデータ", ind="software", market="スタンダード",
         code="4155", emp=224, sal=6210, ten=7.6, cash=1120, cost=None, growth=7.4),
    dict(name="オオタキ・インテグレーション株式会社", kana="オオタキインテグレーシヨン", ind="si", market="プライム",
         code="9455", emp=3120, sal=7080, ten=13.8, cash=21200, cost=946, growth=2.9),
    dict(name="株式会社カザハヤ工房", kana="カザハヤコウボウ", ind="web", market="グロース",
         code="4021", emp=86, sal=5980, ten=2.8, cash=190, cost=56, growth=12.6),
]

SEG_NAMES = ["主力事業", "関連サービス", "保守・その他"]

#: 交付年度, 制度名, 直近売上に対する割合。gBizINFO の生レコード相当を作るための素材。
SUBSIDY_BASE = [
    (2025, "IT導入補助金（複数社連携枠）", 0.0030),
    (2024, "事業再構築補助金（成長枠）", 0.0110),
    (2023, "キャリアアップ助成金", 0.0004),
    (2022, "中小企業DX推進支援助成金", 0.0013),
    # 5 年度目。表と合計行が「直近 4 年度」で切られることを確かめるために置いている。
    (2021, "ものづくり補助金（一般型）", 0.0021),
]


def build_periods(c):
    """5 期の系列。ダミー専用の決定論的な合成。"""
    out = []
    rev0 = round(c["emp"] * 30)
    rate = 1 + (c.get("growth") or 8) / 100.0
    trend = c.get("emp_trend", 1)
    for i in range(5):
        rev = int(round(rev0 * (rate ** i) / 10.0) * 10)
        op = int(round(rev * (0.05 + 0.005 * i)))
        if trend >= 0:
            emp = int(round(c["emp"] * (1 - 0.055 * (4 - i))))
        else:  # 直近期に大きく減らす
            emp = int(round(c["emp"] * (1 + 0.075 * (4 - i))))
        sal = None if c["sal"] is None else int(round((c["sal"] - 60 * (4 - i)) / 10.0) * 10)
        s0 = int(round(op * 0.45))
        s1 = int(round(op * 0.33))
        segments = [
            {"name": SEG_NAMES[0], "value": s0},
            {"name": SEG_NAMES[1], "value": s1},
            {"name": SEG_NAMES[2], "value": op - s0 - s1},
        ]
        row = {
            "label": "%d/3" % (22 + i),
            "seq": i,
            "revenue": rev,
            "operatingProfit": op,
            "employees": emp,
            "avgSalary": sal,
            "segments": segments,
        }
        if c.get("gap_oldest") and i == 0:
            # 期間不整合は推定で埋めず null にする(5.1)
            row.update({"revenue": None, "operatingProfit": None, "segments": []})
        out.append(row)
    return out






def build():
    companies = []
    for b in BASE:
        periods = build_periods(b)
        last_rev = periods[-1]["revenue"]
        edinet = "E0" + b["code"]
        # gBizINFO の生レコード相当を作り、本番と同じ transform/subsidy で正規化する。
        raw = []
        if not b.get("no_subsidy"):
            shift = 1 if b.get("gap_oldest") else 0  # 1 年ずらして ratio=null を作る
            for idx, (year, name, f) in enumerate(SUBSIDY_BASE):
                rev = periods[4 - idx]["revenue"] or periods[-1]["revenue"]
                raw.append({
                    "title": name,
                    "amount": max(1_000_000, int(round(rev * f)) * 1_000_000),
                    "date_of_approval": "%d-06-01" % (year - shift),
                })
        subsidies = subsidy_tx.recent(subsidy_tx.normalize(raw, periods))
        companies.append({
            "edinetCode": edinet,
            "corpNumber": "70100010" + b["code"] + "0",
            "name": b["name"],
            "nameKana": b["kana"],
            "market": b["market"],
            "secCode": b["code"],
            "industryCode": b["ind"],
            "industryLabel": INDUSTRIES[b["ind"]],
            "fiscalEnd": "2026-03",
            "filedAt": "2026-06-26",
            "consolidated": True,
            "employees": b["emp"],
            "avgSalary": b["sal"],
            "avgTenure": b["ten"],
            "cash": b["cash"],
            "monthlyCost": b["cost"],
            "runway": derive_runway(b["cash"], b["cost"]),
            "growth": cagr(periods),
            "summary": b.get("summary"),
            "tags": b.get("tags"),
            "updatedAt": "2026-08-20",
            "fiscalPeriods": periods,
            "subsidies": subsidies,
            "_lastRevenue": last_rev,
        })

    # --- 業種内パーセンタイル・中央値（母集団 10 社未満は全社にフォールバック） ---
    by_ind = {}
    for c in companies:
        by_ind.setdefault(c["industryCode"], []).append(c)

    stats = []
    for code, group in sorted(by_ind.items()):
        pool = group if len(group) >= 10 else companies
        for c in group:
            c["percentiles"] = {
                "salary": percentile([x["avgSalary"] for x in pool], c["avgSalary"]),
                "tenure": percentile([x["avgTenure"] for x in pool], c["avgTenure"]),
                "growth": percentile([x["growth"] for x in pool], c["growth"]),
                "scale": percentile([x["employees"] for x in pool], c["employees"]),
                "finance": percentile([x["runway"] for x in pool], c["runway"]),
            }
        stats.append({
            "industryCode": code,
            "industryLabel": INDUSTRIES[code],
            "companyCount": len(group),
            "medianSalary": median([x["avgSalary"] for x in group]),
            "medianTenure": median([x["avgTenure"] for x in group]),
        })

    for c in companies:
        c.pop("_lastRevenue", None)
    return companies, stats


def write_json(companies, stats):
    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({"companies": companies, "industryStats": stats}, f,
                  ensure_ascii=False, indent=2)
        f.write("\n")


def write_db(companies, stats):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        conn.executescript(f.read())
    for c in companies:
        conn.execute(
            """INSERT INTO companies (edinet_code, corp_number, name, name_kana, market,
                 sec_code, industry_code, industry_label, fiscal_end, filed_at, consolidated,
                 employees, avg_salary, avg_tenure, cash, monthly_cost, runway, growth,
                 summary, tags, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (c["edinetCode"], c["corpNumber"], c["name"], c["nameKana"], c["market"],
             c["secCode"], c["industryCode"], c["industryLabel"], c["fiscalEnd"], c["filedAt"],
             1 if c["consolidated"] else 0, c["employees"], c["avgSalary"], c["avgTenure"],
             c["cash"], c["monthlyCost"], c["runway"], c["growth"], c["summary"],
             json.dumps(c["tags"], ensure_ascii=False) if c["tags"] else None, c["updatedAt"]))
        for p in c["fiscalPeriods"]:
            conn.execute(
                """INSERT INTO fiscal_periods (edinet_code, label, seq, revenue,
                     operating_profit, employees, avg_salary, segments)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (c["edinetCode"], p["label"], p["seq"], p["revenue"], p["operatingProfit"],
                 p["employees"], p["avgSalary"],
                 json.dumps(p["segments"], ensure_ascii=False) if p["segments"] else None))
        for s in c["subsidies"]:
            conn.execute(
                "INSERT INTO subsidies (edinet_code, year, name, amount, ratio, source) VALUES (?,?,?,?,?,?)",
                (c["edinetCode"], s["year"], s["name"], s["amount"], s["ratio"], s["source"]))
        pc = c["percentiles"]
        conn.execute(
            "INSERT INTO percentiles (edinet_code, salary, tenure, growth, scale, finance) VALUES (?,?,?,?,?,?)",
            (c["edinetCode"], pc["salary"], pc["tenure"], pc["growth"], pc["scale"], pc["finance"]))
    for s in stats:
        conn.execute(
            """INSERT INTO industry_stats (industry_code, industry_label, company_count,
                 median_salary, median_tenure) VALUES (?,?,?,?,?)""",
            (s["industryCode"], s["industryLabel"], s["companyCount"],
             s["medianSalary"], s["medianTenure"]))
    conn.commit()
    conn.close()


if __name__ == "__main__":
    companies, stats = build()
    write_json(companies, stats)
    write_db(companies, stats)
    print("wrote %s (%d companies)" % (JSON_PATH, len(companies)))
    print("wrote %s" % DB_PATH)

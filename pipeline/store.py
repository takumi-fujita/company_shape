"""SQLite への書き込み。フロントとの境界（schema.sql）を守る唯一の層。

冪等: 同じ入力で何度実行しても同じ結果になること。途中で落ちても再実行できること。
"""
import json
import os
import sqlite3

import config
from transform import derive, percentile

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")


def connect(db_path):
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        conn.executescript(f.read())
    return conn


def existing_filings(conn):
    """{edinet_code: filed_at}。差分実行の判定に使う。"""
    rows = conn.execute("SELECT edinet_code, filed_at FROM companies").fetchall()
    return {r["edinet_code"]: r["filed_at"] for r in rows}


def _load_periods(conn, edinet_code):
    """既存の期別データを {fiscal_end 相当のラベル: row} で返す。"""
    rows = conn.execute(
        "SELECT * FROM fiscal_periods WHERE edinet_code = ? ORDER BY seq", (edinet_code,)
    ).fetchall()
    return {r["label"]: dict(r) for r in rows}


def _merge_periods(existing, incoming):
    """過去の提出分と今回分をマージする。

    1 通の有報では 5 期すべては埋まらない（営業利益は当期・前期のみ、平均年収は当期のみ）。
    毎年の提出を重ねて系列を育てる。今回取れた値だけを上書きし、
    取れなかった項目は既存値を残す（None で上書きしない）。
    """
    merged = {}
    for label, row in existing.items():
        merged[label] = {
            "label": label,
            "revenue": row.get("revenue"),
            "operating_profit": row.get("operating_profit"),
            "employees": row.get("employees"),
            "avg_salary": row.get("avg_salary"),
            "segments": json.loads(row["segments"]) if row.get("segments") else [],
        }

    for p in incoming:
        cur = merged.get(p["label"]) or {"label": p["label"], "segments": []}
        for key in ("revenue", "operating_profit", "employees", "avg_salary"):
            if p.get(key) is not None:
                cur[key] = p[key]
            else:
                cur.setdefault(key, None)
        if p.get("segments"):
            cur["segments"] = p["segments"]
        cur.setdefault("segments", [])
        merged[p["label"]] = cur

    # ラベル "26/3" を年で並べ替える。世紀跨ぎは考慮不要（有報は 2000 年以降）。
    def sort_key(label):
        y, m = label.split("/")
        return (int(y), int(m))

    ordered = [merged[k] for k in sorted(merged, key=sort_key)]
    return ordered[-config.PERIODS :]


def upsert_company(conn, record, industry, updated_at):
    """1 社分を書き込む。派生値（runway / growth）はここで確定させる。

    industry: {"code": ..., "label": ...}
    """
    code = record["edinet_code"]
    periods = _merge_periods(_load_periods(conn, code), record["periods"])

    latest = periods[-1] if periods else {}
    cost = derive.monthly_cost(latest.get("revenue"), latest.get("operating_profit"))
    cash = record.get("cash")
    runway = derive.derive_runway(cash, cost)
    growth = derive.cagr(periods)

    conn.execute(
        """INSERT INTO companies (edinet_code, corp_number, name, name_kana, market,
             sec_code, industry_code, industry_label, fiscal_end, filed_at, consolidated,
             employees, avg_salary, avg_tenure, cash, monthly_cost, runway, growth,
             summary, tags, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                   (SELECT summary FROM companies WHERE edinet_code = ?),
                   (SELECT tags    FROM companies WHERE edinet_code = ?), ?)
           ON CONFLICT(edinet_code) DO UPDATE SET
             corp_number=excluded.corp_number, name=excluded.name, market=excluded.market,
             sec_code=excluded.sec_code, industry_code=excluded.industry_code,
             industry_label=excluded.industry_label, fiscal_end=excluded.fiscal_end,
             filed_at=excluded.filed_at, consolidated=excluded.consolidated,
             employees=excluded.employees, avg_salary=excluded.avg_salary,
             avg_tenure=excluded.avg_tenure, cash=excluded.cash,
             monthly_cost=excluded.monthly_cost, runway=excluded.runway,
             growth=excluded.growth, updated_at=excluded.updated_at""",
        (
            code, record.get("corp_number"), record.get("name"), record.get("name_kana"),
            record.get("market"), record.get("sec_code"), industry["code"], industry["label"],
            record.get("fiscal_end"), record.get("filed_at"),
            1 if record.get("consolidated") else 0,
            record.get("employees"), record.get("avg_salary"), record.get("avg_tenure"),
            cash, cost, runway, growth,
            code, code, updated_at,
        ),
    )

    conn.execute("DELETE FROM fiscal_periods WHERE edinet_code = ?", (code,))
    for seq, p in enumerate(periods):
        conn.execute(
            """INSERT INTO fiscal_periods (edinet_code, label, seq, revenue,
                 operating_profit, employees, avg_salary, segments)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                code, p["label"], seq, p.get("revenue"), p.get("operating_profit"),
                p.get("employees"), p.get("avg_salary"),
                json.dumps(p.get("segments") or [], ensure_ascii=False) or None,
            ),
        )


def replace_subsidies(conn, edinet_code, rows):
    """補助金は交付決定ベースの洗い替え。"""
    conn.execute("DELETE FROM subsidies WHERE edinet_code = ?", (edinet_code,))
    for s in rows:
        conn.execute(
            "INSERT INTO subsidies (edinet_code, year, name, amount, ratio, source) VALUES (?,?,?,?,?,?)",
            (edinet_code, s["year"], s["name"], s["amount"], s.get("ratio"), s.get("source")),
        )


def set_summary(conn, edinet_code, summary, tags):
    conn.execute(
        "UPDATE companies SET summary = ?, tags = ? WHERE edinet_code = ?",
        (summary, json.dumps(tags, ensure_ascii=False) if tags else None, edinet_code),
    )


def rebuild_derived(conn, fallback_group=None):
    """パーセンタイルと業種中央値を全社分作り直す。

    1 社だけ更新した場合でも母集団が変わるため、必ず全社分をやり直すこと。
    """
    rows = [dict(r) for r in conn.execute("SELECT * FROM companies").fetchall()]

    conn.execute("DELETE FROM percentiles")
    for code, axes in percentile.compute_all(rows, fallback_group).items():
        conn.execute(
            "INSERT INTO percentiles (edinet_code, salary, tenure, growth, scale, finance) VALUES (?,?,?,?,?,?)",
            (code, axes["salary"], axes["tenure"], axes["growth"], axes["scale"], axes["finance"]),
        )

    conn.execute("DELETE FROM industry_stats")
    for s in percentile.industry_stats(rows):
        conn.execute(
            """INSERT INTO industry_stats (industry_code, industry_label, company_count,
                 median_salary, median_tenure) VALUES (?,?,?,?,?)""",
            (s["industry_code"], s["industry_label"], s["company_count"],
             s["median_salary"], s["median_tenure"]),
        )

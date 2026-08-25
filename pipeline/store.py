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


def _merge_periods(existing, incoming, prefer_incoming=True):
    """過去の提出分と今回分をマージする。

    1 通の有報では 5 期すべては埋まらない（営業利益は当期・前期のみ、平均年収は当期のみ）。
    毎年の提出を重ねて系列を育てる。

    同じ期を 2 通の有報が別の値で報告することがある（遡及修正など）。そのときは
    **新しい提出の値を採る**。単に「最後に処理したもの」を採ると、5 年分をまとめて
    投入するときに取り込み順で結果が変わってしまう。

    prefer_incoming=False（今回のほうが古い提出）のときは、既存が null の欄だけ埋める。
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
            value = p.get(key)
            if value is None:
                cur.setdefault(key, None)
            elif prefer_incoming or cur.get(key) is None:
                cur[key] = value
        # セグメントは prefer_incoming で縛らない。
        # ある期のセグメントは、その期を「当期」として報告した 1 通からしか来ない
        # （同じ提出の他の期は必ず空で来る）ので、提出どうしで競合しない。
        # ここを新旧で縛ると、抽出の誤りを直して過去分を取り直しても、
        # 最新の提出より古い期は永久に古い値のままになる。
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


#: 「その提出時点のスナップショット」であるフィールド。
#: 古い提出を後から取り込んでも、これらを古い値に戻さない。
SNAPSHOT_FIELDS = (
    "name", "name_kana", "market", "sec_code", "fiscal_end", "filed_at",
    "consolidated", "employees", "avg_salary", "avg_tenure", "cash",
)


def upsert_company(conn, record, industry, updated_at):
    """1 社分を書き込む。派生値（runway / growth）はここで確定させる。

    5 年分をまとめて投入するとき、同じ会社の有報が年ごとに何通も流れてくる。
    期別データ（fiscal_periods）はマージすればよいが、従業員数・現預金・提出日などは
    「最新の提出のもの」でなければならない。古い提出を後から取り込んだ場合に
    最新の値を巻き戻さないよう、filed_at を見て判断する。

    industry: {"code": ..., "label": ...}
    """
    code = record["edinet_code"]
    existing = conn.execute(
        "SELECT * FROM companies WHERE edinet_code = ?", (code,)
    ).fetchone()
    existing = dict(existing) if existing else None

    incoming_filed = record.get("filed_at") or ""
    previous_filed = (existing or {}).get("filed_at") or ""
    # 初回、または今回のほうが新しい（同日を含む）ときだけスナップショットを更新する。
    is_newer = existing is None or incoming_filed >= previous_filed

    periods = _merge_periods(_load_periods(conn, code), record["periods"], prefer_incoming=is_newer)

    values = {}
    for field in SNAPSHOT_FIELDS:
        incoming = record.get(field)
        if field == "consolidated":
            incoming = 1 if record.get("consolidated") else 0
        values[field] = incoming if is_newer else existing.get(field)

    # 業種は CSV 由来で提出時点に依存しないので常に最新を当てる。
    values["industry_code"] = industry["code"]
    values["industry_label"] = industry["label"]
    values["corp_number"] = record.get("corp_number") or (existing or {}).get("corp_number")
    if not is_newer:
        # 市場区分だけは industries.csv から来るので、古い提出でも新しい値を残す。
        values["market"] = industry.get("market") or existing.get("market")

    # 派生値はマージ後の系列（＝最新期を含む）から作るので、取り込み順に依存しない。
    latest = periods[-1] if periods else {}
    cost = derive.monthly_cost(latest.get("revenue"), latest.get("operating_profit"))
    values["monthly_cost"] = cost
    values["runway"] = derive.derive_runway(values["cash"], cost)
    values["growth"] = derive.cagr(periods)
    values["updated_at"] = updated_at

    if existing is None:
        columns = ["edinet_code"] + list(values)
        conn.execute(
            "INSERT INTO companies (%s) VALUES (%s)"
            % (", ".join(columns), ", ".join("?" * len(columns))),
            [code] + [values[c] for c in columns[1:]],
        )
    else:
        # summary / tags はここでは触らない（要約は別経路で入れる）。
        conn.execute(
            "UPDATE companies SET %s WHERE edinet_code = ?"
            % ", ".join("%s = ?" % c for c in values),
            list(values.values()) + [code],
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

#!/usr/bin/env python3
"""配信前の DB 健全性チェック。

壊れたデータを 3,612 ページに載せないための最低限の関門。
落ちたら日次ジョブはコミットも push もしない。

  python3 ops/verify_db.py data/companies.db
  python3 ops/verify_db.py data/companies.db --min-companies 3400
"""
import json
import sqlite3
import sys

#: 前回より会社数がこれ以上減っていたら異常とみなす（%）。
MAX_SHRINK_PERCENT = 5

CHECKS = []


def check(name):
    def decorator(fn):
        CHECKS.append((name, fn))
        return fn
    return decorator


@check("会社が 1 社以上ある")
def _(conn):
    n = conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
    return (True, "%d 社" % n) if n > 0 else (False, "0 社")


@check("必須項目に欠けが無い")
def _(conn):
    n = conn.execute(
        "SELECT COUNT(*) FROM companies WHERE name IS NULL OR name = ''"
        " OR industry_code IS NULL OR industry_label IS NULL OR updated_at IS NULL"
    ).fetchone()[0]
    return (n == 0, "欠けている会社 %d 社" % n)


@check("全社にパーセンタイルがある")
def _(conn):
    n = conn.execute(
        "SELECT COUNT(*) FROM companies c LEFT JOIN percentiles p USING(edinet_code)"
        " WHERE p.edinet_code IS NULL"
    ).fetchone()[0]
    return (n == 0, "パーセンタイル欠落 %d 社" % n)


@check("パーセンタイルが 0-100 に収まっている")
def _(conn):
    n = conn.execute(
        "SELECT COUNT(*) FROM percentiles WHERE"
        " salary NOT BETWEEN 0 AND 100 OR tenure NOT BETWEEN 0 AND 100"
        " OR growth NOT BETWEEN 0 AND 100 OR scale NOT BETWEEN 0 AND 100"
        " OR finance NOT BETWEEN 0 AND 100"
    ).fetchone()[0]
    return (n == 0, "範囲外 %d 社" % n)


@check("業種中央値が全業種にある")
def _(conn):
    n = conn.execute(
        "SELECT COUNT(DISTINCT c.industry_code) FROM companies c"
        " LEFT JOIN industry_stats s USING(industry_code) WHERE s.industry_code IS NULL"
    ).fetchone()[0]
    return (n == 0, "中央値が無い業種 %d 件" % n)


@check("決算期の seq が 0 から連番になっている")
def _(conn):
    bad = conn.execute(
        "SELECT edinet_code FROM fiscal_periods GROUP BY edinet_code"
        " HAVING MIN(seq) != 0 OR MAX(seq) != COUNT(*) - 1 LIMIT 5"
    ).fetchall()
    return (not bad, "壊れている会社: %s" % [r[0] for r in bad])


@check("決算期が 5 期を超えていない")
def _(conn):
    n = conn.execute(
        "SELECT COUNT(*) FROM (SELECT edinet_code FROM fiscal_periods"
        " GROUP BY edinet_code HAVING COUNT(*) > 5)"
    ).fetchone()[0]
    return (n == 0, "6 期以上ある会社 %d 社" % n)


@check("tags が JSON 配列として読める")
def _(conn):
    bad = []
    for code, tags in conn.execute("SELECT edinet_code, tags FROM companies WHERE tags IS NOT NULL"):
        try:
            if not isinstance(json.loads(tags), list):
                bad.append(code)
        except (ValueError, TypeError):
            bad.append(code)
    return (not bad, "壊れている会社: %s" % bad[:5])


@check("segments が JSON 配列として読める")
def _(conn):
    bad = []
    for code, seg in conn.execute(
        "SELECT edinet_code, segments FROM fiscal_periods WHERE segments IS NOT NULL"
    ):
        try:
            if not isinstance(json.loads(seg), list):
                bad.append(code)
        except (ValueError, TypeError):
            bad.append(code)
    return (not bad, "壊れている会社: %s" % bad[:5])


@check("要約が 200 字を超えていない")
def _(conn):
    n = conn.execute(
        "SELECT COUNT(*) FROM companies WHERE summary IS NOT NULL AND LENGTH(summary) > 200"
    ).fetchone()[0]
    return (n == 0, "200 字超の要約 %d 件" % n)


@check("要約に評価語が入っていない")
def _(conn):
    """ガードは ETL 側で通しているが、配信直前にもう一度見る。

    ここが落ちるのはガードを通さない経路で summary が入ったときで、
    そのまま配信すると信用毀損に直結する。
    """
    import os

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
    from summarize import guard

    bad = []
    for code, summary, tags in conn.execute(
        "SELECT edinet_code, summary, tags FROM companies WHERE summary IS NOT NULL"
    ):
        result = guard.check(summary, tags)
        if not result.accepted:
            bad.append("%s(%s%s)" % (code, result.reason, " 「%s」" % result.matched if result.matched else ""))
    return (not bad, "; ".join(bad[:5]))


def check_min_companies(conn, minimum):
    """会社数が急減していないこと。ETL の事故で DB を作り直してしまった場合の関門。"""
    n = conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
    return (n >= minimum, "%d 社（下限 %d 社）" % (n, minimum))


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    minimum = None
    if "--min-companies" in argv:
        minimum = int(argv[argv.index("--min-companies") + 1])

    if not args:
        print("usage: verify_db.py <path/to/companies.db> [--min-companies N]", file=sys.stderr)
        return 2
    conn = sqlite3.connect(args[0])

    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        print("NG  SQLite の整合性: %s" % integrity)
        return 1

    failed = 0
    for name, fn in CHECKS:
        try:
            ok, detail = fn(conn)
        except Exception as e:  # noqa: BLE001
            ok, detail = False, "検査中に例外: %s" % e
        print("%s  %s%s" % ("OK " if ok else "NG ", name, ("  — %s" % detail) if detail else ""))
        if not ok:
            failed += 1

    if minimum is not None:
        ok, detail = check_min_companies(conn, minimum)
        print("%s  会社数が急減していない  — %s" % ("OK " if ok else "NG ", detail))
        if not ok:
            failed += 1

    conn.close()
    if failed:
        print("\n%d 件の検査に落ちました。配信しないでください。" % failed)
        return 1
    print("\nすべての検査を通過しました。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

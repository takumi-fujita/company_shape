#!/usr/bin/env python3
"""ETL のオーケストレータ。

  python3 pipeline/main.py --date 2026-06-26
  python3 pipeline/main.py --from 2026-06-01 --to 2026-06-30 --limit 100

  python3 pipeline/main.py --subsidies-only          # 補助金だけ全社分を取り直す
  python3 pipeline/main.py --summaries-only --summary-batch  # 未生成の会社の要約をまとめて生成
  python3 pipeline/main.py --industries-only         # 業種・市場だけ付け直す（再取得しない）

方針:
- 差分実行。既に同じ filed_at のレコードがあればスキップする。
- 1 社の失敗で全体を止めない。失敗は logs/ に残して続行する。
- パーセンタイルと業種中央値は、1 社でも更新があれば全社分を作り直す。
- 全社の一括再取得は日次で回さない（--force を明示したときだけ）。
"""
import argparse
import datetime
import logging
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config  # noqa: E402
import etl_lock  # noqa: E402
import industries  # noqa: E402
import store  # noqa: E402
from fetch import edinet  # noqa: E402
from fetch import gbizinfo  # noqa: E402
from fetch import http as fetch_http  # noqa: E402
from parse import extract as extractor  # noqa: E402
from parse import labels as labelmod  # noqa: E402
from parse import xbrl  # noqa: E402
from summarize import claude as summarizer  # noqa: E402
from summarize import inputs as summary_inputs  # noqa: E402
from transform import subsidy as subsidy_tx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(ROOT, "data", "companies.db")
LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")

log = logging.getLogger("pipeline")


def setup_logging(verbose=False):
    os.makedirs(LOG_DIR, exist_ok=True)
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stderr),
            logging.FileHandler(os.path.join(LOG_DIR, "etl.log"), encoding="utf-8"),
        ],
        # 繰り返し呼ばれても古いハンドラを閉じる
        force=True,
    )


def process_document(conn, doc, table, updated_at):
    """1 通の有報を取り込む。例外は呼び出し側で握る。"""
    zip_bytes = edinet.download_zip(doc["doc_id"])
    instance = xbrl.parse_instance(xbrl.read_instance_from_zip(zip_bytes))
    labels = labelmod.read_labels_from_zip(zip_bytes)
    record = extractor.extract(instance, labels, filed_at=doc["filed_at"])

    # DEI より書類一覧のほうが確実な項目は上書きする
    record["edinet_code"] = record.get("edinet_code") or doc["edinet_code"]
    record["name"] = record.get("name") or doc["name"]
    record["sec_code"] = record.get("sec_code") or doc["sec_code"]
    record["corp_number"] = record.get("corp_number") or doc["corp_number"]

    industry = table.lookup(record.get("sec_code"))
    record["market"] = industry.get("market")

    store.upsert_company(conn, record, industry, updated_at)
    # 要約の入力は DB に入れず、後から要約だけ回し直せるようにキャッシュへ置く。
    latest = record["periods"][-1] if record.get("periods") else {}
    summary_inputs.save(
        record["edinet_code"], record.get("description_of_business"), latest.get("segments")
    )
    return record


def fetch_subsidies(conn, codes):
    """gBizINFO から交付決定を取り込む。

    補助金は補助情報なので、取れなくても有報側のデータは残す。
    トークンが無い場合は警告だけ出して丸ごとスキップする。
    """
    if not codes:
        return 0, 0

    ok, failed = 0, 0
    for code in codes:
        row = conn.execute(
            "SELECT corp_number FROM companies WHERE edinet_code = ?", (code,)
        ).fetchone()
        corp_number = row["corp_number"] if row else None
        if not corp_number:
            log.warning("法人番号が無いため補助金を引けません: %s", code)
            continue

        periods = [
            dict(r)
            for r in conn.execute(
                "SELECT label, revenue FROM fiscal_periods WHERE edinet_code = ? ORDER BY seq",
                (code,),
            )
        ]
        try:
            raw = gbizinfo.get_subsidies(corp_number)
        except fetch_http.MissingCredential:
            raise
        except fetch_http.FetchError as e:
            failed += 1
            log.error("補助金の取得に失敗 %s: %s", code, e)
            continue

        rows = subsidy_tx.normalize(raw, periods)
        store.replace_subsidies(conn, code, rows)
        conn.commit()
        ok += 1

    return ok, failed


def apply_industries(conn, table):
    """既存レコードに業種・市場を付け直す。有報の再取得はしない。

    industries.csv は新規上場や市場変更のたびに更新される。そのために
    3,600 社ぶんの XBRL を取り直すのは無駄なので、この経路を用意している。
    """
    rows = conn.execute("SELECT edinet_code, sec_code, industry_code FROM companies").fetchall()
    changed, unknown = 0, 0
    for r in rows:
        industry = table.lookup(r["sec_code"])
        if industry["code"] == industries.UNKNOWN["code"]:
            unknown += 1
        if industry["code"] == r["industry_code"]:
            continue
        conn.execute(
            "UPDATE companies SET industry_code = ?, industry_label = ?, market = COALESCE(?, market)"
            " WHERE edinet_code = ?",
            (industry["code"], industry["label"], industry.get("market"), r["edinet_code"]),
        )
        changed += 1
    conn.commit()
    log.info("業種を更新しました: %d 社（変更なし %d 社 / 分類なし %d 社）",
        changed, len(rows) - changed, unknown)
    return changed


def pending_summaries(conn):
    """要約がまだ無い会社のうち、入力がキャッシュにあるもの。

    既存レコードの再生成はしない（ハンドオフ §6）。summary が既に入っている会社は対象外。
    ガードで破棄された会社も summary は null のままなので、キャッシュがある限り
    プロンプトやガードを直したあとに --summaries-only で拾い直せる。
    """
    cached = summary_inputs.available()
    rows = conn.execute("SELECT edinet_code FROM companies WHERE summary IS NULL").fetchall()
    return [r["edinet_code"] for r in rows if r["edinet_code"] in cached]


def generate_summaries(conn, codes, use_batch=False):
    """AI 要約を生成してガードに通す。通らなかった会社は summary = null のまま。"""
    if not codes:
        return {}

    items = []
    for code in codes:
        payload = summary_inputs.load(code)
        if payload and payload.get("description"):
            items.append({
                "edinet_code": code,
                "description": payload["description"],
                "segments": payload.get("segments"),
            })
    if not items:
        return {}

    log.info("要約を生成します: %d 社（%s）", len(items), "バッチ" if use_batch else "逐次")

    results = {}
    if use_batch:
        results = summarizer.summarize_batch(items)
    else:
        for item in items:
            try:
                results[item["edinet_code"]] = summarizer.summarize_one(
                    item["description"], item.get("segments")
                )
            except Exception as e:  # noqa: BLE001 1 社の失敗で全体を止めない
                log.error("要約の生成に失敗 %s: %s", item["edinet_code"], e)

    accepted, rejected = 0, {}
    for code, result in results.items():
        if result.accepted:
            store.set_summary(conn, code, result.summary, result.tags)
            accepted += 1
        else:
            label = result.reason + (" 「%s」" % result.matched if result.matched else "")
            rejected[label] = rejected.get(label, 0) + 1
            log.info("要約を破棄 %s: %s", code, label)
    conn.commit()

    log.info("要約: 採用 %d 社 / 破棄 %d 社", accepted, sum(rejected.values()))
    for label, n in sorted(rejected.items(), key=lambda kv: -kv[1]):
        log.info("  破棄理由 %s: %d 社", label, n)
    return results


def _run_summaries(conn, codes, args):
    if args.skip_summaries or not codes:
        return
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        log.warning(
            "ANTHROPIC_API_KEY が無いため要約の生成をスキップします"
            "（AI 要約カードはセクションごと非表示になります）"
        )
        return
    generate_summaries(conn, codes, use_batch=args.summary_batch)


def run(args):
    conn = store.connect(args.db)
    table = industries.IndustryTable.load()
    known = store.existing_filings(conn)
    updated_at = args.today

    updated_codes = []

    if args.subsidies_only:
        updated_codes = [r["edinet_code"] for r in conn.execute("SELECT edinet_code FROM companies")]
        _run_subsidies(conn, updated_codes, args)
        conn.close()
        return 0

    if args.industries_only:
        apply_industries(conn, table)
        # 業種が変われば母集団も変わるので、パーセンタイルと中央値を作り直す。
        log.info("パーセンタイルと業種中央値を再計算します")
        store.rebuild_derived(conn)
        conn.commit()
        if table.missing:
            log.warning("業種が引けなかった銘柄: %d 件（東証以外の単独上場は industries.csv に載りません）",
                table.missing)
        conn.close()
        return 0

    if args.summaries_only:
        _run_summaries(conn, pending_summaries(conn), args)
        conn.close()
        return 0

    dates = list(edinet.daterange(args.date_from, args.date_to))
    log.info("対象期間 %s..%s (%d 日)", args.date_from, args.date_to, len(dates))

    seen, skipped, imported, failed = 0, 0, 0, 0

    for date in dates:
        try:
            docs = edinet.list_documents(date)
        except edinet.MissingApiKey:
            raise
        except Exception as e:  # noqa: BLE001
            log.error("書類一覧の取得に失敗 %s: %s", date, e)
            failed += 1
            continue

        for doc in docs:
            seen += 1
            if args.limit and imported >= args.limit:
                log.info("--limit %d に到達したので打ち切ります", args.limit)
                break
            if not args.force and known.get(doc["edinet_code"]) == doc["filed_at"]:
                skipped += 1
                continue
            try:
                process_document(conn, doc, table, updated_at)
                conn.commit()
                imported += 1
                updated_codes.append(doc["edinet_code"])
                log.info("取り込み %s %s", doc["edinet_code"], doc["name"])
            except Exception as e:  # noqa: BLE001
                # 1 社の失敗で全体を止めない
                failed += 1
                conn.rollback()
                log.error("スキップ %s %s: %s", doc["edinet_code"], doc["name"], e)
                os.makedirs(LOG_DIR, exist_ok=True)
                with open(os.path.join(LOG_DIR, "failures.log"), "a", encoding="utf-8") as f:
                    f.write("%s\t%s\t%s\t%s\n" % (updated_at, doc["edinet_code"], doc["name"], e))
                    f.write(traceback.format_exc())
        if args.limit and imported >= args.limit:
            break

    # 補助金は有報の取り込みが終わってから。売上比の計算に fiscal_periods が要るため。
    _run_subsidies(conn, updated_codes, args)

    # 要約は新規に有報を取得した会社のうち、まだ要約が無いものだけ。
    if updated_codes:
        just_updated = set(updated_codes)
        _run_summaries(conn, [c for c in pending_summaries(conn) if c in just_updated], args)

    if imported or args.force:
        # 母集団が変わるので必ず全社分をやり直す
        log.info("パーセンタイルと業種中央値を再計算します")
        store.rebuild_derived(conn)
        conn.commit()

    if table.missing:
        log.warning("業種が引けなかった銘柄: %d 件（industries.csv を更新してください）", table.missing)

    log.info("一覧 %d 件 / 取り込み %d 件 / スキップ %d 件 / 失敗 %d 件", seen, imported, skipped, failed)
    conn.close()
    return 0


def _run_subsidies(conn, codes, args):
    if args.skip_subsidies or not codes:
        return
    if not config.GBIZINFO_API_TOKEN:
        log.warning(
            "GBIZINFO_API_TOKEN が無いため補助金の取り込みをスキップします"
            "（有報のデータはそのまま使えます）"
        )
        return
    ok, failed = fetch_subsidies(conn, codes)
    log.info("補助金: 更新 %d 社 / 失敗 %d 社", ok, failed)


def main(argv=None):
    p = argparse.ArgumentParser(description="EDINET から有価証券報告書を取り込む")
    p.add_argument("--date", help="対象日 YYYY-MM-DD（--from/--to の代わり）")
    p.add_argument("--from", dest="date_from", help="開始日 YYYY-MM-DD")
    p.add_argument("--to", dest="date_to", help="終了日 YYYY-MM-DD")
    p.add_argument("--db", default=DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0, help="取り込む会社数の上限（試験用）")
    p.add_argument("--force", action="store_true", help="filed_at が同じでも再取得する")
    p.add_argument("--subsidies-only", action="store_true", help="補助金だけ全社分を取り直す")
    p.add_argument("--skip-subsidies", action="store_true", help="補助金の取り込みを行わない")
    p.add_argument("--industries-only", action="store_true",
                   help="業種・市場だけ付け直す（有報を再取得しない）")
    p.add_argument("--summaries-only", action="store_true", help="要約がまだ無い会社の要約だけ生成する")
    p.add_argument("--skip-summaries", action="store_true", help="要約の生成を行わない")
    p.add_argument("--summary-batch", action="store_true",
                   help="Message Batches API でまとめて生成する（初回の一括投入用・費用が半分）")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    today = datetime.date.today().isoformat()
    if args.date:
        args.date_from = args.date_to = args.date
    if not args.date_from:
        args.date_from = args.date_to = today
    if not args.date_to:
        args.date_to = args.date_from
    args.today = today

    setup_logging(args.verbose)
    try:
        # ETL が動いている間、フロントのビルドや verify_db が DB を開かないようにする。
        # バインドマウント越しの同時アクセスは読むだけでファイルを壊すため。
        with etl_lock.Lock(args.db):
            return run(args)
    except edinet.MissingApiKey as e:
        log.error("%s", e)
        return 2
    except RuntimeError as e:
        log.error("%s", e)
        return 3


if __name__ == "__main__":
    sys.exit(main())

"""main.py の結線テスト。EDINET のアクセスだけ差し替え、それ以外は本番と同じ経路を通す。"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import logging  # noqa: E402

import industries  # noqa: E402
import main as etl  # noqa: E402
import store  # noqa: E402
import xbrl_fixture  # noqa: E402
from fetch import edinet  # noqa: E402


class Args(object):
    def __init__(self, db, **kw):
        self.db = db
        self.date_from = kw.get("date_from", "2026-06-26")
        self.date_to = kw.get("date_to", "2026-06-26")
        self.limit = kw.get("limit", 0)
        self.force = kw.get("force", False)
        self.refresh_latest = kw.get("refresh_latest", False)
        self.subsidies_only = kw.get("subsidies_only", False)
        self.industries_only = kw.get("industries_only", False)
        self.skip_subsidies = kw.get("skip_subsidies", True)
        self.summaries_only = kw.get("summaries_only", False)
        self.skip_summaries = kw.get("skip_summaries", True)
        self.summary_batch = kw.get("summary_batch", False)
        self.today = "2026-08-20"


DOC = {
    "doc_id": "S100XXXX",
    "edinet_code": "E01234",
    "name": "株式会社テスト工業",
    "sec_code": "1234",
    "corp_number": "1234567890123",
    "period_end": "2026-03-31",
    "filed_at": "2026-06-26",
}


logging.disable(logging.CRITICAL)


class MainCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        # 要約の入力キャッシュは本番と同じ既定パスを見る。テストが
        # pipeline/cache/descriptions/ に合成データを書き込むと、実在の
        # EDINET コードと衝突したときに偽の原文から要約が作られる。
        from summarize import inputs as _inputs

        self._cache_dir = _inputs.CACHE_DIR
        _inputs.CACHE_DIR = os.path.join(self.dir, "descriptions")
        self.db = os.path.join(self.dir, "data", "companies.db")
        self._list = edinet.list_documents
        self._zip = edinet.download_zip
        self.downloads = []
        self.codes = {}
        edinet.list_documents = lambda date: [dict(DOC)]
        edinet.download_zip = self._fake_zip
        # industries.csv が無い環境でも落ちないこと
        industries.CSV_PATH = os.path.join(self.dir, "missing.csv")

    def tearDown(self):
        from summarize import inputs as _inputs

        _inputs.CACHE_DIR = self._cache_dir
        edinet.list_documents = self._list
        edinet.download_zip = self._zip

    def _fake_zip(self, doc_id):
        self.downloads.append(doc_id)
        return xbrl_fixture.build_zip(edinet_code=self.codes.get(doc_id, "E01234"))

    def rows(self):
        conn = store.connect(self.db)
        c = conn.execute("SELECT * FROM companies").fetchall()
        p = conn.execute("SELECT * FROM percentiles").fetchall()
        s = conn.execute("SELECT * FROM industry_stats").fetchall()
        conn.close()
        return [dict(x) for x in c], [dict(x) for x in p], [dict(x) for x in s]

    def test_imports_and_computes_derived_values(self):
        self.assertEqual(etl.run(Args(self.db)), 0)
        companies, percentiles, stats = self.rows()
        self.assertEqual(len(companies), 1)
        self.assertEqual(companies[0]["name"], "株式会社テスト工業")
        self.assertEqual(companies[0]["avg_salary"], 6480)
        self.assertEqual(len(percentiles), 1)
        self.assertEqual(len(stats), 1)

    def test_unknown_industry_does_not_break_the_run(self):
        """industries.csv が無くても 1 社も落とさない。"""
        etl.run(Args(self.db))
        companies, _, _ = self.rows()
        self.assertEqual(companies[0]["industry_code"], "unknown")

    def test_second_run_skips_unchanged_filings(self):
        """差分実行: filed_at が同じならダウンロードしない。"""
        etl.run(Args(self.db))
        self.assertEqual(len(self.downloads), 1)
        etl.run(Args(self.db))
        self.assertEqual(len(self.downloads), 1, "同じ提出日の書類を再取得している")

    def test_force_refetches(self):
        etl.run(Args(self.db))
        etl.run(Args(self.db, force=True))
        self.assertEqual(len(self.downloads), 2)

    def test_refresh_latest_refetches_the_newest_filing(self):
        """抽出を直したあとに使うモード。

        差分実行は filed_at が一致する提出を必ず飛ばすので、日付を全部
        なぞり直しても最新の 1 通だけは再抽出されない。実際にそれで
        セグメントの修正が最新期だけ反映されなかった。
        """
        etl.run(Args(self.db))
        self.assertEqual(len(self.downloads), 1)
        # 通常の再実行では飛ばされる。
        etl.run(Args(self.db))
        self.assertEqual(len(self.downloads), 1)
        # --refresh-latest なら取り直す。
        etl.run(Args(self.db, refresh_latest=True, date_from="2021-04-01", date_to="2026-08-25"))
        self.assertEqual(len(self.downloads), 2, "最新提出を取り直していない")

    def test_refresh_latest_only_visits_days_with_filings(self):
        """対象は DB にある提出日だけ。全期間を舐めない。"""
        etl.run(Args(self.db))
        visited = []
        original = edinet.list_documents
        edinet.list_documents = lambda date: (visited.append(date), original(date))[1]
        try:
            etl.run(Args(self.db, refresh_latest=True, date_from="2021-04-01", date_to="2026-08-25"))
        finally:
            edinet.list_documents = original
        self.assertEqual(visited, ["2026-06-26"], "提出日以外の日も見に行っている")

    def test_refresh_latest_ignores_other_companies_on_the_same_day(self):
        """同じ日に出た他社の提出は対象外（その社の最新提出ではない）。"""
        etl.run(Args(self.db))
        docs = [dict(DOC), dict(DOC, doc_id="S100YYYY", edinet_code="E05678", name="別の会社")]
        edinet.list_documents = lambda date: [dict(d) for d in docs]
        before = len(self.downloads)
        etl.run(Args(self.db, refresh_latest=True, date_from="2021-04-01", date_to="2026-08-25"))
        self.assertEqual(len(self.downloads) - before, 1, "対象外の会社まで取り込んでいる")

    def test_one_broken_company_does_not_stop_the_run(self):
        """1 社の失敗で全体を止めない。"""
        docs = [dict(DOC, doc_id="BAD", edinet_code="E09999"), dict(DOC)]
        edinet.list_documents = lambda date: [dict(d) for d in docs]

        def zips(doc_id):
            if doc_id == "BAD":
                raise edinet.EdinetError("HTTP 500")
            return xbrl_fixture.build_zip()

        edinet.download_zip = zips
        etl.LOG_DIR = os.path.join(self.dir, "logs")

        self.assertEqual(etl.run(Args(self.db)), 0)
        companies, _, _ = self.rows()
        self.assertEqual([c["edinet_code"] for c in companies], ["E01234"])

    def test_limit_caps_the_number_of_companies(self):
        self.codes = {"D%d" % i: "E%05d" % i for i in range(5)}
        edinet.list_documents = lambda date: [
            dict(DOC, doc_id="D%d" % i, edinet_code="E%05d" % i) for i in range(5)
        ]
        etl.run(Args(self.db, limit=2))
        companies, _, _ = self.rows()
        self.assertEqual(len(companies), 2)

    def test_missing_api_key_exits_with_code_2(self):
        edinet.list_documents = self._list  # 本物に戻す
        rc = etl.main(["--date", "2026-06-26", "--db", self.db])
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()


class TestSubsidies(MainCase):
    """補助金の取り込み。gBizINFO のアクセスだけ差し替える。"""

    RAW = [
        {"title": "IT導入補助金", "amount": 36000000, "date_of_approval": "2025-06-01"},
        {"title": "事業再構築補助金", "amount": 120000000, "date_of_approval": "2024-09-30"},
        {"title": "非公表", "amount": "非公表", "date_of_approval": "2024-09-30"},
    ]

    def setUp(self):
        super(TestSubsidies, self).setUp()
        import config
        from fetch import gbizinfo

        self._token = config.GBIZINFO_API_TOKEN
        self._get = gbizinfo.get_subsidies
        config.GBIZINFO_API_TOKEN = "dummy"
        self.corp_numbers = []
        gbizinfo.get_subsidies = self._fake_subsidies

    def tearDown(self):
        import config
        from fetch import gbizinfo

        config.GBIZINFO_API_TOKEN = self._token
        gbizinfo.get_subsidies = self._get
        super(TestSubsidies, self).tearDown()

    def _fake_subsidies(self, corp_number):
        self.corp_numbers.append(corp_number)
        return list(self.RAW)

    def subsidies(self):
        conn = store.connect(self.db)
        rows = [dict(r) for r in conn.execute("SELECT * FROM subsidies ORDER BY year DESC")]
        conn.close()
        return rows

    def args(self, **kw):
        a = Args(self.db, **kw)
        a.subsidies_only = kw.get("subsidies_only", False)
        a.industries_only = kw.get("industries_only", False)
        a.skip_subsidies = kw.get("skip_subsidies", False)
        return a

    def test_subsidies_are_imported_after_the_filing(self):
        etl.run(self.args())
        rows = self.subsidies()
        self.assertEqual([r["name"] for r in rows], ["IT導入補助金", "事業再構築補助金"])
        self.assertEqual(rows[0]["amount"], 36)
        self.assertEqual(self.corp_numbers, ["1234567890123"])

    def test_ratio_uses_the_same_fiscal_year_revenue(self):
        etl.run(self.args())
        rows = {r["year"]: r for r in self.subsidies()}
        # 2025 年度 = 26/3 期 = 売上 12,000 百万円
        self.assertEqual(rows[2025]["ratio"], 0.3)
        # 2024 年度 = 25/3 期 = 売上 11,000 百万円
        self.assertEqual(rows[2024]["ratio"], 1.09)

    def test_skip_subsidies_flag(self):
        etl.run(self.args(skip_subsidies=True))
        self.assertEqual(self.subsidies(), [])
        self.assertEqual(self.corp_numbers, [])

    def test_missing_token_does_not_fail_the_run(self):
        """補助金は補助情報。トークンが無くても有報のデータは残す。"""
        import config

        config.GBIZINFO_API_TOKEN = None
        self.assertEqual(etl.run(self.args()), 0)
        companies, _, _ = self.rows()
        self.assertEqual(len(companies), 1)
        self.assertEqual(self.subsidies(), [])

    def test_gbizinfo_failure_does_not_fail_the_run(self):
        from fetch import gbizinfo, http

        def boom(corp_number):
            raise http.FetchError("HTTP 503")

        gbizinfo.get_subsidies = boom
        self.assertEqual(etl.run(self.args()), 0)
        companies, _, _ = self.rows()
        self.assertEqual(len(companies), 1)

    def test_subsidies_are_replaced_not_appended(self):
        """交付決定ベースの洗い替え。2 回流しても重複しない。"""
        etl.run(self.args())
        etl.run(self.args(force=True))
        self.assertEqual(len(self.subsidies()), 2)

    def test_subsidies_only_mode_refreshes_every_company(self):
        etl.run(self.args(skip_subsidies=True))
        self.assertEqual(self.subsidies(), [])
        etl.run(self.args(subsidies_only=True))
        self.assertEqual(len(self.subsidies()), 2)


class TestSummaries(MainCase):
    """AI 要約の結線。Anthropic API は差し替える。"""

    def setUp(self):
        super(TestSummaries, self).setUp()
        import os

        from summarize import claude as summarizer
        from summarize import guard
        from summarize import inputs

        self.guard = guard
        self.cache_dir = os.path.join(self.dir, "descriptions")
        self._cache = inputs.CACHE_DIR
        inputs.CACHE_DIR = self.cache_dir

        self._one = summarizer.summarize_one
        self._batch = summarizer.summarize_batch
        self.summarizer = summarizer
        self.generated = []
        summarizer.summarize_one = self._fake_one
        summarizer.summarize_batch = self._fake_batch

        self._key = os.environ.get("ANTHROPIC_API_KEY")
        os.environ["ANTHROPIC_API_KEY"] = "dummy"

        self.result = guard.GuardResult(summary="受託開発が売上の 7 割。", tags=["受託開発"])

    def tearDown(self):
        import os

        from summarize import claude as summarizer
        from summarize import inputs

        inputs.CACHE_DIR = self._cache
        summarizer.summarize_one = self._one
        summarizer.summarize_batch = self._batch
        if self._key is None:
            os.environ.pop("ANTHROPIC_API_KEY", None)
        else:
            os.environ["ANTHROPIC_API_KEY"] = self._key
        super(TestSummaries, self).tearDown()

    def _fake_one(self, description, segments=None, client=None):
        self.generated.append(description)
        return self.result

    def _fake_batch(self, items, **kw):
        self.generated.extend(i["description"] for i in items)
        return {i["edinet_code"]: self.result for i in items}

    def args(self, **kw):
        a = Args(self.db, **kw)
        a.industries_only = kw.get("industries_only", False)
        a.summaries_only = kw.get("summaries_only", False)
        a.skip_summaries = kw.get("skip_summaries", False)
        a.summary_batch = kw.get("summary_batch", False)
        return a

    def company(self):
        conn = store.connect(self.db)
        row = conn.execute("SELECT summary, tags FROM companies WHERE edinet_code='E01234'").fetchone()
        conn.close()
        return dict(row)

    def test_summary_is_generated_for_a_new_filing(self):
        etl.run(self.args())
        c = self.company()
        self.assertEqual(c["summary"], "受託開発が売上の 7 割。")
        self.assertEqual(c["tags"], '["受託開発"]')
        # 入力は有報の原文（HTML は除去済み）
        self.assertEqual(len(self.generated), 1)
        self.assertIn("受託開発", self.generated[0])

    def test_a_rejected_summary_stays_null(self):
        self.result = self.guard.GuardResult(reason=self.guard.Rejection.BANNED_WORD, matched="堅調")
        etl.run(self.args())
        self.assertIsNone(self.company()["summary"])

    def test_existing_summaries_are_not_regenerated(self):
        etl.run(self.args())
        self.assertEqual(len(self.generated), 1)
        # 翌年の有報を取り込んでも、既存の要約は作り直さない
        etl.run(self.args(force=True))
        self.assertEqual(len(self.generated), 1)

    def test_skip_summaries_flag(self):
        etl.run(self.args(skip_summaries=True))
        self.assertIsNone(self.company()["summary"])
        self.assertEqual(self.generated, [])

    def test_summaries_only_picks_up_previously_rejected_companies(self):
        """ガードを直したあとに拾い直せること。"""
        self.result = self.guard.GuardResult(reason=self.guard.Rejection.BANNED_WORD, matched="堅調")
        etl.run(self.args())
        self.assertIsNone(self.company()["summary"])

        self.result = self.guard.GuardResult(summary="受託開発が中心。", tags=[])
        etl.run(self.args(summaries_only=True))
        self.assertEqual(self.company()["summary"], "受託開発が中心。")

    def test_batch_mode_is_used_when_requested(self):
        etl.run(self.args(summary_batch=True, skip_summaries=False))
        self.assertEqual(self.company()["summary"], "受託開発が売上の 7 割。")

    def test_missing_api_key_does_not_fail_the_run(self):
        import os

        os.environ.pop("ANTHROPIC_API_KEY", None)
        self.assertEqual(etl.run(self.args()), 0)
        companies, _, _ = self.rows()
        self.assertEqual(len(companies), 1)
        self.assertIsNone(self.company()["summary"])

    def test_a_failing_summary_call_does_not_stop_the_run(self):
        def boom(description, segments=None, client=None):
            raise RuntimeError("529 overloaded")

        self.summarizer.summarize_one = boom
        self.assertEqual(etl.run(self.args()), 0)
        companies, _, _ = self.rows()
        self.assertEqual(len(companies), 1)
        self.assertIsNone(self.company()["summary"])


class TestIndustriesOnly(MainCase):
    """業種の付け直し。有報を再取得しないこと。"""

    def setUp(self):
        super(TestIndustriesOnly, self).setUp()
        import os

        # 既定は「CSV が無い」状態。基底クラスのテストもこのクラスで走るので、
        # ここで CSV を用意してしまうと前提が食い違う。必要なテストが自分で書く。
        self.csv_path = os.path.join(self.dir, "industries.csv")
        industries.CSV_PATH = os.path.join(self.dir, "missing.csv")

    def write_csv(self, sec_code="1234"):
        import csv

        with open(self.csv_path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["sec_code", "industry_code", "industry_label", "market"])
            w.writeheader()
            w.writerow({"sec_code": sec_code, "industry_code": "5250",
                        "industry_label": "情報・通信業", "market": "プライム"})
        industries.CSV_PATH = self.csv_path

    def args(self, **kw):
        a = Args(self.db, **kw)
        a.industries_only = kw.get("industries_only", False)
        return a

    def company(self):
        conn = store.connect(self.db)
        row = conn.execute(
            "SELECT industry_code, industry_label, market FROM companies WHERE edinet_code='E01234'"
        ).fetchone()
        conn.close()
        return dict(row)

    def test_applies_industry_without_refetching(self):
        # csv が無い状態で取り込む
        etl.run(self.args())
        self.assertEqual(self.company()["industry_code"], "unknown")
        downloads_before = len(self.downloads)

        # csv を用意して付け直す
        self.write_csv()
        etl.run(self.args(industries_only=True))
        c = self.company()
        self.assertEqual(c["industry_code"], "5250")
        self.assertEqual(c["industry_label"], "情報・通信業")
        self.assertEqual(c["market"], "プライム")
        self.assertEqual(len(self.downloads), downloads_before, "有報を再取得している")

    def test_rebuilds_percentiles(self):
        etl.run(self.args())
        self.write_csv()
        etl.run(self.args(industries_only=True))
        conn = store.connect(self.db)
        n = conn.execute("SELECT COUNT(*) FROM percentiles").fetchone()[0]
        stats = conn.execute("SELECT industry_code FROM industry_stats").fetchall()
        conn.close()
        self.assertEqual(n, 1)
        self.assertEqual([r["industry_code"] for r in stats], ["5250"])

    def test_unlisted_company_stays_unknown(self):
        """東証以外の単独上場は industries.csv に載らない。落とさず unknown のまま。"""
        etl.run(self.args())
        self.write_csv(sec_code="9999")
        self.assertEqual(etl.run(self.args(industries_only=True)), 0)
        self.assertEqual(self.company()["industry_code"], "unknown")


class TestEtlLock(unittest.TestCase):
    """ETL 実行中に DB を開かせないロック。

    バインドマウント越しの同時アクセスは読むだけで DB を壊す。
    リトライではなく機械的に止める。
    """

    def setUp(self):
        import etl_lock

        self.etl_lock = etl_lock
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "data", "companies.db")
        os.makedirs(os.path.dirname(self.db), exist_ok=True)

    def test_lock_is_created_and_removed(self):
        self.assertFalse(self.etl_lock.is_locked(self.db))
        with self.etl_lock.Lock(self.db):
            self.assertTrue(self.etl_lock.is_locked(self.db))
            info = self.etl_lock.read(self.db)
            self.assertEqual(info["pid"], os.getpid())
            self.assertIn("started_at", info)
        self.assertFalse(self.etl_lock.is_locked(self.db))

    def test_lock_is_removed_on_exception(self):
        try:
            with self.etl_lock.Lock(self.db):
                raise ValueError("失敗")
        except ValueError:
            pass
        self.assertFalse(self.etl_lock.is_locked(self.db), "例外で抜けてもロックが残っている")

    def test_double_acquire_is_refused(self):
        with self.etl_lock.Lock(self.db):
            with self.assertRaises(RuntimeError):
                self.etl_lock.Lock(self.db).acquire()

    def test_lock_sits_next_to_the_db(self):
        self.assertEqual(
            self.etl_lock.lock_path(self.db),
            os.path.join(self.dir, "data", ".etl-running"),
        )

    def test_describe_is_empty_without_lock(self):
        self.assertEqual(self.etl_lock.describe(self.db), "")
        with self.etl_lock.Lock(self.db):
            self.assertIn("ETL が実行中", self.etl_lock.describe(self.db))


class TestLockDuringRun(MainCase):
    """main() の実行中はロックが立ち、終了後に消えること。"""

    def args(self, **kw):
        a = Args(self.db, **kw)
        a.industries_only = kw.get("industries_only", False)
        return a

    def test_lock_is_held_during_the_run_and_released_after(self):
        import etl_lock

        seen = {}

        original = etl.process_document

        def spy(conn, doc, table, updated_at):
            seen["locked"] = etl_lock.is_locked(self.db)
            return original(conn, doc, table, updated_at)

        etl.process_document = spy
        try:
            etl.main(["--date", "2026-06-26", "--db", self.db])
        finally:
            etl.process_document = original

        self.assertTrue(seen.get("locked"), "ETL 中にロックが立っていない")
        self.assertFalse(etl_lock.is_locked(self.db), "ETL 後にロックが残っている")

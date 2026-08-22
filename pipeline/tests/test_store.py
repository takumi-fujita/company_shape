"""store 層のテスト。SQLite はテンポラリに作る。ネットワーク不要。"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import store  # noqa: E402
import xbrl_fixture  # noqa: E402
from parse import extract as extractor  # noqa: E402
from parse import labels as labelmod  # noqa: E402
from parse import xbrl  # noqa: E402

INDUSTRY = {"code": "software", "label": "ソフトウェア開発", "market": "グロース"}


def extract(**kwargs):
    filed = kwargs.pop("filed_at", "2026-06-26")
    z = xbrl_fixture.build_zip(**kwargs)
    inst = xbrl.parse_instance(xbrl.read_instance_from_zip(z))
    return extractor.extract(inst, labelmod.read_labels_from_zip(z), filed_at=filed)


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.conn = store.connect(os.path.join(self.dir, "data", "t.db"))

    def tearDown(self):
        self.conn.close()

    def periods(self, code="E01234"):
        return [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM fiscal_periods WHERE edinet_code=? ORDER BY seq", (code,)
            )
        ]

    def company(self, code="E01234"):
        return dict(self.conn.execute("SELECT * FROM companies WHERE edinet_code=?", (code,)).fetchone())


class TestUpsert(StoreCase):
    def test_writes_five_periods_numbered_from_zero(self):
        store.upsert_company(self.conn, extract(), INDUSTRY, "2026-08-20")
        p = self.periods()
        self.assertEqual([r["seq"] for r in p], [0, 1, 2, 3, 4])
        self.assertEqual([r["label"] for r in p], ["22/3", "23/3", "24/3", "25/3", "26/3"])

    def test_derives_monthly_cost_runway_growth(self):
        store.upsert_company(self.conn, extract(), INDUSTRY, "2026-08-20")
        c = self.company()
        # 営業費用 = 12000 - 700 = 11300 百万円 -> 月あたり 942
        self.assertEqual(c["monthly_cost"], 942)
        # 2180 / 942 = 2.3 ヶ月
        self.assertEqual(c["runway"], 2.3)
        # 9000 -> 12000 を 4 期で = 7.5%
        self.assertEqual(c["growth"], 7.5)

    def test_runway_is_null_when_operating_expenses_unknown(self):
        r = extract()
        r["periods"][-1]["operating_profit"] = None
        store.upsert_company(self.conn, r, INDUSTRY, "2026-08-20")
        c = self.company()
        self.assertIsNone(c["monthly_cost"])
        self.assertIsNone(c["runway"])

    def test_is_idempotent(self):
        """同じ入力で 2 回流しても結果が変わらないこと。"""
        r = extract()
        store.upsert_company(self.conn, r, INDUSTRY, "2026-08-20")
        first = (self.company(), self.periods())
        store.upsert_company(self.conn, r, INDUSTRY, "2026-08-20")
        self.assertEqual(first, (self.company(), self.periods()))
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0], 1
        )


class TestMergeAcrossFilings(StoreCase):
    """1 通では埋まらない項目を、翌年の提出で足していけること。"""

    def test_next_year_filing_shifts_the_window_and_keeps_old_values(self):
        # 2026/3 期の有報
        store.upsert_company(self.conn, extract(), INDUSTRY, "2026-08-20")
        self.assertEqual([r["operating_profit"] for r in self.periods()],
                         [None, None, None, 620, 700])

        # 2027/3 期の有報（1 期ずれる）
        nxt = extract(
            fiscal_year_end="2027-03-31",
            revenues=(9600, 10200, 11000, 12000, 13200),
            operating_profits=(500, 560, 620, 700, 800),
            employees=(290, 300, 306, 312, 330),
            filed_at="2027-06-25",
        )
        store.upsert_company(self.conn, nxt, INDUSTRY, "2027-08-20")

        p = self.periods()
        self.assertEqual([r["label"] for r in p], ["23/3", "24/3", "25/3", "26/3", "27/3"])
        # 25/3 と 26/3 の営業利益は前回の提出で入った値が残っている
        self.assertEqual([r["operating_profit"] for r in p], [None, None, 620, 700, 800])
        # 直近 5 期だけを保持する
        self.assertEqual(len(p), 5)

    def test_old_salary_survives_the_next_filing(self):
        """平均年収は 1 通に当期分しかない。過去分を None で上書きしないこと。"""
        store.upsert_company(self.conn, extract(avg_salary_yen=6480000), INDUSTRY, "2026-08-20")
        store.upsert_company(
            self.conn,
            extract(fiscal_year_end="2027-03-31", avg_salary_yen=6720000, filed_at="2027-06-25"),
            INDUSTRY,
            "2027-08-20",
        )
        p = {r["label"]: r["avg_salary"] for r in self.periods()}
        self.assertEqual(p["26/3"], 6480)
        self.assertEqual(p["27/3"], 6720)

    def test_summary_is_not_wiped_by_a_new_filing(self):
        """AI 要約は既存レコードの再生成をしない。取り込みで消さないこと。"""
        store.upsert_company(self.conn, extract(), INDUSTRY, "2026-08-20")
        store.set_summary(self.conn, "E01234", "受託開発が売上の 7 割。", ["受託開発"])
        store.upsert_company(
            self.conn, extract(fiscal_year_end="2027-03-31", filed_at="2027-06-25"),
            INDUSTRY, "2027-08-20",
        )
        c = self.company()
        self.assertEqual(c["summary"], "受託開発が売上の 7 割。")
        self.assertEqual(c["tags"], '["受託開発"]')


class TestRebuildDerived(StoreCase):
    def _add(self, code, salary, tenure, employees, runway, growth, industry="software"):
        self.conn.execute(
            """INSERT INTO companies (edinet_code, name, industry_code, industry_label,
                 employees, avg_salary, avg_tenure, runway, growth, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (code, code, industry, "ソフトウェア開発", employees, salary, tenure, runway, growth, "2026-08-20"),
        )

    def test_percentiles_cover_every_company(self):
        for i in range(5):
            self._add("E%05d" % i, 6000 + i * 100, 5 + i, 100 + i * 10, 10 + i, 5 + i)
        store.rebuild_derived(self.conn)
        n = self.conn.execute("SELECT COUNT(*) FROM percentiles").fetchone()[0]
        self.assertEqual(n, 5)

    def test_missing_metric_becomes_50(self):
        for i in range(5):
            self._add("E%05d" % i, 6000 + i * 100, 5 + i, 100 + i * 10, 10 + i, 5 + i)
        self._add("E09999", None, 5, 100, None, 5)
        store.rebuild_derived(self.conn)
        r = dict(self.conn.execute("SELECT * FROM percentiles WHERE edinet_code='E09999'").fetchone())
        self.assertEqual(r["salary"], 50)
        self.assertEqual(r["finance"], 50)

    def test_industry_stats_medians(self):
        self._add("E00001", 6000, 4.0, 100, 10, 5)
        self._add("E00002", 6400, 8.0, 200, 12, 6)
        store.rebuild_derived(self.conn)
        s = dict(self.conn.execute("SELECT * FROM industry_stats WHERE industry_code='software'").fetchone())
        self.assertEqual(s["company_count"], 2)
        self.assertEqual(s["median_salary"], 6200)
        self.assertEqual(s["median_tenure"], 6.0)

    def test_rebuild_is_idempotent(self):
        for i in range(3):
            self._add("E%05d" % i, 6000 + i * 100, 5 + i, 100 + i * 10, 10 + i, 5 + i)
        store.rebuild_derived(self.conn)
        first = [dict(r) for r in self.conn.execute("SELECT * FROM percentiles ORDER BY edinet_code")]
        store.rebuild_derived(self.conn)
        second = [dict(r) for r in self.conn.execute("SELECT * FROM percentiles ORDER BY edinet_code")]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()

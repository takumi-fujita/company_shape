"""パーセンタイル・派生値のテスト。レーダーの生命線なのでここは必ず緑にすること。

実行: python3 -m unittest discover -s pipeline/tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from seed_fixtures import build  # noqa: E402
from summarize import guard  # noqa: E402
from transform.derive import cagr, derive_runway  # noqa: E402
from transform.percentile import median, percentile  # noqa: E402


class TestPercentile(unittest.TestCase):
    def test_missing_value_is_50(self):
        """欠損は 50 として扱い、レーダーを歪めない。"""
        self.assertEqual(percentile([1, 2, 3, 4], None), 50)

    def test_smallest_is_0_and_largest_is_100(self):
        vals = [10, 20, 30, 40, 50]
        self.assertEqual(percentile(vals, 10), 0)
        self.assertEqual(percentile(vals, 50), 100)

    def test_middle_value(self):
        vals = [10, 20, 30, 40, 50]
        self.assertEqual(percentile(vals, 30), 50)

    def test_ties_are_treated_as_equal_rank(self):
        """同値は自分より小さい数だけを数えるので同順位になる。"""
        vals = [10, 10, 30, 40, 50]
        self.assertEqual(percentile(vals, 10), 0)

    def test_nulls_in_population_are_ignored(self):
        self.assertEqual(percentile([10, None, 30, None, 50], 30), 50)

    def test_population_smaller_than_two_is_50(self):
        """母集団が 1 社以下では順位に意味がないので 50 に倒す。"""
        self.assertEqual(percentile([42], 42), 50)
        self.assertEqual(percentile([], 42), 50)

    def test_output_is_bounded(self):
        vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        for v in vals + [None, 0, 999]:
            p = percentile(vals, v)
            self.assertGreaterEqual(p, 0)
            self.assertLessEqual(p, 100)


class TestDerived(unittest.TestCase):
    def test_runway_is_null_when_cost_is_zero_or_missing(self):
        """0 除算と黒字判定の誤りを避ける。"""
        self.assertIsNone(derive_runway(1000, 0))
        self.assertIsNone(derive_runway(1000, -5))
        self.assertIsNone(derive_runway(1000, None))
        self.assertIsNone(derive_runway(None, 100))

    def test_runway_is_cash_over_monthly_cost(self):
        self.assertEqual(derive_runway(1200, 100), 12.0)

    def test_cagr_is_null_when_oldest_period_is_missing_or_zero(self):
        def periods(first, last):
            return [{"revenue": first}, {}, {}, {}, {"revenue": last}]

        self.assertIsNone(cagr(periods(None, 1000)))
        self.assertIsNone(cagr(periods(0, 1000)))
        self.assertIsNone(cagr(periods(1000, None)))

    def test_cagr_over_four_intervals(self):
        # 100 -> 200 を 4 期かけて = 約 18.9%/年
        self.assertAlmostEqual(cagr([{"revenue": 100}, {}, {}, {}, {"revenue": 200}]), 18.9, places=1)

    def test_median_ignores_nulls(self):
        self.assertEqual(median([1, None, 3]), 2)
        self.assertEqual(median([1, 2, 3, 4]), 2.5)
        self.assertIsNone(median([None, None]))


class TestFixtureContract(unittest.TestCase):
    """フィクスチャに必須のエッジケースが揃っていること（ハンドオフ §10）。"""

    @classmethod
    def setUpClass(cls):
        cls.companies, cls.stats = build()

    def test_has_company_without_salary(self):
        self.assertTrue(any(c["avgSalary"] is None for c in self.companies))

    def test_has_company_with_incomplete_periods(self):
        self.assertTrue(
            any(any(p["revenue"] is None for p in c["fiscalPeriods"]) for c in self.companies)
        )

    def test_has_company_without_subsidies(self):
        self.assertTrue(any(len(c["subsidies"]) == 0 for c in self.companies))

    def test_has_company_without_summary(self):
        self.assertTrue(any(c["summary"] is None for c in self.companies))

    def test_has_company_without_runway(self):
        self.assertTrue(any(c["runway"] is None for c in self.companies))

    def test_every_company_has_five_percentiles(self):
        for c in self.companies:
            self.assertEqual(
                set(c["percentiles"]), {"salary", "tenure", "growth", "scale", "finance"}
            )

    def test_has_company_with_null_subsidy_ratio(self):
        """売上が取れない年度の交付は売上比を出さない。"""
        self.assertTrue(
            any(s["ratio"] is None for c in self.companies for s in c["subsidies"])
        )

    def test_subsidies_are_capped_to_four_fiscal_years(self):
        for c in self.companies:
            years = {s["year"] for s in c["subsidies"]}
            if years:
                self.assertLessEqual(max(years) - min(years), 3, c["name"])

    def test_every_fixture_summary_passes_the_guard(self):
        """デザインが示した例文そのものが法務ガードを通ること。

        ここが落ちるなら、デザインの文言か禁止語リストのどちらかが間違っている。
        """
        checked = 0
        for c in self.companies:
            if c["summary"] is None:
                continue
            result = guard.check(c["summary"], c["tags"])
            self.assertTrue(result.accepted, "%s: %r" % (c["name"], result))
            checked += 1
        self.assertGreater(checked, 0, "要約付きのフィクスチャが 1 社も無い")

    def test_missing_metric_yields_percentile_50(self):
        """平均年収 null の会社は salary 軸が 50。"""
        for c in self.companies:
            if c["avgSalary"] is None:
                self.assertEqual(c["percentiles"]["salary"], 50)
            if c["runway"] is None:
                self.assertEqual(c["percentiles"]["finance"], 50)
            if c["growth"] is None:
                self.assertEqual(c["percentiles"]["growth"], 50)


if __name__ == "__main__":
    unittest.main()

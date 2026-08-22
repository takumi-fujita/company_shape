"""補助金の正規化テスト。ネットワーク不要。"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from transform import subsidy  # noqa: E402

PERIODS = [
    {"label": "22/3", "revenue": 9000},
    {"label": "23/3", "revenue": 9600},
    {"label": "24/3", "revenue": 10200},
    {"label": "25/3", "revenue": 11000},
    {"label": "26/3", "revenue": 12000},
]


class TestFiscalYear(unittest.TestCase):
    def test_april_starts_a_new_fiscal_year(self):
        self.assertEqual(subsidy.fiscal_year_of(2025, 4), 2025)
        self.assertEqual(subsidy.fiscal_year_of(2025, 3), 2024)
        self.assertEqual(subsidy.fiscal_year_of(2025, 12), 2025)

    def test_parses_common_date_formats(self):
        for value in ("2025-06-01", "2025/06/01", "2025年6月1日", "2025-06-01T00:00:00+09:00"):
            self.assertEqual(subsidy.parse_fiscal_year(value), 2025, value)

    def test_january_belongs_to_the_previous_fiscal_year(self):
        self.assertEqual(subsidy.parse_fiscal_year("2025-01-20"), 2024)

    def test_unparseable_date_is_none(self):
        self.assertIsNone(subsidy.parse_fiscal_year(None))
        self.assertIsNone(subsidy.parse_fiscal_year("不明"))

    def test_maps_fiscal_periods_to_fiscal_years(self):
        """3 月決算の "26/3" は 2025 年度。"""
        m = subsidy.revenue_by_fiscal_year(PERIODS)
        self.assertEqual(m[2025], 12000)
        self.assertEqual(m[2021], 9000)

    def test_december_closing_company(self):
        """12 月決算なら "25/12" は 2025 年度。"""
        m = subsidy.revenue_by_fiscal_year([{"label": "25/12", "revenue": 500}])
        self.assertEqual(m, {2025: 500})

    def test_period_without_revenue_is_not_mapped(self):
        m = subsidy.revenue_by_fiscal_year([{"label": "26/3", "revenue": None}])
        self.assertEqual(m, {})


class TestAmount(unittest.TestCase):
    def test_accepts_numbers_and_strings(self):
        self.assertEqual(subsidy.parse_amount_yen(36000000), 36000000)
        self.assertEqual(subsidy.parse_amount_yen("36,000,000"), 36000000)
        self.assertEqual(subsidy.parse_amount_yen("36000000円"), 36000000)

    def test_rejects_garbage(self):
        self.assertIsNone(subsidy.parse_amount_yen("非公表"))
        self.assertIsNone(subsidy.parse_amount_yen(None))
        self.assertIsNone(subsidy.parse_amount_yen(""))


class TestNormalize(unittest.TestCase):
    def rows(self, **over):
        base = {"title": "IT導入補助金", "amount": 36000000, "date_of_approval": "2025-06-01"}
        base.update(over)
        return [base]

    def test_converts_yen_to_millions(self):
        r = subsidy.normalize(self.rows(), PERIODS)[0]
        self.assertEqual(r["amount"], 36)

    def test_ratio_is_computed_against_the_same_fiscal_year_revenue(self):
        # 36,000,000 円 / 12,000 百万円 = 0.3%
        r = subsidy.normalize(self.rows(), PERIODS)[0]
        self.assertEqual(r["year"], 2025)
        self.assertEqual(r["ratio"], 0.3)

    def test_ratio_is_null_when_the_year_has_no_revenue(self):
        """売上が取れない年度は推定で埋めない。"""
        r = subsidy.normalize(self.rows(date_of_approval="2015-06-01"), PERIODS)[0]
        self.assertIsNone(r["ratio"])

    def test_records_without_date_or_amount_are_dropped(self):
        rows = self.rows() + [
            {"title": "日付なし", "amount": 100},
            {"title": "金額なし", "date_of_approval": "2025-06-01"},
            {"title": "非公表", "amount": "非公表", "date_of_approval": "2025-06-01"},
        ]
        out = subsidy.normalize(rows, PERIODS)
        self.assertEqual([r["name"] for r in out], ["IT導入補助金"])

    def test_falls_back_to_the_resource_name_when_title_is_missing(self):
        r = subsidy.normalize(
            [{"amount": 1000000, "date_of_approval": "2025-06-01",
              "subsidy_resource": ["経済産業省", "中小企業庁"]}],
            PERIODS,
        )[0]
        self.assertIn("経済産業省", r["name"])

    def test_sorted_newest_first_then_by_amount(self):
        rows = [
            {"title": "A", "amount": 1000000, "date_of_approval": "2024-06-01"},
            {"title": "B", "amount": 5000000, "date_of_approval": "2025-06-01"},
            {"title": "C", "amount": 9000000, "date_of_approval": "2025-08-01"},
        ]
        out = subsidy.normalize(rows, PERIODS)
        self.assertEqual([r["name"] for r in out], ["C", "B", "A"])

    def test_alternate_field_names_are_accepted(self):
        """gBizINFO のフィールド名の揺れに耐えること。"""
        out = subsidy.normalize(
            [{"subsidy_title": "事業再構築補助金", "subsidy_amount": "12,000,000",
              "dateOfApproval": "2024/09/30"}],
            PERIODS,
        )
        self.assertEqual(out[0]["name"], "事業再構築補助金")
        self.assertEqual(out[0]["amount"], 12)
        self.assertEqual(out[0]["year"], 2024)

    def test_empty_input_yields_empty_output(self):
        self.assertEqual(subsidy.normalize([], PERIODS), [])


class TestRecent(unittest.TestCase):
    def test_keeps_only_the_last_four_fiscal_years(self):
        rows = [{"year": y, "name": str(y), "amount": 1, "ratio": None, "source": "gbizinfo"}
                for y in (2025, 2024, 2023, 2022, 2021, 2020)]
        years = [r["year"] for r in subsidy.recent(rows)]
        self.assertEqual(years, [2025, 2024, 2023, 2022])

    def test_empty_is_safe(self):
        self.assertEqual(subsidy.recent([]), [])


if __name__ == "__main__":
    unittest.main()

"""XBRL 抽出のテスト。ネットワーク不要。"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import xbrl_fixture  # noqa: E402
from parse import extract as extractor  # noqa: E402
from parse import labels as labelmod  # noqa: E402
from parse import xbrl  # noqa: E402


def load(**kwargs):
    z = xbrl_fixture.build_zip(**kwargs)
    inst = xbrl.parse_instance(xbrl.read_instance_from_zip(z))
    labels = labelmod.read_labels_from_zip(z)
    return extractor.extract(inst, labels, filed_at="2026-06-26")


class TestIdentity(unittest.TestCase):
    def test_dei_fields(self):
        r = load()
        self.assertEqual(r["edinet_code"], "E01234")
        self.assertEqual(r["name"], "株式会社テスト工業")
        self.assertEqual(r["corp_number"], "1234567890123")
        self.assertEqual(r["fiscal_end"], "2026-03")
        self.assertEqual(r["filed_at"], "2026-06-26")

    def test_security_code_is_trimmed_to_four_digits(self):
        """DEI の証券コードは 5 桁（末尾 0 埋め）。"""
        self.assertEqual(load()["sec_code"], "1234")

    def test_audit_document_is_ignored(self):
        """監査報告書ではなく提出本文のインスタンスを読む。"""
        self.assertEqual(load()["name"], "株式会社テスト工業")


class TestUnits(unittest.TestCase):
    """単位は DB 投入時点で確定させる。金額=百万円 / 給与=千円。"""

    def test_money_is_millions(self):
        r = load(revenues=(9000, 9600, 10200, 11000, 12000), cash=2180)
        self.assertEqual(r["periods"][-1]["revenue"], 12000)
        self.assertEqual(r["cash"], 2180)

    def test_salary_is_thousands(self):
        self.assertEqual(load(avg_salary_yen=6480000)["avg_salary"], 6480)

    def test_tenure_combines_years_and_months(self):
        # 5 年 10 ヶ月 = 5.8 年
        self.assertEqual(load(tenure_years="5", tenure_months="10")["avg_tenure"], 5.8)

    def test_tenure_without_months(self):
        self.assertEqual(load(tenure_years="8", tenure_months=None)["avg_tenure"], 8.0)


class TestPeriods(unittest.TestCase):
    def test_five_periods_labelled_oldest_first(self):
        p = load()["periods"]
        self.assertEqual([x["label"] for x in p], ["22/3", "23/3", "24/3", "25/3", "26/3"])

    def test_revenue_available_for_all_five_periods(self):
        p = load(revenues=(9000, 9600, 10200, 11000, 12000))["periods"]
        self.assertEqual([x["revenue"] for x in p], [9000, 9600, 10200, 11000, 12000])

    def test_operating_profit_only_current_and_prior(self):
        """営業利益は本表にしかないため 1 通では 2 期分しか取れない。

        取れない期は推定で埋めず None にする。過去の提出分と store 側でマージする。
        """
        p = load(operating_profits=(450, 500, 560, 620, 700))["periods"]
        self.assertEqual([x["operating_profit"] for x in p], [None, None, None, 620, 700])

    def test_salary_only_on_latest_period(self):
        p = load()["periods"]
        self.assertEqual([x["avg_salary"] for x in p], [None, None, None, None, 6480])

    def test_employees_for_all_five_periods(self):
        p = load(employees=(280, 290, 300, 306, 312))["periods"]
        self.assertEqual([x["employees"] for x in p], [280, 290, 300, 306, 312])


class TestMissingData(unittest.TestCase):
    def test_missing_salary_is_none_not_zero(self):
        r = load(with_salary=False)
        self.assertIsNone(r["avg_salary"])
        self.assertIsNone(r["periods"][-1]["avg_salary"])

    def test_missing_tenure_is_none(self):
        r = load(tenure_years=None, tenure_months=None)
        self.assertIsNone(r["avg_tenure"])

    def test_missing_fiscal_year_end_raises(self):
        """会社を特定できないものは黙って通さない。"""
        z = xbrl_fixture.build_instance()
        broken = z.replace(b"jpdei_cor:CurrentFiscalYearEndDateDEI", b"jpdei_cor:Removed")
        inst = xbrl.parse_instance(broken)
        with self.assertRaises(ValueError):
            extractor.extract(inst)


class TestSegments(unittest.TestCase):
    def test_segment_names_come_from_label_linkbase(self):
        segs = load()["periods"][-1]["segments"]
        self.assertEqual([s["name"] for s in segs], ["主力事業", "関連サービス", "保守・その他"])

    def test_segment_values_in_millions_sorted_desc(self):
        segs = load()["periods"][-1]["segments"]
        self.assertEqual([s["value"] for s in segs], [300, 230, 170])

    def test_total_and_elimination_are_dropped(self):
        """合計・調整額は内訳ではないので落とす。"""
        names = [s["name"] for s in load(include_totals=True)["periods"][-1]["segments"]]
        self.assertNotIn("合計", names)
        self.assertNotIn("調整額", names)

    def test_at_most_three_segments(self):
        segs = load(segments=(("Core", 300), ("Related", 230), ("Maintenance", 170)),
                    include_totals=False)["periods"][-1]["segments"]
        self.assertLessEqual(len(segs), 3)

    def test_standard_taxonomy_aggregates_are_dropped(self):
        """報告セグメント計と調整額は事業ではない。

        実物では最大値の「報告セグメント計」が内訳の先頭に並び、
        大きい順 3 件の枠を 1 つ食っていた（2,466 社中 1,982 社）。
        """
        segs = load(include_totals=False, include_standard_members=True)["periods"][-1]["segments"]
        names = [s["name"] for s in segs]
        self.assertNotIn("ReportableSegmentsMember", names)
        self.assertNotIn("ReconcilingItemsMember", names)
        # 集計行が枠を食わないので、実セグメントが 3 件そのまま残る。
        self.assertEqual(names, ["主力事業", "関連サービス", "保守・その他"])

    def test_standard_other_member_gets_japanese_name(self):
        """標準タクソノミの「その他」はラベルが引けないので既定名を当てる。"""
        segs = load(segments=(("Core", 300),), include_totals=False,
                    include_standard_members=True)["periods"][-1]["segments"]
        self.assertEqual([s["name"] for s in segs], ["主力事業", "その他"])

    def test_filer_segments_containing_reportablesegments_survive(self):
        """提出会社のメンバーは "CoreReportableSegmentsMember" のような形。

        集計行の除外を部分一致でやると、これらが巻き添えで消える。
        """
        names = [s["name"] for s in load(include_totals=False)["periods"][-1]["segments"]]
        self.assertEqual(names, ["主力事業", "関連サービス", "保守・その他"])


class TestConsolidation(unittest.TestCase):
    def test_consolidated_filing_uses_consolidated_contexts(self):
        self.assertTrue(load(consolidated=True)["consolidated"])

    def test_non_consolidated_filing_is_recorded(self):
        """連結を作っていない会社は単体を使い、そのことを記録する。"""
        r = load(consolidated=False)
        self.assertFalse(r["consolidated"])
        # 単体コンテキストから値が取れていること
        self.assertIsNotNone(r["avg_salary"])


class TestText(unittest.TestCase):
    def test_description_html_is_stripped(self):
        d = load()["description_of_business"]
        self.assertNotIn("<", d)
        self.assertIn("受託開発", d)


if __name__ == "__main__":
    unittest.main()


class TestSanityRange(unittest.TestCase):
    """提出会社側の XBRL に桁の誤りがある。推測で直さず欠損にする。"""

    def test_absurdly_high_salary_becomes_missing(self):
        """実在例: 8,759,000,000 円（正しくは 1/1000 と思われる）。"""
        r = load(avg_salary_yen=8_759_000_000)
        self.assertIsNone(r["avg_salary"], "桁がずれた年収がそのまま入っている")
        self.assertIsNone(r["periods"][-1]["avg_salary"])

    def test_absurdly_low_salary_becomes_missing(self):
        """実在例: 4,950 円（千円単位の値をそのまま入れたと思われる）。"""
        self.assertIsNone(load(avg_salary_yen=4950)["avg_salary"])

    def test_normal_salary_passes(self):
        # 境界も落とさない
        for yen in (1_000_000, 6_002_892, 50_000_000):
            self.assertIsNotNone(load(avg_salary_yen=yen)["avg_salary"], "%d 円が落ちている" % yen)

    def test_zero_tenure_becomes_missing(self):
        self.assertIsNone(load(tenure_years="0", tenure_months="0")["avg_tenure"])

    def test_normal_tenure_passes(self):
        self.assertEqual(load(tenure_years="13", tenure_months="2")["avg_tenure"], 13.2)

    def test_ranges_are_declared_for_the_fields_we_publish(self):
        import config

        for field in ("avg_salary", "avg_tenure", "employees"):
            self.assertIn(field, config.SANE_RANGES)
            lo, hi = config.SANE_RANGES[field]
            self.assertLess(lo, hi)

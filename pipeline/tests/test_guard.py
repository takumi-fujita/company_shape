# -*- coding: utf-8 -*-
"""AI 要約ガードのテスト。ここが Phase 4 の完了条件そのもの。

「評価語が 1 件も通過しない」ことを機械的に確かめる。ネットワーク不要。
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from summarize import guard  # noqa: E402

GOOD = "企業向けの受託システム開発が売上の約 7 割。残りは自社パッケージの保守と運用サポート。取引先は金融と製造が中心で、元請けで入る案件が多い。"
TAGS = ["受託開発", "元請け中心", "金融・製造"]


class TestAccepted(unittest.TestCase):
    def test_a_plain_factual_summary_passes(self):
        r = guard.check(GOOD, TAGS)
        self.assertTrue(r.accepted, r)
        self.assertEqual(r.summary, GOOD)
        self.assertEqual(r.tags, TAGS)

    def test_tags_may_arrive_as_a_json_string(self):
        r = guard.check(GOOD, '["受託開発", "元請け中心"]')
        self.assertTrue(r.accepted, r)
        self.assertEqual(r.tags, ["受託開発", "元請け中心"])

    def test_empty_tag_list_is_allowed(self):
        self.assertTrue(guard.check(GOOD, []).accepted)

    def test_exactly_200_chars_passes(self):
        self.assertTrue(guard.check("あ" * 200, []).accepted)

    def test_exactly_four_tags_pass(self):
        self.assertTrue(guard.check(GOOD, ["あ", "い", "う", "え"]).accepted)


class TestBannedWords(unittest.TestCase):
    """評価語が 1 語でも入っていたら要約ごと破棄する。"""

    def test_every_banned_word_is_rejected(self):
        for word in guard.BANNED:
            text = "当社の事業は%sです。" % word
            r = guard.check(text, TAGS)
            self.assertFalse(r.accepted, "「%s」が通過している" % word)
            self.assertEqual(r.reason, guard.Rejection.BANNED_WORD)

    def test_the_words_named_in_the_handoff(self):
        for word in ("優良", "堅調", "安定", "不安定", "将来性", "有望", "懸念"):
            self.assertIn(word, guard.BANNED, "ハンドオフが名指しした語が漏れている: %s" % word)

    def test_forecast_expressions_are_rejected(self):
        for text in (
            "今後は海外展開を進める。",
            "受託開発の売上は拡大する。",
            "来期の売上は 100 億円を見込む。",
            "海外売上比率の向上を目指す。",
        ):
            self.assertFalse(guard.check(text, TAGS).accepted, text)

    def test_speculative_expressions_are_rejected(self):
        for text in (
            "主力は受託開発と思われる。",
            "取引先は金融が中心だろう。",
            "自社製品の比率が高いようだ。",
        ):
            self.assertFalse(guard.check(text, TAGS).accepted, text)

    def test_banned_word_in_a_tag_drops_only_the_tags(self):
        """タグの不正で要約を捨てない。本文は既に検査済みなので tags だけ落とす。"""
        r = guard.check(GOOD, ["受託開発", "経営が安定"])
        self.assertTrue(r.accepted, r)
        self.assertEqual(r.summary, GOOD)
        self.assertEqual(r.tags, [])
        self.assertTrue(r.tags_dropped)

    def test_full_width_and_half_width_are_both_caught(self):
        """NFKC 正規化してから検査する。"""
        self.assertFalse(guard.check("業績は好調︙", TAGS).accepted)

    def test_the_matched_word_is_reported(self):
        r = guard.check("将来性のある事業です。", TAGS)
        self.assertEqual(r.matched, "将来性")


class TestLength(unittest.TestCase):
    def test_over_200_chars_is_trimmed_at_a_sentence_boundary(self):
        """長すぎるときは文の切れ目まで削る。途中で切ると意味が変わるため。"""
        text = "第一の文です。" * 40
        r = guard.check(text, [])
        self.assertTrue(r.accepted, r)
        self.assertTrue(r.trimmed)
        self.assertLessEqual(guard.count_chars(r.summary), guard.MAX_SUMMARY_CHARS)
        self.assertTrue(r.summary.endswith("。"), "文の途中で切れている")
        self.assertTrue(text.startswith(r.summary), "元の本文と一致しない")

    def test_a_single_sentence_that_is_too_long_is_rejected(self):
        """1 文目すら収まらないなら削りようがない。"""
        r = guard.check("あ" * 250 + "。", [])
        self.assertFalse(r.accepted)
        self.assertEqual(r.reason, guard.Rejection.TOO_LONG)

    def test_within_the_limit_is_not_trimmed(self):
        r = guard.check("あ" * 200, [])
        self.assertTrue(r.accepted)
        self.assertFalse(r.trimmed)

    def test_empty_summary_is_rejected(self):
        for value in (None, "", "   ", "\n"):
            r = guard.check(value, TAGS)
            self.assertFalse(r.accepted)
            self.assertEqual(r.reason, guard.Rejection.EMPTY)


class TestTags(unittest.TestCase):
    """tags が規約外でも要約は残す。条件そのものは緩めない。"""

    def assert_tags_dropped(self, tags):
        r = guard.check(GOOD, tags)
        self.assertTrue(r.accepted, "%r で要約ごと落ちている" % (tags,))
        self.assertEqual(r.summary, GOOD)
        self.assertEqual(r.tags, [])
        self.assertTrue(r.tags_dropped)

    def test_broken_json_drops_only_the_tags(self):
        self.assert_tags_dropped("受託開発, 元請け")

    def test_non_list_json_drops_only_the_tags(self):
        self.assert_tags_dropped('{"a": 1}')

    def test_non_string_items_drop_only_the_tags(self):
        self.assert_tags_dropped([1, 2])

    def test_none_drops_only_the_tags(self):
        self.assert_tags_dropped(None)

    def test_more_than_four_tags_drops_only_the_tags(self):
        self.assert_tags_dropped(["あ", "い", "う", "え", "お"])

    def test_a_tag_that_is_a_sentence_drops_only_the_tags(self):
        self.assert_tags_dropped(["受託開発が中心です。"])

    def test_an_overlong_tag_drops_only_the_tags(self):
        self.assert_tags_dropped(["あ" * (guard.MAX_TAG_CHARS + 1)])

    def test_tag_rules_are_not_relaxed(self):
        """条件自体は変えていないこと（12 字・4 個・句読点なし）。"""
        self.assertEqual(guard.MAX_TAGS, 4)
        self.assertEqual(guard.MAX_TAG_CHARS, 12)

    def test_blank_tags_are_dropped_not_rejected(self):
        r = guard.check(GOOD, ["受託開発", "", "  "])
        self.assertTrue(r.accepted)
        self.assertEqual(r.tags, ["受託開発"])


class TestRejectedOutputIsNull(unittest.TestCase):
    """要約ごと破棄する場合は summary も tags も残さない。"""

    def test_rejection_carries_no_content(self):
        for summary, tags in (
            ("業績は堅調。", TAGS),          # 評価語
            ("あ" * 300 + "。", TAGS),      # 1 文が長すぎて削れない
            ("", TAGS),                      # 空
        ):
            r = guard.check(summary, tags)
            self.assertFalse(r.accepted, "%r が通っている" % (summary[:20],))
            self.assertIsNone(r.summary)
            self.assertIsNone(r.tags)

    def test_evaluative_language_is_still_fatal(self):
        """緩めたのは字数と tags だけ。評価語は 1 語でも要約ごと破棄する。"""
        for word in guard.BANNED:
            r = guard.check("当社の事業は%sです。" % word, [])
            self.assertFalse(r.accepted, "「%s」が通過している" % word)


if __name__ == "__main__":
    unittest.main()

# -*- coding: utf-8 -*-
"""要約生成の結線テスト。Anthropic API は差し替える。ネットワーク不要。"""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from summarize import claude, guard, inputs  # noqa: E402


class Block(object):
    def __init__(self, text):
        self.type = "text"
        self.text = text


class Message(object):
    def __init__(self, payload=None, stop_reason="end_turn", text=None):
        self.stop_reason = stop_reason
        if text is not None:
            self.content = [Block(text)]
        elif payload is None:
            self.content = []
        else:
            self.content = [Block(json.dumps(payload, ensure_ascii=False))]


class FakeMessages(object):
    def __init__(self, message):
        self.message = message
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.message


class FakeClient(object):
    def __init__(self, message):
        self.beta = type("Beta", (), {})()
        self.beta.messages = FakeMessages(message)


GOOD = {"summary": "受託システム開発が売上の約 7 割。取引先は金融と製造が中心。", "tags": ["受託開発", "金融・製造"]}


class TestUserContent(unittest.TestCase):
    def test_includes_the_raw_description(self):
        text = claude.build_user_content("当社は受託開発を行っております。")
        self.assertIn("当社は受託開発を行っております。", text)

    def test_segments_become_percentages(self):
        text = claude.build_user_content("x", [{"name": "主力", "value": 300}, {"name": "関連", "value": 100}])
        self.assertIn("主力: 75.0%", text)
        self.assertIn("関連: 25.0%", text)

    def test_negative_segments_do_not_break_the_ratio(self):
        text = claude.build_user_content("x", [{"name": "主力", "value": 300}, {"name": "赤字", "value": -100}])
        self.assertIn("%", text)
        self.assertNotIn("nan", text.lower())

    def test_zero_total_segments_are_omitted(self):
        text = claude.build_user_content("x", [{"name": "主力", "value": 0}])
        self.assertNotIn("構成比", text)


class TestRequestShape(unittest.TestCase):
    def test_uses_opus_5_with_structured_output_and_fallbacks(self):
        client = FakeClient(Message(GOOD))
        claude.summarize_one("原文", None, client=client)
        params = client.beta.messages.calls[0]
        self.assertEqual(params["model"], "claude-opus-5")
        self.assertEqual(params["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(params["output_config"]["effort"], claude.EFFORT)
        self.assertEqual(params["fallbacks"], "default")
        self.assertIn(claude.FALLBACK_BETA, params["betas"])

    def test_schema_avoids_keywords_the_api_rejects(self):
        """構造化出力が受け付けないキーワードを混ぜない。

        maxItems を入れて 400 を食らったことがある:
          output_config.format.schema: For 'array' type, property 'maxItems' is not supported
        全件が要約なしで通ってしまい、しかもガードは何も言わない（要約が無いだけ）ので、
        気づきにくい。スキーマ側で個数を縛らず、プロンプトと guard.check に任せる。
        """
        UNSUPPORTED = ("maxItems", "minItems", "maxLength", "minLength", "pattern", "format")
        def walk(node, path="schema"):
            if isinstance(node, dict):
                for k, v in node.items():
                    self.assertNotIn(k, UNSUPPORTED, "%s に %s がある" % (path, k))
                    walk(v, "%s.%s" % (path, k))
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, "%s[%d]" % (path, i))
        walk(claude.OUTPUT_SCHEMA)
        self.assertFalse(claude.OUTPUT_SCHEMA["additionalProperties"])

    def test_tag_count_is_enforced_by_prompt_and_guard(self):
        """スキーマで縛れないぶん、プロンプトとガードの両方で押さえる。"""
        self.assertIn("最大 %d つ" % guard.MAX_TAGS, claude.load_prompt())
        over = ["あ", "い", "う", "え", "お"]
        self.assertFalse(guard.check("受託開発が中心。", over).accepted)

    def test_prompt_forbids_evaluative_language(self):
        prompt = claude.load_prompt()
        for phrase in ("評価語", "予測", "推測表現", "200 字以内"):
            self.assertIn(phrase, prompt)


class TestResponseHandling(unittest.TestCase):
    def test_a_clean_response_is_accepted(self):
        r = claude.summarize_one("原文", client=FakeClient(Message(GOOD)))
        self.assertTrue(r.accepted, r)
        self.assertEqual(r.tags, ["受託開発", "金融・製造"])

    def test_an_evaluative_response_is_discarded(self):
        payload = {"summary": "業績は堅調に推移している。", "tags": ["受託開発"]}
        r = claude.summarize_one("原文", client=FakeClient(Message(payload)))
        self.assertFalse(r.accepted)
        self.assertEqual(r.reason, guard.Rejection.BANNED_WORD)

    def test_a_refusal_is_discarded_not_raised(self):
        r = claude.summarize_one("原文", client=FakeClient(Message(GOOD, stop_reason="refusal")))
        self.assertFalse(r.accepted)
        self.assertEqual(r.reason, guard.Rejection.REFUSED)

    def test_non_json_text_is_discarded(self):
        r = claude.summarize_one("原文", client=FakeClient(Message(text="申し訳ありませんが")))
        self.assertFalse(r.accepted)

    def test_an_empty_response_is_discarded(self):
        r = claude.summarize_one("原文", client=FakeClient(Message()))
        self.assertFalse(r.accepted)
        self.assertEqual(r.reason, guard.Rejection.EMPTY)


class TestInputCache(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def test_round_trip(self):
        inputs.save("E01234", "原文です", [{"name": "主力", "value": 1}], base_dir=self.dir)
        payload = inputs.load("E01234", base_dir=self.dir)
        self.assertEqual(payload["description"], "原文です")
        self.assertEqual(payload["segments"][0]["name"], "主力")

    def test_empty_description_is_not_cached(self):
        self.assertFalse(inputs.save("E01234", None, base_dir=self.dir))
        self.assertIsNone(inputs.load("E01234", base_dir=self.dir))

    def test_missing_and_corrupt_files_return_none(self):
        self.assertIsNone(inputs.load("E99999", base_dir=self.dir))
        with open(os.path.join(self.dir, "E00001.json"), "w", encoding="utf-8") as f:
            f.write("{壊れている")
        self.assertIsNone(inputs.load("E00001", base_dir=self.dir))

    def test_available_lists_cached_codes(self):
        inputs.save("E01234", "x", base_dir=self.dir)
        inputs.save("E05678", "y", base_dir=self.dir)
        self.assertEqual(inputs.available(base_dir=self.dir), {"E01234", "E05678"})

    def test_available_on_a_missing_directory_is_empty(self):
        self.assertEqual(inputs.available(base_dir=os.path.join(self.dir, "nope")), set())


if __name__ == "__main__":
    unittest.main()

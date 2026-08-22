# -*- coding: utf-8 -*-
"""AI 要約の出力ガード。

このサイトは企業にとって不都合な数字を出す。要約に評価が 1 語でも混ざれば
信用毀損のリスクになるので、**疑わしければ破棄する**側に倒す。

  1. 評価語・予測・推測表現にヒット → 破棄
  2. 200 字超 → 破棄
  3. tags が JSON として壊れている / 規約外 → 破棄

破棄した会社は summary = null で保存し、UI 側は AI 要約カードをセクションごと
非表示にする（実装済み）。数十社が空欄になっても構わない。
誤った評価を 1 件出すほうが遥かに損害が大きい。
"""
import json
import re
import unicodedata

MAX_SUMMARY_CHARS = 200
MAX_TAGS = 4
MAX_TAG_CHARS = 12

# ---------------------------------------------------------------------------
# 禁止語
#
# ここが唯一の正。増やすのは自由、減らすときは理由をコメントに残すこと。
# 「原文にない事実の補完」は機械的に判定できないので、プロンプト側の制約に委ねる。
# ---------------------------------------------------------------------------

#: 企業の良し悪しを含意する語。
EVALUATIVE = [
    "優良", "優れ", "劣っ", "劣位", "優位", "良好", "良質", "堅調", "好調", "不調",
    "安定", "不安定", "健全", "盤石", "強固", "危険", "危機", "注意", "要注意",
    "将来性", "有望", "期待", "懸念", "不安", "リスク", "課題", "問題",
    "強み", "弱み", "魅力", "割安", "割高", "注目", "おすすめ", "推奨",
    "成長性", "収益性", "競争力", "優位性", "順調", "苦戦", "低迷", "躍進",
    "改善", "悪化", "有利", "不利", "評価", "秀で", "卓越", "脆弱",
]

#: 予測・見通しに関する記述。事実の提示だけに留める。
FORECAST = [
    "見込", "見通し", "予測", "予想", "今後", "将来", "中長期", "次期以降",
    "拡大する", "縮小する", "伸びる", "落ち込む", "目指す", "方針", "計画",
    "期待できる", "可能性が高い", "見据え",
]

#: 推測表現。
SPECULATIVE = [
    "と思われる", "とみられる", "と見られる", "だろう", "でしょう",
    "かもしれない", "考えられる", "推測", "推察", "ようだ", "とされる",
]

BANNED = EVALUATIVE + FORECAST + SPECULATIVE
_BANNED_RE = re.compile("|".join(re.escape(w) for w in BANNED))


class Rejection(object):
    """破棄理由。ログと集計に使う。"""

    EMPTY = "空の要約"
    TOO_LONG = "200 字超"
    BANNED_WORD = "禁止語"
    TAGS_NOT_JSON = "tags が JSON として壊れている"
    TAGS_INVALID = "tags が規約外"
    REFUSED = "モデルが応答を拒否"


class GuardResult(object):
    __slots__ = ("summary", "tags", "reason", "matched")

    def __init__(self, summary=None, tags=None, reason=None, matched=None):
        self.summary = summary
        self.tags = tags
        self.reason = reason
        self.matched = matched

    @property
    def accepted(self):
        return self.reason is None

    def __repr__(self):
        if self.accepted:
            return "GuardResult(accepted, %d 字, tags=%s)" % (len(self.summary), self.tags)
        return "GuardResult(rejected: %s%s)" % (
            self.reason, " 「%s」" % self.matched if self.matched else ""
        )


def count_chars(text):
    """字数。結合文字を 1 文字として数える（NFC 正規化）。"""
    return len(unicodedata.normalize("NFC", text))


def find_banned(text):
    """最初にヒットした禁止語。無ければ None。"""
    if not text:
        return None
    m = _BANNED_RE.search(unicodedata.normalize("NFKC", text))
    return m.group(0) if m else None


def _normalize_tags(value):
    """tags を list[str] にする。文字列で来た場合は JSON としてパースする。

    パースできない / 形が違う場合は None を返す（＝破棄）。
    """
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return None
    if not isinstance(value, list):
        return None
    if not all(isinstance(v, str) for v in value):
        return None
    return [v.strip() for v in value if v and v.strip()]


def check(summary, tags):
    """要約とタグを検査する。1 つでも引っかかれば要約ごと破棄する。

    tags だけが不正な場合も要約ごと落とす。片方だけ残すと、
    「どこまで検査済みか」が読み手に伝わらないため。
    """
    if summary is None or not str(summary).strip():
        return GuardResult(reason=Rejection.EMPTY)

    text = str(summary).strip()

    if count_chars(text) > MAX_SUMMARY_CHARS:
        return GuardResult(reason=Rejection.TOO_LONG)

    hit = find_banned(text)
    if hit:
        return GuardResult(reason=Rejection.BANNED_WORD, matched=hit)

    normalized = _normalize_tags(tags)
    if normalized is None:
        return GuardResult(reason=Rejection.TAGS_NOT_JSON)

    if len(normalized) > MAX_TAGS:
        return GuardResult(reason=Rejection.TAGS_INVALID)

    for tag in normalized:
        if count_chars(tag) > MAX_TAG_CHARS:
            return GuardResult(reason=Rejection.TAGS_INVALID)
        # タグは名詞句。文にしない。
        if any(c in tag for c in "。、．，!?！？"):
            return GuardResult(reason=Rejection.TAGS_INVALID)
        hit = find_banned(tag)
        if hit:
            return GuardResult(reason=Rejection.BANNED_WORD, matched=hit)

    return GuardResult(summary=text, tags=normalized)

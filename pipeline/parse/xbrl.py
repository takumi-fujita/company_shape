"""EDINET の XBRL インスタンス文書から必要な事実だけを抜き出す。

arelle を使わず stdlib の ElementTree で直接読んでいる理由:
  - 抽出したいのは 10 数個の要素だけで、計算リンクや按分の解決が要らない。
  - 3,612 社の初回一括処理で、1 通あたり数秒かかるモデル構築を避けたい。
  - 依存を増やさない（Cloudflare Pages / GitHub Actions の両方で動く）。
より複雑な抽出が必要になったら、この module の公開関数（parse_instance / extract）
だけを arelle 実装に差し替えればよい。呼び出し側は Facts しか知らない。
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET

XBRLI = "{http://www.xbrl.org/2003/instance}"


def _localname(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


class Context(object):
    """XBRL の context。期間と、連結／単体・セグメントなどの次元を持つ。"""

    __slots__ = ("id", "start", "end", "instant", "members", "consolidated")

    def __init__(self, cid, start, end, instant, members):
        self.id = cid
        self.start = start
        self.end = end
        self.instant = instant
        self.members = members
        # 明示的に NonConsolidatedMember が付いていれば単体。付いていなければ連結扱い。
        self.consolidated = not any("NonConsolidatedMember" in m for m in members)

    @property
    def is_segment(self):
        """セグメント等の次元が付いているか（連結／単体の軸だけの場合は False）。"""
        return any("NonConsolidatedMember" not in m for m in self.members)

    def __repr__(self):
        return "Context(%s, %s..%s, members=%s)" % (self.id, self.start, self.end, self.members)


class Instance(object):
    """パース済みのインスタンス文書。"""

    def __init__(self, contexts, facts):
        self.contexts = contexts
        #: [(localname, context_id, value, unit)]
        self.facts = facts
        self._by_name = {}
        for name, cid, value, unit in facts:
            self._by_name.setdefault(name, []).append((cid, value, unit))

    def find(self, names, predicate=None):
        """要素名の候補リストから、条件を満たす最初の事実を返す。

        names は優先順。同じ要素に複数の context がある場合は predicate で絞る。
        """
        if isinstance(names, str):
            names = [names]
        for name in names:
            for cid, value, unit in self._by_name.get(name, []):
                ctx = self.contexts.get(cid)
                if predicate is None or predicate(ctx):
                    return value, ctx, unit
        return None, None, None

    def find_all(self, names, predicate=None):
        if isinstance(names, str):
            names = [names]
        out = []
        for name in names:
            for cid, value, unit in self._by_name.get(name, []):
                ctx = self.contexts.get(cid)
                if predicate is None or predicate(ctx):
                    out.append((value, ctx, unit))
        return out


def parse_instance(xml_bytes):
    """インスタンス文書のバイト列を Instance にする。"""
    root = ET.fromstring(xml_bytes)

    contexts = {}
    for el in root.findall(XBRLI + "context"):
        cid = el.get("id")
        period = el.find(XBRLI + "period")
        start = end = instant = None
        if period is not None:
            s = period.find(XBRLI + "startDate")
            e = period.find(XBRLI + "endDate")
            i = period.find(XBRLI + "instant")
            start = s.text.strip() if s is not None and s.text else None
            end = e.text.strip() if e is not None and e.text else None
            instant = i.text.strip() if i is not None and i.text else None
        members = []
        for m in el.iter():
            if _localname(m.tag) == "explicitMember" and m.text:
                members.append(m.text.strip())
        contexts[cid] = Context(cid, start, end, instant, members)

    facts = []
    for el in root:
        name = _localname(el.tag)
        cid = el.get("contextRef")
        if cid is None or el.text is None:
            continue
        text = el.text.strip()
        if not text:
            continue
        facts.append((name, cid, text, el.get("unitRef")))

    return Instance(contexts, facts)


def read_instance_from_zip(zip_bytes):
    """EDINET の書類 ZIP から、提出本文のインスタンス文書(.xbrl)を取り出す。

    ZIP には PublicDoc / AuditDoc が入っている。監査報告書ではなく本文を使う。
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        candidates = [
            n
            for n in z.namelist()
            if n.lower().endswith(".xbrl") and "AuditDoc" not in n and "audit" not in n.lower()
        ]
        if not candidates:
            candidates = [n for n in z.namelist() if n.lower().endswith(".xbrl")]
        if not candidates:
            raise ValueError("インスタンス文書(.xbrl)が ZIP に含まれていません")
        # PublicDoc 配下を優先し、次に名前が短いもの（本文は 1 つだけのはず）
        candidates.sort(key=lambda n: (0 if "PublicDoc" in n else 1, len(n)))
        return z.read(candidates[0])


# --- 値の正規化 ---------------------------------------------------------------

_NUM = re.compile(r"^-?[\d,]+(\.\d+)?$")


def to_number(text):
    if text is None:
        return None
    t = text.strip().replace(",", "")
    if t in ("", "-", "―", "—"):
        return None
    if not _NUM.match(t):
        return None
    return float(t)


def to_int(text):
    v = to_number(text)
    return None if v is None else int(round(v))


def strip_html(text):
    """TextBlock は HTML 断片。タグを落として本文だけにする。"""
    if text is None:
        return None
    t = re.sub(r"<[^>]+>", " ", text)
    t = re.sub(r"&[a-zA-Z]+;|&#\d+;", " ", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip() or None

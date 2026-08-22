"""ラベルリンクベース（*_lab.xml）から要素の日本語ラベルを引く。

セグメント名は context の explicitMember に QName でしか入っていないため、
「主力事業」のような表示名を出すにはラベルリンクベースが要る。
"""
import io
import zipfile
import xml.etree.ElementTree as ET

XLINK = "{http://www.w3.org/1999/xlink}"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


def _localname(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def parse_labels(xml_bytes):
    """{要素ID: 日本語ラベル} を返す。"""
    root = ET.fromstring(xml_bytes)

    # xlink:label -> 要素ID（href の # 以降）
    loc = {}
    # xlink:label -> ラベル文字列
    text = {}
    # from(loc の label) -> to(label の label)
    arcs = []

    for el in root.iter():
        name = _localname(el.tag)
        if name == "loc":
            href = el.get(XLINK + "href") or ""
            if "#" in href:
                loc[el.get(XLINK + "label")] = href.split("#", 1)[1]
        elif name == "label":
            lang = el.get(XML_LANG)
            if lang and lang != "ja":
                continue
            role = el.get(XLINK + "role") or ""
            # 標準ラベルのみ。verbose / terse などは採らない。
            if role and not role.endswith("/label"):
                continue
            if el.text and el.text.strip():
                text[el.get(XLINK + "label")] = el.text.strip()
        elif name == "labelArc":
            arcs.append((el.get(XLINK + "from"), el.get(XLINK + "to")))

    out = {}
    for src, dst in arcs:
        element_id = loc.get(src)
        label = text.get(dst)
        if element_id and label:
            out.setdefault(element_id, label)
    return out


def read_labels_from_zip(zip_bytes):
    """ZIP 内のすべての *_lab.xml をマージした {要素ID: ラベル} を返す。"""
    merged = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            low = name.lower()
            if not low.endswith(".xml") or "_lab" not in low:
                continue
            if "AuditDoc" in name:
                continue
            try:
                merged.update(parse_labels(z.read(name)))
            except ET.ParseError:
                continue
    return merged


def label_for_member(labels, member_qname):
    """context の explicitMember（"prefix:XxxMember"）に対応する日本語ラベルを引く。

    要素 ID は接頭辞込み（例 jpcrp030000-asr_E12345-000_XxxMember）なので、
    ローカル名の後方一致で探す。
    """
    if not member_qname:
        return None
    local = member_qname.rsplit(":", 1)[-1]
    if local in labels:
        return labels[local]
    suffix = "_" + local
    for element_id, text in labels.items():
        if element_id.endswith(suffix):
            return text
    return None

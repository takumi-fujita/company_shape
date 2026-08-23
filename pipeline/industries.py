"""業種（33業種分類）と市場区分の対応表。

EDINET は業種も市場区分も返さないため、JPX が公開している
「東証上場銘柄一覧」から作った CSV を参照する。

  pipeline/data/industries.csv
  列: sec_code,industry_code,industry_label,market

CSV が無い / 該当が無い銘柄は UNKNOWN に倒す。1 社でも欠損で落とさないため。
業種が UNKNOWN のままだとレーダーの母集団が壊れるので、件数をログに出して気づけるようにする。
"""
import csv
import logging
import os

log = logging.getLogger(__name__)

CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "industries.csv")

UNKNOWN = {"code": "unknown", "label": "分類なし", "market": None}


class IndustryTable(object):
    def __init__(self, rows):
        self._by_sec = rows
        self.missing = 0

    @classmethod
    def load(cls, path=None):
        # 既定引数に CSV_PATH を直接書くと定義時に束縛され、
        # あとから差し替えても効かない（テストで踏んだ）。
        path = path or CSV_PATH
        if not os.path.exists(path):
            log.warning(
                "%s がありません。全社が「%s」になります。"
                "JPX の東証上場銘柄一覧から生成してください。",
                path, UNKNOWN["label"],
            )
            return cls({})
        rows = {}
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                sec = (r.get("sec_code") or "").strip()
                if not sec:
                    continue
                rows[sec] = {
                    "code": (r.get("industry_code") or "").strip() or UNKNOWN["code"],
                    "label": (r.get("industry_label") or "").strip() or UNKNOWN["label"],
                    "market": (r.get("market") or "").strip() or None,
                }
        log.info("industries.csv: %d 銘柄", len(rows))
        return cls(rows)

    def lookup(self, sec_code):
        if sec_code and sec_code in self._by_sec:
            return self._by_sec[sec_code]
        self.missing += 1
        return dict(UNKNOWN)

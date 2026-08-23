#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""JPX「東証上場銘柄一覧」(data_j.xls) から pipeline/data/industries.csv を作る。

EDINET は業種も市場区分も返さないので、この対応表が要る。
無いと全社が「分類なし」になり、レーダーの母集団と業種ページが壊れる。

  1. https://www.jpx.co.jp/ の「その他統計資料 → 東証上場銘柄一覧」から data_j.xls を取得
  2. python3 pipeline/build_industries.py ~/Downloads/data_j.xls

新規上場・市場変更・業種変更のたびに作り直す（月 1 回の更新で足りる）。
"""
import argparse
import csv
import os
import sys

#: 対象は内国株式の 3 市場のみ。
#: ETF・ETN / REIT / PRO Market / 外国株式 / 出資証券 は事業会社ではないので除く。
MARKETS = {
    "プライム（内国株式）": "プライム",
    "スタンダード（内国株式）": "スタンダード",
    "グロース（内国株式）": "グロース",
}

COLUMNS = ["sec_code", "industry_code", "industry_label", "market"]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XLS = os.path.join(ROOT, "pipeline", "data", "data_j.xls")
DEFAULT_OUT = os.path.join(ROOT, "pipeline", "data", "industries.csv")


def _cell(value):
    """xls のセルを文字列にする。数値は float で来るので整数に直す。"""
    if isinstance(value, float):
        return str(int(value)) if value == int(value) else str(value)
    return str(value).strip()


def _sec_code(value):
    """銘柄コード。1301 のような数値と 130A のような英数字が混在する。

    普通株は 4 文字。5 文字は優先株・種類株（例: 25935 伊藤園第1種優先株式）で、
    先頭 4 桁に切ると普通株と衝突する。EDINET の secCode が指すのは普通株なので、
    5 文字のものは対象外にする。
    """
    code = _cell(value)
    if not code or len(code) != 4:
        return None
    return code


def read_rows(xls_path):
    try:
        import xlrd  # noqa: PLC0415 変換のときだけ要る
    except ImportError:
        print(
            "xlrd がありません。次のどちらかで実行してください。\n"
            "  pip install xlrd\n"
            "  docker compose run --rm etl shell   # イメージには入っている",
            file=sys.stderr,
        )
        raise SystemExit(2)

    book = xlrd.open_workbook(xls_path)
    sheet = book.sheet_by_index(0)
    header = [_cell(sheet.cell_value(0, c)) for c in range(sheet.ncols)]

    required = ["コード", "市場・商品区分", "33業種コード", "33業種区分"]
    missing = [c for c in required if c not in header]
    if missing:
        print(
            "想定した列がありません: %s\n実際の列: %s\n"
            "JPX の書式が変わった可能性があります。" % (missing, header),
            file=sys.stderr,
        )
        raise SystemExit(2)

    idx = {name: header.index(name) for name in required}
    return [
        {name: sheet.cell_value(r, i) for name, i in idx.items()}
        for r in range(1, sheet.nrows)
    ]


def convert(rows):
    out = []
    skipped = {}
    for row in rows:
        market_raw = _cell(row["市場・商品区分"])
        market = MARKETS.get(market_raw)
        if market is None:
            skipped[market_raw] = skipped.get(market_raw, 0) + 1
            continue

        label = _cell(row["33業種区分"])
        code_raw = _cell(row["33業種コード"])
        if not label or label == "-" or not code_raw or code_raw == "-":
            skipped["業種なし"] = skipped.get("業種なし", 0) + 1
            continue

        sec = _sec_code(row["コード"])
        if not sec:
            skipped["優先株・種類株"] = skipped.get("優先株・種類株", 0) + 1
            continue

        out.append(
            {
                "sec_code": sec,
                # 33業種コードは 4 桁（0050 水産・農林業 … 9050 サービス業）。
                # そのまま /industry/[code] の URL になる。
                "industry_code": code_raw.zfill(4),
                "industry_label": label,
                "market": market,
            }
        )

    out.sort(key=lambda r: r["sec_code"])

    # 同じ銘柄コードが 2 行以上あると、参照側の辞書で後勝ちになり黙って片方が消える。
    seen = {}
    dups = []
    for r in out:
        prev = seen.get(r["sec_code"])
        if prev is not None and prev != (r["industry_code"], r["market"]):
            dups.append(r["sec_code"])
        seen[r["sec_code"]] = (r["industry_code"], r["market"])
    if dups:
        print("警告: 同じ銘柄コードで業種か市場が食い違っています: %s" % dups[:10], file=sys.stderr)

    return out, skipped


def write_csv(rows, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)


def main(argv=None):
    p = argparse.ArgumentParser(description="JPX の銘柄一覧から industries.csv を作る")
    p.add_argument("xls", nargs="?", default=DEFAULT_XLS, help="data_j.xls のパス")
    p.add_argument("-o", "--out", default=DEFAULT_OUT)
    a = p.parse_args(argv)

    if not os.path.exists(a.xls):
        print(
            "%s がありません。\n"
            "JPX の「その他統計資料 → 東証上場銘柄一覧」から data_j.xls を取得してください。" % a.xls,
            file=sys.stderr,
        )
        return 2

    rows, skipped = convert(read_rows(a.xls))
    if not rows:
        print("1 件も変換できませんでした。JPX の書式を確認してください。", file=sys.stderr)
        return 1

    write_csv(rows, a.out)

    industries = {}
    markets = {}
    for r in rows:
        industries[(r["industry_code"], r["industry_label"])] = industries.get(
            (r["industry_code"], r["industry_label"]), 0
        ) + 1
        markets[r["market"]] = markets.get(r["market"], 0) + 1

    print("%s に %d 社を書き出しました" % (a.out, len(rows)))
    print("  市場: " + " / ".join("%s %d" % (k, v) for k, v in sorted(markets.items())))
    print("  業種: %d 種類" % len(industries))
    print("  除外: " + " / ".join("%s %d" % (k, v) for k, v in sorted(skipped.items(), key=lambda kv: -kv[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

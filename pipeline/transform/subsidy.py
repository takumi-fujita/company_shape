"""補助金・助成金（交付決定ベース）の正規化。

gBizINFO の生レコードを「データ契約」の形に写す。
- 交付年度は日本の年度（4 月始まり）。交付決定日から求める。
- 金額は円 → 百万円。売上比は円のまま計算するので丸め誤差が乗らない。
- 売上が取れない年度は ratio を null にする（推定で埋めない）。
"""
import re

import config

#: gBizINFO のフィールド名は版によって揺れるため候補で引く。
DATE_KEYS = ("date_of_approval", "dateOfApproval", "date_of_approval_date", "交付決定日")
AMOUNT_KEYS = ("amount", "subsidy_amount", "amountOfSubsidy", "交付額")
TITLE_KEYS = ("title", "subsidy_title", "name", "事業名")
RESOURCE_KEYS = ("subsidy_resource", "subsidyResource", "government_departments")

_DATE = re.compile(r"(\d{4})[-/年](\d{1,2})")


def _pick(row, keys):
    for k in keys:
        v = row.get(k)
        if v not in (None, "", []):
            return v
    return None


def parse_amount_yen(value):
    """円。数値でも "1,234,000" でも受ける。取れなければ None。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().replace(",", "").replace("円", "")
    if not text or not re.match(r"^-?\d+(\.\d+)?$", text):
        return None
    return int(float(text))


def fiscal_year_of(year, month):
    """日本の年度。4 月始まり。"""
    return year if month >= 4 else year - 1


def parse_fiscal_year(value):
    """交付決定日から交付年度を求める。取れなければ None。"""
    if value is None:
        return None
    m = _DATE.search(str(value))
    if not m:
        return None
    return fiscal_year_of(int(m.group(1)), int(m.group(2)))


def revenue_by_fiscal_year(periods):
    """{年度: 売上高(百万円)}。label "26/3" → 2025 年度。"""
    out = {}
    for p in periods:
        label = p.get("label") or ""
        m = re.match(r"^(\d{2})/(\d{1,2})$", label)
        if not m:
            continue
        year = 2000 + int(m.group(1))
        fy = fiscal_year_of(year, int(m.group(2)))
        if p.get("revenue") is not None:
            out[fy] = p["revenue"]
    return out


def _flatten(value):
    if isinstance(value, list):
        return " / ".join(str(v) for v in value if v)
    return str(value) if value else None


def normalize(rows, periods, source="gbizinfo"):
    """生レコード列 → subsidies テーブルに入る形。

    交付年度・金額のどちらかが取れないレコードは落とす（テーブルに出せないため）。
    """
    revenues = revenue_by_fiscal_year(periods)
    out = []
    for row in rows:
        year = parse_fiscal_year(_pick(row, DATE_KEYS))
        amount_yen = parse_amount_yen(_pick(row, AMOUNT_KEYS))
        if year is None or amount_yen is None:
            continue

        title = _pick(row, TITLE_KEYS) or _flatten(_pick(row, RESOURCE_KEYS)) or "名称の記載なし"
        title = str(title).strip()

        revenue_million = revenues.get(year)
        ratio = None
        if revenue_million:
            revenue_yen = revenue_million * config.YEN_PER_MILLION
            if revenue_yen > 0:
                ratio = round(amount_yen / float(revenue_yen) * 100, 2)

        out.append(
            {
                "year": year,
                "name": title,
                "amount": int(round(amount_yen / float(config.YEN_PER_MILLION))),
                "ratio": ratio,
                "source": source,
            }
        )

    # 新しい年度が上。同年度内は金額の大きい順。
    out.sort(key=lambda r: (-r["year"], -r["amount"]))
    return out


def recent(rows, years=config.SUBSIDY_YEARS):
    """直近 N 年度分だけに絞る。表と合計行の対象を一致させるため。"""
    if not rows:
        return []
    newest = max(r["year"] for r in rows)
    return [r for r in rows if r["year"] > newest - years]

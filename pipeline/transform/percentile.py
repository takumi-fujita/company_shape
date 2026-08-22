"""業種内パーセンタイルと中央値。レーダーチャートの生命線。

- 5 軸すべて同一 industry_code 内の順位を 0-100 に正規化する。
- 母集団が MIN_POPULATION 未満の業種は大分類（フォールバック母集団）に切り替える。
- 欠損は 50。レーダーを歪めないため。
- 1 社だけ更新した場合でも母集団が変わるので、パーセンタイルは毎回全社分を作り直す。
"""

MIN_POPULATION = 10
NEUTRAL = 50

AXES = ("salary", "tenure", "growth", "scale", "finance")


def percentile(values, val):
    """同業種内パーセンタイル(0-100)。値が null のときは 50。

    pct = 自社より小さい値の数 / (n-1) * 100

    values には自社の値も含まれている前提。母集団の作り方を誤って自社が含まれない場合、
    below が n に達して 100 を超えるため 0-100 に丸める。
    """
    if val is None:
        return NEUTRAL
    vals = [v for v in values if v is not None]
    if len(vals) < 2:
        return NEUTRAL
    below = len([v for v in vals if v < val])
    pct = int(round(below / float(len(vals) - 1) * 100))
    return max(0, min(100, pct))


def median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    m = len(vals) // 2
    return vals[m] if len(vals) % 2 else (vals[m - 1] + vals[m]) / 2.0


#: レーダー 5 軸と、companies のどのフィールドを見るか。
AXIS_FIELDS = {
    "salary": "avg_salary",
    "tenure": "avg_tenure",
    "growth": "growth",
    "scale": "employees",
    "finance": "runway",
}


def compute_all(companies, fallback_group=None):
    """全社分のパーセンタイルを作り直して {edinet_code: {axis: 0-100}} を返す。

    companies: dict の列。industry_code と AXIS_FIELDS の各フィールドを持つ。
    fallback_group: industry_code -> 大分類コード。母集団が MIN_POPULATION 未満の
        業種はこの大分類でまとめる。未指定なら全社を母集団にする。
    """
    fallback_group = fallback_group or {}

    by_industry = {}
    for c in companies:
        by_industry.setdefault(c["industry_code"], []).append(c)

    by_major = {}
    for code, group in by_industry.items():
        major = fallback_group.get(code, "__all__")
        by_major.setdefault(major, []).extend(group)

    out = {}
    for code, group in by_industry.items():
        if len(group) >= MIN_POPULATION:
            pool = group
        else:
            pool = by_major.get(fallback_group.get(code, "__all__"), companies)
        columns = {
            axis: [x.get(field) for x in pool] for axis, field in AXIS_FIELDS.items()
        }
        for c in group:
            out[c["edinet_code"]] = {
                axis: percentile(columns[axis], c.get(field))
                for axis, field in AXIS_FIELDS.items()
            }
    return out


def industry_stats(companies):
    """業種ごとの社数と中央値。スコアカードの「業種中央値との差」に使う。"""
    by_industry = {}
    for c in companies:
        by_industry.setdefault(c["industry_code"], []).append(c)

    out = []
    for code in sorted(by_industry):
        group = by_industry[code]
        out.append(
            {
                "industry_code": code,
                "industry_label": group[0]["industry_label"],
                "company_count": len(group),
                "median_salary": median([x.get("avg_salary") for x in group]),
                "median_tenure": median([x.get("avg_tenure") for x in group]),
            }
        )
    return out

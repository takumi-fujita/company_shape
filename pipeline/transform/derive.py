"""派生値の算出。単位はここで確定させ、以降は変換しない。

金額 = 百万円 / 給与 = 千円 / 期間 = 月・年
"""


def operating_expenses(revenue, operating_profit):
    """営業費用 = 売上高 − 営業利益（百万円）。どちらか欠損なら null。"""
    if revenue is None or operating_profit is None:
        return None
    return revenue - operating_profit


def monthly_cost(revenue, operating_profit):
    """毎月の費用（百万円）。直近期の営業費用 / 12。"""
    expenses = operating_expenses(revenue, operating_profit)
    if expenses is None:
        return None
    return int(round(expenses / 12.0))


def derive_runway(cash, cost):
    """手元のお金で払える月数。

    monthly_cost <= 0 / null なら null を返す。0 除算を避けるためだけでなく、
    「費用がマイナス＝無限に持つ」という誤った判定を出さないため。
    """
    if cost is None or cost <= 0 or cash is None:
        return None
    return round(cash / float(cost), 1)


def cagr(periods):
    """売上 CAGR(%)。periods は古い順の dict 列で "revenue" を持つ。

    最古期が欠損 / 0 以下、または最新期が欠損なら null。推定で埋めない。
    """
    if len(periods) < 2:
        return None
    first = periods[0].get("revenue")
    last = periods[-1].get("revenue")
    if not first or first <= 0 or not last:
        return None
    n = len(periods) - 1
    return round(((last / float(first)) ** (1.0 / n) - 1) * 100, 1)


def operating_margin(revenue, operating_profit):
    """営業利益率(%)。"""
    if revenue is None or operating_profit is None or revenue == 0:
        return None
    return round(operating_profit / float(revenue) * 100, 1)

"""Instance から「データ契約」の形へ写す層。

ここが唯一、XBRL の語彙とアプリの語彙が接する場所。単位もここで確定させる
（金額=百万円 / 給与=千円）。以降の層では単位変換をしない。

取れないものは推定で埋めず None にする。1 社でも欠損で落ちないこと。
"""
import datetime
import logging

import config
from parse import labels as labelmod
from parse.xbrl import strip_html, to_int, to_number

log = logging.getLogger(__name__)


def _fiscal_label(date_str):
    """"2026-03-31" -> "26/3"。"""
    y, m = int(date_str[0:4]), int(date_str[5:7])
    return "%02d/%d" % (y % 100, m)


def _shift_years(date_str, back):
    y, m, d = int(date_str[0:4]), int(date_str[5:7]), int(date_str[8:10])
    y -= back
    # 2/29 は 2/28 に寄せる
    while True:
        try:
            return datetime.date(y, m, d).isoformat()
        except ValueError:
            d -= 1


def _same_period_end(value, target):
    """決算日が数日ずれることがあるため、年月一致で判定する。"""
    return bool(value) and value[0:7] == target[0:7]


def period_targets(fiscal_year_end, n=config.PERIODS):
    """古い順に [(label, 期末日)] を返す。"""
    out = []
    for back in range(n - 1, -1, -1):
        end = _shift_years(fiscal_year_end, back)
        out.append((_fiscal_label(end), end))
    return out


def in_sane_range(field, value):
    """妥当性の範囲に収まっているか。範囲外なら None を返す。

    桁がずれた値をそのまま載せると、実在企業の平均年収を数十億円と表示することになる。
    推測で直すより、欠損にして「—」を出すほうが安全。
    """
    if value is None:
        return None
    lo, hi = config.SANE_RANGES.get(field, (None, None))
    if lo is None:
        return value
    if lo <= value <= hi:
        return value
    log.warning("%s の値 %s が妥当な範囲 %s〜%s の外なので欠損として扱います", field, value, lo, hi)
    return None


def _money_to_millions(value):
    v = to_number(value)
    if v is None:
        return None
    return int(round(v / config.YEN_PER_MILLION))


def _yen_to_thousands(value):
    v = to_number(value)
    if v is None:
        return None
    return int(round(v / config.YEN_PER_THOUSAND))


def _duration_at(end, consolidated):
    def predicate(ctx):
        return (
            ctx is not None
            and ctx.start is not None
            and _same_period_end(ctx.end, end)
            and ctx.consolidated == consolidated
            and not ctx.is_segment
        )

    return predicate


def _instant_at(end, consolidated):
    def predicate(ctx):
        return (
            ctx is not None
            and ctx.instant is not None
            and _same_period_end(ctx.instant, end)
            and ctx.consolidated == consolidated
            and not ctx.is_segment
        )

    return predicate


def _any_basis(instance, names, end, consolidated, kind):
    """連結を優先し、無ければ単体で引く。採用した基準も返す。"""
    order = [consolidated, not consolidated]
    for basis in order:
        pred = _duration_at(end, basis) if kind == "duration" else _instant_at(end, basis)
        value, ctx, _ = instance.find(names, pred)
        if value is not None:
            return value, basis
    return None, None


def extract_segments(instance, labels, end, consolidated):
    """最新期のセグメント別営業利益。最大 3 件（大きい順）。"""
    def predicate(ctx):
        return (
            ctx is not None
            and ctx.start is not None
            and _same_period_end(ctx.end, end)
            and ctx.consolidated == consolidated
            and ctx.is_segment
        )

    rows = []
    for value, ctx, _ in instance.find_all(config.SEGMENT["operating_profit"], predicate):
        member = next((m for m in ctx.members if "NonConsolidatedMember" not in m), None)
        if member is None:
            continue
        local = member.rsplit(":", 1)[-1]
        # 標準タクソノミの集計行・調整額。完全一致で落とす。
        if local in config.SEGMENT_AGGREGATE_MEMBERS:
            continue
        # 提出会社が自前で立てた合計・調整額。名前に現れるので部分一致で落とす。
        if "Total" in member or "Elimination" in member or "Adjustment" in member:
            continue
        # ラベルリンクベース → 標準メンバーの既定名 → 最後の手段でローカル名。
        name = labelmod.label_for_member(labels, member) or config.SEGMENT_MEMBER_LABELS.get(local) or local
        amount = _money_to_millions(value)
        if amount is None:
            continue
        rows.append({"name": name, "value": amount})

    rows.sort(key=lambda r: r["value"], reverse=True)
    return rows[:3]


def extract(instance, labels=None, filed_at=None):
    """1 通の有報から取れるものをすべて取り出す。

    戻り値は store.py がそのまま SQLite に入れられる形。
    5 期の系列は 1 通では埋まりきらない（営業利益は当期と前期のみ）。
    足りない期は None にして返し、過去の提出分と store 側でマージする。
    """
    labels = labels or {}

    dei = {}
    for key, name in config.DEI.items():
        value, _, _ = instance.find(name)
        dei[key] = value

    fiscal_year_end = dei.get("fiscal_year_end")
    if not fiscal_year_end:
        raise ValueError("CurrentFiscalYearEndDateDEI が取れないため処理できません")

    consolidated = str(dei.get("consolidated", "")).lower() in ("true", "1")
    targets = period_targets(fiscal_year_end)
    current_end = targets[-1][1]

    # --- 期別の系列 ---------------------------------------------------------
    periods = []
    basis_used = set()
    for label, end in targets:
        revenue, basis = _any_basis(
            instance, config.SUMMARY["revenue"], end, consolidated, "duration"
        )
        if revenue is None:
            revenue, basis = _any_basis(
                instance, config.STATEMENTS["revenue"], end, consolidated, "duration"
            )
        if basis is not None:
            basis_used.add(basis)

        op, op_basis = _any_basis(
            instance, config.STATEMENTS["operating_profit"], end, consolidated, "duration"
        )
        if op_basis is not None:
            basis_used.add(op_basis)

        emp, _ = _any_basis(instance, config.SUMMARY["employees"], end, consolidated, "instant")

        periods.append(
            {
                "label": label,
                "fiscal_end": end,
                "revenue": _money_to_millions(revenue),
                "operating_profit": _money_to_millions(op),
                "employees": in_sane_range("employees", to_int(emp)),
                # 平均年収は 1 通に当期分しか載らない。最新期だけ後で埋める。
                "avg_salary": None,
                "segments": [],
            }
        )

    periods[-1]["segments"] = extract_segments(instance, labels, current_end, consolidated)

    # --- 従業員の状況（提出会社。当期のみ） ---------------------------------
    emp_now, _, _ = instance.find(
        config.EMPLOYEES["employees"], _instant_at(current_end, False)
    )
    if emp_now is None:
        emp_now, _, _ = instance.find(
            config.EMPLOYEES["employees"], _instant_at(current_end, True)
        )

    salary_raw, _, _ = instance.find(config.EMPLOYEES["avg_salary"])
    avg_salary = in_sane_range("avg_salary", _yen_to_thousands(salary_raw))

    tenure_years, _, _ = instance.find(config.EMPLOYEES["avg_tenure_years"])
    tenure_months, _, _ = instance.find(config.EMPLOYEES["avg_tenure_months"])
    avg_tenure = to_number(tenure_years)
    if avg_tenure is not None and to_number(tenure_months) is not None:
        avg_tenure = round(avg_tenure + to_number(tenure_months) / 12.0, 1)
    elif avg_tenure is not None:
        avg_tenure = round(avg_tenure, 1)
    avg_tenure = in_sane_range("avg_tenure", avg_tenure)

    periods[-1]["avg_salary"] = avg_salary
    if periods[-1]["employees"] is None:
        periods[-1]["employees"] = in_sane_range("employees", to_int(emp_now))

    # --- 現預金（当期末） ---------------------------------------------------
    cash_raw, _ = _any_basis(instance, config.STATEMENTS["cash"], current_end, consolidated, "instant")

    description, _, _ = instance.find(config.TEXT_BLOCKS["description_of_business"])

    sec_code = dei.get("sec_code")
    if sec_code:
        # DEI の証券コードは 5 桁（末尾 0 埋め）。表示は 4 桁に揃える。
        sec_code = sec_code.strip()
        if len(sec_code) == 5 and sec_code.endswith("0"):
            sec_code = sec_code[:4]

    return {
        "edinet_code": dei.get("edinet_code"),
        "corp_number": dei.get("corp_number"),
        "name": dei.get("name"),
        "sec_code": sec_code,
        "fiscal_end": fiscal_year_end[0:7],
        "filed_at": filed_at,
        # 連結と単体が混在した場合は「単体を使った」ことを記録側に倒す（5.1）
        "consolidated": consolidated and basis_used != {False},
        "employees": periods[-1]["employees"],
        "avg_salary": avg_salary,
        "avg_tenure": avg_tenure,
        "cash": _money_to_millions(cash_raw),
        "description_of_business": strip_html(description),
        "periods": periods,
    }

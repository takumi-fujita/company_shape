#!/usr/bin/env python3
"""ETL の実経路（parse → extract → store）で合成 XBRL を流し込み、検証用 DB を作る。

EDINET API v2 は購読キーが要るため、キーが用意できるまでの間、
「実データ相当の DB でフロントが崩れないか」を確かめるために使う。
本番の取り込みには使わない（--db を明示しないと動かない）。

  python3 pipeline/dev_synthetic.py --db /tmp/synthetic.db --count 60
"""
import argparse
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tests"))

import store  # noqa: E402
import xbrl_fixture  # noqa: E402
from parse import extract as extractor  # noqa: E402
from parse import labels as labelmod  # noqa: E402
from parse import xbrl  # noqa: E402

INDUSTRIES = [
    ("software", "ソフトウェア開発"),
    ("si", "SI・受託開発"),
    ("web", "Webサービス"),
    ("telecom", "情報通信インフラ"),
    ("electric", "電気機器"),
]
MARKETS = ["プライム", "スタンダード", "グロース"]

#: フロントを壊しにいくケース。必ず 1 社ずつ入れる。
EDGE_CASES = [
    {"label": "平均年収なし", "with_salary": False},
    {"label": "勤続年数なし", "tenure_years": None, "tenure_months": None},
    {"label": "セグメントなし", "segments": (), "include_totals": False},
    {"label": "セグメント1つ", "segments": (("Core", 420),), "include_totals": False},
    {"label": "営業赤字", "operating_profits": (-120, -80, -40, -10, -200)},
    {"label": "単体のみ", "consolidated": False},
    {"label": "兆円規模", "revenues": (8_200_000, 8_600_000, 9_100_000, 9_400_000, 10_200_000),
     "operating_profits": (410_000, 430_000, 470_000, 490_000, 560_000),
     "employees": (98_000, 99_500, 101_000, 103_400, 106_200), "cash": 1_820_000},
    {"label": "超小型", "revenues": (180, 195, 210, 240, 260),
     "operating_profits": (4, 5, 6, 8, 9), "employees": (12, 13, 15, 17, 18), "cash": 60},
    {"label": "売上横ばい", "revenues": (5000, 5000, 5000, 5000, 5000)},
    {"label": "従業員急減", "employees": (900, 880, 860, 840, 610)},
]


def build(db_path, count, seed=20260823):
    rng = random.Random(seed)
    conn = store.connect(db_path)

    specs = []
    for case in EDGE_CASES:
        specs.append(dict(case))
    while len(specs) < count:
        scale = rng.choice([1, 3, 10, 30])
        base = rng.randint(600, 4000) * scale
        growth = rng.uniform(0.97, 1.22)
        revenues = tuple(int(base * growth ** i) for i in range(5))
        margin = rng.uniform(-0.03, 0.18)
        specs.append(
            {
                "label": "random",
                "revenues": revenues,
                "operating_profits": tuple(int(r * margin) for r in revenues),
                "employees": tuple(int(base / rng.uniform(20, 60)) + i * rng.randint(0, 25) for i in range(5)),
                "cash": int(revenues[-1] * rng.uniform(0.02, 0.9)),
                "avg_salary_yen": rng.randint(3_800_000, 12_500_000),
                "tenure_years": str(rng.randint(1, 22)),
                "tenure_months": str(rng.randint(0, 11)),
                "with_salary": rng.random() > 0.06,
            }
        )

    ok, failed = 0, 0
    for i, spec in enumerate(specs[:count]):
        label = spec.pop("label", "")
        code = "E%05d" % (10000 + i)
        industry_code, industry_label = INDUSTRIES[i % len(INDUSTRIES)]
        try:
            z = xbrl_fixture.build_zip(edinet_code=code, **spec)
            inst = xbrl.parse_instance(xbrl.read_instance_from_zip(z))
            record = extractor.extract(inst, labelmod.read_labels_from_zip(z), filed_at="2026-06-26")
            record["name"] = ("株式会社第%d工業" % (i + 1)) if i % 2 else ("第%d工業株式会社" % (i + 1))
            record["name_kana"] = "ダイ%dコウギヨウ" % (i + 1)
            record["sec_code"] = "%04d" % (1000 + i)
            record["corp_number"] = "%013d" % (1000000000000 + i)
            record["market"] = MARKETS[i % len(MARKETS)]
            store.upsert_company(
                conn, record, {"code": industry_code, "label": industry_label}, "2026-08-20"
            )
            ok += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("  失敗 %s (%s): %s" % (code, label, e), file=sys.stderr)

    store.rebuild_derived(conn)
    conn.commit()

    n_thin = conn.execute(
        "SELECT COUNT(*) FROM companies WHERE (employees IS NULL) + (avg_salary IS NULL)"
        " + (avg_tenure IS NULL) + (runway IS NULL) + (growth IS NULL) > 2"
    ).fetchone()[0]
    conn.close()
    print("%s: %d 社 (失敗 %d 社 / 主要項目が 3 つ未満の会社 %d 社)" % (db_path, ok, failed, n_thin))
    return failed


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("--count", type=int, default=60)
    a = p.parse_args()
    sys.exit(1 if build(a.db, a.count) else 0)

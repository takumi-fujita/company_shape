"""EDINET API v2 クライアント。

- 書類一覧 → docTypeCode=120（有価証券報告書）で絞る
- 既に同じ filed_at のレコードがあればスキップ（差分実行）
- 失敗は指数バックオフで 3 回リトライ。それでも駄目ならその会社だけスキップして続行

リトライとバックオフは fetch/http.py に集約している。
"""
import logging

import config
from fetch import http

log = logging.getLogger(__name__)

#: 後方互換のための別名。呼び出し側は http の例外型をそのまま握ってよい。
EdinetError = http.FetchError
MissingApiKey = http.MissingCredential


def _request(path, params, binary=False):
    if not config.EDINET_API_KEY:
        raise MissingApiKey(
            "EDINET_API_KEY が設定されていません。"
            "https://api.edinet-fsa.go.jp/ で購読キーを取得し、環境変数に設定してください。"
        )
    query = dict(params)
    query["Subscription-Key"] = config.EDINET_API_KEY
    return http.request(http.build_url(config.EDINET_BASE, path, query), binary=binary)


def list_documents(date):
    """指定日(YYYY-MM-DD)に提出された有価証券報告書の一覧。

    戻り値: [{doc_id, edinet_code, name, sec_code, corp_number, period_end, filed_at}]
    """
    data = _request("/documents.json", {"date": date, "type": 2})
    results = data.get("results") or []
    out = []
    for r in results:
        if r.get("docTypeCode") != config.DOC_TYPE_ASR:
            continue
        if not r.get("edinetCode"):
            continue
        # 訂正報告書（取下げ・縦覧終了）は対象外
        if r.get("withdrawalStatus") == "1" or r.get("docInfoEditStatus") == "1":
            continue
        submit = (r.get("submitDateTime") or "")[0:10].replace("/", "-")
        out.append(
            {
                "doc_id": r.get("docID"),
                "edinet_code": r.get("edinetCode"),
                "name": r.get("filerName"),
                "sec_code": (r.get("secCode") or "")[:4] or None,
                "corp_number": r.get("JCN"),
                "period_end": r.get("periodEnd"),
                "filed_at": submit or date,
            }
        )
    return out


def download_zip(doc_id):
    """書類 ZIP（type=1: 提出本文・XBRL）を取得する。"""
    return _request("/documents/%s" % doc_id, {"type": 1}, binary=True)


def daterange(start, end):
    """start..end(YYYY-MM-DD, 両端含む)の日付を順に返す。"""
    import datetime

    d0 = datetime.date.fromisoformat(start)
    d1 = datetime.date.fromisoformat(end)
    while d0 <= d1:
        yield d0.isoformat()
        d0 += datetime.timedelta(days=1)

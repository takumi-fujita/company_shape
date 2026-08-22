"""gBizINFO クライアント。法人番号をキーに補助金・助成金の交付決定を取る。

  GET /hojin/v1/hojin/{corporate_number}/subsidy
  ヘッダ: X-hojinInfo-api-token

トークンは https://info.gbiz.go.jp/ で発行する。環境変数 GBIZINFO_API_TOKEN。
"""
import logging

import config
from fetch import http

log = logging.getLogger(__name__)


def _headers():
    if not config.GBIZINFO_API_TOKEN:
        raise http.MissingCredential(
            "GBIZINFO_API_TOKEN が設定されていません。"
            "https://info.gbiz.go.jp/ でトークンを取得し、環境変数に設定してください。"
        )
    return {"X-hojinInfo-api-token": config.GBIZINFO_API_TOKEN, "Accept": "application/json"}


def _first_hojin(payload):
    """レスポンスの包み方が版によって違うので、両方に耐える。"""
    if not isinstance(payload, dict):
        return {}
    for key in ("hojin-infos", "hojin_infos", "hojinInfos"):
        rows = payload.get(key)
        if isinstance(rows, list) and rows:
            return rows[0] or {}
    return payload


def get_subsidies(corp_number):
    """交付決定の生レコード列を返す。該当なしは空リスト。

    404 は「その法人に補助金の記録が無い」だけなので空リストに倒す。
    """
    if not corp_number:
        return []
    url = http.build_url(config.GBIZINFO_BASE, "/hojin/%s/subsidy" % corp_number)
    try:
        payload = http.request(url, headers=_headers())
    except http.MissingCredential:
        raise
    except http.FetchError as e:
        if "HTTP 404" in str(e):
            return []
        raise
    rows = _first_hojin(payload).get("subsidy") or []
    return [r for r in rows if isinstance(r, dict)]

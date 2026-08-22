"""HTTP 取得の共通処理。

- 指数バックオフで MAX_RETRIES 回リトライ
- 4xx（429 を除く）はリトライしても直らないので即座に諦める
- 依存を増やさないため urllib で実装
"""
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request

import config

log = logging.getLogger(__name__)


class FetchError(Exception):
    """呼び出し側はこれを握って「その会社だけスキップして続行」する。"""


class MissingCredential(FetchError):
    """API キー未設定。1 社の失敗ではなく設定の問題なので、上位で止める。"""


def build_url(base, path, params=None):
    url = base + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return url


def request(url, headers=None, binary=False, retries=None, timeout=None):
    retries = config.MAX_RETRIES if retries is None else retries
    timeout = config.REQUEST_TIMEOUT if timeout is None else timeout
    req = urllib.request.Request(url, headers=headers or {})

    last_error = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read()
            return body if binary else json.loads(body.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500 and e.code != 429:
                raise FetchError("HTTP %d for %s" % (e.code, url.split("?")[0]))
            last_error = e
        except Exception as e:  # noqa: BLE001 ネットワーク系はすべてリトライ対象
            last_error = e

        if attempt < retries - 1:
            wait = config.BACKOFF_BASE_SECONDS * (2 ** attempt)
            log.warning("retry %d/%d after %.1fs: %s", attempt + 1, retries, wait, last_error)
            time.sleep(wait)

    raise FetchError("giving up after %d attempts: %s" % (retries, last_error))

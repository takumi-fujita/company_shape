# -*- coding: utf-8 -*-
"""ETL 実行中であることを示すロック。

Docker のバインドマウント越しに、コンテナ（ETL）とホスト（フロントのビルド）から
同じ SQLite を開くと、POSIX ロックが効かず **読むだけでファイルが壊れる**。
実際にそれで 1 回 DB を壊している。

そこで「ETL が動いている間は誰も DB を開かない」を、リトライではなく
ファイル 1 つで機械的に強制する。読み手（lib/db.ts / build-search-index.mjs /
verify_db.py）はこのファイルがあれば即座に失敗する。
"""
import atexit
import json
import os
import signal
import socket
import time

LOCK_NAME = ".etl-running"


def lock_path(db_path):
    return os.path.join(os.path.dirname(os.path.abspath(db_path)) or ".", LOCK_NAME)


def read(db_path):
    """ロックの中身。無ければ None。"""
    p = lock_path(db_path)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (ValueError, OSError):
        return {"pid": None, "started_at": None, "host": None}


def is_locked(db_path):
    return read(db_path) is not None


def describe(db_path):
    """人が読める説明。読み手のエラーメッセージに使う。"""
    info = read(db_path)
    if info is None:
        return ""
    started = info.get("started_at") or "不明"
    host = info.get("host") or "不明"
    return "ETL が実行中です（開始 %s / 実行元 %s）" % (started, host)


class Lock(object):
    """with 文で使う。異常終了でも消えるよう atexit とシグナルにも登録する。"""

    def __init__(self, db_path):
        self.path = lock_path(db_path)
        self._held = False

    def acquire(self):
        if os.path.exists(self.path):
            raise RuntimeError(
                "%s が既にあります。ETL が二重に動いていないか確認してください。\n"
                "前回が異常終了して残っている場合だけ手で消してください: rm %s"
                % (self.path, self.path)
            )
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "pid": os.getpid(),
                    "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "host": socket.gethostname(),
                },
                f,
                ensure_ascii=False,
            )
        self._held = True
        atexit.register(self.release)
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                previous = signal.getsignal(sig)
                signal.signal(sig, self._handler(sig, previous))
            except (ValueError, OSError):
                pass  # メインスレッド以外では登録できない
        return self

    def _handler(self, sig, previous):
        def handle(signum, frame):
            self.release()
            if callable(previous):
                previous(signum, frame)
            else:
                raise SystemExit(128 + sig)

        return handle

    def release(self):
        if not self._held:
            return
        self._held = False
        try:
            os.remove(self.path)
        except OSError:
            pass

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()
        return False

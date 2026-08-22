# -*- coding: utf-8 -*-
"""要約の入力（事業の内容の原文＋セグメント構成比）のキャッシュ。

DB には入れない。原文は 1 社あたり数 KB あり、3,612 社ぶんを
リポジトリ同梱の SQLite に入れると肥大するため。

このキャッシュがあると、有報を取り直さずに要約だけ回し直せる
（ガードの調整後にやり直したい、というのが実際によく起きる）。
ディレクトリは .gitignore 済み。消えても有報を取り直せば再生成できる。
"""
import json
import os

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache", "descriptions")


def _path(edinet_code, base_dir=None):
    return os.path.join(base_dir or CACHE_DIR, "%s.json" % edinet_code)


def save(edinet_code, description, segments=None, base_dir=None):
    if not description:
        return False
    path = _path(edinet_code, base_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {"edinet_code": edinet_code, "description": description, "segments": segments or []},
            f, ensure_ascii=False,
        )
    return True


def load(edinet_code, base_dir=None):
    path = _path(edinet_code, base_dir)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (ValueError, OSError):
        return None


def available(base_dir=None):
    """キャッシュがある EDINET コードの集合。"""
    directory = base_dir or CACHE_DIR
    if not os.path.isdir(directory):
        return set()
    return {n[:-5] for n in os.listdir(directory) if n.endswith(".json")}

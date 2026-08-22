# -*- coding: utf-8 -*-
"""AI 要約の生成（Anthropic API）。

- ETL 側でだけ実行する。フロントから API を叩かない。
- 新規に有報を取得した会社のみ。既存レコードの再生成はしない。
- 出力は必ず summarize.guard を通す。落ちたら summary = null。

anthropic パッケージは要約を実際に生成するときだけ必要。
import を関数内に置いているのは、未インストールの環境でもテストと他フェーズを
動かせるようにするため。
"""
import json
import logging
import os
import time

from summarize import guard

log = logging.getLogger(__name__)

#: 要約は短いが、事実の取りこぼしを避けたいので中程度の effort を使う。
MODEL = "claude-opus-5"
EFFORT = "medium"
MAX_TOKENS = 2000

#: 拒否されたときに別モデルへ回すサーバー側フォールバック。
FALLBACK_BETA = "server-side-fallback-2026-07-01"

PROMPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompt.txt")

#: 構造化出力のスキーマ。tags のパース失敗をここで潰しておく。
#: 個数の上限は API のスキーマでは指定できない（maxItems は非対応）ので、
#: プロンプトで指示し、最終的には guard.check が弾く。
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "tags"],
    "additionalProperties": False,
}


def load_prompt():
    with open(PROMPT_PATH, encoding="utf-8") as f:
        return f.read().strip()


def build_user_content(description, segments=None):
    """モデルへの入力。原文と、直近期のセグメント別構成比。"""
    parts = ["【事業の内容（有価証券報告書の原文）】", (description or "").strip()]
    if segments:
        total = sum(abs(s.get("value") or 0) for s in segments)
        if total:
            lines = []
            for s in segments:
                value = s.get("value") or 0
                lines.append("- %s: %.1f%%" % (s.get("name", ""), abs(value) / float(total) * 100))
            parts.append("\n【直近期のセグメント別構成比】\n" + "\n".join(lines))
    return "\n".join(parts)


def _client():
    import anthropic  # noqa: PLC0415 未インストール環境でも他フェーズを動かすため

    return anthropic.Anthropic()


def _request_params(description, segments):
    return {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": load_prompt(),
        "messages": [{"role": "user", "content": build_user_content(description, segments)}],
        "output_config": {"effort": EFFORT, "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    }


def _guard_response(message):
    """API のレスポンス 1 件をガードに通す。"""
    if getattr(message, "stop_reason", None) == "refusal":
        return guard.GuardResult(reason=guard.Rejection.REFUSED)

    text = next((b.text for b in message.content if b.type == "text"), None)
    if not text:
        return guard.GuardResult(reason=guard.Rejection.EMPTY)
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return guard.GuardResult(reason=guard.Rejection.TAGS_NOT_JSON)

    return guard.check(data.get("summary"), data.get("tags"))


def summarize_one(description, segments=None, client=None):
    """1 社分。ガードを通した結果を返す。例外は呼び出し側で握る。"""
    client = client or _client()
    message = client.beta.messages.create(
        betas=[FALLBACK_BETA],
        fallbacks="default",
        **_request_params(description, segments)
    )
    return _guard_response(message)


def summarize_batch(items, client=None, poll_seconds=60, timeout_seconds=24 * 3600):
    """Message Batches API でまとめて生成する。初回の一括投入用（費用が半分）。

    items: [{"edinet_code": ..., "description": ..., "segments": [...]}]
    戻り値: {edinet_code: GuardResult}
    """
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    client = client or _client()
    requests = [
        Request(
            custom_id=item["edinet_code"],
            params=MessageCreateParamsNonStreaming(
                **_request_params(item.get("description"), item.get("segments"))
            ),
        )
        for item in items
    ]
    batch = client.messages.batches.create(requests=requests)
    log.info("バッチを投入しました: %s (%d 件)", batch.id, len(requests))

    waited = 0
    while True:
        current = client.messages.batches.retrieve(batch.id)
        if current.processing_status == "ended":
            break
        if waited >= timeout_seconds:
            raise RuntimeError("バッチが %d 秒で終わりませんでした: %s" % (timeout_seconds, batch.id))
        time.sleep(poll_seconds)
        waited += poll_seconds

    out = {}
    for result in client.messages.batches.results(batch.id):
        kind = result.result.type
        if kind == "succeeded":
            out[result.custom_id] = _guard_response(result.result.message)
        else:
            # errored / canceled / expired。要約は補助情報なので落として続行する。
            out[result.custom_id] = guard.GuardResult(reason="バッチ結果が %s" % kind)
    return out

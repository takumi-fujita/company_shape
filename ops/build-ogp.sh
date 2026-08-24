#!/usr/bin/env bash
#
# OGP 画像（1200x630 PNG）を版下 SVG から焼く。
#
#   bash ops/build-ogp.sh
#
# 日本語を描くのに Noto Sans JP が要るが、ホストに入れる必要はない。
# コンテナで 1 枚焼いて apps/web/public/ogp.png に置き、それをコミットする。
# 版下を直したときだけ実行すればよい。

set -Eeuo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OUT="apps/web/public/ogp.png"

docker run --rm -v "$PWD:/w" -w /w alpine:3.20 sh -c '
  apk add --no-cache --quiet rsvg-convert font-noto-cjk >/dev/null
  rsvg-convert -w 1200 -h 630 ops/assets/ogp.svg -o '"$OUT"'
'
echo "$OUT を生成しました（$(du -h "$OUT" | cut -f1)）"

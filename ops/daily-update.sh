#!/usr/bin/env bash
#
# 日次更新ジョブ。常時稼働の Mac mini から 5:00 JST に起動する。
#
#   EDINET / gBizINFO / Anthropic → SQLite → git commit && push
#   → GitHub Actions が検知して Cloudflare Pages にデプロイ
#
# 方針:
# - 差分実行。前日に提出のあった会社だけを処理する。全社の再取得はしない。
# - 変更が無ければコミットも push もしない（空コミットで CI を無駄に回さない）。
# - 二重起動を防ぐ。前回が長引いていたら今回はスキップする。
# - 1 社の失敗で止めない（ETL 側で処理済み）。ジョブ全体の失敗だけをここで扱う。

set -Eeuo pipefail

# cron / launchd は LANG 未設定で起動することがある。
# その状態だと bash が全角文字を変数名の一部として読んでしまう。
export LANG="${LANG:-ja_JP.UTF-8}"
export LC_ALL="${LC_ALL:-ja_JP.UTF-8}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/pipeline/logs"
LOG_FILE="$LOG_DIR/daily.log"
LOCK_DIR="${TMPDIR:-/tmp}/kaisha-no-katachi-daily.lock"
BRANCH="${DEPLOY_BRANCH:-main}"
#: 前回より会社数がこれ以上減っていたら異常として止める（%）。
MAX_SHRINK_PERCENT="${MAX_SHRINK_PERCENT:-5}"
PYTHON="${PYTHON:-python3}"

mkdir -p "$LOG_DIR"

# --- API キー --------------------------------------------------------------
# キーはリポジトリにも launchd の plist にも書かない。ここだけに置く。
#   chmod 600 ~/.config/kaisha-no-katachi/env
ENV_FILE="${KAISHA_ENV_FILE:-$HOME/.config/kaisha-no-katachi/env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
fail() { log "ERROR: $*"; exit 1; }

trap 'log "ERROR: line $LINENO で失敗しました"' ERR

# --- 二重起動の防止 --------------------------------------------------------
# 前回が終わっていなければ今回はスキップする。待つと EDINET を二重に叩く。
# macOS には flock(1) が無いので mkdir の原子性を使う。
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  STALE_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo '')"
  if [ -n "$STALE_PID" ] && kill -0 "$STALE_PID" 2>/dev/null; then
    log "前回のジョブ（pid ${STALE_PID}）が実行中のためスキップします"
    exit 0
  fi
  # ロックの持ち主が死んでいる場合だけ引き継ぐ
  log "残存ロックを引き継ぎます（pid ${STALE_PID:-不明} は不在）"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || fail "ロックを取得できませんでした"
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

# --- 対象日 ----------------------------------------------------------------
# 既定は前日。EDINET は当日分が揃うまで時間がかかるため。
TARGET_DATE="${1:-$(date -v-1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')}"

log "===== 日次更新 開始（対象日 ${TARGET_DATE}）====="

# --- 事前チェック ----------------------------------------------------------
[ -n "${EDINET_API_KEY:-}" ] || fail "EDINET_API_KEY が未設定です"
git diff --quiet && git diff --cached --quiet || fail "作業ツリーに未コミットの変更があります"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "$BRANCH" ] || fail "ブランチが $CURRENT_BRANCH です（$BRANCH で実行してください）"

log "リモートの変更を取り込みます"
git pull --rebase --quiet origin "$BRANCH"

# --- ETL -------------------------------------------------------------------
# 有報 → 補助金 → 要約 → パーセンタイル再計算まで main.py が面倒を見る。
log "ETL を実行します"
# set -e はパイプの失敗でその場で抜けてしまい、こちらのメッセージが出ない。
# if で包んで、何に失敗したのかを必ずログに残す。
if ! "$PYTHON" pipeline/main.py --date "$TARGET_DATE" 2>&1 | tee -a "$LOG_FILE"; then
  fail "ETL が失敗しました。コミットしません。"
fi

# --- 変更の確認 ------------------------------------------------------------
if git diff --quiet -- data/companies.db; then
  log "データに変更はありませんでした。コミットしません。"
  log "===== 日次更新 終了 ====="
  exit 0
fi

# --- 健全性チェック --------------------------------------------------------
# 壊れた DB を配信しないための最低限の関門。
# 前リビジョンの会社数と比べ、5% を超えて減っていたら止める（作り直し事故の検出）。
PREV_DB="$(mktemp -t kaisha-prev-db)"
MIN_COMPANIES=0
if git show "HEAD:data/companies.db" > "$PREV_DB" 2>/dev/null; then
  PREV_COUNT="$(sqlite3 "$PREV_DB" 'SELECT COUNT(*) FROM companies;' 2>/dev/null || echo 0)"
  MIN_COMPANIES=$(( PREV_COUNT * (100 - MAX_SHRINK_PERCENT) / 100 ))
  log "前リビジョンの会社数: ${PREV_COUNT} 社（下限 ${MIN_COMPANIES} 社）"
fi
rm -f "$PREV_DB"

log "DB の健全性を確認します"
if ! "$PYTHON" ops/verify_db.py data/companies.db --min-companies "$MIN_COMPANIES" 2>&1 | tee -a "$LOG_FILE"; then
  fail "DB の健全性チェックに落ちました。コミットしません。"
fi

# --- コミットと push -------------------------------------------------------
COMPANY_COUNT="$(sqlite3 data/companies.db 'SELECT COUNT(*) FROM companies;')"
git add data/companies.db
git commit --quiet -m "data: ${TARGET_DATE} の提出分を反映（${COMPANY_COUNT} 社）"
git push --quiet origin "$BRANCH"
log "push しました（${COMPANY_COUNT} 社）。GitHub Actions がデプロイします。"

# --- ログの世代管理 --------------------------------------------------------
find "$LOG_DIR" -name '*.log' -size +20M -exec sh -c 'mv "$1" "$1.$(date +%Y%m%d)" && : > "$1"' _ {} \; 2>/dev/null || true
find "$LOG_DIR" -name '*.log.*' -mtime +30 -delete 2>/dev/null || true

log "===== 日次更新 終了 ====="

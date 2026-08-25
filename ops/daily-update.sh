#!/usr/bin/env bash
#
# 取り込みから配信までの一連。
#
#   EDINET / gBizINFO / Anthropic → SQLite → git commit && push
#   → フロントのビルド（禁止語・テスト・SSG・予算）→ Cloudflare Pages
#
# 実行場所は問わない。Docker コンテナ（docker/）の中で回すのが既定だが、
# 手元で直接実行しても同じ動きをする。
#
#   bash ops/daily-update.sh                 # 前日分
#   bash ops/daily-update.sh 2026-06-26      # 日付を指定
#   ETL_DATE_FROM=2025-04-01 ETL_DATE_TO=2026-08-22 bash ops/daily-update.sh
#   ETL_REFRESH_LATEST=true bash ops/daily-update.sh # 抽出を直したあと、各社の最新提出だけ取り直す
#   SKIP_DEPLOY=true bash ops/daily-update.sh # 配信せずデータ更新だけ
#   SKIP_GIT=true    bash ops/daily-update.sh # git を一切触らない（一括投入用）
#
# 方針:
# - 差分実行。前日に提出のあった会社だけを処理する。全社の再取得はしない。
# - 変更が無ければコミットも push もしない（空コミットで CI を無駄に回さない）。
# - 二重起動を防ぐ。前回が長引いていたら今回はスキップする。
# - 1 社の失敗で止めない（ETL 側で処理済み）。ジョブ全体の失敗だけをここで扱う。

set -Eeuo pipefail

# cron / launchd / CI ランナーは LANG 未設定で起動することがある。
# その状態だと bash が全角文字を変数名の一部として読んでしまう。
# 存在しないロケールを指定すると C にフォールバックして同じ問題が起きるので、
# 実際に使えるものを選ぶ（Linux は C.UTF-8、macOS は ja_JP.UTF-8）。
case "${LANG:-}" in
  *.UTF-8|*.utf8) ;;                      # 既に UTF-8 ならそのまま使う
  *)
    for candidate in C.UTF-8 ja_JP.UTF-8 en_US.UTF-8; do
      if locale -a 2>/dev/null | grep -qxF "$candidate"; then
        export LANG="$candidate"
        break
      fi
    done
    ;;
esac
export LC_ALL="${LANG:-C.UTF-8}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="$REPO_ROOT/pipeline/logs"
LOG_FILE="$LOG_DIR/daily.log"
LOCK_DIR="${TMPDIR:-/tmp}/company-shape-daily.lock"
BRANCH="${DEPLOY_BRANCH:-main}"
#: 前回より会社数がこれ以上減っていたら異常として止める（%）。
MAX_SHRINK_PERCENT="${MAX_SHRINK_PERCENT:-5}"
PYTHON="${PYTHON:-python3}"

mkdir -p "$LOG_DIR"

# --- API キー --------------------------------------------------------------
# キーはリポジトリにも launchd の plist にも書かない。ここだけに置く。
#   chmod 600 ~/.config/company-shape/env
ENV_FILE="${COMPANY_SHAPE_ENV_FILE:-$HOME/.config/company-shape/env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }

# GitHub Actions に「データが変わったか」を返す。後続の deploy ジョブがこれを見る。
emit_changed() {
  [ -n "${GITHUB_OUTPUT:-}" ] && printf 'changed=%s\n' "$1" >> "$GITHUB_OUTPUT"
  return 0
}

# sqlite3 コマンドに依存しない（CI ランナーに無いことがある）。
count_companies() {
  "$PYTHON" - "$1" <<'PYEOF' 2>/dev/null || echo 0
import sqlite3, sys
try:
    print(sqlite3.connect(sys.argv[1]).execute("SELECT COUNT(*) FROM companies").fetchone()[0])
except Exception:
    print(0)
PYEOF
}
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

# --- フロントのビルドと配信 -------------------------------------------------
# 検査を通ったものだけを配信する。ここを飛ばすと、禁止語チェックを通らない
# 内容がそのまま公開される経路ができてしまう。
deploy_site() {
  if [ "${SKIP_DEPLOY:-false}" = "true" ]; then
    log "SKIP_DEPLOY=true のため配信しません"
    return 0
  fi
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    log "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID が無いため配信をスキップします"
    log "（データは push 済みなので、あとから配信だけやり直せます）"
    return 0
  fi
  # canonical / sitemap に入る値。既定値が無いので、ここで無ければビルドが落ちる。
  # 落ちてから気づくより先に止める。
  if [ -z "${NEXT_PUBLIC_SITE_URL:-}" ]; then
    fail "NEXT_PUBLIC_SITE_URL が未設定です。canonical と sitemap に入るので必須です。"
  fi

  cd "$REPO_ROOT/apps/web"

  if [ ! -d node_modules ]; then
    log "npm ci"
    if ! npm ci --no-audit --no-fund 2>&1 | tee -a "$LOG_FILE"; then
      cd "$REPO_ROOT"; fail "npm ci に失敗しました"
    fi
  fi

  # 禁止語チェック → テスト → SSG ビルド → パフォーマンス予算
  log "検査とビルド（npm run check）"
  if ! npm run check 2>&1 | tee -a "$LOG_FILE"; then
    cd "$REPO_ROOT"; fail "検査またはビルドに失敗しました。配信しません。"
  fi

  log "Cloudflare Pages へ配信します"
  if ! wrangler pages deploy out \
        --project-name "${CF_PAGES_PROJECT:-company-shape}" \
        --branch "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
    cd "$REPO_ROOT"; fail "配信に失敗しました。データは push 済みなので配信だけやり直せます。"
  fi

  cd "$REPO_ROOT"
  log "配信しました"
}

# --- 対象期間とオプション --------------------------------------------------
# 既定は前日 1 日分。EDINET は当日分が揃うまで時間がかかるため。
# 引数 > 環境変数 > 既定値 の順で決める（CI からは環境変数で渡す）。
YESTERDAY="$(date -v-1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')"
DATE_FROM="${1:-${ETL_DATE_FROM:-$YESTERDAY}}"

# 終了日の既定:
#   引数や ETL_DATE_TO があればそれ。
#   開始日だけ指定されたら「そこから前日まで」。過去分をまとめて入れたいはずなので、
#   1 日分に縮めない（初回投入でこれを踏むと 1 日しか入らない）。
#   何も指定が無ければ前日 1 日分（日次実行）。
if [ -n "${2:-}" ]; then
  DATE_TO="$2"
elif [ -n "${ETL_DATE_TO:-}" ]; then
  DATE_TO="$ETL_DATE_TO"
elif [ -n "${1:-}" ]; then
  DATE_TO="$1"          # 日付を 1 つだけ引数で渡したときはその日だけ
else
  DATE_TO="$YESTERDAY"
fi

ETL_ARGS=(--from "$DATE_FROM" --to "$DATE_TO")
[ "${ETL_LIMIT:-0}" != "0" ] && [ -n "${ETL_LIMIT:-}" ] && ETL_ARGS+=(--limit "$ETL_LIMIT")
[ "${ETL_FORCE:-false}" = "true" ] && ETL_ARGS+=(--force)
# 抽出を直したあとに使う。差分実行は各社の最新提出を必ず飛ばすため、
# これを付けないとパーサの修正が最新期に反映されない。
[ "${ETL_REFRESH_LATEST:-false}" = "true" ] && ETL_ARGS+=(--refresh-latest)
[ "${ETL_SKIP_SUMMARIES:-false}" = "true" ] && ETL_ARGS+=(--skip-summaries)
[ "${ETL_SKIP_SUBSIDIES:-false}" = "true" ] && ETL_ARGS+=(--skip-subsidies)
[ "${ETL_SUBSIDIES_ONLY:-false}" = "true" ] && ETL_ARGS+=(--subsidies-only)
[ "${ETL_INDUSTRIES_ONLY:-false}" = "true" ] && ETL_ARGS+=(--industries-only)
[ "${ETL_SUMMARIES_ONLY:-false}" = "true" ] && ETL_ARGS+=(--summaries-only)
[ "${ETL_SUMMARY_BATCH:-false}" = "true" ] && ETL_ARGS+=(--summary-batch)

log "===== 更新 開始（対象 ${DATE_FROM} .. ${DATE_TO}）====="

# --- 事前チェック ----------------------------------------------------------
[ -n "${EDINET_API_KEY:-}" ] || fail "EDINET_API_KEY が未設定です"

# git を触らないモード（一括投入など）では、作業ツリーの状態もブランチも問わない。
# コミットしないので、他の変更を巻き込む心配がないため。
if [ "${SKIP_GIT:-false}" = "true" ]; then
  log "SKIP_GIT=true のため git を触りません（コミットも push もしません）"
  SKIP_PUSH=true
else
  git diff --quiet && git diff --cached --quiet || fail "作業ツリーに未コミットの変更があります"

  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  [ "$CURRENT_BRANCH" = "$BRANCH" ] || fail "ブランチが $CURRENT_BRANCH です（$BRANCH で実行してください）"
fi

if [ "${SKIP_PUSH:-false}" = "true" ]; then
  log "SKIP_PUSH=true のため、リモートとのやり取りを行いません"
elif ! git remote get-url origin >/dev/null 2>&1; then
  log "origin が未設定のため、リモートとのやり取りを行いません"
  SKIP_PUSH=true
else
  log "リモートの変更を取り込みます"
  if ! git pull --rebase --quiet origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
    fail "git pull に失敗しました。origin への認証（SSH 鍵 / GIT_TOKEN）を確認してください。"
  fi
fi

# --- ETL -------------------------------------------------------------------
# 有報 → 補助金 → 要約 → パーセンタイル再計算まで main.py が面倒を見る。
log "ETL を実行します"
# set -e はパイプの失敗でその場で抜けてしまい、こちらのメッセージが出ない。
# if で包んで、何に失敗したのかを必ずログに残す。
log "pipeline/main.py ${ETL_ARGS[*]}"
if ! "$PYTHON" pipeline/main.py "${ETL_ARGS[@]}" 2>&1 | tee -a "$LOG_FILE"; then
  fail "ETL が失敗しました。コミットしません。"
fi

# --- 変更の確認 ------------------------------------------------------------
if git diff --quiet -- data/companies.db; then
  log "データに変更はありませんでした。コミットしません。"
  emit_changed false
  log "===== 更新 終了 ====="
  exit 0
fi

# --- 健全性チェック --------------------------------------------------------
# 壊れた DB を配信しないための最低限の関門。
# 前リビジョンの会社数と比べ、5% を超えて減っていたら止める（作り直し事故の検出）。
PREV_DB="$(mktemp "${TMPDIR:-/tmp}/company-shape-prev-db.XXXXXX")"
MIN_COMPANIES=0
if git show "HEAD:data/companies.db" > "$PREV_DB" 2>/dev/null; then
  PREV_COUNT="$(count_companies "$PREV_DB")"
  MIN_COMPANIES=$(( PREV_COUNT * (100 - MAX_SHRINK_PERCENT) / 100 ))
  log "前リビジョンの会社数: ${PREV_COUNT} 社（下限 ${MIN_COMPANIES} 社）"
fi
rm -f "$PREV_DB"

log "DB の健全性を確認します"
if ! "$PYTHON" ops/verify_db.py data/companies.db --min-companies "$MIN_COMPANIES" 2>&1 | tee -a "$LOG_FILE"; then
  fail "DB の健全性チェックに落ちました。コミットしません。"
fi

# --- コミットと push -------------------------------------------------------
COMPANY_COUNT="$(count_companies data/companies.db)"

if [ "${SKIP_GIT:-false}" = "true" ]; then
  log "データを更新しました（${COMPANY_COUNT} 社）。SKIP_GIT=true のためコミットしません。"
  emit_changed true
  deploy_site
  log "===== 更新 終了 ====="
  exit 0
fi

git add data/companies.db
git commit --quiet -m "data: ${DATE_FROM} .. ${DATE_TO} の提出分を反映（${COMPANY_COUNT} 社）"

if [ "${SKIP_PUSH:-false}" = "true" ]; then
  log "コミットしました（${COMPANY_COUNT} 社）。SKIP_PUSH=true のため push はしません。"
else
  if ! git push --quiet origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
    fail "git push に失敗しました。origin への認証（SSH 鍵 / GIT_TOKEN）を確認してください。"
  fi
  log "push しました（${COMPANY_COUNT} 社）。"
fi
emit_changed true

# --- フロントのビルドと配信 -------------------------------------------------
deploy_site

# --- ログの世代管理 --------------------------------------------------------
find "$LOG_DIR" -name '*.log' -size +20M -exec sh -c 'mv "$1" "$1.$(date +%Y%m%d)" && : > "$1"' _ {} \; 2>/dev/null || true
find "$LOG_DIR" -name '*.log.*' -mtime +30 -delete 2>/dev/null || true

log "===== 更新 終了 ====="

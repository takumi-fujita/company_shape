#!/usr/bin/env bash
#
# 初回の一括投入。5 年分の有報を古い年から順に取り込む。
#
#   bash ops/backfill.sh                # 2021 年度〜前日まで
#   bash ops/backfill.sh 2023           # 2023 年度から
#   RESET=true bash ops/backfill.sh     # 既存の DB を消してから始める
#
# 途中で止めても、同じコマンドで再開できる（取り込み済みは提出日で飛ばす）。
#
# 各段で何をしているか:
#   1. 年度ごとに有報だけ取り込む（要約・補助金・配信はしない）
#   2. 補助金をまとめて 1 回だけ引く（年ごとに引くと 5 倍の API 呼び出しになる）
#   3. 要約を Message Batches API でまとめて生成する（費用が半分）
#   4. 検査して配信する

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

START_YEAR="${1:-2021}"
END_YEAR="${END_YEAR:-$(date '+%Y')}"
LOG_DIR="$REPO_ROOT/pipeline/logs"
LOG_FILE="$LOG_DIR/backfill.log"
COMPOSE=(docker compose run --rm --no-TTY)

mkdir -p "$LOG_DIR"
log() { printf '%s [backfill] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }

count() {
  python3 - <<'PYEOF' 2>/dev/null || echo 0
import sqlite3
try:
    print(sqlite3.connect("data/companies.db").execute("SELECT COUNT(*) FROM companies").fetchone()[0])
except Exception:
    print(0)
PYEOF
}

if [ "${RESET:-false}" = "true" ]; then
  log "既存の data/companies.db を削除します"
  rm -f data/companies.db data/companies.db-wal data/companies.db-shm
fi

log "===== 一括投入 開始（${START_YEAR} 年度 〜）====="

# --- 1. 年度ごとに有報を取り込む -------------------------------------------
# 古い年から順に。新しい提出ほど優先されるので順序に依存しないが、
# 途中で止めたときに「最新が入っている」状態にしたいので古い順で回す。
for year in $(seq "$START_YEAR" "$((END_YEAR - 1))"); do
  log "--- ${year} 年度（${year}-04-01 .. $((year + 1))-03-31）---"
  "${COMPOSE[@]}" \
    -e ETL_DATE_FROM="${year}-04-01" \
    -e ETL_DATE_TO="$((year + 1))-03-31" \
    -e ETL_SKIP_SUMMARIES=true \
    -e ETL_SKIP_SUBSIDIES=true \
    -e SKIP_DEPLOY=true \
    -e SKIP_GIT=true \
    -e MAX_SHRINK_PERCENT=100 \
    etl run 2>&1 | tee -a "$LOG_FILE"
  log "${year} 年度まで: $(count) 社"
done

# 直近（当年度の 4 月から前日まで）
log "--- ${END_YEAR} 年度（${END_YEAR}-04-01 〜 前日）---"
"${COMPOSE[@]}" \
  -e ETL_DATE_FROM="${END_YEAR}-04-01" \
  -e ETL_SKIP_SUMMARIES=true \
  -e ETL_SKIP_SUBSIDIES=true \
  -e SKIP_DEPLOY=true \
  -e SKIP_GIT=true \
  -e MAX_SHRINK_PERCENT=100 \
  etl run 2>&1 | tee -a "$LOG_FILE"
log "有報の取り込み完了: $(count) 社"

# --- 2. 補助金 --------------------------------------------------------------
# 会社ごとに 1 回引けばよい。年度ごとに引くと同じ会社を 5 回叩くことになる。
log "--- 補助金（全社・1 回だけ）---"
"${COMPOSE[@]}" -e ETL_SUBSIDIES_ONLY=true -e SKIP_DEPLOY=true -e SKIP_GIT=true \
  etl run 2>&1 | tee -a "$LOG_FILE"

# --- 3. 要約 ----------------------------------------------------------------
log "--- AI 要約（Message Batches API）---"
"${COMPOSE[@]}" -e ETL_SUMMARIES_ONLY=true -e ETL_SUMMARY_BATCH=true \
  -e SKIP_DEPLOY=true -e SKIP_GIT=true \
  etl run 2>&1 | tee -a "$LOG_FILE"

# --- 4. 検査 ----------------------------------------------------------------
log "--- 健全性チェック ---"
python3 ops/verify_db.py data/companies.db 2>&1 | tee -a "$LOG_FILE"

log "===== 一括投入 完了（$(count) 社）====="
log "この後、内容を確認してからコミットと配信を行ってください:"
log "  git add data/companies.db && git commit -m 'data: 5 年分を一括投入'"
log "  docker compose run --rm etl run"

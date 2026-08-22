#!/usr/bin/env bash
#
# コンテナの入口。
#
#   entrypoint.sh schedule   supercronic を起動して常駐する（既定）
#   entrypoint.sh run        取り込み〜配信を 1 回だけ実行する
#   entrypoint.sh shell      調査用のシェル
#
# リポジトリは /app。ホストからマウントするか、GIT_REMOTE を渡せば clone する。

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app}"
BRANCH="${DEPLOY_BRANCH:-main}"

log() { printf '%s [entrypoint] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# --- リポジトリの用意 --------------------------------------------------------
prepare_repo() {
  if [ -d "$APP_DIR/.git" ]; then
    log "既存のリポジトリを使います: $APP_DIR"
    return
  fi
  if [ -z "${GIT_REMOTE:-}" ]; then
    cat >&2 <<'MSG'
/app にリポジトリがありません。次のどちらかを指定してください。

  1. ホストのリポジトリをマウントする
       docker run -v "$PWD:/app" ...
  2. clone させる
       docker run -e GIT_REMOTE=https://... ...
MSG
    exit 2
  fi
  log "clone します: ${GIT_REMOTE%%:*}..."
  git clone --branch "$BRANCH" --depth 1 "$GIT_REMOTE" "$APP_DIR"
}

# --- git の資格情報 ----------------------------------------------------------
setup_git() {
  cd "$APP_DIR"
  git config --global --add safe.directory "$APP_DIR"
  git config user.name  "${GIT_AUTHOR_NAME:-kaisha-no-katachi-bot}"
  git config user.email "${GIT_AUTHOR_EMAIL:-bot@kaisha-no-katachi.invalid}"

  # HTTPS + トークンで push する場合。SSH 鍵を /root/.ssh にマウントする運用でもよい。
  if [ -n "${GIT_TOKEN:-}" ]; then
    git config --global credential.helper store
    local remote host
    remote="$(git remote get-url origin)"
    host="$(printf '%s' "$remote" | sed -E 's#^https://([^/]+)/.*#\1#')"
    printf 'https://x-access-token:%s@%s\n' "$GIT_TOKEN" "$host" > /root/.git-credentials
    chmod 600 /root/.git-credentials
  fi
}

# --- Node の依存 -------------------------------------------------------------
# node_modules はイメージに焼いてある。/app にマウントされたツリーへ寄せる。
link_web_deps() {
  local target="$APP_DIR/apps/web/node_modules"
  if [ -d "${WEB_DEPS_DIR:-}" ] && [ ! -e "$target" ]; then
    log "node_modules をリンクします"
    ln -s "$WEB_DEPS_DIR" "$target"
  fi
}

case "${1:-schedule}" in
  run)
    prepare_repo
    setup_git
    link_web_deps
    cd "$APP_DIR"
    exec bash ops/daily-update.sh
    ;;
  schedule)
    prepare_repo
    setup_git
    link_web_deps
    log "supercronic を起動します（$(grep -v '^#' /etc/kaisha/crontab | grep -v '^$' | head -1)）"
    exec supercronic -passthrough-logs /etc/kaisha/crontab
    ;;
  shell)
    prepare_repo
    setup_git
    link_web_deps
    cd "$APP_DIR"
    exec bash
    ;;
  *)
    exec "$@"
    ;;
esac

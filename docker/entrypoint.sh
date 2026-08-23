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
HOME_HINT="${HOST_HOME:-/Users/<あなた>}"
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
# コンテナは無人で動くので、対話プロンプトが出た時点で詰む。
# 先に「押せる手が揃っているか」を確かめ、揃っていなければ理由を出して止める。
setup_git() {
  cd "$APP_DIR"
  git config --global --add safe.directory "$APP_DIR"
  git config user.name  "${GIT_AUTHOR_NAME:-company-shape-bot}"
  git config user.email "${GIT_AUTHOR_EMAIL:-bot@company-shape.invalid}"

  if [ "${SKIP_PUSH:-false}" = "true" ] || [ "${SKIP_GIT:-false}" = "true" ]; then
    log "SKIP_PUSH=true のため、git の認証情報は確かめません"
    return 0
  fi

  local remote=""
  remote="$(git remote get-url origin 2>/dev/null || true)"
  if [ -z "$remote" ]; then
    log "origin が未設定です。push はスキップされます。"
    return 0
  fi

  case "$remote" in
    https://*)
      if [ -z "${GIT_TOKEN:-}" ]; then
        cat >&2 <<MSG
origin が HTTPS ですが GIT_TOKEN がありません。

  $remote

.env に GIT_TOKEN=<repo 権限のトークン> を書いてください。
MSG
        exit 2
      fi
      local host
      host="$(printf '%s' "$remote" | sed -E 's#^https://([^/]+)/.*#\1#')"
      git config --global credential.helper store
      printf 'https://x-access-token:%s@%s\n' "$GIT_TOKEN" "$host" > /root/.git-credentials
      chmod 600 /root/.git-credentials
      log "HTTPS + GIT_TOKEN で認証します"
      ;;
    *)
      # git@host:... / ssh://... — 鍵が要る。
      # 鍵は /ssh-keys に読み取り専用でマウントされる想定。SSH は鍵の権限に厳しく、
      # known_hosts も書き込めないと困るので、書ける場所へコピーして使う。
      # ファイル名ではなく中身で判定する。README や .gitkeep を鍵と誤認しないため。
      local key_count=0
      if [ -d /ssh-keys ]; then
        # grep は該当なしで終了コード 1。pipefail のもとでは代入ごと失敗するので握る。
        key_count="$( { grep -rlsE 'BEGIN [A-Z ]*PRIVATE KEY' /ssh-keys 2>/dev/null || true; } | wc -l | tr -d ' ')"
      fi
      if [ "$key_count" -eq 0 ]; then
        cat >&2 <<MSG
origin が SSH ですが、コンテナに鍵がありません。

  $remote

次のどれかを選んでください。

  1. SSH 鍵を渡す（.env に絶対パスで書く。compose は ~ を展開しない）
       GIT_SSH_DIR=${HOME_HINT}/.ssh

  2. HTTPS + トークンに切り替える
       git remote set-url origin https://github.com/USER/REPO.git
     そのうえで .env に GIT_TOKEN=<repo 権限のトークン> を書く

  3. push しない（データ更新と配信だけ行う）
       .env に SKIP_PUSH=true を書く
MSG
        exit 2
      fi

      mkdir -p /root/.ssh
      cp -a /ssh-keys/. /root/.ssh/ 2>/dev/null || true
      chmod 700 /root/.ssh
      find /root/.ssh -maxdepth 1 -type f -exec chmod 600 {} +
      touch /root/.ssh/known_hosts

      # 無人実行なので絶対に対話させない。
      # accept-new: 初回のホスト鍵は受け入れるが、変わったら失敗する。
      GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh/known_hosts"
      export GIT_SSH_COMMAND
      git config --global core.sshCommand "$GIT_SSH_COMMAND"
      log "SSH 鍵で認証します（${key_count} 個）"
      ;;
  esac
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
    log "supercronic を起動します（$(grep -v '^#' /etc/company-shape/crontab | grep -v '^$' | head -1)）"
    exec supercronic -passthrough-logs /etc/company-shape/crontab
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

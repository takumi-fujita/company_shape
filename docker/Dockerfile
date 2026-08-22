# 会社のかたち — ETL からデプロイまでを 1 つのコンテナで完結させる。
#
#   EDINET / gBizINFO / Anthropic → SQLite → git push
#   → フロントのビルド（禁止語・テスト・SSG・予算）→ Cloudflare Pages
#
# 実行場所を問わないようにするのが目的なので、ホスト側に必要なのは Docker だけ。
# Python も Node も wrangler もこのイメージが持つ。

# Node は公式イメージから取り出す。nodesource のスクリプトを走らせるより
# 再現性が高く、レイヤも小さい。
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm

# --- Node ---------------------------------------------------------------------
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# --- OS パッケージ -------------------------------------------------------------
# git: DB のコミットと push / ca-certificates: HTTPS / tini: PID 1 のシグナル処理
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl tini openssh-client \
 && rm -rf /var/lib/apt/lists/*

# --- supercronic ---------------------------------------------------------------
# コンテナ内の定期実行。cron と違い、ログを標準出力に出し、環境変数を引き継ぎ、
# PID 1 として正しく振る舞う。バージョンとハッシュを固定する。
ARG SUPERCRONIC_VERSION=v0.2.33
ARG SUPERCRONIC_SHA1=71b0d58cc53f6bd72cf2f293e09e294b79c666d8
RUN curl -fsSLO "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA1}  supercronic-linux-amd64" | sha1sum -c - \
 && chmod +x supercronic-linux-amd64 \
 && mv supercronic-linux-amd64 /usr/local/bin/supercronic

# --- アプリの依存 ---------------------------------------------------------------
# 依存だけ先に入れてレイヤキャッシュを効かせる。
WORKDIR /app

COPY pipeline/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY apps/web/package.json apps/web/package-lock.json /tmp/web/
RUN cd /tmp/web && npm ci --no-audit --no-fund \
 && mkdir -p /opt/web-deps && mv node_modules /opt/web-deps/node_modules \
 && npm cache clean --force && rm -rf /tmp/web /root/.npm

# Cloudflare Pages への配信。npx で都度取りに行かせない。
RUN npm install -g wrangler@4 --no-audit --no-fund \
 && npm cache clean --force && rm -rf /root/.npm

# --- 実行 ----------------------------------------------------------------------
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/crontab /etc/kaisha/crontab
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    WEB_DEPS_DIR=/opt/web-deps/node_modules

# リポジトリは /app にマウントするか、GIT_REMOTE から clone させる（entrypoint 参照）。
VOLUME ["/app"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["schedule"]

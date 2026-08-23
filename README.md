# 会社のかたち

上場企業の有価証券報告書・gBizINFO から従業員データと財務指標を自動抽出し、
会計知識ゼロで読める形に変換する静的サイト。

- 仕様: `design_handoff_kaisha_no_katachi/README.md`（デザイン・データ契約）
- 技術仕様: エンジニアリング・ハンドオフ（構成・ETL・SEO・法務）

## 構成

```
apps/web/        Next.js 15 App Router / TypeScript / CSS Modules（全ページ SSG）
pipeline/        Python ETL。フロントとの境界は schema.sql の 1 枚だけ
docker/          実行イメージ（Python + Node + wrangler + supercronic）
ops/             取り込みと配信の運用（手順は ops/README.md）
data/companies.db        SQLite（コミットする。ビルド時にだけ読む）
fixtures/companies.json  ダミー 14 社（DB が無い環境でのフォールバック）
```

## 動かす

**以下のコマンドはすべてリポジトリのルートで実行する。** まず取得する。

```bash
git clone <このリポジトリの URL>
cd <クローンしてできたディレクトリ>
```

以降のコマンドはすべてここで実行する。別のディレクトリに移る箇所には
その都度 `cd` を書いてある。

### フロントだけ触る（実データ不要）

ダミー 14 社で全画面が動く。API キーもコンテナも要らない。

```bash
# リポジトリのルートで
python3 pipeline/seed_fixtures.py   # ダミーデータを生成

cd apps/web
npm install
npm run dev      # http://localhost:3000/companies/（SITE_URL 未設定でも動く）
# SSG ビルドは canonical/sitemap の絶対 URL が要る（既定値は無い）
NEXT_PUBLIC_SITE_URL=https://example.invalid npm run check
cd -             # ルートに戻る
```

### 実データを取り込む

**Docker で回す。** ホストに要るのは Docker だけで、Python も Node も wrangler も
イメージが持つ。実行場所は問わない。

```bash
# リポジトリのルートで（docker-compose.yml がある場所）
cp ops/env.example .env
# .env をエディタで開いて記入する（必須は EDINET_API_KEY）

docker compose build
docker compose run --rm etl run           # 1 回だけ
docker compose up -d                      # 常駐（日次実行）
docker compose logs -f etl
```

Docker を使わず直接回すこともできる（Python 3.12 / Node 22 / wrangler をホストで揃える）。

```bash
# リポジトリのルートで
mkdir -p ~/.config/company-shape
cp ops/env.example ~/.config/company-shape/env
chmod 600 ~/.config/company-shape/env
# ~/.config/company-shape/env をエディタで開いて記入する

bash ops/daily-update.sh                    # 取り込み → push → ビルド → 配信
SKIP_DEPLOY=true bash ops/daily-update.sh   # 配信せずデータ更新だけ
```

`ops/daily-update.sh` は自身の位置からリポジトリのルートを求めて `cd` するので、
どこから呼んでも同じように動く。

詳しい手順・初回の一括投入・監視・ロールバックは **`ops/README.md`**。

> **ETL の実行中にフロントをビルドしないこと。** ETL はコンテナから、ビルドはホストから
> 同じ SQLite をバインドマウント越しに開くため、`database disk image is malformed` に
> なります（DB は壊れていません）。ETL 中にフロントを触るときは
> `COMPANIES_DB=/nonexistent.db npm run dev` でダミー 14 社を使ってください。

`apps/web/lib/db.ts` は `data/companies.db` があればそれを、無ければ
`fixtures/companies.json` を読む。ETL とフロントはこの 1 点だけで繋がっている。
`COMPANIES_DB=/path/to.db` で別の DB を指せる（ETL の出力でフロントを検証するときに使う）。

## 現在の進捗

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | スキーマ確定 + ダミー 14 社 | 完了 |
| 1 | フロント 2 画面 | 完了 |
| 2 | ETL（EDINET）で実データ化 | 実装済み・**実データ未投入**（API 購読キー待ち） |
| 3 | gBizINFO（補助金）、パーセンタイル全社計算 | 実装済み・**実データ未投入**（gBizINFO トークン待ち） |
| 4 | AI 要約 + ガード | 実装済み・**実生成は未実行**（ANTHROPIC_API_KEY 待ち） |
| 5 | ランキング・業種ページ、sitemap、SEO | 完了 |
| 6 | Cloudflare Pages デプロイ、日次スケジュール | 実装済み・**未設置**（Cloudflare の作成と `.env` の記入待ち） |

## 変えてはいけないもの

- 企業の良し悪しを評価する文言・アイコン・色を追加しない。
  CI の `npm run lint:words` が `app/` `components/` `lib/` を機械的に検査する。
- 正常＝無彩色。色が付くのは閾値超過（alert / warn）のときだけ。「良好」を緑にしない。
- 正常な指標はラベル（余力＝「十分」）。異常時のみ具体値を出す。
- マスコット「データくん」の発話は固定文言。LLM に喋らせない。表情はサイトの状態にのみ反応させる。
- AI 要約は必ず `pipeline/summarize/guard.py` を通す。落ちたら `summary = null`。
  「数字のまとめ」はテンプレート生成で、LLM を通さない。
- フォントウェイトは 400 と 500 のみ。Web フォントは使わない。
- 実行時に外部 API を呼ばない。すべてビルド時に解決する。
- 閾値は `apps/web/lib/thresholds.ts` の 1 箇所のみで定義する。
- `NEXT_PUBLIC_SITE_URL` に既定値を置かない。未設定なら本番ビルドを例外で止める。
  存在しないドメインが canonical や sitemap に混入したまま公開されるほうが高くつく。

## デプロイと日次更新

```
Docker コンテナ（常駐 / 20:00 UTC = 翌 05:00 JST）
  EDINET / gBizINFO / Anthropic → pipeline/main.py → data/companies.db
                                                    → git commit && push
  → 禁止語・テスト・SSG・予算 → wrangler → Cloudflare Pages
```

**取り込みから配信までを 1 つのコンテナで完結させる。**
GitHub に依存せず、コンテナが動く場所ならどこでも同じように回る。

- 配信前に必ず `npm run check`（禁止語・テスト・SSG・予算）を通す。
  ここを飛ばすと検査を通らない内容が公開される経路ができる。
- GitHub Actions はフロントの変更を配信する `deploy.yml` と CI だけ。
  データ更新による配信には関与しない。
- `ops/verify_db.py` が配信前の関門。**要約に評価語が入っていないか**を
  ここでもう一度見る。落ちたらコミットも配信もしない。
- `public/_redirects` で `/` → `/companies/` を 301。
- `robots.txt` が指す `/sitemap.xml` は postbuild スクリプトが sitemap index として生成する。
- `npm run check:budget` が JS 150KB gzip / 検索インデックス 2MB gzip を検査する。

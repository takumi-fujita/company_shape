# 会社のかたち

上場企業の有価証券報告書・gBizINFO から従業員データと財務指標を自動抽出し、
会計知識ゼロで読める形に変換する静的サイト。

- 仕様: `design_handoff_kaisha_no_katachi/README.md`（デザイン・データ契約）
- 技術仕様: エンジニアリング・ハンドオフ（構成・ETL・SEO・法務）

## 構成

```
apps/web/        Next.js 15 App Router / TypeScript / CSS Modules（全ページ SSG）
pipeline/        Python ETL。フロントとの境界は schema.sql の 1 枚だけ
data/companies.db   SQLite（コミットする。ビルド時にだけ読む）
fixtures/companies.json  ダミー 14 社（DB が無い環境でのフォールバック）
```

## 動かす

```bash
# データ（ダミー 14 社）を生成
python3 pipeline/seed_fixtures.py

# ETL（実データを取り込む。API キーが要る）
mkdir -p ~/.config/kaisha-no-katachi
cp ops/env.example ~/.config/kaisha-no-katachi/env   # 必須は EDINET_API_KEY のみ
chmod 600 ~/.config/kaisha-no-katachi/env
source ~/.config/kaisha-no-katachi/env
python3 pipeline/main.py --from 2026-06-01 --to 2026-06-30 --limit 100

# フロント
cd apps/web
npm install
npm run dev          # http://localhost:3000/companies/
npm run build        # out/ に静的出力（Cloudflare Pages にそのまま配信）
npm run check        # 禁止語チェック + テスト + SSG ビルド
```

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
| 6 | Cloudflare Pages デプロイ、cron | 実装済み・**未設置**（Cloudflare / Mac mini の設定待ち） |

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

## デプロイと日次更新

```
Mac mini（毎日 5:00 JST）
  EDINET / gBizINFO / Anthropic → pipeline/main.py → data/companies.db
                                                    → git commit && push
GitHub push
  └→ Actions（禁止語・テスト・SSG・予算）→ Cloudflare Pages
```

**手順は `ops/README.md`。** Cloudflare Pages の作成、GitHub Secrets、
Mac mini の launchd / cron 設置、初回の一括投入、監視、ロールバックまで書いてある。

- ビルドは Cloudflare ではなく GitHub Actions で行い、`out/` をアップロードする。
  CI を通ったものだけが配信される。
- `ops/verify_db.py` が配信前の関門。**要約に評価語が入っていないか**を
  ここでもう一度見る。落ちたらコミットも push もしない。
- `public/_redirects` で `/` → `/companies/` を 301。
- `robots.txt` が指す `/sitemap.xml` は postbuild スクリプトが sitemap index として生成する。
- `npm run check:budget` が JS 150KB gzip / 検索インデックス 2MB gzip を検査する。

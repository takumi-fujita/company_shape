# ops — 取り込みと配信

```
Docker コンテナ（常駐 / supercronic が 20:00 UTC = 翌 05:00 JST に起動）
  EDINET / gBizINFO / Anthropic → pipeline/main.py → data/companies.db
                                                    → git commit && push
  → 禁止語チェック・テスト・SSG ビルド・予算 → wrangler → Cloudflare Pages
```

**取り込みから配信までを 1 つのコンテナで完結させる。** ホストに要るのは Docker だけで、
Python も Node も wrangler もイメージが持つ。実行場所は問わない。

| ファイル | 役割 |
|---|---|
| `docker/Dockerfile` | 実行イメージ（Python 3.12 + Node 22 + wrangler + supercronic） |
| `docker/entrypoint.sh` | `schedule`（常駐）/ `run`（1 回）/ `shell`（調査） |
| `docker/crontab` | コンテナ内の実行時刻 |
| `docker-compose.yml` | 常駐運用の入口 |
| `ops/daily-update.sh` | 本体。取り込み → 検査 → push → ビルド → 配信 |
| `ops/verify_db.py` | 配信前の DB 健全性チェック。落ちたらコミットも配信もしない |
| `ops/env.example` | 認証情報と設定の雛形 |
| `ops/com.company-shape.daily.plist` | Docker を使わず macOS で直接回す場合のみ |

GitHub Actions は **フロントの変更を配信する `deploy.yml`** と **CI** だけ。
データ更新による配信はコンテナが直接行うので、Actions は取り込みに関与しない。

---

## 0. 実行場所

**このドキュメントのコマンドはすべてリポジトリのルートで実行する。**
`docker compose` は `docker-compose.yml` のある場所でないと動かず、
`cp ops/env.example .env` のような相対パスも同じ。

```bash
git clone <このリポジトリの URL>
cd <クローンしてできたディレクトリ>
pwd    # 以降のコマンドはすべてここで実行する
```

別のディレクトリに移る箇所には、その都度 `cd` を書いてある。

---

## 1. Cloudflare Pages の準備（初回のみ）

リポジトリのルートで。

```bash
npm i -g wrangler
wrangler login
wrangler pages project create company-shape --production-branch main
```

**ビルドは Cloudflare 側では行わない。** コンテナ（データ更新時）と GitHub Actions
（フロント変更時）でビルドして `out/` をアップロードする。どちらの経路でも
配信前に禁止語チェックとテストを通る。Pages のダッシュボードでは
「Direct Upload」プロジェクトとして扱われる。

### GitHub 側の設定

Settings → Secrets and variables → Actions:

フロントの変更を配信する `deploy.yml` 用。取り込み系のキーは**コンテナの `.env`** に置く。

| 種別 | 名前 | 値 |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Pages の編集権限を持つ API トークン |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID |
| Variable | `SITE_URL` | 実際に配信するドメイン。canonical と sitemap に入る。**既定値は無いので未設定だとビルドが止まる** |

API トークンは Cloudflare の「My Profile → API Tokens」で
**Account → Cloudflare Pages → Edit** のテンプレートから作る。
それ以外の権限は付けない。

### 独自ドメイン

Pages プロジェクトの Custom domains にドメインを追加する。
`SITE_URL` と一致させること（ずれると canonical と sitemap が食い違う）。

---

## 2. コンテナを立てる

```bash
# リポジトリのルートで（docker-compose.yml がある場所）
cp ops/env.example .env
# .env をエディタで開いて記入する
#   必須: EDINET_API_KEY / CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
#         NEXT_PUBLIC_SITE_URL（既定値が無いので未設定だとビルドが止まる）

docker compose build
docker compose run --rm etl run     # まず 1 回だけ流して確認
docker compose up -d                # 問題なければ常駐させる
docker compose logs -f etl
```

### git の認証

コンテナは `data/companies.db` を push するので、`origin` の形式に応じた資格情報が要る。
**無人実行では対話プロンプトが出た時点で詰む**ため、起動時に確かめて、無ければ
「何をすればよいか」を出して止まる。

| `origin` | 用意するもの |
|---|---|
| `git@github.com:USER/REPO.git`（SSH） | `.env` に `GIT_SSH_DIR=/Users/you/.ssh`（絶対パス。compose は `~` を展開しない） |
| `https://github.com/USER/REPO.git` | `.env` に `GIT_TOKEN=<repo 権限のトークン>` |
| push しない | `.env` に `SKIP_PUSH=true`（データ更新と配信だけ行う） |

SSH 鍵は `/ssh-keys` に読み取り専用でマウントし、コンテナ内の書ける場所へコピーして
権限を 600 に直してから使う（SSH は鍵の権限に厳しい）。
ホスト鍵の検証は `accept-new`（初回は受け入れ、変わったら失敗）で、対話しない。

リポジトリは既定でホストのものをマウントする（`.:/app`）。
ホストにチェックアウトを置きたくない場合は、`docker-compose.yml` の `volumes` を
`repo:/app` に切り替え、`.env` に `GIT_REMOTE` と `GIT_TOKEN` を書けば
コンテナが自分で clone する。

### 単発実行

```bash
# リポジトリのルートで
docker compose run --rm etl run                       # 前日分
docker compose run --rm -e ETL_DATE_FROM=2026-06-26 etl run
docker compose run --rm -e SKIP_DEPLOY=true etl run   # 配信せずデータ更新だけ
docker compose run --rm etl shell                     # 調査用シェル
```

### 実行時刻を変える

`docker/crontab` を編集して `docker compose build` し直す。時刻は **UTC**。

---

## 3. 初回の投入

日次実行は前日分の差分しか取らない。過去分は単発実行で入れる。

### なぜ 5 年分なのか

上場企業は年 1 回しか有報を出さないので、**13 か月で全社が 1 周する**。
それ以上遡るのは、1 通の有報から取れる期数に差があるため。

| 項目 | 1 通から取れる期数 |
|---|---|
| 売上高・従業員数 | 5 期（主要な経営指標等の推移） |
| 営業利益 | 2 期（財務諸表本表） |
| 平均年収・勤続年数・セグメント | 1 期 |

5 年分を遡ると、営業利益と平均年収の系列も 5 期そろう。
**古い年から順に**入れること（新しい順に入れると古い期が窓から外れる）。

### 手順

```bash
# リポジトリのルートで
# 0. まっさらから始める（ダミーデータや試し取り込みを消す）
rm -f data/companies.db

# 1. まず 1 か月・100 社で抽出率を確認する
docker compose run --rm \
  -e ETL_DATE_FROM=2026-06-01 -e ETL_DATE_TO=2026-06-30 \
  -e ETL_LIMIT=100 -e ETL_SKIP_SUMMARIES=true -e SKIP_DEPLOY=true \
  -e MAX_SHRINK_PERCENT=100 etl run

python3 ops/verify_db.py data/companies.db
```

抽出率（従業員数・平均年収が取れている割合）を見て、
低ければ `pipeline/config.py` の勘定科目マッピングを直す。ここは実データを当てるまで
分からないので、必ず確認すること。

```bash
# 2. 5 年分を年ごとに入れる。古い年から順に。
#    1 年あたり 2〜3 時間かかる。途中で止めても、再実行すれば取り込み済みは飛ばす。
for y in 2021 2022 2023 2024 2025; do
  docker compose run --rm \
    -e ETL_DATE_FROM=$y-04-01 -e ETL_DATE_TO=$((y+1))-03-31 \
    -e ETL_SKIP_SUMMARIES=true -e SKIP_DEPLOY=true \
    -e MAX_SHRINK_PERCENT=100 etl run
done

# 3. 直近（前年度の 4 月から前日まで）
docker compose run --rm \
  -e ETL_DATE_FROM=2026-04-01 \
  -e ETL_SKIP_SUMMARIES=true -e SKIP_DEPLOY=true etl run

# 4. 要約をまとめて生成（Message Batches API。費用が半分）
docker compose run --rm \
  -e ETL_SUMMARIES_ONLY=true -e ETL_SUMMARY_BATCH=true -e SKIP_DEPLOY=true etl run

# 5. 検査して配信
python3 ops/verify_db.py data/companies.db
docker compose run --rm etl run
```

`MAX_SHRINK_PERCENT=100` を付けているのは、空の DB から始めると
「会社数が急減していない」の検査に引っかかるため。定常運用では外すこと。

`ETL_SKIP_SUMMARIES=true` を付けているのは、取り込みのたびに数千社分の要約を
逐次生成してしまうのを避けるため。要約は 4 でまとめて作る。

### 取り込み対象

`docTypeCode=120`（有価証券報告書）には**投資信託の有報が大量に混ざる**。
1 つの運用会社がファンドごとに何通も出すので、同じ EDINET コードが何度も現れ、
しかも従業員数も平均年収も持たない。次の条件で事業会社だけに絞っている。

- `formCode == "030000"`（内国会社の有価証券報告書）
- `fundCode` が無い
- `secCode` がある（＝上場している）

実測では、ある 1 日の 27 件のうち投資信託が 20 件、外国会社が 1 件で、
対象になる事業会社は 6 件だった。

### 業種分類

リポジトリのルートから見て `pipeline/data/industries.csv` に置く。
**これが無いと全社が「分類なし」になり、レーダーの母集団が壊れる。**
出どころは JPX「東証上場銘柄一覧」。

```csv
sec_code,industry_code,industry_label,market
4213,software,情報・通信業,グロース
```

---

## 4. Docker を使わずに回す場合（任意）

```bash
# リポジトリのルートで
mkdir -p ~/.config/company-shape
cp ops/env.example ~/.config/company-shape/env
chmod 600 ~/.config/company-shape/env
# ~/.config/company-shape/env をエディタで開いて記入する

bash ops/daily-update.sh
```

`ops/daily-update.sh` は自身の位置からリポジトリのルートを求めて `cd` するので、
どのディレクトリから呼んでも同じように動く。

同じスクリプトなので動きは変わらない。ただし Python 3.12 / Node 22 / wrangler を
ホスト側で揃える必要がある。macOS で常用したい場合は
`ops/com.company-shape.daily.plist` を LaunchAgents に置く（`docker compose up -d` の代わり）。

---

## 5. 更新ジョブの挙動

`ops/daily-update.sh` は次の順で動く。コンテナでも手元でも同じ。

1. `~/.config/company-shape/env` があれば読む（コンテナでは compose の env_file から入る）
2. **二重起動を防ぐ**（前回が実行中ならスキップ。待つと EDINET を二重に叩く）
3. 作業ツリーが綺麗か / ブランチが `main` かを確認する
4. `git pull --rebase`
5. `pipeline/main.py --from <前日> --to <前日>` — 有報 → 補助金 → 要約 → パーセンタイル再計算
6. **`data/companies.db` に変更が無ければ何もしない**（空コミットで CI を無駄に回さない）
7. `ops/verify_db.py` — 落ちたらコミットも push もしない
8. コミットして push
9. `npm run check` — 禁止語チェック → テスト → SSG ビルド → パフォーマンス予算
10. `wrangler pages deploy out` — Cloudflare Pages へ配信

9 を必ず通してから配信する。ここを飛ばすと、禁止語チェックを通らない内容が
そのまま公開される経路ができてしまう。`SKIP_DEPLOY=true` で 9・10 を止められる。

対象日は既定で**前日**。EDINET は当日分が揃うまで時間がかかる。
特定の日をやり直したいときは `docker compose run --rm -e ETL_DATE_FROM=2026-06-26 etl run`。

### 健全性チェックの中身

`verify_db.py` は配信前の関門。特に効くのは次の 2 つ。

- **要約に評価語が入っていない** — ガードは ETL 側で通しているが、ここでもう一度見る。
  ガードを通さない経路で `summary` が入ったまま配信すると信用毀損に直結する。
- **会社数が急減していない** — 前リビジョンと比べて 5% を超えて減っていたら止める。
  ETL の事故で DB を作り直してしまった場合の検出。

---

## 6. 監視

```bash
# リポジトリのルートで
docker compose logs -f etl              # コンテナの標準出力

tail -50 pipeline/logs/daily.log        # ジョブ全体
tail -50 pipeline/logs/etl.log          # ETL の詳細
cat pipeline/logs/failures.log          # 取り込みに失敗した会社
```

気にする値:

- **`業種が引けなかった銘柄: N 件`** — `industries.csv` の更新漏れ。新規上場のたびに出る。
- **`要約: 採用 N 社 / 破棄 M 社`** と破棄理由の内訳 — 破棄率が高すぎるなら
  禁止語が広すぎるかプロンプトが弱い。`pipeline/summarize/guard.py` を見直す。
- **`補助金: 更新 N 社 / 失敗 M 社`** — gBizINFO 側の不調。翌日直ることが多い。

配信だけが落ちた場合、`data/companies.db` は既に push 済みなので、
`docker compose run --rm -e ETL_SKIP_SUBSIDIES=true ... etl run` で
やり直すのではなく、`docker compose run --rm etl shell` に入って
`cd apps/web && npm run check && wrangler pages deploy out` を叩けばよい。
取り込みをやり直す必要はない。

---

## 7. ロールバック

```bash
# リポジトリのルートで
# 配信だけ戻す（Cloudflare の以前のデプロイに切り替える）
wrangler pages deployment list --project-name=company-shape

# データを戻す
git revert <commit>
git push origin main
```

データを戻したあとの配信は自動では起きない（データの push で Actions は動かない）。
`docker compose run --rm etl shell` に入って
`cd apps/web && npm run check && wrangler pages deploy out` を叩くか、
上の「配信だけ戻す」で以前のデプロイに切り替える。

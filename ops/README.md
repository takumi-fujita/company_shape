# ops — デプロイと日次更新

```
Mac mini（毎日 5:00 JST）
  EDINET / gBizINFO / Anthropic → pipeline/main.py → data/companies.db
                                                    → git commit && push
GitHub push
  └→ Actions（禁止語・テスト・SSG・予算）→ Cloudflare Pages
```

| ファイル | 役割 |
|---|---|
| `daily-update.sh` | 日次更新ジョブ本体 |
| `verify_db.py` | 配信前の DB 健全性チェック。落ちたらコミットも push もしない |
| `com.kaisha-no-katachi.daily.plist` | launchd 設定（cron の代替） |
| `env.example` | 認証情報の雛形。実体は `~/.config/kaisha-no-katachi/env` |

---

## 1. Cloudflare Pages の準備（初回のみ）

```bash
npm i -g wrangler
wrangler login
wrangler pages project create kaisha-no-katachi --production-branch main
```

**ビルドは Cloudflare 側では行わない。** GitHub Actions でビルドして `out/` をアップロードする。
Cloudflare のビルド環境に Node と SQLite の依存を持ち込まずに済み、
CI で通ったものだけが配信される。Pages のダッシュボードでは
「Direct Upload」プロジェクトとして扱われる。

### GitHub 側の設定

Settings → Secrets and variables → Actions:

| 種別 | 名前 | 値 |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Pages の編集権限を持つ API トークン |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID |
| Variable | `SITE_URL` | `https://kaisha-no-katachi.jp`（canonical と sitemap に入る） |

API トークンは Cloudflare の「My Profile → API Tokens」で
**Account → Cloudflare Pages → Edit** のテンプレートから作る。
それ以外の権限は付けない。

### 独自ドメイン

Pages プロジェクトの Custom domains にドメインを追加する。
`SITE_URL` と一致させること（ずれると canonical と sitemap が食い違う）。

---

## 2. Mac mini の準備（初回のみ）

```bash
git clone <repo> ~/Workspace/company_shape
cd ~/Workspace/company_shape

# API キーはここだけに置く。リポジトリにも plist にも書かない。
mkdir -p ~/.config/kaisha-no-katachi
cp ops/env.example ~/.config/kaisha-no-katachi/env
chmod 600 ~/.config/kaisha-no-katachi/env
$EDITOR ~/.config/kaisha-no-katachi/env   # 必須は EDINET_API_KEY のみ

# push できることを確認（SSH 鍵かデプロイキー）
git push --dry-run origin main
```

### 業種分類の投入

`pipeline/data/industries.csv` を用意する。**これが無いと全社が「分類なし」になり、
レーダーの母集団が壊れる。** 出どころは JPX「東証上場銘柄一覧」。

```csv
sec_code,industry_code,industry_label,market
4213,software,情報・通信業,グロース
```

### 初回の一括投入

日次ジョブは前日分の差分しか取らない。過去分は手で流す。

```bash
source ~/.config/kaisha-no-katachi/env

# 有報は 6 月に集中する。まず 1 か月ぶんを 100 社だけ試す
python3 pipeline/main.py --from 2026-06-01 --to 2026-06-30 --limit 100 --skip-summaries

# レイアウトが崩れないことを確認してから全件
python3 pipeline/main.py --from 2025-04-01 --to 2026-08-22 --skip-summaries

# 要約はバッチで（費用が半分）
python3 pipeline/main.py --summaries-only --summary-batch

python3 ops/verify_db.py data/companies.db
```

---

## 3. スケジューラの設置

### launchd（推奨）

```bash
sed -i '' "s|/Users/USERNAME/Workspace/company_shape|$PWD|g" ops/com.kaisha-no-katachi.daily.plist
cp ops/com.kaisha-no-katachi.daily.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kaisha-no-katachi.daily.plist

# 手動で 1 回流して確認
launchctl kickstart -p gui/$(id -u)/com.kaisha-no-katachi.daily
tail -f pipeline/logs/daily.log
```

launchd を勧める理由は、スリープや再起動でジョブを取りこぼしたときに復帰後へ寄せてくれること、
出力先を設定で持てること、TCC（フルディスクアクセス）の権限を LaunchAgent 単位で扱えること。

### cron

常時稼働で取りこぼしを気にしないなら cron でもよい。

```cron
0 5 * * * /bin/bash -lc '$HOME/Workspace/company_shape/ops/daily-update.sh' >> $HOME/Workspace/company_shape/pipeline/logs/cron.log 2>&1
```

---

## 4. 日次ジョブの挙動

`ops/daily-update.sh` は次の順で動く。

1. `~/.config/kaisha-no-katachi/env` を読む
2. **二重起動を防ぐ**（前回が実行中ならスキップ。待つと EDINET を二重に叩く）
3. 作業ツリーが綺麗か / ブランチが `main` かを確認する
4. `git pull --rebase`
5. `pipeline/main.py --date <前日>` — 有報 → 補助金 → 要約 → パーセンタイル再計算
6. **`data/companies.db` に変更が無ければ何もしない**（空コミットで CI を無駄に回さない）
7. `ops/verify_db.py` — 落ちたらコミットも push もしない
8. コミットして push → Actions がデプロイ

対象日は既定で**前日**。EDINET は当日分が揃うまで時間がかかる。
特定の日をやり直したいときは `ops/daily-update.sh 2026-06-26`。

### 健全性チェックの中身

`verify_db.py` は配信前の関門。特に効くのは次の 2 つ。

- **要約に評価語が入っていない** — ガードは ETL 側で通しているが、ここでもう一度見る。
  ガードを通さない経路で `summary` が入ったまま配信すると信用毀損に直結する。
- **会社数が急減していない** — 前リビジョンと比べて 5% を超えて減っていたら止める。
  ETL の事故で DB を作り直してしまった場合の検出。

---

## 5. 監視

日次で見る場所:

```bash
tail -50 pipeline/logs/daily.log        # ジョブ全体
tail -50 pipeline/logs/etl.log          # ETL の詳細
cat pipeline/logs/failures.log          # 取り込みに失敗した会社
```

気にする値:

- **`業種が引けなかった銘柄: N 件`** — `industries.csv` の更新漏れ。新規上場のたびに出る。
- **`要約: 採用 N 社 / 破棄 M 社`** と破棄理由の内訳 — 破棄率が高すぎるなら
  禁止語が広すぎるかプロンプトが弱い。`pipeline/summarize/guard.py` を見直す。
- **`補助金: 更新 N 社 / 失敗 M 社`** — gBizINFO 側の不調。翌日直ることが多い。

GitHub Actions が落ちた場合は `data/companies.db` は既に push 済みなので、
直してから Actions を再実行すれば配信される。ETL をやり直す必要はない。

---

## 6. ロールバック

```bash
# 配信だけ戻す（Cloudflare の以前のデプロイに切り替える）
wrangler pages deployment list --project-name=kaisha-no-katachi

# データを戻す
git revert <commit>
git push origin main    # Actions が回って前の状態が配信される
```

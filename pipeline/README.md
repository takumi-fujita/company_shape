# pipeline — ETL

フロント（`apps/web`）との境界は `schema.sql` の 1 枚だけ。それ以外で依存しない。

## 構成

| ファイル | 役割 |
|---|---|
| `schema.sql` | SQLite スキーマ。**唯一の境界** |
| `config.py` | API 設定と勘定科目マッピング。抽出対象を変えるときはここだけ |
| `fetch/http.py` | 取得の共通処理（指数バックオフ・4xx は即諦め） |
| `fetch/edinet.py` | EDINET API v2 クライアント（書類一覧・ZIP 取得） |
| `fetch/gbizinfo.py` | 法人番号キーの補助金交付決定 |
| `parse/xbrl.py` | インスタンス文書のパース（context / fact） |
| `parse/labels.py` | ラベルリンクベース。セグメント名の日本語化に必要 |
| `parse/extract.py` | XBRL の語彙 → データ契約。**単位はここで確定** |
| `transform/derive.py` | runway / CAGR / 毎月の費用 |
| `transform/percentile.py` | 業種内パーセンタイル・中央値 |
| `transform/subsidy.py` | 交付決定の正規化（年度・百万円・売上比） |
| `store.py` | SQLite への書き込み。複数年の提出をまたいだ系列のマージ |
| `industries.py` | 33業種分類と市場区分（JPX の銘柄一覧から作った CSV を参照） |
| `summarize/guard.py` | 要約の出力ガード。**法的な防御線** |
| `summarize/claude.py` | Anthropic API（逐次 / Message Batches） |
| `summarize/prompt.txt` | 要約のプロンプト制約 |
| `summarize/inputs.py` | 要約の入力（原文）のキャッシュ |
| `main.py` | オーケストレータ |
| `seed_fixtures.py` | ダミー 14 社（フロント単体開発用） |
| `dev_synthetic.py` | 合成 XBRL を実 ETL 経路に流して検証用 DB を作る |

```bash
export EDINET_API_KEY=...                       # EDINET API v2（購読キー必須）
export GBIZINFO_API_TOKEN=...                   # gBizINFO（トークン必須）
export ANTHROPIC_API_KEY=...                    # AI 要約
python3 pipeline/main.py --date 2026-06-26      # 1 日分を取り込む
python3 pipeline/main.py --from 2026-06-01 --to 2026-06-30 --limit 100
python3 pipeline/main.py --subsidies-only       # 補助金だけ全社分を取り直す
python3 pipeline/main.py --summaries-only --summary-batch  # 未生成の会社の要約をまとめて生成
python3 -m unittest discover -s pipeline/tests  # ネットワーク不要
```

## XBRL パーサについて

ハンドオフでは `arelle` を挙げていたが、**stdlib の ElementTree で直接読む実装にしている**。

- 抽出したいのは 10 数個の要素だけで、計算リンクや按分の解決が要らない。
- 3,612 社の初回一括処理で、1 通あたり数秒かかるモデル構築を避けたい。
- 依存を増やさずに済む（GitHub Actions でそのまま動く）。

より複雑な抽出が必要になったら、`parse/xbrl.py` の `parse_instance` / `parse/extract.py` の
`extract` を arelle 実装に差し替えればよい。呼び出し側はデータ契約の dict しか知らない。

## 1 通の有報から取れるもの・取れないもの

ここが設計上いちばん効く制約。

| 項目 | 取れる期数 | 出どころ |
|---|---|---|
| 売上高 | **5 期** | 主要な経営指標等の推移 |
| 従業員数 | **5 期** | 主要な経営指標等の推移 |
| 営業利益 | **2 期**（当期・前期） | 財務諸表本表 |
| 平均年収・平均勤続年数 | **1 期**（当期） | 従業員の状況 |
| セグメント別営業利益 | **1 期**（当期） | セグメント情報の注記 |

つまり 5 期分の営業利益・平均年収は 1 通では埋まらない。`store.upsert_company` は
**過去の提出分とマージ**して系列を育てる（取れなかった項目を None で上書きしない）。
初回投入直後はグラフに欠けがある状態が正しく、年を重ねるほど埋まる。
フロントは欠損期を描かない実装になっているので、そのままで破綻しない。

## 補助金（gBizINFO）

**交付決定の一次ソースは gBizINFO** の `/hojin/v1/hojin/{法人番号}/subsidy`（トークン必須）。

> jGrants の公開 API は公募中の制度マスタしか持たず、どの会社がいくら受け取ったかは返さないため、
> 使っていない（一度実装したが不要と判断して削除した）。gBizINFO の補助金情報は
> jGrants や各省庁のデータを集約したものなので、交付決定はこれ 1 本で足りる。

- **交付年度は日本の年度（4 月始まり）。** 交付決定日から求める。2025-01-20 なら 2024 年度。
- **売上比は円のまま計算する。** 百万円に丸めてから割ると小口の交付で誤差が目立つため。
- 該当年度の売上が取れない会社は `ratio` を null にする（推定で埋めない）。
- 金額は百万円に丸めるので、50 万円未満の交付は 0 百万円として入る。売上比は正しい値が出る。
- **表と合計行の対象は「直近 4 年度」で一致させる**（件数で切らない。合計が表の一部だけを
  指すことになり数字が合わなくなる）。フロント側は `lib/detail.ts` の `recentSubsidies`。
- 交付決定ベースの洗い替え。取り込みのたびにその会社の行を全消しして入れ直す。

補助金は補助情報なので、**トークンが無い / API が落ちていても有報側のデータは残す**。
`--skip-subsidies` で明示的に止められる。

## 業種分類

EDINET は業種も市場区分も返さない。`pipeline/data/industries.csv` を用意すること。

```csv
sec_code,industry_code,industry_label,market
4213,software,情報・通信業,グロース
```

出どころは JPX「東証上場銘柄一覧」。CSV が無い場合は全社が `unknown`／`分類なし` になり、
件数がログに出る。この状態だとレーダーの母集団が壊れるので、実データ投入前に必ず用意する。

## 運用ルール

- **差分実行。** `filed_at` が同じ会社は取得しない。`--force` を付けたときだけ再取得する。
- **1 社の失敗で全体を止めない。** 失敗は `pipeline/logs/failures.log` に残して続行する。
- **パーセンタイルは毎回全社分を作り直す。** 1 社の更新でも母集団が変わるため。
- **全社の一括再取得・再要約を日次で回さない。** 有報は年 1 回しか出ない。

## AI 要約

### 生成のタイミング

**新規に有報を取得した会社のうち、まだ要約が無いものだけ。** 既存レコードの再生成はしない。
有報は年 1 回しか出ないので、全社の再要約を日次で回すのは API コストの無駄。

要約の入力（事業の内容の原文＋直近期のセグメント構成比）は `pipeline/cache/descriptions/` に
置いている。DB には入れない（原文は 1 社数 KB あり、リポジトリ同梱の SQLite が肥大するため）。
このキャッシュがあると **有報を取り直さずに要約だけ回し直せる** ので、
プロンプトやガードを直したあとは `--summaries-only` で拾い直せる。

### モデルと呼び出し

`claude-opus-5` / effort `medium` / 構造化出力（json_schema）。
拒否されたときのサーバー側フォールバック（`fallbacks: "default"`）を有効にしている。
初回の 3,612 社は `--summary-batch` で Message Batches API を使う（費用が半分）。

### 出力ガード（`summarize/guard.py`）

**疑わしければ破棄する側に倒す。** 1 つでも引っかかれば要約ごと落とし、`summary = null` で保存する。

1. 評価語・予測・推測表現にヒット → 破棄（`guard.BANNED` が唯一の正）
2. 200 字超 → 破棄
3. `tags` が JSON として壊れている / 5 個以上 / 文になっている → 破棄

タグだけが不正な場合も要約ごと落とす。片方だけ残すと「どこまで検査済みか」が読み手に伝わらない。
モデルが応答を拒否した場合（`stop_reason == "refusal"`）も破棄として扱う。

破棄された会社は UI 側で AI 要約カードがセクションごと消える。
**数十社が空欄になっても構わない。誤った評価を 1 件出すほうが遥かに損害が大きい。**

禁止語を増やすのは自由。減らすときは理由をコメントに残すこと。
`tests/test_guard.py` が `guard.BANNED` の全語について「通過しないこと」を検査している。

### 「数字のまとめ」は LLM を使わない

箇条書き 4 点は完全なテンプレート生成（`apps/web/lib/detail.ts` の `buildNumberNotes`）。
LLM を通すと数値を書き間違えるリスクだけが乗る。マスコットのセリフも固定文言。

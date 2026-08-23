/**
 * public/search-index.json をビルド前に生成する。
 *
 * 含めるフィールドを増やさないこと（gzip 後 2MB 以内に収める必要がある）。
 * data/companies.db があればそれを、無ければ fixtures/companies.json を読む。
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '../..');
const DB_PATH = process.env.COMPANIES_DB
  ? path.resolve(process.env.COMPANIES_DB)
  : path.join(REPO_ROOT, 'data', 'companies.db');
const FIXTURE_PATH = path.join(REPO_ROOT, 'fixtures', 'companies.json');
const OUT_PATH = path.join(WEB_ROOT, 'public', 'search-index.json');

/** gzip 後の上限。超えたらフィールドを削ること。 */
const MAX_GZIP_BYTES = 2 * 1024 * 1024;

/**
 * ETL（コンテナ）が書き込み中の DB を、ホストからバインドマウント越しに読むと
 * "malformed" として見えることがある。壊れているわけではないので少し待ってやり直す。
 */
const OPEN_RETRIES = 5;
const OPEN_RETRY_WAIT_MS = 400;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 開くだけでなく読み切るまでを 1 回の試行とする（失敗するのはクエリ側のこともある）。 */
function readWithRetry(read) {
  let last;
  for (let i = 0; i < OPEN_RETRIES; i += 1) {
    let db;
    try {
      db = new DatabaseSync(DB_PATH, { readOnly: true });
      return read(db);
    } catch (e) {
      last = e;
      const msg = String(e?.message ?? e);
      const transient = ['malformed', 'locked', 'busy', 'SQLITE_BUSY', 'SQLITE_CORRUPT'].some((m) =>
        msg.includes(m),
      );
      if (!transient) throw e;
      if (i < OPEN_RETRIES - 1) sleepSync(OPEN_RETRY_WAIT_MS);
    } finally {
      try {
        db?.close();
      } catch {
        /* 開けなかった場合は閉じるものが無い */
      }
    }
  }
  console.error(
    `\n${DB_PATH} を読めませんでした（${OPEN_RETRIES} 回試行）。\n` +
      'ETL が書き込み中の可能性があります。終わるのを待つか、\n' +
      'フィクスチャ（ダミー 14 社）で開発する場合は次のように指定してください:\n' +
      '  COMPANIES_DB=/nonexistent.db npm run dev\n',
  );
  throw last;
}

/** ETL が実行中なら開かない。読むだけで DB を壊すため。 */
function assertEtlNotRunning() {
  const lock = path.join(path.dirname(DB_PATH), '.etl-running');
  if (!fs.existsSync(lock)) return;
  let detail = '';
  try {
    const info = JSON.parse(fs.readFileSync(lock, 'utf8'));
    detail = `（開始 ${info.started_at ?? '不明'} / 実行元 ${info.host ?? '不明'}）`;
  } catch {
    /* 壊れたロックでも「動いている」とみなす */
  }
  console.error(
    `\nETL が実行中のため ${DB_PATH} を開けません${detail}。\n\n` +
      'ETL とビルドが同時に同じ SQLite を開くと、読むだけでファイルが壊れます。\n\n' +
      '対処:\n' +
      '  - 終わるまで待つ:              docker compose logs -f etl\n' +
      '  - 待たずにフロントを触るなら:  COMPANIES_DB=/nonexistent.db npm run dev\n' +
      `  - ETL が異常終了して残っている場合のみ:  rm ${lock}\n`,
  );
  process.exit(1);
}

function fromSqlite() {
  assertEtlNotRunning();
  const rows = readWithRetry((db) =>
    db
      .prepare(
        `SELECT edinet_code, name, name_kana, sec_code, industry_code, industry_label,
                market, employees, avg_salary, avg_tenure, runway
           FROM companies ORDER BY edinet_code`,
      )
      .all(),
  );
  return rows.map((r) => ({
    edinetCode: r.edinet_code,
    name: r.name,
    nameKana: r.name_kana ?? null,
    secCode: r.sec_code ?? null,
    industryCode: r.industry_code,
    industryLabel: r.industry_label,
    market: r.market ?? null,
    employees: r.employees ?? null,
    avgSalary: r.avg_salary ?? null,
    avgTenure: r.avg_tenure ?? null,
    runway: r.runway ?? null,
  }));
}

function fromFixtures() {
  const { companies } = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  return companies.map((c) => ({
    edinetCode: c.edinetCode,
    name: c.name,
    nameKana: c.nameKana ?? null,
    secCode: c.secCode ?? null,
    industryCode: c.industryCode,
    industryLabel: c.industryLabel,
    market: c.market ?? null,
    employees: c.employees ?? null,
    avgSalary: c.avgSalary ?? null,
    avgTenure: c.avgTenure ?? null,
    runway: c.runway ?? null,
  }));
}

const index = fs.existsSync(DB_PATH) ? fromSqlite() : fromFixtures();
const json = JSON.stringify(index);
const gzipped = gzipSync(json).length;

if (gzipped > MAX_GZIP_BYTES) {
  console.error(
    `search-index.json is ${(gzipped / 1024 / 1024).toFixed(2)}MB gzipped, over the ${MAX_GZIP_BYTES / 1024 / 1024}MB budget. Drop a field.`,
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, json);
console.log(
  `search-index.json: ${index.length} companies, ${(json.length / 1024).toFixed(1)}KB raw / ${(gzipped / 1024).toFixed(1)}KB gzipped`,
);

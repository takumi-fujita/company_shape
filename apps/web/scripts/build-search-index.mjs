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

function fromSqlite() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT edinet_code, name, name_kana, sec_code, industry_code, industry_label,
              market, employees, avg_salary, avg_tenure, runway
         FROM companies ORDER BY edinet_code`,
    )
    .all();
  db.close();
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

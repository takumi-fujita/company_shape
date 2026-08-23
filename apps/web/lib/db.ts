/**
 * ビルド時のみ実行されるデータ読み取り層。
 *
 * data/companies.db があればそれを読む（本番）。無ければ fixtures/companies.json を読む
 * （フロント単体開発 / CI）。どちらの経路でも返す型は同じ Company で、
 * パーセンタイル・業種中央値・runway・growth はすべて算出済みの確定値。
 *
 * ここはサーバー専用。クライアントコンポーネントから import しないこと。
 */
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { assertEtlNotRunning, openWithRetry } from './sqlite';
import type {
  Company,
  FiscalPeriod,
  IndustryStat,
  SearchIndexEntry,
  Segment,
  Subsidy,
} from './types';

const REPO_ROOT = path.resolve(process.cwd(), '../..');
// COMPANIES_DB で別の DB を指せる（ETL の出力を実データ相当として検証するときに使う）。
const DB_PATH = process.env.COMPANIES_DB
  ? path.resolve(process.env.COMPANIES_DB)
  : path.join(REPO_ROOT, 'data', 'companies.db');
const FIXTURE_PATH = path.join(REPO_ROOT, 'fixtures', 'companies.json');

interface Dataset {
  companies: Company[];
  industryStats: IndustryStat[];
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadFromSqlite(): Dataset {
  // ETL 実行中は開かない。リトライではなく即座に止める。
  assertEtlNotRunning(DB_PATH);

  // node:sqlite は Node 22.5+ に同梱。native モジュールを増やさないために採用している。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  // readOnly は Node 22.13+ で利用可能。@types/node が追いついていないため cast する。
  // ETL の書き込み中は一時的に開けないことがあるので数回やり直す。
  const db = openWithRetry(
    () =>
      new DatabaseSync(DB_PATH, { readOnly: true } as ConstructorParameters<
        typeof DatabaseSync
      >[1]),
    DB_PATH,
  );

  const periodsByCompany = new Map<string, FiscalPeriod[]>();
  for (const r of db.prepare('SELECT * FROM fiscal_periods ORDER BY edinet_code, seq').all() as any[]) {
    const list = periodsByCompany.get(r.edinet_code) ?? [];
    list.push({
      label: r.label,
      seq: r.seq,
      revenue: r.revenue ?? null,
      operatingProfit: r.operating_profit ?? null,
      employees: r.employees ?? null,
      avgSalary: r.avg_salary ?? null,
      segments: parseJson<Segment[]>(r.segments, []),
    });
    periodsByCompany.set(r.edinet_code, list);
  }

  const subsidiesByCompany = new Map<string, Subsidy[]>();
  for (const r of db.prepare('SELECT * FROM subsidies ORDER BY edinet_code, year DESC').all() as any[]) {
    const list = subsidiesByCompany.get(r.edinet_code) ?? [];
    list.push({
      year: r.year,
      name: r.name,
      amount: r.amount,
      ratio: r.ratio ?? null,
      source: r.source ?? '',
    });
    subsidiesByCompany.set(r.edinet_code, list);
  }

  const percentilesByCompany = new Map<string, Company['percentiles']>();
  for (const r of db.prepare('SELECT * FROM percentiles').all() as any[]) {
    percentilesByCompany.set(r.edinet_code, {
      salary: r.salary,
      tenure: r.tenure,
      growth: r.growth,
      scale: r.scale,
      finance: r.finance,
    });
  }

  const NEUTRAL = { salary: 50, tenure: 50, growth: 50, scale: 50, finance: 50 };
  const companies = (db.prepare('SELECT * FROM companies ORDER BY edinet_code').all() as any[]).map(
    (r): Company => ({
      edinetCode: r.edinet_code,
      corpNumber: r.corp_number ?? null,
      name: r.name,
      nameKana: r.name_kana ?? null,
      market: r.market ?? null,
      secCode: r.sec_code ?? null,
      industryCode: r.industry_code,
      industryLabel: r.industry_label,
      fiscalEnd: r.fiscal_end ?? null,
      filedAt: r.filed_at ?? null,
      consolidated: r.consolidated === 1,
      employees: r.employees ?? null,
      avgSalary: r.avg_salary ?? null,
      avgTenure: r.avg_tenure ?? null,
      cash: r.cash ?? null,
      monthlyCost: r.monthly_cost ?? null,
      runway: r.runway ?? null,
      growth: r.growth ?? null,
      summary: r.summary ?? null,
      tags: parseJson<string[] | null>(r.tags, null),
      updatedAt: r.updated_at,
      fiscalPeriods: periodsByCompany.get(r.edinet_code) ?? [],
      subsidies: subsidiesByCompany.get(r.edinet_code) ?? [],
      // パーセンタイルが無い会社（ETL 途中失敗）はレーダーを歪めないよう全軸 50。
      percentiles: percentilesByCompany.get(r.edinet_code) ?? NEUTRAL,
    }),
  );

  const industryStats = (db.prepare('SELECT * FROM industry_stats').all() as any[]).map(
    (r): IndustryStat => ({
      industryCode: r.industry_code,
      industryLabel: r.industry_label,
      companyCount: r.company_count,
      medianSalary: r.median_salary ?? null,
      medianTenure: r.median_tenure ?? null,
    }),
  );

  db.close();
  return { companies, industryStats };
}

function loadFromFixtures(): Dataset {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as Dataset;
}

let cache: Dataset | null = null;

function dataset(): Dataset {
  if (cache) return cache;
  cache = fs.existsSync(DB_PATH) ? loadFromSqlite() : loadFromFixtures();
  return cache;
}

export function getAllCompanies(): Company[] {
  return dataset().companies;
}

export function getIndustryStats(): IndustryStat[] {
  return dataset().industryStats;
}

export function getCompany(edinetCode: string): Company | undefined {
  return dataset().companies.find((c) => c.edinetCode === edinetCode);
}

export function getIndustryStat(industryCode: string): IndustryStat | undefined {
  return dataset().industryStats.find((s) => s.industryCode === industryCode);
}

/**
 * 同じ業種の会社。業種一致のうち従業員数が近い順に n 件。
 * 3,612 ページを孤立させないための内部リンク（ハンドオフ §7）。
 */
export function getPeers(company: Company, n = 4): Company[] {
  const base = company.employees ?? 0;
  return dataset()
    .companies.filter(
      (c) => c.industryCode === company.industryCode && c.edinetCode !== company.edinetCode,
    )
    .sort((a, b) => Math.abs((a.employees ?? 0) - base) - Math.abs((b.employees ?? 0) - base))
    .slice(0, n);
}

/** public/search-index.json に落とすフィールドだけを抜く。増やさないこと。 */
export function buildSearchIndex(): SearchIndexEntry[] {
  return dataset().companies.map((c) => ({
    edinetCode: c.edinetCode,
    name: c.name,
    nameKana: c.nameKana,
    secCode: c.secCode,
    industryCode: c.industryCode,
    industryLabel: c.industryLabel,
    market: c.market,
    employees: c.employees,
    avgSalary: c.avgSalary,
    avgTenure: c.avgTenure,
    runway: c.runway,
  }));
}

/**
 * 薄いページは noindex にする（ハンドオフ §8）。
 * 主要 5 項目のうち 3 項目未満しか取れていない会社が対象。
 */
export function isThin(c: Company): boolean {
  const filled = [c.employees, c.avgSalary, c.avgTenure, c.runway, c.growth].filter(
    (v) => v != null,
  ).length;
  return filled < 3;
}

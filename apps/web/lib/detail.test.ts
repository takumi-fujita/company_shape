import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  headcountLevel,
  recentSubsidies,
  runwayDisplay,
  salaryLevel,
  subsidyTotals,
  tenureLevel,
} from './detail';

test('余力は正常時にラベル「十分」を出し、具体値を出さない', () => {
  const ok = runwayDisplay(18.4);
  assert.equal(ok.value, '十分');
  assert.equal(ok.unit, '');
  assert.equal(ok.pill, null);
  assert.equal(ok.level, null);
});

test('余力は閾値を割ったときだけ具体値とピルを出す', () => {
  const warn = runwayDisplay(9.4);
  assert.equal(warn.value, '9.4');
  assert.equal(warn.unit, 'ヶ月');
  assert.deepEqual(warn.pill, { level: 'warn', text: '短め' });

  const alert = runwayDisplay(4.8);
  assert.equal(alert.level, 'alert');
  assert.deepEqual(alert.pill, { level: 'alert', text: '要確認' });
});

test('余力が欠損なら「—」で、警告は出さない', () => {
  const missing = runwayDisplay(null);
  assert.equal(missing.value, '—');
  assert.equal(missing.pill, null);
  assert.equal(missing.level, null);
});

test('中央値が取れない会社では閾値判定をしない', () => {
  assert.equal(salaryLevel(5000, null), null);
  assert.equal(tenureLevel(1.2, null), null);
  assert.equal(salaryLevel(null, 6000), null);
});

test('閾値の境界: ちょうど 85% / 60% は警告にしない', () => {
  assert.equal(salaryLevel(5100, 6000), null); // 6000 * 0.85 = 5100
  assert.equal(salaryLevel(5099, 6000), 'warn');
  assert.equal(tenureLevel(6, 10), null); // 10 * 0.6 = 6
  assert.equal(tenureLevel(5.9, 10), 'warn');
});

test('従業員数の前期比: 0% は無彩色、マイナスで warn、-10% 未満で alert', () => {
  assert.equal(headcountLevel(0), null);
  assert.equal(headcountLevel(-0.1), 'warn');
  assert.equal(headcountLevel(-10), 'warn');
  assert.equal(headcountLevel(-10.1), 'alert');
  assert.equal(headcountLevel(null), null);
});

const period = (label: string, revenue: number | null) => ({
  label, seq: 0, revenue, operatingProfit: 700, employees: 312, avgSalary: 6480, segments: [],
});

const company = (
  subsidies: { year: number; amount: number; name?: string; ratio?: number | null }[],
  periods = [period('26/3', 12000)],
) =>
  ({
    subsidies: subsidies.map((s) => ({
      year: s.year,
      amount: s.amount,
      name: s.name ?? String(s.year),
      ratio: s.ratio ?? null,
      source: 'gbizinfo',
    })),
    fiscalPeriods: periods,
  }) as never;

test('補助金は直近 4 年度だけを出し、合計はその行と一致する', () => {
  const c = company([
    { year: 2025, amount: 36 },
    { year: 2024, amount: 120 },
    { year: 2023, amount: 5 },
    { year: 2022, amount: 13 },
    { year: 2021, amount: 900 },
  ]);
  const rows = recentSubsidies(c);
  assert.deepEqual(rows.map((r) => r.year), [2025, 2024, 2023, 2022]);
  // 合計は表に出ている 4 行だけ。2021 年度の 900 は入らない。
  assert.equal(subsidyTotals(rows, c).amount, 36 + 120 + 5 + 13);
});

test('補助金が飛び飛びでも年度の窓で切る', () => {
  const c = company([
    { year: 2025, amount: 10 },
    { year: 2020, amount: 90 },
  ]);
  assert.deepEqual(recentSubsidies(c).map((r) => r.year), [2025]);
});

test('補助金 0 件なら合計も「—」になる値を返す', () => {
  const c = company([]);
  const rows = recentSubsidies(c);
  assert.deepEqual(rows, []);
  assert.deepEqual(subsidyTotals(rows, c), { amount: null, ratio: null });
});

test('同じ年度の同じ制度はまとめ、件数と金額を合算する', () => {
  const c = company([
    { year: 2025, amount: 375, name: '鉄道施設災害復旧事業費補助', ratio: 0.3 },
    { year: 2025, amount: 12, name: '鉄道施設災害復旧事業費補助', ratio: 0.01 },
    { year: 2025, amount: 5, name: '文化財等保存整備事業', ratio: 0.004 },
  ]);
  const rows = recentSubsidies(c);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '鉄道施設災害復旧事業費補助');
  assert.equal(rows[0].amount, 387);
  assert.equal(rows[0].count, 2);
  assert.ok(Math.abs((rows[0].ratio ?? 0) - 0.31) < 1e-9);
  assert.equal(rows[1].count, 1);
  // まとめても合計は変わらない。
  assert.equal(subsidyTotals(rows, c).amount, 375 + 12 + 5);
});

test('年度が違えば同じ制度でもまとめない', () => {
  const c = company([
    { year: 2025, amount: 10, name: '同じ制度' },
    { year: 2024, amount: 20, name: '同じ制度' },
  ]);
  const rows = recentSubsidies(c);
  assert.deepEqual(rows.map((r) => [r.year, r.amount, r.count]), [
    [2025, 10, 1],
    [2024, 20, 1],
  ]);
});

test('売上比が 1 件でも不明なら、まとめた行の売上比は出さない', () => {
  const c = company([
    { year: 2025, amount: 10, name: '制度', ratio: 0.1 },
    { year: 2025, amount: 20, name: '制度', ratio: null },
  ]);
  const rows = recentSubsidies(c);
  assert.equal(rows[0].amount, 30);
  assert.equal(rows[0].ratio, null);
});

test('合計の売上比は、行と同じ年度の売上合計で割る', () => {
  // "25/3" は 2025 年 3 月期 = 2024 年度、"26/3" は 2025 年度。
  const c = company(
    [
      { year: 2025, amount: 60 },
      { year: 2024, amount: 40 },
    ],
    [period('25/3', 8000), period('26/3', 12000)],
  );
  const t = subsidyTotals(recentSubsidies(c), c);
  assert.equal(t.amount, 100);
  // 100 / (12000 + 8000) = 0.5%。最新期だけで割ると 0.83% になってしまう。
  assert.ok(Math.abs((t.ratio ?? 0) - 0.5) < 1e-9);
});

test('年度が 1 つでも売上不明なら合計の売上比は出さない', () => {
  const c = company(
    [
      { year: 2025, amount: 60 },
      { year: 2024, amount: 40 },
    ],
    [period('25/3', null), period('26/3', 12000)],
  );
  const t = subsidyTotals(recentSubsidies(c), c);
  assert.equal(t.amount, 100);
  assert.equal(t.ratio, null);
});

test('同じ年度に複数の行があっても売上を二重に数えない', () => {
  const c = company(
    [
      { year: 2025, amount: 60, name: 'A' },
      { year: 2025, amount: 60, name: 'B' },
    ],
    [period('26/3', 12000)],
  );
  const t = subsidyTotals(recentSubsidies(c), c);
  // 分母は 12000 の 1 回だけ。120 / 12000 = 1%
  assert.ok(Math.abs((t.ratio ?? 0) - 1) < 1e-9);
});

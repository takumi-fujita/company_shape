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

const company = (subsidies: { year: number; amount: number }[]) =>
  ({
    subsidies: subsidies.map((s) => ({ ...s, name: String(s.year), ratio: null, source: 'gbizinfo' })),
    fiscalPeriods: [{ label: '26/3', seq: 0, revenue: 12000, operatingProfit: 700, employees: 312, avgSalary: 6480, segments: [] }],
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

import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildHeadcountSalaryChart,
  buildRevenueProfitChart,
  buildSegmentChart,
} from './series';
import type { FiscalPeriod } from '../types';

function periods(over: Partial<FiscalPeriod>[] = []): FiscalPeriod[] {
  const base: FiscalPeriod[] = [22, 23, 24, 25, 26].map((y, i) => ({
    label: `${y}/3`,
    seq: i,
    revenue: 9000 + i * 750,
    operatingProfit: 450 + i * 60,
    employees: 280 + i * 8,
    avgSalary: 6200 + i * 70,
    segments: [
      { name: '主力事業', value: 300 },
      { name: '関連サービス', value: 230 },
      { name: '保守・その他', value: 170 },
    ],
  }));
  return base.map((p, i) => ({ ...p, ...(over[i] ?? {}) }));
}

/** viewBox "0 0 W H" の中に収まっているか。 */
function within(viewBox: string, coords: number[], axis: 'x' | 'y') {
  const [, , w, h] = viewBox.split(' ').map(Number);
  const limit = axis === 'x' ? w : h;
  return coords.every((c) => c >= -0.5 && c <= limit + 0.5);
}

function pathYs(d: string): number[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  return nums.filter((_, i) => i % 2 === 1);
}

test('通常の会社: 棒 5 本、折れ線 5 点、すべて viewBox 内', () => {
  const c = buildRevenueProfitChart(periods());
  assert.equal(c.bars.length, 5);
  assert.equal(c.points.length, 5);
  assert.ok(within(c.viewBox, c.points.map((p) => p.y), 'y'));
  assert.ok(within(c.viewBox, pathYs(c.linePath), 'y'));
});

test('営業赤字の会社でも折れ線が viewBox の外へ出ない', () => {
  const c = buildRevenueProfitChart(
    periods([
      { operatingProfit: -120 },
      { operatingProfit: -80 },
      { operatingProfit: -40 },
      { operatingProfit: -10 },
      { operatingProfit: -200 },
    ]),
  );
  assert.equal(c.points.length, 5);
  assert.ok(
    within(c.viewBox, c.points.map((p) => p.y), 'y'),
    `y 座標が viewBox 外: ${c.points.map((p) => p.y)}`,
  );
});

test('黒字と赤字が混ざっても両方が軸に入る', () => {
  const c = buildRevenueProfitChart(
    periods([
      { operatingProfit: 450 },
      { operatingProfit: -300 },
      { operatingProfit: 200 },
      { operatingProfit: -50 },
      { operatingProfit: 700 },
    ]),
  );
  assert.ok(within(c.viewBox, c.points.map((p) => p.y), 'y'));
});

test('欠損期は棒を描かず、折れ線もそこで切る', () => {
  const c = buildRevenueProfitChart(
    periods([{ revenue: null, operatingProfit: null, segments: [] }]),
  );
  assert.equal(c.bars.length, 4);
  assert.equal(c.points.length, 4);
  // サブパスが 1 本（先頭が欠けただけなので分断されない）
  assert.equal((c.linePath.match(/M/g) ?? []).length, 1);
});

test('中間期の欠損では折れ線が 2 本に分かれる', () => {
  const c = buildRevenueProfitChart(periods([{}, {}, { operatingProfit: null }, {}, {}]));
  assert.equal((c.linePath.match(/M/g) ?? []).length, 2);
});

test('桁が違う会社でも軸が壊れない', () => {
  for (const scale of [1, 1000, 100000]) {
    const c = buildRevenueProfitChart(
      periods([0, 1, 2, 3, 4].map((i) => ({ revenue: (9000 + i * 750) * scale }))),
    );
    assert.ok(within(c.viewBox, c.bars.map(() => 0), 'y'));
    assert.ok(!c.bars.some((b) => b.d.includes('NaN')));
  }
});

test('平均年収が全期欠損なら破線を描かない', () => {
  const c = buildHeadcountSalaryChart(periods([0, 1, 2, 3, 4].map(() => ({ avgSalary: null }))));
  assert.equal(c.salaryPath, '');
  assert.equal(c.salaryDots.length, 0);
  assert.equal(c.employeeDots.length, 5);
});

test('セグメントが無い期はブロックを描かない', () => {
  const c = buildSegmentChart(periods([0, 1, 2, 3, 4].map(() => ({ segments: [] }))));
  assert.equal(c.blocks.length, 0);
});

test('赤字セグメントは 0 の下へ積み、切り捨てない', () => {
  const c = buildSegmentChart(
    periods([0, 1, 2, 3, 4].map(() => ({
      segments: [
        { name: '主力事業', value: 400 },
        { name: '関連サービス', value: -150 },
      ],
    }))),
  );
  // 5 期 × 2 セグメント = 10 ブロック（負の分も描く）
  assert.equal(c.blocks.length, 10);
  assert.ok(c.blocks.every((b) => b.h > 0), '高さ 0 のブロックがある（切り捨てられている）');
  assert.ok(within(c.viewBox, c.blocks.map((b) => b.y), 'y'));
  assert.ok(within(c.viewBox, c.blocks.map((b) => b.y + b.h), 'y'));
});

test('すべて 0 の系列でも NaN を出さない', () => {
  const c = buildRevenueProfitChart(
    periods([0, 1, 2, 3, 4].map(() => ({ revenue: 0, operatingProfit: 0 }))),
  );
  assert.ok(!c.linePath.includes('NaN'));
  assert.ok(c.points.every((p) => Number.isFinite(p.y)));
});

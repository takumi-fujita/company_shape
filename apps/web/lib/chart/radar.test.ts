import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildRadar, radarSummary } from './radar';

const P = { salary: 58, tenure: 31, growth: 67, scale: 46, finance: 67 };

test('レーダーは 5 軸すべてを描く', () => {
  const r = buildRadar(P);
  assert.equal(r.dots.length, 5);
  assert.equal(r.spokes.length, 5);
  assert.equal(r.labels.length, 5);
  assert.equal(r.outer.split(' ').length, 5);
});

test('0% でも頂点が中心に潰れない（最小表示比率 0.12）', () => {
  const r = buildRadar({ salary: 0, tenure: 0, growth: 0, scale: 0, finance: 0 });
  const top = r.dots[0];
  // 中心 (130,112) から半径 78 * 0.12 = 9.36 上に離れている
  assert.ok(Math.abs(top.y - (112 - 78 * 0.12)) < 0.01);
});

test('欠損軸（50）は「業種のまんなか」と一致する', () => {
  const r = buildRadar({ salary: 50, tenure: 50, growth: 50, scale: 50, finance: 50 });
  assert.equal(r.self, r.mid);
});

test('サマリは 55 以上を「上」、45 以下を「下」として機械生成し、評価語を含まない', () => {
  const s = radarSummary(P);
  assert.equal(s, '給与・成長・財務は業種のまんなかより上。定着は業種のまんなかより下。');
  for (const banned of ['優良', '堅調', '安定', '不安定', '将来性', '有望', '懸念', '危険', '注意']) {
    assert.ok(!s.includes(banned), `評価語 ${banned} が混入している`);
  }
});

test('全軸が中間帯なら専用の文言を出す', () => {
  assert.equal(
    radarSummary({ salary: 50, tenure: 50, growth: 50, scale: 50, finance: 50 }),
    '5 つの角度すべてが業種のまんなか付近です。',
  );
});

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { niceMax, niceScale, topBarPath } from './nice';

test('niceMax は 1/2/2.5/5×10ⁿ のステップに切り上げる', () => {
  // step = v/4 を上回る最小の nice 値 × 4
  assert.equal(niceMax(100), 100); // step 25 -> 25
  assert.equal(niceMax(97), 100);
  assert.equal(niceMax(101), 200); // step 25.25 -> 50
  assert.equal(niceMax(3.2), 4); // step 0.8 -> 1
  assert.equal(niceMax(1), 1); // step 0.25 -> 0.25
});

test('niceMax は会社ごとに桁が変わっても軸を壊さない', () => {
  // 小規模〜大規模まで: 常に v 以上で、v の 2 倍は超えない
  for (const v of [8, 86, 940, 9360, 85800, 936000, 21200000]) {
    const m = niceMax(v);
    assert.ok(m >= v, `${m} >= ${v}`);
    assert.ok(m < v * 2, `${m} < ${v * 2}`);
    // 4 分割した目盛が丸い数字になっている
    const step = m / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(step)));
    assert.ok([1, 2, 2.5, 5, 10].some((k) => Math.abs(step / mag - k) < 1e-9), `step ${step}`);
  }
});

test('niceMax は 0 以下・非数を安全な既定値にする', () => {
  assert.equal(niceMax(0), 4);
  assert.equal(niceMax(-10), 4);
  assert.equal(niceMax(NaN), 4);
});

test('topBarPath は上部だけ角丸にする', () => {
  const d = topBarPath(10, 20, 44, 100, 7);
  // 始点は左下、終点も下端。下側に Q（角丸）が現れない。
  assert.ok(d.startsWith('M 10 120'));
  assert.ok(d.endsWith('L 54 120 Z'));
  assert.equal((d.match(/Q/g) ?? []).length, 2);
});

test('topBarPath は棒が角丸より低いときも破綻しない', () => {
  const d = topBarPath(0, 0, 44, 3, 7);
  assert.ok(!d.includes('NaN'));
  assert.ok(d.includes('Q 0 0 3 0'));
});

test('niceScale は負の値も軸に入れる', () => {
  const s = niceScale(-200, -10);
  assert.ok(s.min <= -200, `min ${s.min} <= -200`);
  assert.ok(s.max >= 0, `max ${s.max} >= 0`);
  assert.ok(s.ticks.includes(0), `目盛に 0 が含まれる: ${s.ticks}`);
});

test('niceScale は常に 0 を含み、目盛は等間隔', () => {
  for (const [lo, hi] of [
    [0, 100],
    [-50, 50],
    [-1200, 300],
    [0, 0],
    [-3, 0],
    [0, 21200000],
  ] as [number, number][]) {
    const s = niceScale(lo, hi);
    assert.ok(s.min <= Math.min(0, lo) + 1e-9, `min ${s.min} covers ${lo}`);
    assert.ok(s.max >= Math.max(0, hi) - 1e-9, `max ${s.max} covers ${hi}`);
    assert.equal(s.ticks.length, 5);
    assert.ok(s.ticks.some((t) => Math.abs(t) < 1e-9), `0 が目盛にある: ${s.ticks}`);
    for (let i = 1; i < s.ticks.length; i += 1) {
      assert.ok(Math.abs(s.ticks[i] - s.ticks[i - 1] - s.step) < 1e-6);
    }
  }
});

test('niceScale は非数でも軸を壊さない', () => {
  const s = niceScale(NaN, NaN);
  assert.ok(Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min);
});

test('niceMax は niceScale(0, v) と一致する', () => {
  for (const v of [1, 3.2, 97, 101, 9360, 21200000]) {
    assert.equal(niceMax(v), niceScale(0, v).max);
  }
});

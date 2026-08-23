import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildPageItems,
  clampPage,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  pageRange,
  parsePageSize,
  totalPages,
} from './pagination';

test('総ページ数', () => {
  assert.equal(totalPages(3706, 50), 75);
  assert.equal(totalPages(3706, 10), 371);
  assert.equal(totalPages(0, 50), 1);
  assert.equal(totalPages(50, 50), 1);
  assert.equal(totalPages(51, 50), 2);
});

test('ページ番号は 1..total に丸める', () => {
  assert.equal(clampPage('8', 371), 8);
  assert.equal(clampPage('0', 371), 1);
  assert.equal(clampPage('-3', 371), 1);
  assert.equal(clampPage('999', 371), 371);
  assert.equal(clampPage('abc', 371), 1);
  assert.equal(clampPage(null, 371), 1);
  assert.equal(clampPage('1', 0), 1);
});

test('件数は選択肢のいずれかに丸める', () => {
  for (const n of PAGE_SIZE_OPTIONS) assert.equal(parsePageSize(String(n)), n);
  assert.equal(parsePageSize('37'), DEFAULT_PAGE_SIZE);
  assert.equal(parsePageSize(null), DEFAULT_PAGE_SIZE);
  assert.equal(parsePageSize('99999'), DEFAULT_PAGE_SIZE);
});

test('ページ数が少なければ全部並べる', () => {
  assert.deepEqual(buildPageItems(1, 1), [1]);
  assert.deepEqual(buildPageItems(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('中ほどのページは両側を省略する', () => {
  assert.deepEqual(buildPageItems(8, 371), [1, 'ellipsis', 7, 8, 9, 'ellipsis', 371]);
});

test('先頭付近は左を省略しない', () => {
  assert.deepEqual(buildPageItems(1, 371), [1, 2, 3, 4, 5, 'ellipsis', 371]);
  assert.deepEqual(buildPageItems(3, 371), [1, 2, 3, 4, 5, 'ellipsis', 371]);
});

test('末尾付近は右を省略しない', () => {
  assert.deepEqual(buildPageItems(371, 371), [1, 'ellipsis', 367, 368, 369, 370, 371]);
  assert.deepEqual(buildPageItems(369, 371), [1, 'ellipsis', 367, 368, 369, 370, 371]);
});

test('どの位置でも 7 個を超えない（380px に収まる前提）', () => {
  for (const total of [8, 20, 75, 371]) {
    for (let p = 1; p <= total; p += 1) {
      const items = buildPageItems(p, total);
      assert.ok(items.length <= 7, `page ${p}/${total} が ${items.length} 個`);
      assert.equal(items[0], 1);
      assert.equal(items[items.length - 1], total);
      assert.ok(items.includes(p), `現在地 ${p} が含まれていない`);
    }
  }
});

test('省略記号が連続しない・番号が重複しない', () => {
  for (const total of [8, 9, 10, 75, 371]) {
    for (let p = 1; p <= total; p += 1) {
      const items = buildPageItems(p, total);
      const nums = items.filter((i): i is number => typeof i === 'number');
      assert.equal(new Set(nums).size, nums.length, `page ${p}/${total} に重複`);
      assert.deepEqual([...nums].sort((a, b) => a - b), nums, `page ${p}/${total} が昇順でない`);
      for (let i = 1; i < items.length; i += 1) {
        assert.ok(
          !(items[i] === 'ellipsis' && items[i - 1] === 'ellipsis'),
          `page ${p}/${total} で省略が連続`,
        );
      }
    }
  }
});

test('「該当 M 件中 X〜Y 件」の範囲', () => {
  assert.deepEqual(pageRange(1, 50, 3706), { from: 1, to: 50 });
  assert.deepEqual(pageRange(75, 50, 3706), { from: 3701, to: 3706 });
  assert.deepEqual(pageRange(1, 50, 0), { from: 0, to: 0 });
  assert.deepEqual(pageRange(1, 50, 12), { from: 1, to: 12 });
});

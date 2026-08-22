/**
 * パフォーマンス予算の検査（ハンドオフ §8: JS バンドル 150KB gzip 以内）。
 *
 * 実際に書き出された HTML が読み込む JS を数える。Next のビルドログの数字は
 * 一部のチャンクを含まないので当てにしない。
 *
 * noModule 付きのスクリプト（polyfills）は ES モジュール対応ブラウザが
 * 読み込まないので予算から外す。参考値としては表示する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(WEB_ROOT, 'out');

/** gzip 後の 1 ページあたり JS 上限。 */
const JS_BUDGET_BYTES = 150 * 1024;
/** search-index.json の gzip 後上限（ハンドオフ §7）。 */
const INDEX_BUDGET_BYTES = 2 * 1024 * 1024;

if (!fs.existsSync(OUT)) {
  console.error('out/ がありません。先に `npm run build` を実行してください。');
  process.exit(1);
}

const gzipCache = new Map();
function gzipSize(rel) {
  if (gzipCache.has(rel)) return gzipCache.get(rel);
  const file = path.join(OUT, rel.replace(/^\//, ''));
  const size = fs.existsSync(file) ? gzipSync(fs.readFileSync(file), { level: 9 }).length : 0;
  gzipCache.set(rel, size);
  return size;
}

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const SCRIPT_TAG = /<script\b([^>]*)>/g;
const SRC = /src="([^"]+\.js)"/;

function pageWeight(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const blocking = new Set();
  const noModule = new Set();
  for (const [, attrs] of html.matchAll(SCRIPT_TAG)) {
    const src = attrs.match(SRC)?.[1];
    if (!src || !src.startsWith('/_next/')) continue;
    (/\bnoModule\b/i.test(attrs) ? noModule : blocking).add(src);
  }
  // preload/prefetch されるチャンクも初回表示で取りに行くので数える
  for (const [, src] of html.matchAll(/"(\/_next\/static\/chunks\/[^"]+\.js)"/g)) {
    if (!noModule.has(src)) blocking.add(src);
  }
  const sum = (set) => [...set].reduce((a, s) => a + gzipSize(s), 0);
  return { modern: sum(blocking), legacy: sum(noModule) };
}

const pages = htmlFiles(OUT).map((p) => ({
  route: '/' + path.relative(OUT, p).replace(/index\.html$/, '').replace(/\\/g, '/'),
  ...pageWeight(p),
}));

pages.sort((a, b) => b.modern - a.modern);
const worst = pages[0];
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log(`ページ数: ${pages.length}`);
for (const p of pages.slice(0, 3)) {
  console.log(`  ${kb(p.modern).padStart(9)} gz  ${p.route}  (+${kb(p.legacy)} noModule)`);
}

let failed = false;
if (worst && worst.modern > JS_BUDGET_BYTES) {
  console.error(
    `\nJS 予算超過: ${worst.route} が ${kb(worst.modern)} gz（上限 ${kb(JS_BUDGET_BYTES)}）`,
  );
  failed = true;
}

const indexPath = path.join(OUT, 'search-index.json');
if (fs.existsSync(indexPath)) {
  const size = gzipSync(fs.readFileSync(indexPath), { level: 9 }).length;
  console.log(`search-index.json: ${kb(size)} gz`);
  if (size > INDEX_BUDGET_BYTES) {
    console.error(
      `\n検索インデックス予算超過: ${kb(size)} gz（上限 ${kb(INDEX_BUDGET_BYTES)}）。フィールドを削ってください。`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`\nbundle-budget: ok（最大 ${kb(worst.modern)} gz / 上限 ${kb(JS_BUDGET_BYTES)}）`);

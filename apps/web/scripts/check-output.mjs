/**
 * 配信前に、出力が揃っているかを確かめる。
 *
 * `next build` を直に叩くと npm の prebuild / postbuild が走らず、
 * 検索インデックスと sitemap index が欠けたまま配信されることがあった。
 * ビルド方法を間違えても気づけるよう、成果物そのものを見る。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const problems = [];

function must(rel, why) {
  const p = path.join(OUT, rel);
  if (!fs.existsSync(p)) problems.push(`${rel} が無い（${why}）`);
  return p;
}

// 1. 一覧が読む検索インデックス
const index = must('search-index.json', 'npm run build の prebuild で生成される');
if (fs.existsSync(index)) {
  const rows = JSON.parse(fs.readFileSync(index, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) problems.push('search-index.json が空');
  else {
    // 実際に出力された企業ページ数と突き合わせる
    const pages = fs.existsSync(path.join(OUT, 'company'))
      ? fs.readdirSync(path.join(OUT, 'company')).length
      : 0;
    if (pages && Math.abs(pages - rows.length) > 0) {
      problems.push(`search-index.json が ${rows.length} 件、企業ページが ${pages} 件で食い違う`);
    }
  }
}

// 2. robots.txt が指す sitemap が実在するか
const robots = must('robots.txt', 'app/robots.ts で生成される');
if (fs.existsSync(robots)) {
  for (const m of fs.readFileSync(robots, 'utf8').matchAll(/^Sitemap:\s*(\S+)/gim)) {
    const rel = new URL(m[1]).pathname.replace(/^\//, '');
    if (!fs.existsSync(path.join(OUT, rel))) {
      problems.push(`robots.txt が ${m[1]} を指しているが ${rel} が無い（postbuild で生成される）`);
    }
  }
}

// 3. OGP 画像
const ogp = path.join(OUT, 'ogp.png');
if (!fs.existsSync(ogp)) problems.push('ogp.png が無い（og:image が空になる）');

if (problems.length) {
  console.error('配信前の検査に落ちました:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n`npm run build` で作り直してください（next build を直に叩かないこと）。');
  process.exit(1);
}
console.log('check-output: ok');

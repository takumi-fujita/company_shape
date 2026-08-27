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

// 1b. 一覧が読む業種中央値。無いと絞り込みの選択肢が空になる。
const stats = must('industry-stats.json', 'npm run build の prebuild で生成される');
if (fs.existsSync(stats)) {
  const rows = JSON.parse(fs.readFileSync(stats, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) problems.push('industry-stats.json が空');
}

// 1c. OGP。ページごとに openGraph を書くと Next が丸ごと差し替えるため、
// og:image が消えたり og:url がトップを指したままになる事故が起きやすい。
// 代表的なページを直接見て、両方が正しいことを確かめる。
for (const [rel, want] of [
  ['index.html', '/companies/'],
  ['companies/index.html', '/companies/'],
  ['removal-request/index.html', '/removal-request/'],
]) {
  const file = path.join(OUT, rel);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  if (!/property="og:image"/.test(html)) problems.push(`${rel} に og:image が無い`);
  const m = html.match(/property="og:url" content="([^"]+)"/);
  if (!m) problems.push(`${rel} に og:url が無い`);
  else if (!m[1].endsWith(want)) problems.push(`${rel} の og:url が ${m[1]}（${want} で終わるはず）`);
}

// 動的ルートは 1 枚ずつ代表を見る。
for (const [dir, suffix] of [['company', '/'], ['industry', '/'], ['ranking', '/']]) {
  const base = path.join(OUT, dir);
  if (!fs.existsSync(base)) continue;
  const first = fs.readdirSync(base)[0];
  if (!first) continue;
  const file = path.join(base, first, 'index.html');
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  if (!/property="og:image"/.test(html)) problems.push(`${dir}/${first}/ に og:image が無い`);
  const m = html.match(/property="og:url" content="([^"]+)"/);
  if (!m) problems.push(`${dir}/${first}/ に og:url が無い`);
  else if (!m[1].endsWith(`/${dir}/${first}${suffix}`)) {
    problems.push(`${dir}/${first}/ の og:url が ${m[1]}（自分自身を指していない）`);
  }
}

// 1d. 構造化データ。Google の Dataset は description に 50〜5000 文字を求める。
// 短いと Search Console で「文字列長が無効」となりリッチリザルトから外れる。
{
  const base = path.join(OUT, 'company');
  const first = fs.existsSync(base) ? fs.readdirSync(base)[0] : null;
  const file = first && path.join(base, first, 'index.html');
  if (file && fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    if (!m) problems.push(`company/${first}/ に JSON-LD が無い`);
    else {
      let graph;
      try {
        graph = JSON.parse(m[1])['@graph'];
      } catch {
        problems.push(`company/${first}/ の JSON-LD が壊れている`);
      }
      const dataset = (graph || []).find((n) => n['@type'] === 'Dataset');
      if (!dataset) problems.push(`company/${first}/ に Dataset が無い`);
      else {
        const len = (dataset.description || '').length;
        if (len < 50 || len > 5000) {
          problems.push(`company/${first}/ の Dataset.description が ${len} 文字（50〜5000 が要件）`);
        }
      }
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

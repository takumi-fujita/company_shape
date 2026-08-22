/**
 * 法務ガードレール（ハンドオフ §9-1）のコードレベルの担保。
 *
 * このサイトは企業にとって不都合な数字を出す。信用毀損リスクを構造的に排除するため、
 * UI に出る文字列から評価的な語を機械的に締め出す。CI で必ず実行すること。
 *
 * 検査対象は app/ components/ lib/ の実装ファイル。本スクリプト自身とテストは対象外
 * （禁止語そのものを列挙する必要があるため）。
 *
 * 行末に `// banned-words-ok: 理由` を付けた行だけ除外できる。README で確定している
 * 文言（閾値ピルの「要確認」など）を通すための逃げ道で、それ以外に使わないこと。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIRS = ['app', 'components', 'lib'];
const TARGET_EXT = new Set(['.tsx', '.ts', '.css']);

/** 企業の良し悪しを含意する語。UI テキストに出してはいけない。 */
const BANNED = [
  '優良', '堅調', '安定', '不安定', '好調', '不調', '健全', '危険', '注意',
  '将来性', '有望', '懸念', 'おすすめ', 'オススメ', '推奨', '注目',
  '割安', '割高', 'ブラック企業', 'ホワイト企業', '要注意',
];

/** 予測・見通しの語。事実の提示のみに留める。 */
const BANNED_FORECAST = ['見通し', '予測される', 'と思われる', 'だろう', '期待できる'];

const ALL = [...BANNED, ...BANNED_FORECAST];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      out.push(...walk(p));
    } else if (TARGET_EXT.has(path.extname(e.name)) && !e.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

const hits = [];
for (const dir of TARGET_DIRS) {
  const abs = path.join(WEB_ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes('banned-words-ok')) return;
      for (const word of ALL) {
        if (line.includes(word)) {
          hits.push({ file: path.relative(WEB_ROOT, file), line: i + 1, word, text: line.trim() });
        }
      }
    });
  }
}

if (hits.length) {
  console.error('評価語・予測表現が含まれています。数値と閾値の提示だけに留めてください。\n');
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  「${h.word}」\n    ${h.text}`);
  }
  process.exit(1);
}

console.log(`banned-words: ok (${TARGET_DIRS.join(', ')})`);

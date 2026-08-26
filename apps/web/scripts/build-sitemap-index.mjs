/**
 * sitemap index を out/sitemap.xml に生成する。
 * Next の generateSitemaps は静的エクスポートで種別ごとのファイルしか出さないため、
 * それらを束ねる index をここで書く（robots.txt が指しているのはこの URL）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(WEB_ROOT, 'out');
const SITEMAP_DIR = path.join(OUT, 'sitemap');
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kaisha-katachi.com';

if (!fs.existsSync(SITEMAP_DIR)) {
  console.error('out/sitemap/ not found. Run `next build` first.');
  process.exit(1);
}

const files = fs.readdirSync(SITEMAP_DIR).filter((f) => f.endsWith('.xml')).sort();
const lastModified = new Date(fs.statSync(SITEMAP_DIR).mtime).toISOString();

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  files
    .map(
      (f) =>
        `  <sitemap>\n    <loc>${SITE_URL}/sitemap/${f}</loc>\n    <lastmod>${lastModified}</lastmod>\n  </sitemap>`,
    )
    .join('\n') +
  '\n</sitemapindex>\n';

fs.writeFileSync(path.join(OUT, 'sitemap.xml'), xml);
console.log(`sitemap.xml: index of ${files.length} sitemaps`);

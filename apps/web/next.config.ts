import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * リポジトリ直下の .env から NEXT_PUBLIC_* だけを読み込む。
 *
 * コンテナは compose の env_file で .env を渡すが、ホストで `npm run dev` を
 * 叩くと Next は apps/web/ より上の .env を見ない。設定を 2 箇所に書くと必ずずれるので、
 * リポジトリ直下の .env を唯一の置き場にする。
 *
 * **NEXT_PUBLIC_ 以外は読まない。** 同じ .env に API キーが入っており、
 * ビルドプロセスに不要な秘密情報を持ち込まないため。
 * 既に環境変数がある場合はそちらを優先する（CI からの明示指定が勝つ）。
 */
function loadPublicEnvFromRepoRoot(): void {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key]) continue;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (value) process.env[key] = value;
  }
}

loadPublicEnvFromRepoRoot();

// 全ページ静的生成。Cloudflare Pages に out/ をそのまま配信する。
// ISR / SSR / Route Handlers は使わない（データは年 1 回しか変わらない）。
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  productionBrowserSourceMaps: false,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

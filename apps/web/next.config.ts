import type { NextConfig } from 'next';

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

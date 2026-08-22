export const SITE_NAME = '会社のかたち';
export const SITE_TAGLINE = '決算書を、はたらく人の言葉に。';

/**
 * canonical / sitemap / JSON-LD に入る絶対 URL。
 *
 * 既定値は置かない。存在しないドメインが canonical や sitemap に混入したまま
 * 公開される事故のほうが、ビルドが止まるより高くつくため。
 * 本番ビルドで未設定なら例外を投げて止める。
 *
 * 設定場所:
 *   ローカル      apps/web/.env.local（apps/web/.env.example をコピー）
 *   コンテナ      .env（ops/env.example をコピー）
 *   GitHub Actions  Repository variables の SITE_URL
 */
function resolveSiteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (url) return url.replace(/\/$/, '');

  // next dev の出力は公開されないので、開発中だけは localhost に倒す。
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3000';

  throw new Error(
    'NEXT_PUBLIC_SITE_URL が設定されていません。' +
      'canonical・sitemap・JSON-LD に入る絶対 URL なので、既定値は用意していません。' +
      'apps/web/.env.example を参照して設定してください。',
  );
}

export const SITE_URL = resolveSiteUrl();

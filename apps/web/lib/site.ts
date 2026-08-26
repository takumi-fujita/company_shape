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

/**
 * 訂正・削除依頼を受け付ける Google フォームの URL。
 *
 * 未設定でもページ自体は出す。掲載内容に関する窓口はサイトの体裁として必要で、
 * フォームが用意できていないことを理由に窓口ごと消すべきではないため。
 * その場合はボタンを出さず、準備中である旨だけを表示する。
 */
export const REMOVAL_FORM_URL = process.env.NEXT_PUBLIC_REMOVAL_FORM_URL?.trim() ?? '';

/**
 * OGP。ページの metadata では必ずこれを通すこと。
 *
 * Next.js は openGraph を**オブジェクトごと**差し替える。深いマージはしない。
 * そのため素朴に書くと次のどちらかが必ず壊れる。
 *
 *   - ページ側で openGraph を書く → ルートの images が落ちて og:image が消える
 *     （実際に会社の詳細ページ 4,290 枚で消えていた）
 *   - ページ側で書かない        → ルートの url: '/' が残り、どのページを
 *     共有しても og:url がトップを指す（業種・ランキングで起きていた）
 *
 * 既定値とページ固有の値をここで 1 度だけ合成する。
 */
export function openGraph(o: {
  /** そのページの絶対パス。canonical と揃えること。 */
  path: string;
  title?: string;
  description?: string;
  type?: 'website' | 'article';
}): NonNullable<import('next').Metadata['openGraph']> {
  return {
    type: o.type ?? 'website',
    siteName: SITE_NAME,
    locale: 'ja_JP',
    url: o.path,
    images: [{ url: '/ogp.png', width: 1200, height: 630, alt: SITE_NAME }],
    // 省くと Next が metadata の title / description から補う。
    ...(o.title ? { title: o.title } : {}),
    ...(o.description ? { description: o.description } : {}),
  };
}

/**
 * 問い合わせ・削除依頼を受け付けるメールアドレス。
 *
 * 未設定でもページは出す。窓口の記載は ASP や広告審査で求められるが、
 * 用意できていないことを理由に窓口ごと消すべきではないため、
 * その場合は依頼フォームへ誘導する。
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ?? '';

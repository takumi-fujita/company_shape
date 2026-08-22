/**
 * マスコット「データくん」。画像ファイルは使わず幾何形状のみのインライン SVG。
 *
 * 役割は用語説明とナビゲートだけ。個別企業の良し悪しは絶対に語らせない。
 * 表情はサイトの状態にのみ反応させ、企業内容には反応させない（信用毀損リスク）。
 * - smile   … ヘッダー、AI 要約見出し
 * - tilt    … 用語解説
 * - worried … データ欠損の案内のみ
 */
export type MascotMood = 'smile' | 'tilt' | 'worried';

interface Props {
  size?: number;
  mood?: MascotMood;
}

export default function Mascot({ size = 40, mood = 'smile' }: Props) {
  const pupilY = mood === 'worried' ? 25.2 : 24.6;
  const mouth = mood === 'worried' ? 'M18 34 q5 -3 10 0' : 'M18 32 q5 4 10 0';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 46 46"
      aria-hidden="true"
      focusable="false"
      style={{ flex: `0 0 ${size}px` }}
    >
      <rect x="13" y="4" width="4.5" height="8" rx="2.2" fill="#f0997b" />
      <rect x="20.5" y="0" width="4.5" height="12" rx="2.2" fill="#ef9f27" />
      <rect x="28" y="5" width="4.5" height="7" rx="2.2" fill="#7f77dd" />
      {mood === 'tilt' && (
        <path
          d="M9 30 q-3 -5 1 -9"
          stroke="var(--accent)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      )}
      <circle cx="23" cy="27" r="16" fill="var(--accent)" />
      <circle cx="17" cy="24" r="3.4" fill="#ffffff" />
      <circle cx="29" cy="24" r="3.4" fill="#ffffff" />
      <circle cx="17" cy={pupilY} r="1.6" fill="#0f3d30" />
      <circle cx="29" cy={pupilY} r="1.6" fill="#0f3d30" />
      <path d={mouth} stroke="#0f3d30" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

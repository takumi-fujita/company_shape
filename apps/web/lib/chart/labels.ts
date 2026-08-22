/**
 * グラフのラベルは SVG <text> ではなく、position:relative のラッパー内に
 * 絶対配置した HTML <span> で描く（README 9）。SVG が viewBox で拡大されても
 * 本文フォントの実 px サイズが変わらないため。
 */
export interface ChartLabel {
  left: string;
  top: string;
  transform: string;
  text: string;
  color: string;
  size: string;
  chip: boolean;
}

export type Align = 'left' | 'right' | 'center';

/** viewBox 座標 (W×H) → % 座標に変換するラベル生成関数を返す。 */
export function labeler(W: number, H: number) {
  return (
    x: number,
    y: number,
    text: string,
    color = 'var(--ink-muted)',
    size = 10,
    align: Align = 'center',
    chip = false,
  ): ChartLabel => ({
    left: `${((x / W) * 100).toFixed(2)}%`,
    top: `${((y / H) * 100).toFixed(2)}%`,
    transform:
      align === 'right'
        ? 'translate(-100%,-50%)'
        : align === 'left'
          ? 'translate(0,-50%)'
          : 'translate(-50%,-50%)',
    text,
    color,
    size: `${size}px`,
    chip,
  });
}

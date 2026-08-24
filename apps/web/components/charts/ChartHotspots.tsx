'use client';

import { useState } from 'react';
import styles from './ChartHotspots.module.css';
import type { Hotspot } from '@/lib/chart/hotspot';

/**
 * グラフのマウスオーバーで数値を出す。
 *
 * SVG 本体はサーバー側で書き出したものをそのまま使い、その上に透明な当たり判定を重ねる。
 * 表示する文字列はサーバー側で整形済みなので、ここは配置と開閉だけを受け持つ。
 *
 * 出すのは抽出した数値の再掲だけ。良し悪しの判断は書かない。
 */
export default function ChartHotspots({ hotspots }: { hotspots: Hotspot[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (hotspots.length === 0) return null;
  const shown = active == null ? null : hotspots[active];

  return (
    <div className={styles.layer}>
      {hotspots.map((h, i) => (
        <button
          key={i}
          type="button"
          className={styles.zone}
          style={{ left: h.left, top: h.top, width: h.width, height: h.height }}
          // タッチ端末では hover が無いので、押したときにも出す。
          onMouseEnter={() => setActive(i)}
          onMouseLeave={() => setActive((c) => (c === i ? null : c))}
          onFocus={() => setActive(i)}
          onBlur={() => setActive((c) => (c === i ? null : c))}
          onClick={() => setActive((c) => (c === i ? null : i))}
          aria-label={`${h.title} ${h.rows.map((r) => `${r.name} ${r.value}`).join('、')}`}
        />
      ))}
      {shown && (
        <div
          className={styles.tip}
          style={{ left: shown.anchorLeft, top: shown.anchorTop }}
          role="status"
        >
          <span className={styles.title}>{shown.title}</span>
          {shown.rows.map((r) => (
            <span key={r.name} className={styles.row}>
              {r.color ? (
                <span className={styles.swatch} style={{ background: r.color }} />
              ) : (
                <span className={styles.noSwatch} />
              )}
              {r.name}
              <span className={styles.value}>{r.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

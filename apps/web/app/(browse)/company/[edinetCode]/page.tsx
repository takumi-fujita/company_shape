import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Mascot from '@/components/Mascot';
import Pill from '@/components/Pill';
import RadarChart from '@/components/charts/RadarChart';
import RevenueProfitChart from '@/components/charts/RevenueProfitChart';
import HeadcountSalaryChart from '@/components/charts/HeadcountSalaryChart';
import SegmentChart from '@/components/charts/SegmentChart';
import { SEGMENT_COLORS } from '@/lib/chart/series';
import { radarSummary } from '@/lib/chart/radar';
import { getAllCompanies, getCompany, getIndustryStat, getPeers, isThin } from '@/lib/db';
import {
  buildNumberNotes,
  buildScoreCards,
  performanceSummary,
  missingNotice,
  recentSubsidies,
  subsidyTotals,
  SUBSIDY_YEARS,
} from '@/lib/detail';
import {
  EM_DASH,
  date,
  fiscalPeriodLabel,
  num,
  percent,
  salary as fmtSal,
  tenure as fmtTen,
  yen,
} from '@/lib/format';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import styles from './detail.module.css';

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllCompanies().map((c) => ({ edinetCode: c.edinetCode }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ edinetCode: string }>;
}): Promise<Metadata> {
  const { edinetCode } = await params;
  const c = getCompany(edinetCode);
  if (!c) return {};
  const path = `/company/${c.edinetCode}/`;
  const marketCode = [c.market, c.secCode].filter(Boolean).join('・');
  const description =
    `${c.name}（${marketCode}）の平均年収${c.avgSalary == null ? EM_DASH : `${num(c.avgSalary)}千円`}、` +
    `平均勤続年数${c.avgTenure == null ? EM_DASH : `${num(c.avgTenure, 1)}年`}、` +
    `従業員数${c.employees == null ? EM_DASH : `${num(c.employees)}名`}。` +
    '有価証券報告書のデータを会計知識なしで読める形にまとめました。';

  return {
    title: `${c.name}の決算・従業員データ｜平均年収・勤続年数・業績推移`,
    description,
    alternates: { canonical: path },
    // データが 3 項目未満しか取れなかった薄いページは検索対象から外す。
    robots: isThin(c) ? { index: false, follow: true } : undefined,
    openGraph: { title: `${c.name}の決算・従業員データ`, description, url: path, type: 'article' },
  };
}

const GLOSSARY = [
  ['売上高', 'その年に売った金額の合計。会社の規模の目安です。'],
  ['営業利益', '売上から本業のコストを引いた残り。マイナスなら本業で赤字という意味です。'],
  ['手元のお金で払える月数', '現預金を毎月の費用で割った月数。給料を払い続けられる余力の目安です。'],
  ['セグメント', '事業の種類ごとの区分。どの事業で稼いでいるかが分かります。'],
] as const;

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ edinetCode: string }>;
}) {
  const { edinetCode } = await params;
  const c = getCompany(edinetCode);
  if (!c) notFound();

  const stat = getIndustryStat(c.industryCode);
  const peers = getPeers(c, 4);
  const scores = buildScoreCards(c, stat);
  const notes = buildNumberNotes(c, stat);
  const perf = performanceSummary(c);
  const missing = missingNotice(c);
  const subsidies = recentSubsidies(c);
  const totals = subsidyTotals(subsidies, c);
  const latest = c.fiscalPeriods.at(-1) ?? null;
  const segmentNames = latest?.segments.map((s) => s.name) ?? [];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: c.name,
        identifier: c.corpNumber ?? c.edinetCode,
        numberOfEmployees: c.employees ?? undefined,
        url: `${SITE_URL}/company/${c.edinetCode}/`,
      },
      {
        '@type': 'Dataset',
        name: `${c.name}の決算・従業員データ`,
        description: '有価証券報告書・gBizINFO から機械抽出した数値データ。',
        creator: { '@type': 'Organization', name: SITE_NAME },
        isBasedOn: ['https://disclosure2.edinet-fsa.go.jp/', 'https://info.gbiz.go.jp/'],
        dateModified: c.updatedAt,
        license: 'https://www.digital.go.jp/copyright-policy',
      },
    ],
  };

  return (
    <main className={styles.main}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* 1. パンくず・見出し */}
      <div className={styles.headBlock}>
        <nav className={styles.breadcrumb} aria-label="パンくず">
          <Link href="/companies/">会社をさがす</Link>
          <span>/</span>
          <Link href={`/industry/${c.industryCode}/`}>{c.industryLabel}</Link>
          <span>/</span>
          <span className={styles.breadcrumbCurrent}>{c.name}</span>
        </nav>
        <h1 className={styles.h1}>{c.name}の決算・従業員データ</h1>
        <div className={styles.subMeta}>
          <span>
            {[c.market, c.secCode].filter(Boolean).join('・')}（EDINET コード {c.edinetCode}）
          </span>
          <span>
            {fiscalPeriodLabel(c.fiscalEnd)}（{c.consolidated ? '連結' : '単体'}）
          </span>
          <span>有報提出 {date(c.filedAt)}</span>
        </div>
        <div className={styles.sourceMeta}>
          <span>出典: EDINET / gBizINFO</span>
          <span>最終更新 {date(c.updatedAt)}</span>
        </div>
      </div>

      {/* 2. データくんの帯（固定文言。企業内容には反応させない） */}
      <div className={styles.band}>
        <Mascot size={46} mood="smile" />
        <span className={styles.bandText}>
          <span className={styles.bandTitle}>この会社、どんな会社？</span>
          <span className={styles.bandSub}>むずかしい数字は ぜんぶ変換しておいたよ</span>
        </span>
      </div>

      {/* 3. レーダー「会社のかたち」 */}
      <section className={`${styles.section} ${styles.sectionTight}`}>
        <h2 className={styles.h2}>会社のかたち</h2>
        <span className={styles.sectionLead}>
          同じ業種の会社と比べた 5 つの角度。外側にふくらむほど、その業種の中で高い順位です。
        </span>
        <div className={styles.radarCols}>
          <RadarChart percentiles={c.percentiles} />
          <div className={styles.radarSide}>
            <span className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.swatchSolid} />
                この会社
              </span>
              <span className={styles.legendItem}>
                <span className={styles.swatchDashed} />
                業種のまんなか
              </span>
            </span>
            <span className={styles.radarSummary}>{radarSummary(c.percentiles)}</span>
            <span className={styles.footnote}>
              5 軸はいずれも同業種内の順位（0〜100）に変換した値です。金額や年数そのものではありません。
            </span>
          </div>
        </div>
      </section>

      {/* 4. スコアカード 4 枚 */}
      <div className={styles.cols4}>
        {scores.map((s) => (
          <div
            key={s.label}
            className={`${styles.score}${
              s.level === 'alert' ? ` ${styles.scoreAlert}` : s.level === 'warn' ? ` ${styles.scoreWarn}` : ''
            }`}
          >
            <span className={styles.scoreLabel}>{s.label}</span>
            <span className={styles.scoreValueRow}>
              <span className={styles.scoreValue}>{s.value}</span>
              {s.unit && <span className={styles.scoreUnit}>{s.unit}</span>}
            </span>
            <span className={styles.scoreFoot}>
              <span className={styles.scoreSub}>{s.sub}</span>
              <Pill pill={s.pill} />
            </span>
          </div>
        ))}
      </div>

      {/* 5. 免責 */}
      <p className={styles.disclaimer}>
        数値は有価証券報告書からの機械抽出です。評価・解釈は含みません。
      </p>

      {/* 6. データ欠損の案内 */}
      {missing && (
        <div className={styles.missing}>
          <Mascot size={30} mood="worried" />
          <span className={styles.missingText}>{missing}</span>
        </div>
      )}

      {/* 7. AI 要約（要約データがある会社のみ。ガード不合格はセクションごと非表示） */}
      {c.summary && (
        <section className={styles.section}>
          <span className={styles.iconRow}>
            <Mascot size={28} mood="smile" />
            <h2 className={styles.h2}>ざっくり言うと、どんな会社？</h2>
          </span>
          <p className={styles.summaryBody}>{c.summary}</p>
          {c.tags && c.tags.length > 0 && (
            <span className={styles.tags}>
              {c.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </span>
          )}
          <span className={styles.footnote}>
            有価証券報告書「事業の内容」の要約です。評価や将来予測は含みません。原文は EDINET
            で確認できます。
          </span>
        </section>
      )}

      {/* 8. 数字のまとめ（テンプレート生成。LLM は通さない） */}
      <section className={styles.section}>
        <h2 className={styles.h2}>数字のまとめ</h2>
        <span className={styles.notes}>
          {notes.map((t) => (
            <span key={t} className={styles.noteItem}>
              <span className={styles.noteDot} />
              {t}
            </span>
          ))}
        </span>
        <span className={styles.footnote}>抽出した数値の再記述です。良し悪しの判断は含みません。</span>
      </section>

      {/* 9. 売上と利益はどう動いた？ */}
      <section className={styles.section}>
        <span className={styles.headRow}>
          <span className={styles.titleStack}>
            <h2 className={styles.h2}>売上と利益はどう動いた？（{c.fiscalPeriods.length} 期分）</h2>
            <span className={styles.sectionLead}>
              棒が売った金額、線が本業で残った利益です。単位は百万円。
            </span>
          </span>
          <span className={styles.legendRow}>
            <span className={styles.legendItem}>
              <span
                className={styles.swatchBox}
                style={{ background: 'var(--chart-teal-3)' }}
              />
              売上高（棒・最新期を濃く）
            </span>
            <span className={styles.legendItem}>
              <span className={styles.swatchLine} style={{ background: 'var(--chart-line)' }} />
              営業利益（線）
            </span>
          </span>
        </span>
        <div className="wideOnly">
          <RevenueProfitChart periods={c.fiscalPeriods} />
        </div>
        <table className={`${styles.dataTable} narrowOnly`}>
          <thead>
            <tr>
              <th className={styles.dataTh}>決算期</th>
              <th className={styles.dataThNum}>売上高</th>
              <th className={styles.dataThNum}>営業利益</th>
            </tr>
          </thead>
          <tbody>
            {c.fiscalPeriods.map((f) => (
              <tr key={f.seq}>
                <td className={styles.dataTd}>{f.label}期</td>
                <td className={styles.dataTdNum}>{num(f.revenue)}</td>
                <td className={styles.dataTdNum}>{num(f.operatingProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <span className={styles.metaRow}>
          <span>{c.fiscalPeriods.length} 期の売上のふえ方 {perf.cagr}</span>
          <span>最新期の営業利益率 {perf.opm}</span>
          <span>単位: 百万円</span>
        </span>
      </section>

      {/* 10. 2 カラム */}
      <div className={styles.cols2}>
        <section className={styles.section}>
          <span className={styles.titleStack}>
            <h2 className={styles.h2}>人とお給料の動き</h2>
            <span className={styles.sectionLead}>実線が従業員数（名）、点線が平均年収（千円）。</span>
          </span>
          <span className={styles.legendRow}>
            <span className={styles.legendItem}>
              <span className={styles.swatchLine} style={{ background: 'var(--chart-teal-3)' }} />
              従業員数
            </span>
            <span className={styles.legendItem}>
              <span className={styles.swatchLineDashed} />
              平均年収
            </span>
          </span>
          <div className="wideOnly">
            <HeadcountSalaryChart periods={c.fiscalPeriods} />
          </div>
          <table className={`${styles.dataTable} narrowOnly`}>
            <thead>
              <tr>
                <th className={styles.dataTh}>決算期</th>
                <th className={styles.dataThNum}>従業員数</th>
                <th className={styles.dataThNum}>平均年収</th>
              </tr>
            </thead>
            <tbody>
              {c.fiscalPeriods.map((f) => (
                <tr key={f.seq}>
                  <td className={styles.dataTd}>{f.label}期</td>
                  <td className={styles.dataTdNum}>{num(f.employees)}</td>
                  <td className={styles.dataTdNum}>{num(f.avgSalary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={styles.section}>
          <span className={styles.titleStack}>
            <h2 className={styles.h2}>どの事業で稼いでいる？</h2>
            <span className={styles.sectionLead}>セグメント別の営業利益（百万円）。</span>
          </span>
          {segmentNames.length > 0 && (
            <span className={styles.legendRow}>
              {segmentNames.map((name, i) => (
                <span key={`${name}-${i}`} className={styles.legendItem}>
                  <span
                    className={styles.swatchBox}
                    style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                  />
                  {name}
                </span>
              ))}
            </span>
          )}
          <div className="wideOnly">
            <SegmentChart periods={c.fiscalPeriods} />
          </div>
          <table className={`${styles.dataTable} narrowOnly`}>
            <tbody>
              {latest?.segments.length ? (
                latest.segments.map((s, i) => (
                  <tr key={`${s.name}-${i}`}>
                    <td className={styles.dataTd}>{s.name}</td>
                    <td className={styles.dataTdNum}>{yen(s.value)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className={styles.dataTd}>セグメントの内訳は取得できていません</td>
                  <td className={styles.dataTdNum}>{EM_DASH}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {/* 11. 国や自治体から受け取ったお金 */}
      <section className={styles.tableSection}>
        <div className={styles.tableHead}>
          <h2 className={styles.h2}>国や自治体から受け取ったお金</h2>
          <span className={styles.sectionLead}>
            売上に占める比率も並べています。出典: gBizINFO（交付決定ベース）
          </span>
        </div>
        {subsidies.length === 0 ? (
          <div className={styles.emptyRow}>公開データの範囲では交付の記録がありません。</div>
        ) : (
          <div className={styles.scrollX}>
            <table className={styles.subsidyTable}>
              <thead>
                <tr>
                  <th className={`${styles.subTh} ${styles.padLeft}`}>交付年度</th>
                  <th className={styles.subTh}>制度名</th>
                  <th className={styles.subThNum}>交付額</th>
                  <th className={`${styles.subThNum} ${styles.padRight}`}>売上比</th>
                </tr>
              </thead>
              <tbody>
                {/* 同じ年度・同じ制度は recentSubsidies でまとめてある。 */}
                {subsidies.map((s) => (
                  <tr key={`${s.year}-${s.name}`}>
                    <td className={`${styles.subTd} ${styles.subTdMuted} ${styles.padLeft}`}>
                      {s.year}年度
                    </td>
                    <td className={styles.subTd}>
                      {s.name}
                      {s.count > 1 && <span className={styles.subCount}>（{s.count}件）</span>}
                    </td>
                    <td className={styles.subTdNum}>{yen(s.amount)}</td>
                    <td className={`${styles.subTdNum} ${styles.padRight}`}>
                      {percent(s.ratio, 2)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className={styles.subTotalLabel} colSpan={2}>
                    合計（直近 {SUBSIDY_YEARS} 年度）
                  </td>
                  <td className={styles.subTotalValue}>{yen(totals.amount)}</td>
                  <td className={`${styles.subTotalValue} ${styles.padRight}`}>
                    {percent(totals.ratio, 2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 12. 大元のデータを見る */}
      <section className={styles.cols2}>
        <div className={styles.sourceCard}>
          <span className={styles.sourceTitle}>大元のデータを見る（EDINET）</span>
          <span className={styles.sourceDesc}>
            会社が国に提出した報告書そのもの。従業員数と平均年収は「従業員の状況」に載っています。
          </span>
          <a
            className={styles.sourceLink}
            href={`https://disclosure2.edinet-fsa.go.jp/WEEK0010.aspx?bunsyo_id=${c.edinetCode}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            有価証券報告書を開く ↗
          </a>
        </div>
        <div className={styles.sourceCard}>
          <span className={styles.sourceTitle}>大元のデータを見る（gBizINFO）</span>
          <span className={styles.sourceDesc}>
            法人番号 {c.corpNumber ?? EM_DASH}。届出・補助金・国との取引をまとめて確認できます。
          </span>
          <a
            className={styles.sourceLink}
            href={`https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${c.corpNumber ?? ''}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            法人情報を開く ↗
          </a>
        </div>
      </section>

      {/* 13. 広告枠（ファーストビュー外）
          広告がついてから出す。それまでは枠だけ見せない。
      <aside className={styles.ad}>
        <span className={styles.adBadge}>広告</span>
        <span className={styles.adText}>
          転職エージェント相談 — 選考中の会社の決算データの見方も聞けます
        </span>
        <a href="#" style={{ fontSize: 12 }}>
          詳細
        </a>
      </aside>
      */}

      {/* 14. 同じ業種の会社 */}
      {peers.length > 0 && (
        <section className={styles.plainSection}>
          <h2 className={styles.h2}>同じ業種の会社</h2>
          <div className={styles.colsPeer}>
            {peers.map((p) => (
              <Link key={p.edinetCode} className={styles.peer} href={`/company/${p.edinetCode}/`}>
                <span className={styles.peerHead}>
                  <span className={styles.peerName}>{p.name}</span>
                  {/* 押せることが分かる手がかり。指標カードと同じ見た目だと区別がつかない。 */}
                  <span className={styles.peerArrow} aria-hidden="true">
                    ›
                  </span>
                </span>
                <span className={styles.peerStats}>
                  平均年収 {fmtSal(p.avgSalary)} ／ 勤続 {fmtTen(p.avgTenure)}
                </span>
              </Link>
            ))}
          </div>
          <span className={styles.legendRow}>
            <Link href={`/industry/${c.industryCode}/`}>{c.industryLabel}の会社をすべて見る</Link>
            <Link href={`/ranking/${c.industryCode}-salary/`}>
              {c.industryLabel}の平均年収ランキング
            </Link>
          </span>
        </section>
      )}

      {/* 15. 用語解説 */}
      <section className={styles.section}>
        <span className={styles.iconRow}>
          <Mascot size={30} mood="tilt" />
          <span className={styles.titleStack}>
            <h2 className={styles.h2}>言葉の意味、ここで説明するね</h2>
            <span className={styles.sectionLead}>むずかしい単語はこれだけ覚えれば読めます</span>
          </span>
        </span>
        <div className={styles.cols2}>
          {GLOSSARY.map(([term, desc]) => (
            <div key={term} className={styles.glossaryCard}>
              <span className={styles.glossaryTerm}>{term}</span>
              <span className={styles.glossaryDesc}>{desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 16. フッター */}
      <footer className={styles.footer}>
        <span>
          EDINET・gBizINFO
          の公開データを機械的に集計して自動生成しています。転記誤りや期間の差異があるため、判断の際は一次情報もご確認ください。
        </span>
        <span>
          <Link href="/removal-request/">掲載内容に関するご連絡・削除依頼</Link>
        </span>
        <span>© 2026 {SITE_NAME}</span>
      </footer>
    </main>
  );
}

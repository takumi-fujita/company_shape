'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Pill from './Pill';
import styles from './CompanyBrowser.module.css';
import { runwayDisplay, salaryLevel, tenureLevel } from '@/lib/detail';
import { employees as fmtEmp, salary as fmtSal, tenure as fmtTen } from '@/lib/format';
import type { IndustryStat, SearchIndexEntry } from '@/lib/types';

/**
 * 一覧・業種ページ・ランキングページで共有する結果表示。
 * 760px 以上はテーブル、未満は 1 社 1 カード。新しいデザインは起こさない。
 */
interface Props {
  entries: SearchIndexEntry[];
  statsByIndustry: Map<string, IndustryStat>;
}

export default function CompanyTable({ entries, statsByIndustry }: Props) {
  const router = useRouter();

  const rows = entries.map((e) => {
    const stat = statsByIndustry.get(e.industryCode);
    const salLevel = salaryLevel(e.avgSalary, stat?.medianSalary ?? null);
    const tenLevel = tenureLevel(e.avgTenure, stat?.medianTenure ?? null);
    return {
      entry: e,
      href: `/company/${e.edinetCode}/`,
      meta: [e.market, e.secCode, e.industryLabel].filter(Boolean).join('・'),
      run: runwayDisplay(e.runway),
      salPill: salLevel ? ({ level: salLevel, text: '中央値未満' } as const) : null,
      tenPill: tenLevel ? ({ level: tenLevel, text: '短め' } as const) : null,
    };
  });

  return (
    <>
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={`${styles.th} ${styles.thFirst}`}>会社名</th>
              <th className={styles.thNum}>従業員数</th>
              <th className={styles.thNum}>平均年収</th>
              <th className={styles.thNum}>勤続年数</th>
              <th className={`${styles.thNum} ${styles.thLast}`}>手元資金の余力</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entry.edinetCode} className={styles.row} onClick={() => router.push(r.href)}>
                <td className={`${styles.td} ${styles.tdFirst}`}>
                  <span className={styles.nameCell}>
                    <Link className={`${styles.name} ${styles.rowLink}`} href={r.href}>
                      {r.entry.name}
                    </Link>
                    <span className={styles.meta}>{r.meta}</span>
                  </span>
                </td>
                <td className={`${styles.td} ${styles.tdNum}`}>{fmtEmp(r.entry.employees)}</td>
                <td className={`${styles.td} ${styles.tdNum}`}>
                  <span className={styles.cellInline}>
                    {fmtSal(r.entry.avgSalary)}
                    <Pill pill={r.salPill} />
                  </span>
                </td>
                <td className={`${styles.td} ${styles.tdNum}`}>
                  <span className={styles.cellInline}>
                    {fmtTen(r.entry.avgTenure)}
                    <Pill pill={r.tenPill} />
                  </span>
                </td>
                <td className={`${styles.td} ${styles.tdNum} ${styles.tdLast}`}>
                  <span className={styles.cellInline}>
                    {r.run.text}
                    <Pill pill={r.run.pill} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.cards}>
        {rows.map((r) => (
          <div key={r.entry.edinetCode} className={styles.card} onClick={() => router.push(r.href)}>
            <span className={styles.cardTop}>
              <span className={styles.nameCell}>
                <Link className={`${styles.cardName} ${styles.rowLink}`} href={r.href}>
                  {r.entry.name}
                </Link>
                <span className={styles.meta}>{r.meta}</span>
              </span>
              <span className={styles.cardSalary}>
                <span className={styles.cardSalaryValue}>{fmtSal(r.entry.avgSalary)}</span>
                <span className={styles.cardSalaryLabel}>平均年収</span>
              </span>
            </span>
            <span className={styles.cardStats}>
              <span>従業員 {fmtEmp(r.entry.employees)}</span>
              <span>勤続 {fmtTen(r.entry.avgTenure)}</span>
              <span>余力 {r.run.text}</span>
              <Pill pill={r.run.pill} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

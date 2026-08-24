/**
 * 詳細ページの表示値を組み立てる。
 * すべてテンプレート生成であり、LLM は通さない（数値の書き間違いリスクだけが乗るため）。
 */
import { EM_DASH, num, salary as fmtSalary, signed, signedPercent, unit } from './format';
import { HEADCOUNT, type Level, RUNWAY, SALARY, TENURE } from './thresholds';
import type { Company, IndustryStat, SubsidyRow } from './types';

export interface Pill {
  level: Exclude<Level, null>;
  text: string;
}

export interface ScoreCard {
  label: string;
  value: string;
  unit: string;
  sub: string;
  pill: Pill | null;
  level: Level;
}

const latest = (c: Company) => c.fiscalPeriods.at(-1) ?? null;
const previous = (c: Company) => c.fiscalPeriods.at(-2) ?? null;

/** 前期比 %。どちらかが欠損なら null。 */
export function headcountChange(c: Company): number | null {
  const prev = previous(c)?.employees;
  const now = c.employees;
  if (prev == null || now == null || prev <= 0) return null;
  return (now / prev - 1) * 100;
}

export function runwayLevel(runway: number | null): Level {
  if (runway == null) return null;
  if (runway < RUNWAY.danger) return 'alert';
  if (runway < RUNWAY.warn) return 'warn';
  return null;
}

export function salaryLevel(value: number | null, median: number | null): Level {
  if (value == null || median == null) return null;
  return value < median * SALARY.warnRatio ? 'warn' : null;
}

export function tenureLevel(value: number | null, median: number | null): Level {
  if (value == null || median == null) return null;
  return value < median * TENURE.warnRatio ? 'warn' : null;
}

export function headcountLevel(change: number | null): Level {
  if (change == null) return null;
  if (change < HEADCOUNT.dangerPercent) return 'alert';
  if (change < HEADCOUNT.warnPercent) return 'warn';
  return null;
}

export interface RunwayDisplay {
  /** スコアカードの 30px 数値部分。正常時はラベル「十分」。 */
  value: string;
  /** 正常時は単位を出さない（README 配色ルール 3）。 */
  unit: string;
  /** 一覧テーブル用の 1 行表記。 */
  text: string;
  pill: Pill | null;
  level: Level;
}

/** 手元資金の余力の表示。正常時は具体値ではなくラベル「十分」（README 配色ルール 3）。 */
export function runwayDisplay(runway: number | null): RunwayDisplay {
  if (runway == null) {
    return { value: EM_DASH, unit: '', text: EM_DASH, pill: null, level: null };
  }
  const level = runwayLevel(runway);
  if (level) {
    return {
      value: num(runway, 1),
      unit: 'ヶ月',
      text: unit(runway, 'ヶ月', 1),
      pill: { level, text: level === 'alert' ? '要確認' : '短め' },
      level,
    };
  }
  return { value: '十分', unit: '', text: '十分', pill: null, level: null };
}

export function buildScoreCards(c: Company, stat: IndustryStat | undefined): ScoreCard[] {
  const prev = previous(c);
  const change = headcountChange(c);
  const empLevel = headcountLevel(change);

  const medSal = stat?.medianSalary ?? null;
  const medTen = stat?.medianTenure ?? null;
  const salGap = c.avgSalary != null && medSal != null ? c.avgSalary - medSal : null;
  const tenGap = c.avgTenure != null && medTen != null ? c.avgTenure - medTen : null;
  const salLevel = salaryLevel(c.avgSalary, medSal);
  const tenLevel = tenureLevel(c.avgTenure, medTen);
  const run = runwayDisplay(c.runway);

  return [
    {
      label: '従業員数',
      value: num(c.employees),
      unit: c.employees == null ? '' : '名',
      sub:
        change == null
          ? '前期の記載がありません'
          : `前期比 ${signedPercent(change)}（${num(prev?.employees)} 名 → ${num(c.employees)} 名）`,
      pill: empLevel ? { level: empLevel, text: '減少' } : null,
      level: empLevel,
    },
    {
      label: '平均年収',
      value: num(c.avgSalary),
      unit: c.avgSalary == null ? '' : '千円',
      sub:
        c.avgSalary == null
          ? '有報に記載がありません'
          : medSal == null
            ? '業種中央値は算出できていません'
            : `業種中央値 ${num(medSal)} 千円 / 差 ${signed(salGap, 0)} 千円`,
      pill: salLevel ? { level: salLevel, text: '中央値未満' } : null,
      level: salLevel,
    },
    {
      label: '平均勤続年数',
      value: num(c.avgTenure, 1),
      unit: c.avgTenure == null ? '' : '年',
      sub:
        c.avgTenure == null
          ? '有報に記載がありません'
          : medTen == null
            ? '業種中央値は算出できていません'
            : `業種中央値 ${num(medTen, 1)} 年 / 差 ${signed(tenGap)} 年`,
      pill: tenLevel ? { level: tenLevel, text: '短め' } : null,
      level: tenLevel,
    },
    {
      label: '手元のお金で払える月数',
      value: run.value,
      unit: run.unit,
      sub:
        c.cash == null || c.monthlyCost == null
          ? '現預金または毎月の費用が取得できていません'
          : `現預金 ${num(c.cash)} 百万円 ÷ 毎月の費用 ${num(c.monthlyCost)} 百万円`,
      pill: run.pill,
      level: run.level,
    },
  ];
}

/**
 * 「数字のまとめ」4 点。完全なテンプレート生成。
 * 期間表記を混ぜない（「5 期で」と「前期比」を同一文に併記しない）。
 */
export function buildNumberNotes(c: Company, stat: IndustryStat | undefined): string[] {
  const notes: string[] = [];
  const first = c.fiscalPeriods[0];
  const last = latest(c);
  const medSal = stat?.medianSalary ?? null;
  const medTen = stat?.medianTenure ?? null;

  if (first?.employees != null && c.employees != null && first.employees > 0) {
    const pct = (c.employees / first.employees - 1) * 100;
    const dir = c.employees >= first.employees ? '増加' : '減少';
    notes.push(
      `従業員は ${c.fiscalPeriods.length} 期で ${num(first.employees)} 名から ${num(c.employees)} 名に${dir}（${signedPercent(pct)}）`,
    );
  } else {
    notes.push('従業員数の期間比較ができる期が揃っていません');
  }

  if (c.avgSalary == null) {
    notes.push('平均年収は有価証券報告書に記載がありません');
  } else if (medSal == null) {
    notes.push(`平均年収は ${fmtSalary(c.avgSalary)}（業種中央値は算出できていません）`);
  } else {
    const gap = c.avgSalary - medSal;
    notes.push(
      `平均年収 ${num(c.avgSalary)} 千円は業種中央値を ${num(Math.abs(gap))} 千円${gap >= 0 ? '上回る' : '下回る'}`,
    );
  }

  if (first?.revenue != null && last?.revenue != null && first.revenue > 0) {
    const pct = (last.revenue / first.revenue - 1) * 100;
    const opm =
      last.operatingProfit != null && last.revenue !== 0
        ? `${num((last.operatingProfit / last.revenue) * 100, 1)}%`
        : EM_DASH;
    notes.push(`売上は ${c.fiscalPeriods.length} 期で ${signedPercent(pct)}、最新期の営業利益率は ${opm}`);
  } else {
    notes.push('売上の期間比較ができる期が揃っていません');
  }

  if (c.avgTenure == null) {
    notes.push('平均勤続年数は有価証券報告書に記載がありません');
  } else {
    notes.push(
      `平均勤続年数は ${num(c.avgTenure, 1)} 年${medTen == null ? '' : `（業種中央値 ${num(medTen, 1)} 年）`}`,
    );
  }

  return notes;
}

/** ヘッダー下の「5 期の売上のふえ方 / 最新期の営業利益率」。 */
export function performanceSummary(c: Company): { cagr: string; opm: string } {
  const last = latest(c);
  const opm =
    last?.operatingProfit != null && last.revenue != null && last.revenue !== 0
      ? `${num((last.operatingProfit / last.revenue) * 100, 1)}%`
      : EM_DASH;
  return { cagr: c.growth == null ? EM_DASH : signedPercent(c.growth), opm };
}

/** 補助金テーブルに出す年度数。合計行の「直近 N 年度」と一致させること。 */
export const SUBSIDY_YEARS = 4;

/**
 * 直近 N 年度の交付決定。表の行と合計行の対象を必ず同じにする。
 * 件数で切ると合計が表の一部だけを指すことになり、数字が合わなくなる。
 *
 * 同じ年度に同じ制度から複数回交付されることが実際にある（368 社中 127 社）。
 * gBizINFO の交付決定 1 件 = 1 行のままだと、金額しか違わない行が 90 行以上
 * 並ぶ会社が出るので、年度と制度名でまとめて件数を添える。合計額は変わらない。
 */
export function recentSubsidies(c: Company, years = SUBSIDY_YEARS): SubsidyRow[] {
  if (c.subsidies.length === 0) return [];
  const newest = Math.max(...c.subsidies.map((s) => s.year));

  const groups = new Map<string, SubsidyRow>();
  for (const s of c.subsidies) {
    if (s.year <= newest - years) continue;
    const key = `${s.year}\u0000${s.name}`;
    const hit = groups.get(key);
    if (!hit) {
      groups.set(key, { ...s, count: 1 });
      continue;
    }
    hit.amount += s.amount;
    hit.count += 1;
    // 売上比は同じ年度の売上に対する比なので足せる。
    // ただし 1 件でも売上不明があれば、その年度の合計比は出せない。
    hit.ratio = hit.ratio == null || s.ratio == null ? null : hit.ratio + s.ratio;
  }

  return [...groups.values()].sort((a, b) => b.year - a.year || b.amount - a.amount);
}

/** 補助金テーブルの合計行。recentSubsidies と同じ行を対象にする。 */
export function subsidyTotals(rows: SubsidyRow[], c: Company): { amount: number | null; ratio: number | null } {
  if (rows.length === 0) return { amount: null, ratio: null };
  const amount = rows.reduce((a, s) => a + s.amount, 0);
  const rev = latest(c)?.revenue ?? null;
  return { amount, ratio: rev && rev > 0 ? (amount / rev) * 100 : null };
}

/** データ欠損の案内（困り顔のデータくん）を出すか。 */
export function missingNotice(c: Company): string | null {
  if (c.avgSalary == null) {
    return 'この会社は有価証券報告書に平均年収の記載がないので、その欄は「—」になっています。ほかの数値はそのまま読めます。';
  }
  if (c.runway == null) {
    return 'この会社は毎月の費用が有価証券報告書から取り出せなかったので、手元のお金で払える月数は「—」になっています。ほかの数値はそのまま読めます。';
  }
  return null;
}

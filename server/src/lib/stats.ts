/**
 * Grade statistics. All definitions follow ER.md §5 ("统计口径定义").
 *
 * Key rules:
 *  - A student counts as "attended" only when `isAbsent === false` AND `score !== null`.
 *  - Standard deviation is the POPULATION stddev (divide by N, not N-1).
 *  - Ranking uses competition ranking: equal scores share a rank, the next rank skips
 *    (1, 2, 2, 4).
 */

export type ScoreInput = { studentId: string; score: number | null; isAbsent: boolean };

export type ExamSummary = {
  total: number;
  attended: number;
  absent: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  median: number | null;
  stddev: number | null;
  passRate: number | null;
  excellentRate: number | null;
};

export type GradeThresholds = { excellent: number; good: number; pass: number };

export const DEFAULT_THRESHOLDS: GradeThresholds = { excellent: 0.85, good: 0.75, pass: 0.6 };

/** Scores that participate in statistics: present AND actually entered. */
export function attendedScores(scores: ScoreInput[]): number[] {
  return scores
    .filter((s) => !s.isAbsent && s.score !== null && s.score !== undefined)
    .map((s) => s.score as number);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return round2(m);
}

/** Population standard deviation (denominator N), per ER.md §5. */
export function stddev(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length;
  return round2(Math.sqrt(variance));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function summarize(
  scores: ScoreInput[],
  fullScore: number,
  thresholds: GradeThresholds = DEFAULT_THRESHOLDS,
): ExamSummary {
  const values = attendedScores(scores);
  const total = scores.length;
  const attended = values.length;
  const absent = scores.filter((s) => s.isAbsent).length;

  if (attended === 0) {
    return {
      total,
      attended: 0,
      absent,
      avg: null,
      max: null,
      min: null,
      median: null,
      stddev: null,
      passRate: null,
      excellentRate: null,
    };
  }

  const passMark = fullScore * thresholds.pass;
  const excellentMark = fullScore * thresholds.excellent;

  return {
    total,
    attended,
    absent,
    avg: mean(values),
    max: round2(Math.max(...values)),
    min: round2(Math.min(...values)),
    median: median(values),
    stddev: stddev(values),
    passRate: round4(values.filter((v) => v >= passMark).length / attended),
    excellentRate: round4(values.filter((v) => v >= excellentMark).length / attended),
  };
}

export type DistributionBucket = {
  range: string;
  label?: string;
  count: number;
  ratio: number;
};

/**
 * Histogram over [0, fullScore] in `bucketSize`-wide buckets. The top bucket is
 * inclusive of fullScore so a perfect score is never dropped.
 */
export function distribution(
  scores: ScoreInput[],
  fullScore: number,
  bucketSize = 10,
): DistributionBucket[] {
  const values = attendedScores(scores);
  const bucketCount = Math.ceil(fullScore / bucketSize);
  const buckets: DistributionBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const lo = i * bucketSize;
    const hi = Math.min((i + 1) * bucketSize, fullScore);
    const isTop = i === bucketCount - 1;
    const count = values.filter((v) => (isTop ? v >= lo && v <= hi : v >= lo && v < hi)).length;
    buckets.push({
      range: `${lo}-${isTop ? hi : hi - 1}`,
      count,
      ratio: values.length ? round4(count / values.length) : 0,
    });
  }
  return buckets;
}

export type GradeBucket = { grade: string; label: string; count: number; ratio: number };

export function gradeRatio(
  scores: ScoreInput[],
  fullScore: number,
  thresholds: GradeThresholds = DEFAULT_THRESHOLDS,
): GradeBucket[] {
  const values = attendedScores(scores);
  const n = values.length;
  const excellentMark = fullScore * thresholds.excellent;
  const goodMark = fullScore * thresholds.good;
  const passMark = fullScore * thresholds.pass;

  const excellent = values.filter((v) => v >= excellentMark).length;
  const good = values.filter((v) => v >= goodMark && v < excellentMark).length;
  const fair = values.filter((v) => v >= passMark && v < goodMark).length;
  const poor = values.filter((v) => v < passMark).length;

  const mk = (grade: string, label: string, count: number): GradeBucket => ({
    grade,
    label,
    count,
    ratio: n ? round4(count / n) : 0,
  });

  return [
    mk('excellent', '优秀', excellent),
    mk('good', '良好', good),
    mk('fair', '中等', fair),
    mk('poor', '待提升', poor),
  ];
}

export type RankRow = { studentId: string; score: number; rank: number };

/**
 * Competition ranking (1, 2, 2, 4). Absent / unentered students are excluded
 * entirely rather than ranked last.
 */
export function rank(scores: ScoreInput[]): RankRow[] {
  const present = scores
    .filter((s) => !s.isAbsent && s.score !== null && s.score !== undefined)
    .map((s) => ({ studentId: s.studentId, score: s.score as number }))
    .sort((a, b) => b.score - a.score);

  const rows: RankRow[] = [];
  let currentRank = 0;
  let prevScore: number | null = null;

  present.forEach((row, idx) => {
    if (prevScore === null || row.score !== prevScore) {
      currentRank = idx + 1;
      prevScore = row.score;
    }
    rows.push({ ...row, rank: currentRank });
  });

  return rows;
}

/** Z-score; defined as 0 when stddev is 0 (all scores identical), per ER.md §5. */
export function zScore(score: number, avg: number, sd: number): number {
  if (!sd) return 0;
  return round2((score - avg) / sd);
}

import { describe, it, expect } from 'vitest';
import {
  attendedScores,
  distribution,
  gradeRatio,
  mean,
  median,
  rank,
  stddev,
  summarize,
  zScore,
} from '../src/lib/stats.js';

const s = (studentId: string, score: number | null, isAbsent = false) => ({
  studentId,
  score,
  isAbsent,
});

describe('stats: attendance filtering', () => {
  it('AC-12: excludes absent students from the statistics base', () => {
    const scores = [s('a', 90), s('b', 60), s('c', null, true), s('d', 0, true)];
    expect(attendedScores(scores)).toEqual([90, 60]);
  });

  it('excludes not-yet-entered scores (null without absent flag)', () => {
    expect(attendedScores([s('a', 80), s('b', null)])).toEqual([80]);
  });

  it('AC-12: absent students do not dilute the average or the pass-rate denominator', () => {
    const summary = summarize([s('a', 90), s('b', 70), s('c', null, true)], 100);
    expect(summary.attended).toBe(2);
    expect(summary.absent).toBe(1);
    expect(summary.avg).toBe(80);
    // Both attendees passed; the absent student must not make it 2/3.
    expect(summary.passRate).toBe(1);
  });

  it('a 0 score is counted, not treated as missing', () => {
    const summary = summarize([s('a', 0), s('b', 100)], 100);
    expect(summary.attended).toBe(2);
    expect(summary.avg).toBe(50);
    expect(summary.min).toBe(0);
  });
});

describe('stats: central tendency', () => {
  it('computes mean and rounds to 2 decimals', () => {
    expect(mean([1, 2, 2])).toBe(1.67);
  });

  it('median of an odd-length set is the middle element', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('median of an even-length set averages the middle pair', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns null for an empty set rather than NaN', () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(stddev([])).toBeNull();
  });

  it('uses population stddev (denominator N), per ER.md §5', () => {
    // values 2,4,4,4,5,5,7,9 -> population sd = 2, sample sd would be 2.138
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it('stddev of identical values is 0', () => {
    expect(stddev([80, 80, 80])).toBe(0);
  });
});

describe('stats: summarize', () => {
  it('returns nulls (not zeros) when nobody attended', () => {
    const summary = summarize([s('a', null, true)], 100);
    expect(summary.attended).toBe(0);
    expect(summary.avg).toBeNull();
    expect(summary.passRate).toBeNull();
    expect(summary.excellentRate).toBeNull();
  });

  it('applies pass/excellent thresholds relative to fullScore, not to 100', () => {
    // fullScore 150 -> pass at 90, excellent at 127.5
    const summary = summarize([s('a', 95), s('b', 130), s('c', 80)], 150);
    expect(summary.passRate).toBeCloseTo(2 / 3, 4);
    expect(summary.excellentRate).toBeCloseTo(1 / 3, 4);
  });

  it('honours custom thresholds from user settings', () => {
    const strict = { excellent: 0.95, good: 0.85, pass: 0.7 };
    const summary = summarize([s('a', 90), s('b', 96)], 100, strict);
    expect(summary.excellentRate).toBe(0.5);
  });

  it('a boundary score exactly on the threshold counts as passing', () => {
    expect(summarize([s('a', 60)], 100).passRate).toBe(1);
    expect(summarize([s('a', 85)], 100).excellentRate).toBe(1);
  });
});

describe('stats: distribution', () => {
  it('buckets scores and keeps a perfect score in the top bucket', () => {
    const buckets = distribution([s('a', 100), s('b', 95), s('c', 0)], 100, 10);
    expect(buckets).toHaveLength(10);
    expect(buckets[9].count).toBe(2); // 95 and 100
    expect(buckets[0].count).toBe(1); // 0
  });

  it('assigns a bucket-boundary score to the upper bucket', () => {
    const buckets = distribution([s('a', 70)], 100, 10);
    expect(buckets[7].range).toBe('70-79');
    expect(buckets[7].count).toBe(1);
    expect(buckets[6].range).toBe('60-69');
    expect(buckets[6].count).toBe(0);
  });

  it('supports a 5-point bucket size', () => {
    expect(distribution([s('a', 82)], 100, 5)).toHaveLength(20);
  });

  it('reports zero ratios instead of NaN when nobody attended', () => {
    const buckets = distribution([s('a', null, true)], 100, 10);
    expect(buckets.every((b) => b.ratio === 0)).toBe(true);
  });
});

describe('stats: gradeRatio', () => {
  it('partitions attendees into four non-overlapping grades', () => {
    const scores = [s('a', 90), s('b', 80), s('c', 65), s('d', 40)];
    const grades = gradeRatio(scores, 100);
    expect(grades.map((g) => g.count)).toEqual([1, 1, 1, 1]);
    expect(grades.reduce((acc, g) => acc + g.count, 0)).toBe(4);
  });
});

describe('stats: ranking', () => {
  it('uses competition ranking: ties share a rank and the next rank skips', () => {
    const ranked = rank([s('a', 90), s('b', 85), s('c', 85), s('d', 70)]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('excludes absent students from the ranking entirely', () => {
    const ranked = rank([s('a', 90), s('b', null, true), s('c', 70)]);
    expect(ranked.map((r) => r.studentId)).toEqual(['a', 'c']);
    expect(ranked[1].rank).toBe(2);
  });

  it('ranks a single attendee first', () => {
    expect(rank([s('a', 55)])).toEqual([{ studentId: 'a', score: 55, rank: 1 }]);
  });

  it('gives every student rank 1 when all scores are equal', () => {
    const ranked = rank([s('a', 80), s('b', 80), s('c', 80)]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1]);
  });
});

describe('stats: zScore', () => {
  it('is 0 when stddev is 0, rather than dividing by zero', () => {
    expect(zScore(80, 80, 0)).toBe(0);
  });

  it('is positive above the mean and negative below', () => {
    expect(zScore(90, 80, 10)).toBe(1);
    expect(zScore(70, 80, 10)).toBe(-1);
  });
});

import { describe, it, expect } from 'vitest';
import {
  dateRange,
  formatDate,
  isoWeekday,
  slotOccursOn,
  weekIndex,
  weekParity,
} from '../src/lib/schedule.js';
import {
  DEFAULT_DAY_SCHEDULE,
  lessonPeriodTimes,
  normalizeDaySchedule,
} from '../src/lib/daySchedule.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('schedule: weekday', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    expect(isoWeekday(d('2026-09-14'))).toBe(1); // Monday
    expect(isoWeekday(d('2026-09-20'))).toBe(7); // Sunday
  });
});

describe('schedule: week index and parity', () => {
  it('treats the term-start week as week 1 (odd)', () => {
    const termStart = d('2026-09-01');
    expect(weekIndex(d('2026-09-01'), termStart)).toBe(1);
    expect(weekParity(d('2026-09-01'), termStart)).toBe('odd');
  });

  it('advances to week 2 (even) after seven days', () => {
    const termStart = d('2026-09-01');
    expect(weekIndex(d('2026-09-08'), termStart)).toBe(2);
    expect(weekParity(d('2026-09-08'), termStart)).toBe('even');
  });

  it('keeps parity stable across a whole week', () => {
    const termStart = d('2026-09-01'); // a Tuesday
    // 2026-09-07 is the Monday starting week 2.
    expect(weekParity(d('2026-09-07'), termStart)).toBe('even');
    expect(weekParity(d('2026-09-13'), termStart)).toBe('even');
  });
});

describe('schedule: slot occurrence', () => {
  const base = { weekday: 1, repeatRule: 'weekly', startDate: '2026-09-01', endDate: '2027-01-15' };

  it('matches only its own weekday', () => {
    expect(slotOccursOn(base, d('2026-09-14'))).toBe(true); // Monday
    expect(slotOccursOn(base, d('2026-09-15'))).toBe(false); // Tuesday
  });

  it('does not occur before the term starts or after it ends', () => {
    expect(slotOccursOn(base, d('2026-08-31'))).toBe(false);
    expect(slotOccursOn(base, d('2027-01-18'))).toBe(false);
  });

  it('AC-6: an odd-week slot is hidden on even weeks', () => {
    const slot = { ...base, repeatRule: 'odd_week' };
    // Term starts 2026-09-01 (week 1). Monday of week 1 is 2026-08-31, which is
    // before startDate, so the first visible Monday is week 2 -> even.
    expect(slotOccursOn(slot, d('2026-09-07'))).toBe(false);
    expect(slotOccursOn(slot, d('2026-09-14'))).toBe(true);
    expect(slotOccursOn(slot, d('2026-09-21'))).toBe(false);
  });

  it('an even-week slot is the exact complement of the odd-week one', () => {
    const odd = { ...base, repeatRule: 'odd_week' };
    const even = { ...base, repeatRule: 'even_week' };

    for (const day of ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']) {
      expect(slotOccursOn(odd, d(day))).toBe(!slotOccursOn(even, d(day)));
    }
  });

  it('a weekly slot occurs on every matching weekday', () => {
    for (const day of ['2026-09-07', '2026-09-14', '2026-09-21']) {
      expect(slotOccursOn(base, d(day))).toBe(true);
    }
  });

  it('has no date bounds when startDate and endDate are null', () => {
    const slot = { weekday: 3, repeatRule: 'weekly', startDate: null, endDate: null };
    expect(slotOccursOn(slot, d('2020-01-01'))).toBe(true); // a Wednesday
  });
});

describe('daySchedule', () => {
  it('derives legacy periodTimes from the default schedule, 8 lessons', () => {
    const times = lessonPeriodTimes(DEFAULT_DAY_SCHEDULE);
    expect(times).toHaveLength(8);
    expect(times[0]).toEqual(['08:00', '08:45']);
    expect(times[1]).toEqual(['09:00', '09:45']);
    expect(times[7]).toEqual(['17:10', '17:50']);
  });

  it('falls back to the default schedule when given null/empty', () => {
    expect(lessonPeriodTimes(null)).toHaveLength(8);
    expect(lessonPeriodTimes([])).toHaveLength(8);
  });

  it('normalizeDaySchedule sorts by start time and renumbers lesson periods', () => {
    const out = normalizeDaySchedule([
      { key: 'b', kind: 'activity', label: '午餐', start: '12:00', end: '12:30' },
      { key: 'a', kind: 'lesson', label: '第X节', start: '08:00', end: '08:45' },
      { key: 'c', kind: 'lesson', label: '第Y节', start: '13:00', end: '13:45' },
    ]);
    expect(out.map((i) => i.label)).toEqual(['第X节', '午餐', '第Y节']);
    expect(out[0].period).toBe(1);
    expect(out[2].period).toBe(2);
    expect(out[1].period).toBeUndefined();
  });

  it('normalizeDaySchedule rejects start >= end', () => {
    expect(() =>
      normalizeDaySchedule([
        { key: 'a', kind: 'lesson', label: 'x', start: '09:00', end: '09:00' },
      ]),
    ).toThrow();
  });
});

describe('schedule: date range', () => {
  it('is inclusive of both endpoints', () => {
    const days = dateRange(d('2026-09-14'), d('2026-09-16'));
    expect(days.map(formatDate)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
  });

  it('returns a single day when from equals to', () => {
    expect(dateRange(d('2026-09-14'), d('2026-09-14'))).toHaveLength(1);
  });

  it('spans month boundaries correctly', () => {
    expect(dateRange(d('2026-09-29'), d('2026-10-02'))).toHaveLength(4);
  });
});

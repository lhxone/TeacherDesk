/**
 * Day schedule ("作息时间表").
 *
 * A single ordered list of time blocks that covers a school day: lesson periods
 * (`kind: 'lesson'`, carrying a 1-based `period` that lines up with
 * ScheduleSlot.period) interleaved with fixed activities (`kind: 'activity'` —
 * 早读 / 眼操 / 午餐 / 午休 / 大课间).
 *
 * Stored per-user in `user.settings.daySchedule`. Old users have no such key;
 * everything falls back to DEFAULT_DAY_SCHEDULE so no data migration is needed.
 *
 * The legacy `settings.periodTimes` (`[start, end][]` indexed by period-1) is
 * derived from this list via `lessonPeriodTimes()` so the reminder scanner and
 * agenda serializer keep working unchanged.
 */
import { z } from 'zod';
import { ApiError } from '../errors.js';

export type DayScheduleItem = {
  key: string;
  kind: 'lesson' | 'activity';
  label: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  period?: number; // only when kind === 'lesson'
};

/** The 初一 timetable the product is modelled on (wall-clock, teacher's tz). */
export const DEFAULT_DAY_SCHEDULE: DayScheduleItem[] = [
  { key: 'morning_reading', kind: 'activity', label: '早读', start: '07:30', end: '07:50' },
  { key: 'p1', kind: 'lesson', label: '第1节', start: '08:00', end: '08:45', period: 1 },
  { key: 'p2', kind: 'lesson', label: '第2节', start: '09:00', end: '09:45', period: 2 },
  { key: 'eye_exercise_1', kind: 'activity', label: '眼操', start: '09:45', end: '09:50' },
  { key: 'p3', kind: 'lesson', label: '第3节', start: '10:00', end: '10:40', period: 3 },
  { key: 'p4', kind: 'lesson', label: '第4节', start: '10:55', end: '11:35', period: 4 },
  { key: 'lunch', kind: 'activity', label: '午餐', start: '11:35', end: '12:05' },
  { key: 'nap', kind: 'activity', label: '午休', start: '12:45', end: '13:25' },
  { key: 'p5', kind: 'lesson', label: '第5节', start: '13:40', end: '14:25', period: 5 },
  { key: 'eye_exercise_2', kind: 'activity', label: '眼操', start: '14:25', end: '14:30' },
  { key: 'big_break', kind: 'activity', label: '大课间', start: '14:30', end: '15:25' },
  { key: 'p6', kind: 'lesson', label: '第6节', start: '15:25', end: '16:10', period: 6 },
  { key: 'p7', kind: 'lesson', label: '第7节', start: '16:20', end: '17:00', period: 7 },
  { key: 'p8', kind: 'lesson', label: '第8节', start: '17:10', end: '17:50', period: 8 },
];

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

const itemSchema = z.object({
  key: z.string().min(1).max(48),
  kind: z.enum(['lesson', 'activity']),
  label: z.string().min(1).max(24),
  start: z.string().regex(HHMM, '时间格式应为 HH:MM'),
  end: z.string().regex(HHMM, '时间格式应为 HH:MM'),
  period: z.number().int().min(1).max(20).optional(),
});

/** Minutes since midnight for a "HH:MM" string. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Validate, sort by start time, and renumber lesson periods 1..N in order.
 * Throws ApiError.validation on a malformed item or a start >= end.
 */
export function normalizeDaySchedule(input: unknown): DayScheduleItem[] {
  const parsed = z.array(itemSchema).max(40).safeParse(input);
  if (!parsed.success) {
    throw ApiError.validation('作息时间表格式不正确', [
      { field: 'daySchedule', message: parsed.error.issues[0]?.message ?? '格式错误' },
    ]);
  }

  const items = [...parsed.data].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  let period = 0;
  return items.map((it) => {
    if (toMinutes(it.start) >= toMinutes(it.end)) {
      throw ApiError.validation('作息时间表格式不正确', [
        { field: 'daySchedule', message: `“${it.label}”的开始时间应早于结束时间` },
      ]);
    }
    if (it.kind === 'lesson') {
      period += 1;
      return { ...it, period };
    }
    const { period: _drop, ...rest } = it;
    return rest;
  });
}

/**
 * Legacy `periodTimes` shape: `[start, end]` for each lesson period, indexed by
 * `period - 1`. Non-lesson blocks are ignored; a gap in period numbers becomes a
 * `null` hole.
 */
export function lessonPeriodTimes(
  daySchedule: DayScheduleItem[] | null | undefined,
): (readonly [string, string] | null)[] {
  const list = daySchedule?.length ? daySchedule : DEFAULT_DAY_SCHEDULE;
  const out: (readonly [string, string] | null)[] = [];
  for (const it of list) {
    if (it.kind !== 'lesson' || !it.period) continue;
    out[it.period - 1] = [it.start, it.end];
  }
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = null;
  return out;
}

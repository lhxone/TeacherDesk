/**
 * Shared time-axis layout math for the schedule calendar. Both the week grid
 * (one column per weekday) and the day view (a single wide column) render
 * lessons/activities/todos as absolutely-positioned blocks within the same
 * day-schedule-derived coordinate system, computed here once so a lesson, an
 * activity backdrop, a todo, and the current-time line can never disagree
 * about where "9:00" is — see ScheduleDayColumn.vue for the rendering side.
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { DayScheduleItem } from '@/api/types';

/** "HH:MM" -> minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since local midnight for an ISO instant. */
export function instantMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** "YYYY-MM-DD" in the browser's local time zone — deliberately not
 * `Date.toISOString().slice(0, 10)`, which is UTC and would misidentify
 * "today" for part of the day in time zones ahead of/behind UTC (e.g. still
 * "yesterday" in UTC at 2am in UTC+8). Used to compare a calendar day's date
 * string against "now" for the current-time line (ScheduleDayColumn) and the
 * week header's today marker (ScheduleView). */
export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type RowLayout = { top: number; height: number };
export type PositionStyle = { top: string; height: string };

// A pure minute→percentage mapping squashes short blocks (眼操, 5 min) to a
// couple of px — too little to read their label. Instead each day-schedule
// row gets a minimum share of the calendar's height (MIN_ROW_SHARE, as a
// fraction of an "average" row) before the remaining height is divided by
// actual minutes, then those per-row shares are turned into cumulative
// top/height percentages — like sizing CSS grid rows with `minmax()`, but
// computed here so the result is still a plain top/height percentage that
// works with the rest of the absolute-positioning overlay (lessons, todos).
const MIN_ROW_SHARE = 0.85; // as a fraction of the day's average per-row minutes

export function useScheduleLayout(daySchedule: Ref<DayScheduleItem[]> | ComputedRef<DayScheduleItem[]>) {
  /** The calendar's visible time range: the day schedule's earliest start to
   * its latest end, padded 15 min each side so edge blocks aren't flush
   * against the top/bottom. Falls back to 07:00–18:00 with no day schedule. */
  const dayBounds = computed(() => {
    const rows = daySchedule.value;
    if (!rows.length) return { start: 7 * 60, end: 18 * 60 };
    const starts = rows.map((r) => toMinutes(r.start));
    const ends = rows.map((r) => toMinutes(r.end));
    return { start: Math.max(0, Math.min(...starts) - 15), end: Math.min(24 * 60, Math.max(...ends) + 15) };
  });

  const rowLayout = computed(() => {
    const rows = daySchedule.value;
    const { start: dayStart, end: dayEnd } = dayBounds.value;
    const totalMinutes = dayEnd - dayStart;
    if (!rows.length || totalMinutes <= 0) return { rows: [] as RowLayout[], totalShare: 1 };

    const avgMinutes = totalMinutes / rows.length;
    const minShare = avgMinutes * MIN_ROW_SHARE;
    const shares = rows.map((r) => Math.max(toMinutes(r.end) - toMinutes(r.start), minShare));
    const totalShare = shares.reduce((a, b) => a + b, 0);

    let cursor = 0;
    const laidOut = shares.map((share) => {
      const top = cursor;
      cursor += share;
      return { top, height: share };
    });
    return { rows: laidOut, totalShare };
  });

  /** Percentage position/height within the calendar for the Nth day-schedule row. */
  function rowStyle(rowIndex: number): PositionStyle {
    const { rows, totalShare } = rowLayout.value;
    const r = rows[rowIndex];
    if (!r || totalShare <= 0) return { top: '0%', height: '0%' };
    return { top: `${(r.top / totalShare) * 100}%`, height: `${(r.height / totalShare) * 100}%` };
  }

  /** Interpolates an arbitrary minute value (not necessarily a row boundary)
   * to a cumulative-share fraction [0, totalShare], by locating which
   * day-schedule row it falls in and blending linearly within that row's
   * share. Shared by timeRangeStyle (todo blocks) and nowLineTop (the
   * current-time line) so both agree with the row grid's minimum-share
   * squashing instead of a naive minute proportion. */
  function minuteToShare(min: number): number {
    const rows = daySchedule.value;
    const { rows: laidOut, totalShare } = rowLayout.value;
    if (!rows.length || totalShare <= 0) return 0;
    for (let i = 0; i < rows.length; i++) {
      const rowStart = toMinutes(rows[i].start);
      const rowEnd = toMinutes(rows[i].end);
      if (min <= rowEnd || i === rows.length - 1) {
        const span = Math.max(rowEnd - rowStart, 1);
        const frac = Math.min(Math.max((min - rowStart) / span, 0), 1);
        return laidOut[i].top + frac * laidOut[i].height;
      }
    }
    return laidOut[laidOut.length - 1].top + laidOut[laidOut.length - 1].height;
  }

  /** Percentage position/height for an arbitrary minute range (a todo's
   * start–end), interpolated across whichever day-schedule rows it overlaps —
   * so a todo spanning a short row still lines up with that row's
   * minimum-share height instead of the raw minute proportion. */
  function timeRangeStyle(startMin: number, endMin: number): PositionStyle {
    const { totalShare } = rowLayout.value;
    if (totalShare <= 0) return { top: '0%', height: '0%' };
    const top = minuteToShare(startMin);
    const bottom = minuteToShare(endMin);
    return { top: `${(top / totalShare) * 100}%`, height: `${(Math.max(bottom - top, 0) / totalShare) * 100}%` };
  }

  /** Percentage top for a single point in time (the current-time line),
   * or null when that minute falls entirely outside the visible calendar
   * range (before the first row's start / after the last row's end) — the
   * line should not render squashed against an edge it doesn't belong at. */
  function timeToTop(min: number): number | null {
    const rows = daySchedule.value;
    const { totalShare } = rowLayout.value;
    if (!rows.length || totalShare <= 0) return null;
    const firstStart = toMinutes(rows[0].start);
    const lastEnd = toMinutes(rows[rows.length - 1].end);
    if (min < firstStart || min > lastEnd) return null;
    return (minuteToShare(min) / totalShare) * 100;
  }

  return { dayBounds, rowLayout, rowStyle, timeRangeStyle, timeToTop };
}

export type LaidOutBlock = { key: string; left: number; width: number };

/**
 * Assigns each block in one day column a left/width fraction so overlapping
 * blocks (a lesson and a todo at the same time, or two todos) sit side by
 * side instead of on top of each other. Classic interval-graph column
 * packing: group mutually-overlapping blocks into a cluster, give the
 * cluster's blocks one column each out of however many the cluster needs.
 */
export function packColumns(blocks: { key: string; start: number; end: number }[]): LaidOutBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: LaidOutBlock[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    // Greedy column assignment within the cluster: each block takes the
    // first column whose previous occupant has already ended.
    const columnEnds: number[] = [];
    const columnOf = new Map<string, number>();
    for (const b of cluster) {
      let col = columnEnds.findIndex((end) => end <= b.start);
      if (col === -1) col = columnEnds.length;
      columnEnds[col] = b.end;
      columnOf.set(b.key, col);
    }
    const columns = columnEnds.length;
    for (const b of cluster) {
      const col = columnOf.get(b.key)!;
      result.push({ key: b.key, left: (col / columns) * 100, width: (1 / columns) * 100 });
    }
    cluster = [];
  };

  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();

  return result;
}

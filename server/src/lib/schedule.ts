/**
 * Schedule expansion. Implements PRD §3.4.1 repeat rules.
 *
 * Week parity is computed relative to the slot's `startDate` (the term start),
 * so "odd week" means the 1st, 3rd, 5th... week of that term — not an absolute
 * ISO week number, which would flip meaning between terms.
 */

export type RepeatRule = 'weekly' | 'odd_week' | 'even_week';

export type SlotLike = {
  weekday: number;
  repeatRule: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
};

function toUtcDate(d: Date | string): Date {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** ISO weekday: Monday = 1 … Sunday = 7, matching schedule_slots.weekday. */
export function isoWeekday(date: Date): number {
  const d = toUtcDate(date).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Monday of the week containing `date`, in UTC. */
export function startOfIsoWeek(date: Date): Date {
  const d = toUtcDate(date);
  const diff = isoWeekday(d) - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/**
 * 1-based week index of `date` relative to the week containing `termStart`.
 * The term-start week is week 1 (odd).
 */
export function weekIndex(date: Date, termStart: Date): number {
  const a = startOfIsoWeek(termStart).getTime();
  const b = startOfIsoWeek(date).getTime();
  const weeks = Math.floor((b - a) / (7 * 24 * 60 * 60 * 1000));
  return weeks + 1;
}

export function weekParity(date: Date, termStart: Date | null): 'odd' | 'even' {
  if (!termStart) {
    // No term start configured: fall back to ISO week number parity so the
    // odd/even alternation is at least stable across renders.
    const jan1 = new Date(Date.UTC(toUtcDate(date).getUTCFullYear(), 0, 1));
    return weekIndex(date, jan1) % 2 === 1 ? 'odd' : 'even';
  }
  return weekIndex(date, termStart) % 2 === 1 ? 'odd' : 'even';
}

/** Whether a slot should appear on the given date. */
export function slotOccursOn(slot: SlotLike, date: Date): boolean {
  const day = toUtcDate(date);

  if (isoWeekday(day) !== slot.weekday) return false;

  if (slot.startDate) {
    const start = toUtcDate(slot.startDate);
    if (day < start) return false;
  }
  if (slot.endDate) {
    const end = toUtcDate(slot.endDate);
    if (day > end) return false;
  }

  const rule = slot.repeatRule as RepeatRule;
  if (rule === 'weekly') return true;

  const termStart = slot.startDate ? toUtcDate(slot.startDate) : null;
  const parity = weekParity(day, termStart);
  return rule === 'odd_week' ? parity === 'odd' : parity === 'even';
}

/** Inclusive list of UTC dates between `from` and `to`. */
export function dateRange(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = toUtcDate(from);
  const end = toUtcDate(to);
  while (cur <= end) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function formatDate(d: Date): string {
  return toUtcDate(d).toISOString().slice(0, 10);
}

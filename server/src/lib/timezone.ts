/**
 * Per-user IANA timezone helpers.
 *
 * TeacherDesk is a public app; teachers can be in any timezone, so "wall clock
 * time" (a lesson period's "08:00", a day's local midnight) must always be
 * resolved against *that user's* zone, never a single server-wide offset.
 * These helpers use `Intl.DateTimeFormat`, which has full IANA tzdata
 * (including DST rules) built into Node — no extra dependency needed.
 */

const FALLBACK_TZ = 'UTC';

/** True if `tz` is a timezone name the runtime's ICU data recognizes. */
export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset in minutes east of UTC of `tz` at `instant` (varies across DST transitions). */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  // Reinterpret the zone's wall-clock reading of `instant` as if it were UTC;
  // the difference from `instant` itself is the zone's current offset.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Instant of `HH:MM` wall-clock on `day` (a UTC-midnight Date used as a plain
 * calendar-date marker) in the given IANA zone. Falls back to `fallbackOffsetMinutes`
 * (minutes east of UTC) when `tz` is missing/invalid.
 */
export function wallTimeToInstant(
  day: Date,
  hhmm: string,
  tz: string | null | undefined,
  fallbackOffsetMinutes: number,
): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  const naive = new Date(day.getTime() + minutes * 60_000);

  const zone = tz && isValidTimeZone(tz) ? tz : null;
  if (!zone) return new Date(naive.getTime() - fallbackOffsetMinutes * 60_000);

  // `naive` read as UTC is the wall-clock instant; subtract the zone's actual
  // offset at that moment to get the real instant. One iteration is enough
  // except right at a DST transition, where a second pass converges.
  let offset = tzOffsetMinutes(naive, zone);
  let instant = new Date(naive.getTime() - offset * 60_000);
  const offset2 = tzOffsetMinutes(instant, zone);
  if (offset2 !== offset) {
    offset = offset2;
    instant = new Date(naive.getTime() - offset * 60_000);
  }
  return instant;
}

/**
 * Local calendar date of `instant` in `tz`, returned as that date's UTC
 * midnight — the shape `slotOccursOn` / `formatDate` expect.
 */
export function startOfLocalDay(
  instant: Date,
  tz: string | null | undefined,
  fallbackOffsetMinutes: number,
): Date {
  const zone = tz && isValidTimeZone(tz) ? tz : null;
  if (!zone) {
    const local = new Date(instant.getTime() + fallbackOffsetMinutes * 60_000);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

export const DEFAULT_FALLBACK_TZ = FALLBACK_TZ;

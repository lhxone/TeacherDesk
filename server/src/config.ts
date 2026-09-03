import path from 'node:path';
import { DEFAULT_DAY_SCHEDULE } from './lib/daySchedule.js';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  // Bootstrap invite code: only usable to register the very first account
  // (i.e. while the users table is empty). Every account after that,
  // including the one created with this code, has its own permanent invite
  // code (see User.inviteCode) and registration requires one.
  initialInviteCode: process.env.INITIAL_INVITE_CODE ?? '',
  accessTokenTtlSec: 7200,
  refreshTokenTtlDays: 7,
  refreshTokenTtlDaysRemember: 30,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  loginMaxAttempts: 5,
  loginLockoutMs: 15 * 60 * 1000,
  isTest: process.env.NODE_ENV === 'test',

  // Web Push (VAPID). Generate a keypair once with `npx web-push generate-vapid-keys`
  // and set both halves in the environment. When unset, push is simply disabled —
  // the API still runs and the frontend hides the toggle.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@teacherdesk.app',
  // How often the reminder scheduler scans for upcoming lessons/todos.
  reminderScanIntervalMs: Number(process.env.REMINDER_SCAN_INTERVAL_MS ?? 60_000),
  // Lesson period times ("08:00") are wall-clock in each teacher's own timezone
  // (`user.settings.timeZone`, an IANA name). This fixed minutes-east-of-UTC
  // offset is only the fallback used for a user who has never set one — do not
  // use it as if it applied to everyone; the server itself has no "local" zone.
  localTzOffsetMinutes: Number(process.env.LOCAL_TZ_OFFSET_MINUTES ?? 480),

  // 教学知识中心 (Knowledge Center): where original resource files live on
  // disk. Postgres only ever stores metadata/paths/extracted text — never file
  // bytes (goal requirement). In docker-compose.yml this is a named volume
  // mounted at this same path; locally it's a gitignored folder under server/.
  // Resolved against cwd (both `npm run dev` and `node dist/main.js` are run
  // from `server/`), not `import.meta.url`, since the latter would resolve to
  // a different depth in dev (src/) vs build (dist/) output.
  resourceStorageRoot: process.env.RESOURCE_STORAGE_ROOT ?? path.resolve(process.cwd(), 'data/resources'),
  // Generous cap for teaching materials (PPT/PDF/Word/scans) — well above the
  // 5MB excel-import limit above, which is a different multipart registration.
  resourceMaxFileSizeBytes: Number(process.env.RESOURCE_MAX_FILE_SIZE_BYTES ?? 100 * 1024 * 1024),
};

export const pushEnabled = () => Boolean(config.vapidPublicKey && config.vapidPrivateKey);

// `periodTimes` is kept for backwards compatibility; it is derived from
// DEFAULT_DAY_SCHEDULE's lesson blocks. New code should read `daySchedule` and
// go through `lessonPeriodTimes()` in lib/daySchedule.ts.
const DEFAULT_PERIOD_TIMES = DEFAULT_DAY_SCHEDULE.filter((i) => i.kind === 'lesson').map(
  (i) => [i.start, i.end] as [string, string],
);

export const DEFAULT_SETTINGS = {
  periodsPerDay: 8,
  showWeekend: false,
  periodTimes: DEFAULT_PERIOD_TIMES,
  daySchedule: DEFAULT_DAY_SCHEDULE,
  gradeThresholds: { excellent: 0.85, good: 0.75, pass: 0.6 },
  // Push reminders: master switch plus how many minutes before a lesson/todo
  // start the notification fires.
  pushRemindersEnabled: false,
  remindBeforeMinutes: 5,
  // "放学提醒": a separate toggle (independent of pushRemindersEnabled above)
  // that pushes one notification 5 minutes after the last daySchedule block of
  // the day ends, telling the teacher today's schedule is over. Kept
  // independent because a teacher may want this end-of-day ping without
  // wanting per-lesson/todo reminders, or vice versa.
  endOfDayReminderEnabled: false,
  // IANA time zone (e.g. "Asia/Shanghai") the user's day schedule is wall-clock
  // in. This app is public and teachers can be anywhere, so reminders must be
  // computed per-user — never assume everyone is in the server's zone. Falls
  // back to `config.localTzOffsetMinutes` only for users who never set one.
  timeZone: null as string | null,
};

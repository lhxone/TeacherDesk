export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
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
  // Lesson period times ("08:00") are wall-clock in the teachers' timezone.
  // The server runs in UTC, so this offset (minutes east of UTC; 480 = UTC+8)
  // turns a period's wall time on a given day into a real instant.
  localTzOffsetMinutes: Number(process.env.LOCAL_TZ_OFFSET_MINUTES ?? 480),
};

export const pushEnabled = () => Boolean(config.vapidPublicKey && config.vapidPrivateKey);

export const DEFAULT_SETTINGS = {
  periodsPerDay: 8,
  showWeekend: false,
  periodTimes: [
    ['08:00', '08:45'],
    ['08:55', '09:40'],
    ['10:00', '10:45'],
    ['10:55', '11:40'],
    ['14:00', '14:45'],
    ['14:55', '15:40'],
    ['16:00', '16:45'],
    ['16:55', '17:40'],
  ],
  gradeThresholds: { excellent: 0.85, good: 0.75, pass: 0.6 },
  // Push reminders: master switch plus how many minutes before a lesson/todo
  // start the notification fires.
  pushRemindersEnabled: false,
  remindBeforeMinutes: 5,
};

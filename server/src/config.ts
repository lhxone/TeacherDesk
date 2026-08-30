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
};

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
};

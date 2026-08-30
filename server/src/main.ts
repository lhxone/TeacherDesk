import { buildApp } from './app.js';
import { config, pushEnabled } from './config.js';
import { prisma } from './db.js';
import { startReminderScheduler, stopReminderScheduler } from './lib/reminder.js';

async function main() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    stopReminderScheduler();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`TeacherDesk API listening on http://${config.host}:${config.port}/api/v1`);

  if (pushEnabled()) {
    startReminderScheduler(app.log);
    app.log.info('push reminder scheduler started');
  } else {
    app.log.warn('VAPID keys not set — push reminders disabled');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';

// Load .env.test before anything imports config/db. This is required, not
// optional: without it, tests would fall back to whatever DATABASE_URL is
// already in the environment (e.g. a developer's real dev DB), and
// tests/helpers.ts's resetDb() TRUNCATEs every table between tests.
const envPath = path.resolve(process.cwd(), '.env.test');
if (!fs.existsSync(envPath)) {
  throw new Error(
    `server/.env.test not found (looked at ${envPath}). Tests refuse to run ` +
      `without it, since resetDb() would otherwise TRUNCATE whatever database ` +
      `DATABASE_URL happens to point at. Create .env.test pointing at a ` +
      `dedicated *_test database before running tests.`,
  );
}
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
  if (!m) continue;
  const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  process.env[m[1]] = value;
}

if (!(process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop()?.endsWith('_test')) {
  throw new Error(
    `DATABASE_URL from server/.env.test does not point at a *_test database ` +
      `(got "${process.env.DATABASE_URL}"). Refusing to run tests against it.`,
  );
}

process.env.NODE_ENV = 'test';

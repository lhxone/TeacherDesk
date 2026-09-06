import fs from 'node:fs';
import path from 'node:path';

// Load .env.test before anything imports config/db, if present. Locally this
// file is how DATABASE_URL gets pointed at a disposable *_test database; in
// CI (see .github/workflows/container.yml) there is no .env.test at all —
// DATABASE_URL etc. are injected directly as job-level env vars instead, so
// a missing file must NOT be treated as an error on its own.
const envPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    process.env[m[1]] = value;
  }
}

// What actually matters — whether from .env.test or from the environment
// (CI) — is that DATABASE_URL, once resolved, points at a dedicated *_test
// database. Without this, tests/helpers.ts's resetDb() would TRUNCATE
// whatever database DATABASE_URL happens to point at, e.g. a developer's
// real dev DB if .env.test was never created and DATABASE_URL leaked in from
// somewhere else (a shell profile, an inherited .env).
if (!(process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop()?.endsWith('_test')) {
  throw new Error(
    `DATABASE_URL does not point at a *_test database (got ` +
      `"${process.env.DATABASE_URL}"). Locally, create server/.env.test ` +
      `pointing at a dedicated *_test database; in CI, set DATABASE_URL ` +
      `directly. Refusing to run tests against a non-test database.`,
  );
}

process.env.NODE_ENV = 'test';

/**
 * Best-effort .env loader for local development — runs as a MODULE-LEVEL
 * SIDE EFFECT the moment this file is imported, not via an exported function
 * the caller has to remember to invoke.
 *
 * That matters because of how ESM import evaluation actually works: import
 * statements are processed depth-first over the whole module graph before
 * any of the importing module's own top-level statements run. So `import
 * './loadEnv.js'; loadDotEnv();` as separate steps at the top of main.ts does
 * NOT run loadDotEnv() before config.js reads process.env — config.js gets
 * evaluated first anyway, as part of resolving main.ts's `import './app.js'`
 * -> app.js's own imports -> ... -> config.js chain, and only once that whole
 * chain is done does control return to main.ts's own statement (the
 * loadDotEnv() call). Import order on the page is not evaluation order.
 * This bit TeacherDesk directly: `server/.env` was silently ignored by
 * `npm run dev` / `node dist/main.js` for every setting (INITIAL_INVITE_CODE,
 * VAPID keys, RESOURCE_STORAGE_ROOT, ...) despite `prisma migrate dev`
 * appearing to read the same file fine (that's the Prisma CLI's own loader,
 * unrelated to this app's process).
 *
 * The fix: give this module the side effect directly, then import it FIRST,
 * with no other statement before it, in every entrypoint (main.ts). Since it
 * has no imports of its own, its module evaluation completes immediately and
 * unconditionally before Node moves on to resolving the next import.
 *
 * Production (docker-compose.yml) needs none of this — it injects every
 * variable directly via `environment:`, so `server/.env` simply doesn't
 * exist in that container and this is a silent no-op there.
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    // Never override a value the environment already set explicitly (a real
    // Docker `environment:` entry, a CI secret, etc.) — .env is a local-dev
    // fallback only.
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["'](.*)["']$/, '$1');
  }
}

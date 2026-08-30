import fs from 'node:fs';
import path from 'node:path';

// Load .env.test before anything imports config/db.
const envPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    process.env[m[1]] = value;
  }
}

process.env.NODE_ENV = 'test';

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Writes the next migration from the difference between the existing migrations and the schema:
// `bun run db:migration <name>`. Prisma diffs against a temporary shadow database; no live
// database is opened. The server applies the migration on its next start.
const name = process.argv[2] ?? '';
if (!/^[a-z][a-z0-9_]*$/.test(name)) {
  process.stderr.write('Usage: bun run db:migration <name>, with lowercase letters, digits, and underscores.\n');
  process.exit(2);
}

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const sql = execFileSync(
  process.execPath,
  [prismaCli, 'migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema', 'prisma/schema', '--script'],
  {
    cwd: apiDir,
    encoding: 'utf8',
    env: { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
if (!/\b(CREATE|ALTER|DROP)\b/i.test(sql)) {
  process.stderr.write('The schema matches the existing migrations; no migration was written.\n');
  process.exit(1);
}

const stamp = new Date().toISOString().replaceAll(/\D/g, '').slice(0, 14);
const directory = join(apiDir, 'prisma', 'migrations', `${stamp}_${name}`);
mkdirSync(directory);
writeFileSync(join(directory, 'migration.sql'), sql);
process.stdout.write(`Wrote ${join('prisma', 'migrations', `${stamp}_${name}`, 'migration.sql')}; review it before committing.\n`);

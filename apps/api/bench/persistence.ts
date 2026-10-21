import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { openDatabase } from '../src/database/database.ts';

// Measures local reads and mutations through the server's database layer (Prisma, WAL, write gate)
// for issue #3: `bun run --cwd apps/api bench:persistence`. The dataset is generated before timing:
// two profiles sharing 10,000 entries in a representative collection table. No domain model exists
// yet, so the table is a fixture shaped like a typical collection (indexed owner, ordered pages).
const profiles = 2;
const entries = 10_000;
const runs = 3;
const operationsPerRun = 200;
const warmup = 50;
const pageSize = 50;

const root = mkdtempSync(join(tmpdir(), 'nihon-bench-'));
const migrationsDir = join(root, 'migrations');
mkdirSync(join(migrationsDir, '20260101000000_create_entry'), { recursive: true });
writeFileSync(
  join(migrationsDir, '20260101000000_create_entry', 'migration.sql'),
  `CREATE TABLE "Entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "profileId" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "reading" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "reviewedAt" TEXT,
    "createdAt" TEXT NOT NULL
);
CREATE INDEX "Entry_profileId_id_idx" ON "Entry"("profileId", "id");
`,
);

const { database } = await openDatabase({ dataDir: join(root, 'data'), migrationsDir });
try {
  const now = new Date().toISOString();
  for (let start = 0; start < entries; start += 1_000) {
    await database.write(async (transaction) => {
      for (let index = start; index < start + 1_000; index += 1) {
        await transaction.$executeRaw`INSERT INTO "Entry" ("profileId", "term", "reading", "meaning", "createdAt") VALUES (${(index % profiles) + 1}, ${`語${index}`}, ${`ご${index}`}, ${`meaning ${index}`}, ${now})`;
      }
    });
  }

  const randomId = () => 1 + Math.floor(Math.random() * entries);
  const randomProfile = () => 1 + Math.floor(Math.random() * profiles);
  const operations = {
    'read: entry by id': () => database.reader.$queryRaw`SELECT * FROM "Entry" WHERE "id" = ${randomId()}`,
    'read: page of 50 after a cursor': () =>
      database.reader.$queryRaw`SELECT * FROM "Entry" WHERE "profileId" = ${randomProfile()} AND "id" > ${randomId()} ORDER BY "id" LIMIT ${pageSize}`,
    'mutation: insert one entry': () =>
      database.write((transaction) =>
        transaction.$executeRaw`INSERT INTO "Entry" ("profileId", "term", "reading", "meaning", "createdAt") VALUES (${randomProfile()}, ${'新'}, ${'しん'}, ${'new'}, ${new Date().toISOString()})`,
      ),
    'mutation: update one entry': () =>
      database.write((transaction) =>
        transaction.$executeRaw`UPDATE "Entry" SET "reviewedAt" = ${new Date().toISOString()} WHERE "id" = ${randomId()}`,
      ),
  };

  const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
  console.log(`Node ${process.version}, ${process.platform}/${process.arch}, ${cpus()[0]?.model ?? 'unknown CPU'}, ${Math.round(totalmem() / 2 ** 30)} GB`);
  console.log(`${profiles} profiles, ${entries} entries; ${runs} runs of ${operationsPerRun} operations after ${warmup} warm-up operations`);
  for (const [name, operation] of Object.entries(operations)) {
    for (let index = 0; index < warmup; index += 1) {
      await operation();
    }
    const results: string[] = [];
    for (let run = 0; run < runs; run += 1) {
      const durations: number[] = [];
      for (let index = 0; index < operationsPerRun; index += 1) {
        const started = performance.now();
        await operation();
        durations.push(performance.now() - started);
      }
      durations.sort((a, b) => a - b);
      results.push(`p50 ${percentile(durations, 50).toFixed(2)} ms, p95 ${percentile(durations, 95).toFixed(2)} ms`);
    }
    console.log(`${name}: ${results.join(' | ')}`);
  }
  const databaseBytes = statSync(join(root, 'data', 'nihon.db')).size;
  console.log(`Database ${(databaseBytes / 2 ** 20).toFixed(1)} MiB; process RSS ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)} MiB`);
} finally {
  await database.close();
  rmSync(root, { recursive: true, force: true });
}

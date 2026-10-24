import { statSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { dataDirEntries } from '../src/data-dir.ts';
import { startVersionedApp } from '../test/fixtures/versioned-app.ts';

// Measures the concurrent-modification guard for issue #71: `bun run --cwd apps/api bench:versions`.
// Requests go through the real HTTP adapter, command layer, and database, against the fixture notes
// of test/fixtures/versioned-app.ts (no domain owns a versioned aggregate yet). Every write is a
// keyed command, as a domain's would be, so the figures include the idempotency record.
const seededNotes = 10_000;
const series = 3;
const perSeries = 100;
const warmup = 20;
const contenders = 8;

const app = await startVersionedApp();
const { database } = app;

const send = async (expected: number, ...args: Parameters<typeof app.send>) => {
  const answer = await app.send(...args);
  if (answer.status !== expected) {
    throw new Error(`${args[0]} ${args[1]} answered ${answer.status}, expected ${expected}`);
  }
  return answer;
};
const timed = async (work: () => Promise<unknown>) => {
  const started = performance.now();
  await work();
  return performance.now() - started;
};
const percentile = (values: number[], fraction: number) => {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
};

let next = 0;
/** A seeded note not used before, so every operation starts from its version 1. */
const freshNote = () => `seed-${(next += 1)}`;
const keyed = () => ({ key: crypto.randomUUID() });

const operations: Record<string, () => Promise<() => Promise<unknown>>> = {
  'Read one note (read)': async () => {
    const id = freshNote();
    return () => send(200, 'GET', `/notes/${id}`);
  },
  'Write on the current version (mutation)': async () => {
    const id = freshNote();
    return () => send(200, 'PUT', `/notes/${id}`, { title: 'renamed' }, { ifMatch: '"v1"', ...keyed() });
  },
  'Write on a stale version, refused (mutation)': async () => {
    const id = freshNote();
    await send(200, 'PUT', `/notes/${id}`, { title: 'moved on' }, { ifMatch: '"v1"', ...keyed() });
    return () => send(412, 'PUT', `/notes/${id}`, { title: 'late' }, { ifMatch: '"v1"', ...keyed() });
  },
  [`${contenders} concurrent writes on one version, until all answered (mutation)`]: async () => {
    const id = freshNote();
    return async () => {
      const answers = await Promise.all(
        Array.from({ length: contenders }, () => app.send('PUT', `/notes/${id}`, { title: 'contended' }, { ifMatch: '"v1"', ...keyed() })),
      );
      const succeeded = answers.filter((answer) => answer.status === 200).length;
      if (succeeded !== 1) {
        throw new Error(`${succeeded} of ${contenders} concurrent writes succeeded, expected exactly one`);
      }
    };
  },
};

try {
  // Notes written before timing, in batches inside one transaction each.
  for (let start = 0; start < seededNotes; start += 500) {
    await database.write(async (transaction) => {
      for (let index = start; index < start + 500; index += 1) {
        await transaction.$executeRaw`INSERT INTO "FixtureNote" ("id", "title") VALUES (${`seed-${index + 1}`}, ${`note ${index + 1}`})`;
      }
    });
  }

  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  const lines: string[] = [];
  for (const [label, prepare] of Object.entries(operations)) {
    for (let index = 0; index < warmup; index += 1) {
      await (await prepare())();
    }
    for (let run = 1; run <= series; run += 1) {
      const durations: number[] = [];
      for (let index = 0; index < perSeries; index += 1) {
        const operation = await prepare();
        durations.push(await timed(operation));
      }
      lines.push(
        `| ${label} | ${run} | ${durations.length} | ${percentile(durations, 0.5).toFixed(2)} ms | ${percentile(durations, 0.95).toFixed(2)} ms | ${Math.max(...durations).toFixed(2)} ms |`,
      );
    }
  }
  clearInterval(sampler);

  const fileSize = (name: string) => {
    try {
      return statSync(join(app.dataDir, name)).size;
    } catch {
      return 0;
    }
  };
  const databaseBytes = fileSize(dataDirEntries.database) + fileSize(`${dataDirEntries.database}-wal`);
  const used = next;
  if (used > seededNotes) {
    throw new Error(`The run used ${used} notes but ${seededNotes} were seeded.`);
  }

  process.stdout.write(
    [
      `Machine: ${cpus()[0]?.model ?? 'unknown'}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GiB, ${process.platform} ${process.arch}, Node.js ${process.version}`,
      `Dataset: ${seededNotes} seeded notes, ${used} used (each operation starts from a fresh note at version 1); ${series} series of ${perSeries} operations after ${warmup} warm-up operations, per operation; no profiles are modelled by the fixture`,
      '',
      '| Operation | Series | Samples | p50 | p95 | Max |',
      '| --- | --- | --- | --- | --- | --- |',
      ...lines,
      '',
      `Notes: ${await app.count('FixtureNote')}; idempotency records: ${await app.count('IdempotencyRecord')}; database with WAL: ${(databaseBytes / 2 ** 20).toFixed(1)} MiB; peak RSS: ${(peakRss / 2 ** 20).toFixed(0)} MiB`,
      '',
    ].join('\n'),
  );
} finally {
  await app.stop();
}

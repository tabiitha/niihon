import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createApp } from '../src/app.ts';
import { loadCommandKey } from '../src/commands/command-key.ts';
import { createCommands, defaultCommandLimits } from '../src/commands/idempotency.ts';
import { databaseFileName, openDatabase } from '../src/database/database.ts';
import { silentLogger } from '../src/log.ts';
import { createAccountsModule } from '../src/modules/accounts/index.ts';

// Measures the idempotency guarantee for issue #70: `bun run --cwd apps/api bench:idempotency`.
// Commands are local registrations through the real HTTP adapter and database. Password hashing is
// replaced by a constant, as the issue's budget excludes it, so the figures are the command path:
// validation, the idempotency lookup, the write transaction, and the stored response.
const seededRecords = 10_000;
const series = 3;
const perSeries = 100;
const warmup = 20;
const callers = ['profile:bench-one', 'profile:bench-two'];
const callerHeader = 'x-bench-caller';
const password = 'correct horse battery';

const root = mkdtempSync(join(tmpdir(), 'nihon-bench-idempotency-'));
const dataDir = join(root, 'data');
const { database } = await openDatabase({ dataDir });
const commands = createCommands({
  database,
  key: loadCommandKey(dataDir),
  identifyCaller: (request) => request.get(callerHeader) ?? 'anonymous',
});
const server = createServer(
  createApp({
    version: 'bench',
    modules: [createAccountsModule({ hashPassword: async () => '$argon2id$v=19$m=65536,t=3,p=1$YmVuY2hzYWx0$YmVuY2h0YWc' })],
    database,
    commands,
    logger: silentLogger,
  }),
);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounts/local-registrations`;

let counter = 0;
const register = async (expected: number, { key, caller, username }: { key?: string; caller: string; username?: string }) => {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [callerHeader]: caller, ...(key === undefined ? {} : { 'idempotency-key': key }) },
    body: JSON.stringify({ username: username ?? `bench_${(counter += 1)}`, password }),
  });
  await response.text();
  if (response.status !== expected) {
    throw new Error(`Registration answered ${response.status}, expected ${expected}`);
  }
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

/** One keyed registration already committed, to be replayed or reused. */
interface Committed {
  readonly key: string;
  readonly caller: string;
  readonly username: string;
}
const commit = async (index: number): Promise<Committed> => {
  const committed = { key: randomUUID(), caller: callers[index % 2]!, username: `kept_${(counter += 1)}` };
  await register(201, committed);
  return committed;
};

const operations: Record<string, (index: number) => Promise<() => Promise<void>>> = {
  'Keyed registration, first execution (mutation)': async (index) => () => register(201, { key: randomUUID(), caller: callers[index % 2]! }),
  'Unkeyed registration (mutation, reference)': async (index) => () => register(201, { caller: callers[index % 2]! }),
  'Replay of a committed registration (read)': async (index) => {
    const committed = await commit(index);
    return () => register(201, committed);
  },
  'Key reused with other input (read, refused)': async (index) => {
    const committed = await commit(index);
    return () => register(422, { ...committed, username: `${committed.username}_other` });
  },
};

try {
  // Proof table of two callers, written before timing.
  const seed = async (count: number, expiresAt: Date) => {
    const created = new Date();
    for (let start = 0; start < count; start += 1_000) {
      await database.write((transaction) =>
        transaction.idempotencyRecord.createMany({
          data: Array.from({ length: Math.min(1_000, count - start) }, (_, offset) => ({
            key: randomUUID(),
            caller: callers[(start + offset) % 2]!,
            operation: 'registerLocalAccount',
            fingerprint: randomUUID().replaceAll('-', '').repeat(2),
            status: 201,
            response: JSON.stringify({ id: randomUUID(), username: `seed_${start + offset}`, role: 'user', registeredWith: 'local', createdAt: created.toISOString() }),
            createdAt: created,
            expiresAt,
          })),
        }),
      );
    }
  };
  await seed(seededRecords, new Date(Date.now() + defaultCommandLimits.retentionMs));

  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  const lines: string[] = [];
  for (const [label, prepare] of Object.entries(operations)) {
    for (let index = 0; index < warmup; index += 1) {
      await (await prepare(index))();
    }
    for (let run = 1; run <= series; run += 1) {
      const durations: number[] = [];
      for (let index = 0; index < perSeries; index += 1) {
        const operation = await prepare(index);
        durations.push(await timed(operation));
      }
      lines.push(
        `| ${label} | ${run} | ${durations.length} | ${percentile(durations, 0.5).toFixed(2)} ms | ${percentile(durations, 0.95).toFixed(2)} ms | ${Math.max(...durations).toFixed(2)} ms |`,
      );
    }
  }

  // Worst purge: each series starts with 10,000 expired records besides the live ones, so every
  // keyed command deletes a full batch. The seeding is not timed.
  const liveBefore = await database.reader.idempotencyRecord.count();
  for (let run = 1; run <= series; run += 1) {
    await seed(defaultCommandLimits.purgeBatch * perSeries, new Date(0));
    const durations: number[] = [];
    for (let index = 0; index < perSeries; index += 1) {
      durations.push(await timed(() => register(201, { key: randomUUID(), caller: callers[index % 2]! })));
    }
    lines.push(
      `| Keyed registration purging ${defaultCommandLimits.purgeBatch} expired records (mutation) | ${run} | ${durations.length} | ${percentile(durations, 0.5).toFixed(2)} ms | ${percentile(durations, 0.95).toFixed(2)} ms | ${Math.max(...durations).toFixed(2)} ms |`,
    );
  }
  clearInterval(sampler);

  const records = await database.reader.idempotencyRecord.count();
  const profiles = await database.reader.profile.count();
  const fileSize = (name: string) => {
    try {
      return statSync(join(dataDir, name)).size;
    } catch {
      return 0;
    }
  };
  const databaseBytes = fileSize(databaseFileName) + fileSize(`${databaseFileName}-wal`);

  process.stdout.write(
    [
      `Machine: ${cpus()[0]?.model ?? 'unknown'}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GiB, ${process.platform} ${process.arch}, Node.js ${process.version}`,
      `Dataset: ${seededRecords} seeded records of ${callers.length} callers; ${series} series of ${perSeries} operations after ${warmup} warm-up operations, per operation; password hashing excluded`,
      '',
      '| Operation | Series | Samples | p50 | p95 | Max |',
      '| --- | --- | --- | --- | --- | --- |',
      ...lines,
      '',
      `Live records before the purge series: ${liveBefore}; ${defaultCommandLimits.purgeBatch * perSeries} expired records added before each purge series`,
      `Records at the end: ${records}; profiles: ${profiles}; database with WAL: ${(databaseBytes / 2 ** 20).toFixed(1)} MiB; peak RSS: ${(peakRss / 2 ** 20).toFixed(0)} MiB`,
      '',
    ].join('\n'),
  );
} finally {
  server.close();
  server.closeAllConnections();
  await database.close();
  rmSync(root, { recursive: true, force: true });
}

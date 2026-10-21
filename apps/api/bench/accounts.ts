import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { githubClient, googleClient, googleIssuer, startFakeProviders } from '../test/fixtures/fake-providers.ts';
import { openDatabase } from '../src/database/database.ts';
import { createApp } from '../src/app.ts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { silentLogger } from '../src/log.ts';
import { createAccountsModule } from '../src/modules/accounts/index.ts';
import { argon2Parameters, hashPassword } from '../src/modules/accounts/password-hash.ts';

// Measures Nihon's own registration work for issue #233: `bun run --cwd apps/api bench:accounts`.
// Provider calls go to a local fake that answers at once, so the provider-flow figures are Nihon's
// work only; real Google or GitHub latency comes on top and is not measured here.
const warmup = 10;
const sequential = 100;
const concurrentRounds = 20;
const concurrency = 10;
const password = 'correct horse battery';

const root = mkdtempSync(join(tmpdir(), 'nihon-bench-accounts-'));
const fake = await startFakeProviders();
const { database } = await openDatabase({ dataDir: join(root, 'data') });
const server = createServer(
  createApp({
    version: 'bench',
    modules: [createAccountsModule({ googleEndpoints: fake.endpoints.google, githubEndpoints: fake.endpoints.github })],
    database,
    logger: silentLogger,
    oauth: { providers: { google: googleClient, github: githubClient }, redirectUris: [] },
  }),
);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let counter = 0;
const post = async (path: string, body: unknown) => {
  const response = await fetch(`${baseUrl}/api/accounts${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
};
const register = async () => {
  const response = await post('/local-registrations', { username: `bench_${(counter += 1)}`, password });
  if (response.status !== 201) {
    throw new Error(`Registration answered ${response.status}`);
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
const row = (label: string, values: number[]) =>
  `| ${label} | ${values.length} | ${percentile(values, 0.5).toFixed(1)} ms | ${percentile(values, 0.95).toFixed(1)} ms | ${values.reduce((largest, value) => Math.max(largest, value), 0).toFixed(1)} ms |`;

try {
  // Hashing alone.
  for (let index = 0; index < warmup; index += 1) {
    await hashPassword(password);
  }
  const hashing = [];
  for (let index = 0; index < 30; index += 1) {
    hashing.push(await timed(() => hashPassword(password)));
  }

  // Registration, one at a time.
  for (let index = 0; index < warmup; index += 1) {
    await register();
  }
  const registrations = [];
  for (let index = 0; index < sequential; index += 1) {
    registrations.push(await timed(register));
  }

  // Ten concurrent registrations while lightweight status reads are sampled.
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  const reads: number[] = [];
  const burstRegistrations: number[] = [];
  for (let round = 0; round < concurrentRounds; round += 1) {
    let running = true;
    const burst = Promise.all(Array.from({ length: concurrency }, () => timed(register))).then((durations) => {
      burstRegistrations.push(...durations);
      running = false;
    });
    while (running) {
      reads.push(await timed(async () => (await fetch(`${baseUrl}/api/health`)).text()));
    }
    await burst;
  }
  clearInterval(sampler);

  // Provider flows against the immediate fake.
  const startDurations: number[] = [];
  const completeDurations: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    let started: { authorizationUrl: string; state: string } | undefined;
    startDurations.push(
      await timed(async () => {
        started = (await post('/oauth-registrations', { provider: 'google', username: `oauth_${index}`, redirectUri: 'http://127.0.0.1:4000/cb' })).body;
      }),
    );
    const nonce = new URL(started!.authorizationUrl).searchParams.get('nonce');
    const seconds = Math.floor(Date.now() / 1000);
    fake.googleToken = () => ({
      status: 200,
      body: { id_token: fake.signIdToken({ iss: googleIssuer, aud: googleClient.clientId, sub: `sub-${index}`, nonce, iat: seconds, exp: seconds + 3600 }) },
    });
    completeDurations.push(
      await timed(async () => {
        const response = await post('/oauth-registrations/completion', { state: started!.state, code: 'bench' });
        if (response.status !== 201) {
          throw new Error(`Completion answered ${response.status}`);
        }
      }),
    );
  }

  const profile = cpus()[0]?.model ?? 'unknown CPU';
  console.log(`Account registration benchmark — ${profile}, ${Math.round(totalmem() / 2 ** 30)} GB, ${process.platform} ${process.arch}, Node.js ${process.version}`);
  console.log(`Argon2id: memory ${argon2Parameters.memoryKiB / 1024} MiB, ${argon2Parameters.passes} passes, ${argon2Parameters.parallelism} lane`);
  console.log('\n| Measure | Samples | p50 | p95 | Max |\n| --- | --- | --- | --- | --- |');
  console.log(row('Hash one password (30 after warm-up)', hashing));
  console.log(row('Register one account, sequential, warm', registrations));
  console.log(row(`Register one account, ${concurrency} at once`, burstRegistrations));
  console.log(row(`Status read (GET /api/health) during ${concurrency} concurrent registrations`, reads));
  console.log(row('Start a provider flow (fake provider)', startDurations));
  console.log(row('Complete a provider flow (fake provider answers at once)', completeDurations));
  console.log(`\nPeak process RSS during the concurrent registrations: ${(peakRss / 2 ** 20).toFixed(0)} MiB (hashing allowed at most 2 at once, 64 MiB each)`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await database.close();
  await fake.stop();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

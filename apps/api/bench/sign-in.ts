import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.ts';
import { openDatabase } from '../src/database/database.ts';
import { silentLogger } from '../src/log.ts';
import { createAccountsModule } from '../src/modules/accounts/index.ts';
import { argon2Parameters } from '../src/modules/accounts/password-hash.ts';
import { githubClient, googleClient, googleIssuer, startFakeProviders } from '../test/fixtures/fake-providers.ts';

// Measures Nihon's own sign-in and session work for issue #269: `bun run --cwd apps/api bench:sign-in`.
// Real Argon2id verification; provider calls go to a local fake that answers at once, so the
// provider figures are Nihon's work only.
const warmup = 10;
const sequential = 100;
const concurrentRounds = 20;
const concurrency = 10;
const password = 'correct horse battery';
const accounts = 20;

const root = mkdtempSync(join(tmpdir(), 'nihon-bench-sign-in-'));
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

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? undefined : JSON.parse(text)) as any };
};
let counter = 0;
const signIn = async (expected = 201, secret = password) => {
  const response = await call('POST', '/accounts/sessions', { username: `bench_${(counter += 1) % accounts}`, password: secret, client: 'native' });
  if (response.status !== expected) {
    throw new Error(`Sign-in answered ${response.status}`);
  }
  return response.body?.token as string;
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
  for (let index = 0; index < accounts; index += 1) {
    await call('POST', '/accounts/local-registrations', { username: `bench_${index}`, password });
  }
  const reader = await signIn();

  for (let index = 0; index < warmup; index += 1) {
    await signIn();
  }
  const signIns = [];
  for (let index = 0; index < sequential; index += 1) {
    signIns.push(await timed(() => signIn()));
  }
  const wrongPassword = [];
  const unknownUser = [];
  for (let index = 0; index < 30; index += 1) {
    wrongPassword.push(await timed(() => signIn(401, 'wrong password!')));
    unknownUser.push(
      await timed(async () => {
        const response = await call('POST', '/accounts/sessions', { username: `nobody_${index}`, password, client: 'native' });
        if (response.status !== 401) {
          throw new Error(`Unknown sign-in answered ${response.status}`);
        }
      }),
    );
  }

  // Ten concurrent sign-ins while lightweight reads are sampled, anonymous and authenticated.
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  const healthReads: number[] = [];
  const sessionReads: number[] = [];
  const burst: number[] = [];
  for (let round = 0; round < concurrentRounds; round += 1) {
    let running = true;
    const work = Promise.all(Array.from({ length: concurrency }, () => timed(() => signIn()))).then((durations) => {
      burst.push(...durations);
      running = false;
    });
    while (running) {
      healthReads.push(await timed(async () => (await fetch(`${baseUrl}/api/health`)).text()));
      sessionReads.push(
        await timed(async () => {
          if ((await call('GET', '/accounts/sessions/current', undefined, reader)).status !== 200) {
            throw new Error('The reading session stopped working.');
          }
        }),
      );
    }
    await work;
  }
  clearInterval(sampler);

  const signOuts = [];
  for (let index = 0; index < 60; index += 1) {
    const token = await signIn();
    signOuts.push(await timed(() => call('DELETE', '/accounts/sessions/current', undefined, token)));
  }

  // Provider sign-ins against the immediate fake.
  await database.write((transaction) =>
    transaction.profile.create({
      data: { id: randomUUID(), username: 'Linked', usernameKey: 'linked', externalIdentities: { create: { id: randomUUID(), provider: 'google', issuer: googleIssuer, subject: 'linked-sub' } } },
    }),
  );
  const starts: number[] = [];
  const completions: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    let started: { authorizationUrl: string; state: string; clientBinding: string } | undefined;
    starts.push(
      await timed(async () => {
        started = (await call('POST', '/accounts/oauth-sign-ins', { provider: 'google', redirectUri: 'http://127.0.0.1:4000/cb', client: 'native' })).body;
      }),
    );
    const nonce = new URL(started!.authorizationUrl).searchParams.get('nonce');
    const seconds = Math.floor(Date.now() / 1000);
    fake.googleToken = () => ({
      status: 200,
      body: { id_token: fake.signIdToken({ iss: googleIssuer, aud: googleClient.clientId, sub: 'linked-sub', nonce, iat: seconds, exp: seconds + 3600 }) },
    });
    completions.push(
      await timed(async () => {
        const response = await call('POST', '/accounts/oauth-sign-ins/completion', { state: started!.state, code: 'bench', clientBinding: started!.clientBinding });
        if (response.status !== 201) {
          throw new Error(`Completion answered ${response.status}`);
        }
      }),
    );
  }

  const profile = cpus()[0]?.model ?? 'unknown CPU';
  console.log(`Sign-in benchmark — ${profile}, ${Math.round(totalmem() / 2 ** 30)} GB, ${process.platform} ${process.arch}, Node.js ${process.version}`);
  console.log(`Argon2id: memory ${argon2Parameters.memoryKiB / 1024} MiB, ${argon2Parameters.passes} passes, ${argon2Parameters.parallelism} lane`);
  console.log('\n| Measure | Samples | p50 | p95 | Max |\n| --- | --- | --- | --- | --- |');
  console.log(row('Sign in with a password, sequential, warm', signIns));
  console.log(row('Refused sign-in, wrong password', wrongPassword));
  console.log(row('Refused sign-in, unknown username', unknownUser));
  console.log(row(`Sign in, ${concurrency} at once`, burst));
  console.log(row(`Status read (GET /api/health) during ${concurrency} concurrent sign-ins`, healthReads));
  console.log(row(`Session read (GET /api/accounts/sessions/current) during ${concurrency} concurrent sign-ins`, sessionReads));
  console.log(row('Sign out', signOuts));
  console.log(row('Start a provider sign-in (fake provider)', starts));
  console.log(row('Complete a provider sign-in (fake provider answers at once)', completions));
  console.log(`\nPeak process RSS during the concurrent sign-ins: ${(peakRss / 2 ** 20).toFixed(0)} MiB`);
  console.log(`Sessions in the table at the end: ${await database.reader.session.count()}`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await database.close();
  await fake.stop();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

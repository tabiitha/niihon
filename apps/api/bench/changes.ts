import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createApp } from '../src/app.ts';
import { createChangeFeed, defaultChangeFeedLimits } from '../src/changes/feed.ts';
import { openDatabase } from '../src/database/database.ts';
import { createJsonLogger } from '../src/log.ts';
import { createAccountsModule } from '../src/modules/accounts/index.ts';
import { createChangesModule } from '../src/modules/changes/index.ts';
import { defaultStreamLimits } from '../src/modules/changes/stream.ts';
import { createSessions } from '../src/sessions/sessions.ts';
import { openEventStream, type EventStreamClient } from '../test/fixtures/event-stream.ts';

// Measures change notifications for issue #364: `bun run --cwd apps/api bench:changes`.
// Two profiles, each followed by 10 streams, plus 10 anonymous streams. A mutation is a real
// sign-out over HTTP; its sessions are opened directly, so no password hashing is involved.
const warmup = 20;
const series = 3;
const perSeries = 100;
const streamsPerAudience = 10;
const history = 10_000;
const topics = 50;

const root = mkdtempSync(join(tmpdir(), 'nihon-bench-changes-'));
const { database } = await openDatabase({ dataDir: join(root, 'data') });
const logs: string[] = [];
const logger = createJsonLogger((line) => logs.push(line));
const changes = createChangeFeed({ database });
const sessions = createSessions({ database, changes });
const server = createServer(
  createApp({
    version: 'bench',
    modules: [createAccountsModule({ hashPassword: async (value) => `hash:${value}` }), createChangesModule()],
    database,
    changes,
    sessions,
    logger,
  }),
);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const streamUrl = `${baseUrl}/api/changes/stream`;

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
const mib = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;

const opened: EventStreamClient[] = [];
const subscribe = async (headers: Record<string, string> = {}) => {
  const stream = await openEventStream(streamUrl, headers);
  if (stream.status !== 200) {
    throw new Error(`Subscription answered ${stream.status}`);
  }
  opened.push(stream);
  return stream;
};
/** Reads `stream` until the change at or after `sequence` arrives. */
const until = async (stream: EventStreamClient, sequence: number) => {
  for (;;) {
    const event = await stream.next(5_000);
    if (event === undefined) {
      throw new Error('A stream ended.');
    }
    if (Number(event.id?.split('.')[1]) >= sequence) {
      return;
    }
  }
};
const openSession = (profileId: string) =>
  database.write((transaction) => sessions.open(transaction, { profileId, client: 'native', signedInWith: 'local' }));

try {
  const profiles: string[] = [];
  for (const username of ['Sakura', 'Momiji']) {
    const response = await fetch(`${baseUrl}/api/accounts/local-registrations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'correct horse battery' }),
    });
    profiles.push(((await response.json()) as { id: string }).id);
  }
  const [sakura, momiji] = profiles as [string, string];

  // A long history first: the retained window, not the history, bounds what a resume reads.
  let sequence = 0;
  for (let batch = 0; batch < history / 1_000; batch += 1) {
    await database.write(async (transaction) => {
      for (let index = 0; index < 1_000; index += 1) {
        changes.publish(transaction, { topic: `topic-${index % topics}`, profileId: index % 2 === 0 ? sakura : momiji });
      }
    });
    sequence += 1_000;
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const audiences: EventStreamClient[][] = [];
  for (const profileId of [sakura, momiji, undefined]) {
    const streams = [];
    for (let index = 0; index < streamsPerAudience; index += 1) {
      const headers = profileId === undefined ? {} : { authorization: `Bearer ${(await openSession(profileId)).token}` };
      sequence += profileId === undefined ? 0 : 1;
      const stream = await subscribe(headers);
      await stream.next();
      streams.push(stream);
    }
    audiences.push(streams);
  }
  const [sakuraStreams, momijiStreams] = audiences as [EventStreamClient[], EventStreamClient[]];
  // Catch every stream up with the sign-ins above.
  await Promise.all([...sakuraStreams, ...momijiStreams].map((stream) => until(stream, sequence).catch(() => {})));
  const heapStreams = process.memoryUsage().heapUsed;

  /** A real HTTP sign-out of `profileId`, timed until the first and the last of its streams heard of it. */
  const signOutRound = async (profileId: string, streams: EventStreamClient[], first: number[], all: number[], mutation: number[]) => {
    const { token } = await openSession(profileId);
    sequence += 1;
    await Promise.all(streams.map((stream) => until(stream, sequence)));
    sequence += 1;
    const target = sequence;
    const started = performance.now();
    const heard = streams.map((stream) => until(stream, target).then(() => performance.now() - started));
    const response = await fetch(`${baseUrl}/api/accounts/sessions/current`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    mutation.push(performance.now() - started);
    if (response.status !== 204) {
      throw new Error(`Sign-out answered ${response.status}`);
    }
    const durations = await Promise.all(heard);
    first.push(Math.min(...durations));
    all.push(Math.max(...durations));
  };

  for (let index = 0; index < warmup; index += 1) {
    await signOutRound(sakura, sakuraStreams, [], [], []);
  }
  const rounds = Array.from({ length: series }, () => ({ first: [] as number[], all: [] as number[], mutation: [] as number[] }));
  for (const round of rounds) {
    for (let index = 0; index < perSeries; index += 1) {
      const [profileId, streams] = index % 2 === 0 ? [sakura, sakuraStreams] : [momiji, momijiStreams];
      await signOutRound(profileId, streams, round.first, round.all, round.mutation);
    }
  }

  // Resuming after 100 missed changes over the topics, and resynchronizing after a restart.
  const probe = await subscribe({ authorization: `Bearer ${(await openSession(sakura)).token}` });
  sequence += 1;
  const resumeFrom = (await probe.next())?.id as string;
  probe.close();
  await database.write(async (transaction) => {
    for (let index = 0; index < 100; index += 1) {
      changes.publish(transaction, { topic: `topic-${index % topics}`, profileId: sakura });
    }
  });
  const resumeToken = (await openSession(sakura)).token;
  const resumes = Array.from({ length: series }, () => [] as number[]);
  const resyncs = Array.from({ length: series }, () => [] as number[]);
  for (let index = 0; index < warmup; index += 1) {
    const stream = await openEventStream(streamUrl, { authorization: `Bearer ${resumeToken}`, 'Last-Event-ID': resumeFrom });
    await stream.next();
    stream.close();
  }
  for (let round = 0; round < series; round += 1) {
    for (let index = 0; index < perSeries; index += 1) {
      resumes[round]?.push(
        await timed(async () => {
          const stream = await openEventStream(streamUrl, { authorization: `Bearer ${resumeToken}`, 'Last-Event-ID': resumeFrom });
          // The latest change of each topic, then the sign-in that opened the resuming session.
          for (let replayed = 0; replayed < topics + 1; replayed += 1) {
            if ((await stream.next(5_000))?.event !== 'change') {
              throw new Error('Expected a replayed change.');
            }
          }
          stream.close();
        }),
      );
      resyncs[round]?.push(
        await timed(async () => {
          const stream = await openEventStream(streamUrl, { 'Last-Event-ID': 'previousProcess.42' });
          if ((await stream.next(5_000))?.event !== 'resync') {
            throw new Error('Expected a resync.');
          }
          stream.close();
        }),
      );
    }
  }

  // A subscriber that never reads, alone, while 100,000 changes over 1,000 topics are committed.
  for (const stream of opened.splice(0)) {
    stream.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  const stalled = await fetch(streamUrl);
  const flood = await timed(async () => {
    for (let batch = 0; batch < 100; batch += 1) {
      await database.write(async (transaction) => {
        for (let index = 0; index < 1_000; index += 1) {
          changes.publish(transaction, { topic: `flood-${index}` });
        }
      });
    }
  });
  clearInterval(sampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const dropped = logs.filter((line) => line.includes('"changes.subscriber_dropped"')).length;
  await stalled.body?.cancel().catch(() => {});

  const profile = cpus()[0]?.model ?? 'unknown CPU';
  console.log(`Change notification benchmark — ${profile}, ${Math.round(totalmem() / 2 ** 30)} GB, ${process.platform} ${process.arch}, Node.js ${process.version}`);
  console.log(
    `Limits: ${defaultChangeFeedLimits.retainedChanges} retained changes, ${defaultChangeFeedLimits.maxSubscribers} subscribers, ${defaultStreamLimits.maxQueuedEvents} queued events per subscriber`,
  );
  console.log(`${history} changes committed before measuring; ${streamsPerAudience} streams per profile and ${streamsPerAudience} anonymous`);
  console.log('\n| Measure | Samples | p50 | p95 | Max |\n| --- | --- | --- | --- | --- |');
  rounds.forEach((round, index) => {
    console.log(row(`Series ${index + 1}: sign-out answered (HTTP DELETE, commit included)`, round.mutation));
    console.log(row(`Series ${index + 1}: change received by the first stream of the profile`, round.first));
    console.log(row(`Series ${index + 1}: change received by all ${streamsPerAudience} streams of the profile`, round.all));
  });
  resumes.forEach((values, index) => console.log(row(`Series ${index + 1}: resume after 100 missed changes, until the ${topics + 1} replayed topics`, values)));
  resyncs.forEach((values, index) => console.log(row(`Series ${index + 1}: reconnect with a previous process's position, until resync`, values)));
  console.log(`\nHeap for ${streamsPerAudience * 3} open streams, the window already full: ${mib(heapStreams - heapBefore)} more than before them`);
  console.log(`Unread subscriber: 100,000 changes committed in ${flood.toFixed(0)} ms; dropped ${dropped} time(s); RSS ${mib(rssBefore)} before, ${mib(peakRss)} at peak`);
} finally {
  for (const stream of opened) {
    stream.close();
  }
  changes.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await database.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

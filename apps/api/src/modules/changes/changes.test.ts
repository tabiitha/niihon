import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { startAccountsApp, type AccountsApp } from '../../../test/fixtures/accounts-app.ts';
import { openEventStream, type EventStreamClient } from '../../../test/fixtures/event-stream.ts';
import { createJsonLogger } from '../../log.ts';
import { startServer, type RunningServer } from '../../server.ts';
import { registeredModules } from '../registry.ts';

const password = 'correct horse battery';
const day = 24 * 60 * 60 * 1000;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const sequenceOf = (id: string | undefined) => Number(id?.split('.')[1]);

describe('change notifications over server-sent events', () => {
  let app: AccountsApp;
  let clock: Date;
  const streams: EventStreamClient[] = [];

  async function start(options: Parameters<typeof startAccountsApp>[0] = {}) {
    clock = new Date('2026-10-24T08:00:00.000Z');
    app = await startAccountsApp({
      now: () => clock,
      module: { now: () => clock, hashPassword: async (value) => `hash:${value}`, verifyPassword: async (value, hash) => hash === `hash:${value}` },
      ...options,
    });
    for (const username of ['Sakura', 'Momiji']) {
      assert.equal((await app.post('/local-registrations', { username, password })).status, 201);
    }
  }
  afterEach(async () => {
    for (const stream of streams.splice(0)) {
      stream.close();
    }
    await app.stop();
  });

  const signIn = async (username: string, headers: Record<string, string> = {}) => {
    const response = await app.post('/sessions', { username, password, client: 'native' }, { headers });
    assert.equal(response.status, 201);
    return response.body.token as string;
  };

  async function subscribe(headers: Record<string, string> = {}, query = '') {
    const stream = await openEventStream(`${app.baseUrl}/api/changes/stream${query}`, headers);
    streams.push(stream);
    return stream;
  }

  /** Commits a transaction announcing `topic` to everyone. */
  const commitShared = (topic: string) => app.database.write(async (transaction) => app.changes.publish(transaction, { topic }));

  describe('with the default limits', () => {
    beforeEach(() => start());

    it('starts with a resync, then tells a profile when its sessions change, never another profile', async () => {
      const sakura = await signIn('Sakura');
      const stream = await subscribe(bearer(sakura));
      assert.equal(stream.status, 200);
      assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      assert.equal(stream.headers.get('cache-control'), 'no-store');
      const first = await stream.next();
      assert.equal(first?.event, 'resync');
      assert.deepEqual(first?.data, { reason: 'new_subscription' });
      assert.deepEqual(stream.retries, [2000]);

      await signIn('Momiji');
      assert.equal((await app.post('/sessions', { username: 'Sakura', password: 'wrong password', client: 'native' })).status, 401);
      await stream.quiet(150);

      await signIn('Sakura');
      const change = await stream.next();
      assert.equal(change?.event, 'change');
      assert.equal(change?.data.topic, 'sessions');
      assert.equal(change?.data.occurredAt, clock.toISOString());
      assert.equal(sequenceOf(change?.id), sequenceOf(first?.id) + 2, "Momiji's change took a position Sakura never saw");
      assert.ok(app.logs.every((line) => !line.includes(sakura)));
    });

    it('never announces a rolled-back transaction, and tells anonymous subscribers only shared changes', async () => {
      const stream = await subscribe();
      assert.equal((await stream.next())?.event, 'resync');
      await assert.rejects(
        app.database.write(async (transaction) => {
          app.changes.publish(transaction, { topic: 'cancelled' });
          await transaction.$executeRaw`SELECT 1`;
          throw new Error('refused');
        }),
      );
      await signIn('Sakura');
      await commitShared('decks');
      const change = await stream.next();
      assert.equal(change?.data.topic, 'decks');
      await stream.quiet(100);
    });

    it('resumes after several missed changes from Last-Event-ID or lastEventId, the header first', async () => {
      const sakura = await signIn('Sakura');
      const first = await subscribe(bearer(sakura));
      const position = (await first.next())?.id as string;
      first.close();

      await commitShared('decks');
      await signIn('Sakura');
      await signIn('Sakura');
      await commitShared('decks');
      await signIn('Momiji');

      for (const resumed of [
        await subscribe({ ...bearer(sakura), 'Last-Event-ID': position }),
        await subscribe(bearer(sakura), `?lastEventId=${encodeURIComponent(position)}`),
      ]) {
        const replayed = [await resumed.next(), await resumed.next()];
        assert.deepEqual(
          replayed.map((event) => [event?.event, event?.data.topic, sequenceOf(event?.id) - sequenceOf(position)]),
          [
            ['change', 'sessions', 3],
            ['change', 'decks', 4],
          ],
        );
        await resumed.quiet(100);
      }

      const headerFirst = await subscribe({ ...bearer(sakura), 'Last-Event-ID': 'unknown' }, `?lastEventId=${encodeURIComponent(position)}`);
      assert.deepEqual((await headerFirst.next())?.data, { reason: 'unknown_position' });

      const tooLong = await subscribe({ 'Last-Event-ID': 'x'.repeat(129) });
      assert.equal(tooLong.status, 400);
      assert.equal(tooLong.error.error.code, 'validation_failed');
      assert.equal(tooLong.error.error.issues[0].path, 'header.Last-Event-ID');
    });

    it('ends the stream of a session once it is told that the session signed out', async () => {
      const sakura = await signIn('Sakura');
      const other = await signIn('Sakura');
      const ending = await subscribe(bearer(sakura));
      const staying = await subscribe(bearer(other));
      await ending.next();
      await staying.next();

      assert.equal((await app.delete('/sessions/current', { headers: bearer(sakura) })).status, 204);
      assert.equal((await ending.next())?.data.topic, 'sessions');
      assert.equal(await ending.next(), undefined, 'the stream ended');
      assert.equal((await staying.next())?.data.topic, 'sessions');
      await staying.quiet(100);
    });

    it('refuses a subscription with an expired session as anonymous', async () => {
      const sakura = await signIn('Sakura');
      clock = new Date(clock.getTime() + 31 * day);
      const stream = await subscribe(bearer(sakura));
      await stream.next();
      await signIn('Sakura');
      await stream.quiet(100);
    });
  });

  it('ends the stream of a session replaced or evicted by a newer sign-in', async () => {
    await start({ sessionLimits: { maxPerProfile: 2 } });
    const oldest = await signIn('Sakura');
    const switching = await signIn('Momiji');
    const evicted = await subscribe(bearer(oldest));
    const replaced = await subscribe(bearer(switching));
    await evicted.next();
    await replaced.next();

    // Momiji's session switches to Sakura: it is replaced, and Sakura's oldest leaves its two newest.
    await signIn('Sakura', bearer(switching));
    await signIn('Sakura');
    assert.equal(sequenceOf((await replaced.next())?.id), 4);
    assert.equal(await replaced.next(), undefined);
    // Sakura's oldest session hears of the first sign-in, then of its own eviction.
    assert.deepEqual([await evicted.next(), await evicted.next()].map((event) => sequenceOf(event?.id)), [3, 5]);
    assert.equal(await evicted.next(), undefined);
  });

  it('ends a stream once its session expires', async () => {
    await start({ changesModule: { now: () => clock, limits: { heartbeatMs: 20 } } });
    const sakura = await signIn('Sakura');
    const stream = await subscribe(bearer(sakura));
    await stream.next();
    await stream.quiet(60);
    assert.ok(stream.comments.includes('keep-alive'));
    clock = new Date(clock.getTime() + 30 * day);
    assert.equal(await stream.next(), undefined);
  });

  it('refuses subscribers beyond capacity until one leaves', async () => {
    await start({ changeLimits: { maxSubscribers: 1 } });
    const first = await subscribe();
    await first.next();
    const refused = await subscribe();
    assert.equal(refused.status, 503);
    assert.equal(refused.error.error.code, 'changes_capacity_reached');
    assert.equal(refused.headers.get('retry-after'), '5');
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = await subscribe();
    assert.equal(next.status, 200);
  });

  it('disconnects a subscriber that does not read, keeping its memory bounded', async () => {
    await start({ changeLimits: { maxSubscribers: 1 }, changesModule: { limits: { maxQueuedEvents: 64 } } });
    // Subscribed but never read: once the socket is full, events wait in its bounded queue.
    const response = await fetch(`${app.baseUrl}/api/changes/stream`);
    assert.equal(response.status, 200);
    await app.database.write(async (transaction) => {
      for (let index = 0; index < 5_000; index += 1) {
        app.changes.publish(transaction, { topic: `topic-${index}` });
      }
    });
    assert.ok(app.logs.some((line) => line.includes('"changes.subscriber_dropped"') && line.includes('"queue_full"')));
    const next = await subscribe();
    assert.equal(next.status, 200, 'its place was freed');
    await response.body?.cancel().catch(() => {});
  });
});

describe('change notifications across a server restart', () => {
  let root: string;
  let server: RunningServer | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nihon-changes-restart-'));
  });
  afterEach(async () => {
    await server?.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const run = () =>
    startServer({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(root, 'data'),
      version: '1.2.3',
      modules: registeredModules,
      logger: createJsonLogger(() => {}),
    });

  it('ends open streams at once when stopping, then resynchronizes clients of the previous process', async () => {
    server = await run();
    const before = await openEventStream(`http://127.0.0.1:${server.port}/api/changes/stream`);
    const position = (await before.next())?.id as string;

    const stopping = Date.now();
    await server.stop();
    assert.ok(Date.now() - stopping < 2_000, 'an open stream does not hold the 10 s shutdown grace');
    assert.equal(await before.next(), undefined);

    server = await run();
    const after = await openEventStream(`http://127.0.0.1:${server.port}/api/changes/stream`, { 'Last-Event-ID': position });
    const first = await after.next();
    assert.equal(first?.event, 'resync');
    assert.deepEqual(first?.data, { reason: 'server_restarted' });
    assert.notEqual(first?.id?.split('.')[0], position.split('.')[0]);
    after.close();
  });
});

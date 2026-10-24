import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { openDatabase, type Database } from '../database/database.ts';
import { createChangeFeed, type Change, type ChangeEvent, type ChangeFeed, type ChangeFeedLimits, type Subscriber } from './feed.ts';

describe('change feed', () => {
  let root: string;
  let database: Database;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'nihon-changes-'));
    ({ database } = await openDatabase({ dataDir: join(root, 'data') }));
  });
  afterEach(async () => {
    await database.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const feedWith = (limits: Partial<ChangeFeedLimits> = {}) => createChangeFeed({ database, limits });

  /** Commits one transaction announcing `changes`. */
  const commit = (feed: ChangeFeed, ...changes: Change[]) =>
    database.write(async (transaction) => {
      for (const change of changes) {
        feed.publish(transaction, change);
      }
    });

  function listen(feed: ChangeFeed, options: Partial<Subscriber> = {}) {
    const received: ChangeEvent[] = [];
    let ended = 0;
    const subscription = feed.subscribe({
      deliver: (event) => received.push(event),
      end: () => (ended += 1),
      ...options,
    });
    assert.ok(subscription !== undefined);
    return { subscription, received, ended: () => ended, topics: () => received.map((event) => event.topic) };
  }

  it('announces a change only once its transaction committed, never when it rolled back', async () => {
    const feed = feedWith();
    const listener = listen(feed);
    await assert.rejects(
      database.write(async (transaction) => {
        feed.publish(transaction, { topic: 'cancelled' });
        assert.deepEqual(listener.received, []);
        throw new Error('refused');
      }),
    );
    await commit(feed, { topic: 'first' }, { topic: 'second' });
    assert.deepEqual(listener.topics(), ['first', 'second']);
    const [first, second] = listener.received;
    // Rolled-back changes take no position: committed ones are numbered without gaps.
    assert.equal(Number(first?.id.split('.')[1]), 1);
    assert.equal(Number(second?.id.split('.')[1]), 2);
    assert.ok(first?.occurredAt instanceof Date);
  });

  it('tells a profile only its own changes and those meant for everyone', async () => {
    const feed = feedWith();
    const sakura = listen(feed, { profileId: 'sakura' });
    const momiji = listen(feed, { profileId: 'momiji' });
    const anonymous = listen(feed);
    await commit(feed, { topic: 'mine', profileId: 'sakura' }, { topic: 'theirs', profileId: 'momiji' }, { topic: 'shared' });
    assert.deepEqual(sakura.topics(), ['mine', 'shared']);
    assert.deepEqual(momiji.topics(), ['theirs', 'shared']);
    assert.deepEqual(anonymous.topics(), ['shared']);
  });

  it('resynchronizes a new subscription and gives its current position', async () => {
    const feed = feedWith();
    await commit(feed, { topic: 'before' });
    const { subscription } = listen(feed);
    assert.equal(subscription.start.kind, 'resync');
    assert.ok(subscription.start.kind === 'resync');
    assert.equal(subscription.start.reason, 'new_subscription');
    assert.match(subscription.start.position, /^[A-Za-z0-9_-]{12}\.1$/);
  });

  it('replays the latest missed change of each topic visible to the subscriber, in commit order', async () => {
    const feed = feedWith();
    const first = listen(feed, { profileId: 'sakura' });
    await commit(feed, { topic: 'seen' });
    const position = first.received[0]?.id;
    first.subscription.close();

    await commit(feed, { topic: 'decks' }, { topic: 'sessions', profileId: 'sakura' }, { topic: 'other', profileId: 'momiji' });
    await commit(feed, { topic: 'decks' });
    const resumed = listen(feed, { profileId: 'sakura', lastEventId: position });
    assert.ok(resumed.subscription.start.kind === 'replay');
    const replayed = resumed.subscription.start.events;
    assert.deepEqual(
      replayed.map((event) => event.topic),
      ['sessions', 'decks'],
    );
    assert.equal(replayed[1]?.id.split('.')[1], '5');

    const upToDate = listen(feed, { lastEventId: replayed[1]?.id });
    assert.deepEqual(upToDate.subscription.start, { kind: 'replay', events: [] });
  });

  it('resynchronizes a position it cannot resume: another stream, outside the window, or unknown', async () => {
    const limits = { retainedChanges: 3 };
    const feed = feedWith(limits);
    const probe = listen(feed);
    await commit(feed, ...['a', 'b', 'c', 'd', 'e'].map((topic) => ({ topic })));
    const ids = probe.received.map((event) => event.id);
    const stream = ids[0]?.split('.')[0] as string;
    const start = (lastEventId: string) => listen(feed, { lastEventId }).subscription.start;

    // Changes 3 to 5 are kept: resuming after 2 misses nothing, after 1 would miss change 2.
    const kept = start(`${stream}.2`);
    assert.deepEqual(kept.kind === 'replay' && kept.events.map((event) => event.topic), ['c', 'd', 'e']);
    assert.deepEqual(start(`${stream}.1`), { kind: 'resync', reason: 'too_far_behind', position: ids[4] });

    // Another process numbers its own stream: positions of the previous one mean nothing.
    const restarted = feedWith(limits);
    const after = listen(restarted, { lastEventId: ids[4] }).subscription.start;
    assert.equal(after.kind === 'resync' && after.reason, 'server_restarted');

    for (const unknown of [`${stream}.6`, `${stream}.x`, 'garbage', '.3', `${stream}.1234567890123456`]) {
      const refused = start(unknown);
      assert.equal(refused.kind === 'resync' && refused.reason, 'unknown_position', unknown);
    }
  });

  it('bounds the subscriptions and frees the place of a closed one', async () => {
    const feed = feedWith({ maxSubscribers: 2 });
    const first = listen(feed);
    listen(feed);
    assert.equal(feed.subscribe({ deliver: () => {}, end: () => {} }), undefined);
    first.subscription.close();
    first.subscription.close();
    assert.ok(feed.subscribe({ deliver: () => {}, end: () => {} }));
    await commit(feed, { topic: 'after-close' });
    assert.deepEqual(first.received, []);
  });

  it('ends the subscriptions of the sessions a change ends, after telling them', async () => {
    const feed = feedWith();
    const ended = listen(feed, { profileId: 'sakura', sessionId: 's1' });
    const kept = listen(feed, { profileId: 'sakura', sessionId: 's2' });
    await commit(feed, { topic: 'sessions', profileId: 'sakura', endsSessions: ['s1'] });
    await commit(feed, { topic: 'later', profileId: 'sakura' });
    assert.deepEqual(ended.topics(), ['sessions']);
    assert.equal(ended.ended(), 1);
    assert.deepEqual(kept.topics(), ['sessions', 'later']);
    assert.equal(kept.ended(), 0);
  });

  it('ends every subscription when closed, then refuses new ones and announces nothing', async () => {
    const feed = feedWith();
    const listener = listen(feed);
    await database.write(async (transaction) => {
      feed.publish(transaction, { topic: 'committed-after-close' });
      feed.close();
    });
    assert.equal(listener.ended(), 1);
    assert.deepEqual(listener.received, []);
    assert.equal(feed.subscribe({ deliver: () => {}, end: () => {} }), undefined);
  });

  it('refuses a malformed topic as a programming error', async () => {
    const feed = feedWith();
    await assert.rejects(commit(feed, { topic: 'Not a topic' }), /Invalid change topic/);
  });
});

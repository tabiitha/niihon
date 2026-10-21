import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createWriteGate, DatabaseBusyError, DatabaseClosedError } from './write-gate.ts';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('write gate', () => {
  it('runs writes one at a time, in arrival order', async () => {
    const gate = createWriteGate({ maxWaitMs: 1_000, maxQueued: 10 });
    const events: string[] = [];
    let running = 0;
    const write = (id: string) =>
      gate.run(async () => {
        running += 1;
        assert.equal(running, 1, 'two writes overlapped');
        events.push(`start ${id}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`end ${id}`);
        running -= 1;
        return id;
      });
    assert.deepEqual(await Promise.all([write('a'), write('b'), write('c')]), ['a', 'b', 'c']);
    assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('lets the next write proceed after a failed one', async () => {
    const gate = createWriteGate({ maxWaitMs: 1_000, maxQueued: 10 });
    await assert.rejects(
      gate.run(() => Promise.reject(new Error('boom'))),
      /boom/,
    );
    await assert.rejects(
      gate.run(() => {
        throw new Error('sync boom');
      }),
      /sync boom/,
    );
    assert.equal(await gate.run(() => Promise.resolve('next')), 'next');
  });

  it('fails a write that waits longer than the limit, without disturbing the others', async () => {
    const gate = createWriteGate({ maxWaitMs: 20, maxQueued: 10 });
    const blocker = deferred();
    const first = gate.run(() => blocker.promise);
    const waiting = gate.run(() => Promise.resolve('late'));
    await assert.rejects(waiting, DatabaseBusyError);
    blocker.resolve();
    await first;
    assert.equal(await gate.run(() => Promise.resolve('after')), 'after');
  });

  it('refuses a write immediately when the queue is full', async () => {
    const gate = createWriteGate({ maxWaitMs: 1_000, maxQueued: 1 });
    const blocker = deferred();
    const first = gate.run(() => blocker.promise);
    const queued = gate.run(() => Promise.resolve('queued'));
    await assert.rejects(gate.run(() => Promise.resolve('refused')), DatabaseBusyError);
    blocker.resolve();
    await first;
    assert.equal(await queued, 'queued');
  });

  it('on close, finishes the running write and refuses the waiting and new ones', async () => {
    const gate = createWriteGate({ maxWaitMs: 1_000, maxQueued: 10 });
    const blocker = deferred();
    let finished = false;
    const running = gate.run(async () => {
      await blocker.promise;
      finished = true;
    });
    const waiting = gate.run(() => Promise.resolve());
    const closed = gate.close();
    await assert.rejects(waiting, DatabaseClosedError);
    await assert.rejects(gate.run(() => Promise.resolve()), DatabaseClosedError);
    blocker.resolve();
    await closed;
    await running;
    assert.equal(finished, true);
  });
});

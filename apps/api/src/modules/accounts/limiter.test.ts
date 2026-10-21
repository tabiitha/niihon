import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLimiter, LimiterFullError } from './limiter.ts';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('limiter', () => {
  it('runs at most `concurrency` jobs at once and queues the rest in order', async () => {
    const limiter = createLimiter({ concurrency: 2, maxQueued: 10 });
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const gates = Array.from({ length: 5 }, deferred);
    const jobs = gates.map((gate, index) =>
      limiter.run(async () => {
        order.push(index);
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, [0, 1]);
    for (const gate of gates) {
      gate.release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all(jobs);
    assert.equal(peak, 2);
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
  });

  it('refuses at once when the queue is full, and recovers', async () => {
    const limiter = createLimiter({ concurrency: 1, maxQueued: 1 });
    const gate = deferred();
    const first = limiter.run(() => gate.promise);
    const second = limiter.run(async () => 'second');
    await assert.rejects(limiter.run(async () => 'third'), LimiterFullError);
    gate.release();
    await first;
    assert.equal(await second, 'second');
    assert.equal(await limiter.run(async () => 'later'), 'later');
  });

  it('frees the slot when a job fails', async () => {
    const limiter = createLimiter({ concurrency: 1, maxQueued: 0 });
    await assert.rejects(
      limiter.run(async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.equal(await limiter.run(async () => 'ok'), 'ok');
  });
});

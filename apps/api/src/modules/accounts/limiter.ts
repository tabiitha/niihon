/** The work was refused because too much of it is already running or waiting. */
export class LimiterFullError extends Error {
  override name = 'LimiterFullError';
}

export interface Limiter {
  /** Runs `work` once a slot is free; fails with `LimiterFullError` at once when the queue is full. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Bounds expensive work: at most `concurrency` run at once and `maxQueued` wait in arrival order.
 * Used for password hashing and provider exchanges so a burst cannot exhaust memory or sockets.
 */
export function createLimiter({ concurrency, maxQueued }: { concurrency: number; maxQueued: number }): Limiter {
  let running = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    const next = waiting.shift();
    if (next === undefined) {
      running -= 1;
    } else {
      next(); // the slot passes to the next waiter
    }
  };

  return {
    async run(work) {
      if (running >= concurrency) {
        if (waiting.length >= maxQueued) {
          throw new LimiterFullError('Too much work is waiting.');
        }
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        running += 1;
      }
      try {
        return await work();
      } finally {
        release();
      }
    },
  };
}

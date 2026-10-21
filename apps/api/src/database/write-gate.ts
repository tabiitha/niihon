/** A write waited longer than allowed, or too many writes were already waiting. */
export class DatabaseBusyError extends Error {
  override name = 'DatabaseBusyError';
}

/** The database is closing or closed; no further write is accepted. */
export class DatabaseClosedError extends Error {
  override name = 'DatabaseClosedError';
}

export interface WriteGateLimits {
  /** Longest wait for the turn of a write before it fails with `DatabaseBusyError`. */
  readonly maxWaitMs: number;
  /** Writes allowed to wait at once; a further write fails immediately with `DatabaseBusyError`. */
  readonly maxQueued: number;
}

export interface WriteGate {
  /** Runs `task` once every earlier write has finished, in arrival order. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Refuses new and waiting writes, then resolves once the running write has finished. */
  close(): Promise<void>;
}

interface Waiter {
  readonly start: () => void;
  readonly fail: (error: Error) => void;
}

/**
 * Serializes writes on the single writer connection. SQLite allows one writer at a time; queuing
 * here keeps waiting bounded and in order instead of relying on lock retries.
 */
export function createWriteGate({ maxWaitMs, maxQueued }: WriteGateLimits): WriteGate {
  const queue: Waiter[] = [];
  // Set synchronously when a write gets its turn, and handed over directly to the next waiter.
  let busy = false;
  let closed = false;
  let onIdle: (() => void) | undefined;

  const release = () => {
    const waiter = queue.shift();
    if (waiter === undefined) {
      busy = false;
      onIdle?.();
    } else {
      waiter.start();
    }
  };

  const turn = (): Promise<void> => {
    if (closed) {
      return Promise.reject(new DatabaseClosedError('The database is closing.'));
    }
    if (!busy) {
      busy = true;
      return Promise.resolve();
    }
    if (queue.length >= maxQueued) {
      return Promise.reject(new DatabaseBusyError(`${maxQueued} writes are already waiting.`));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        start: () => {
          clearTimeout(timer);
          resolve();
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        queue.splice(queue.indexOf(waiter), 1);
        reject(new DatabaseBusyError(`A write waited more than ${maxWaitMs} ms for its turn.`));
      }, maxWaitMs);
      queue.push(waiter);
    });
  };

  return {
    async run(task) {
      await turn();
      try {
        return await task();
      } finally {
        release();
      }
    },
    async close() {
      closed = true;
      for (const waiter of queue.splice(0)) {
        waiter.fail(new DatabaseClosedError('The database is closing.'));
      }
      if (busy) {
        await new Promise<void>((resolve) => {
          onIdle = resolve;
        });
      }
    },
  };
}

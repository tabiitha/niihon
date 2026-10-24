import type { Response } from 'express';

import type { ChangeEvent, SubscriptionStart } from '../../changes/feed.ts';
import type { Logger } from '../../log.ts';
import { streamDefaults } from './contract.ts';

export interface StreamLimits {
  /** A comment line is sent this often, so idle connections stay open and dead ones are detected. */
  readonly heartbeatMs: number;
  /** Events waiting for a subscriber that does not read, after merging those of the same topic, before it is disconnected. */
  readonly maxQueuedEvents: number;
  /** A subscriber whose connection accepts nothing for this long is disconnected. */
  readonly drainTimeoutMs: number;
  /** Reconnection delay suggested to `EventSource` (`retry:`). */
  readonly retryMs: number;
}

export const defaultStreamLimits: StreamLimits = streamDefaults;

export interface EventWriter {
  open(start: SubscriptionStart, hooks: { readonly onHeartbeat: () => void; readonly onClose: () => void }): void;
  change(event: ChangeEvent): void;
  end(): void;
}

/**
 * Writes the stream with backpressure. While the connection does not accept more, events wait in
 * a queue where a newer event replaces an older one of the same topic, since both only ask to
 * reread it; a subscriber that still falls behind is disconnected and resumes from its position.
 */
export function createEventWriter(response: Response, limits: StreamLimits, logger: Logger): EventWriter {
  const pending: ChangeEvent[] = [];
  let opened = false;
  let blocked = false;
  let finished = false;
  let heartbeat: NodeJS.Timeout | undefined;
  let stalled: NodeJS.Timeout | undefined;
  let onClose = () => {};

  const write = (chunk: string) => {
    if (!response.write(chunk) && !blocked) {
      blocked = true;
      stalled = setTimeout(() => drop('stalled'), limits.drainTimeoutMs);
    }
  };

  const frame = (event: string, id: string, data: unknown) => `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

  const send = (event: ChangeEvent) => {
    write(frame('change', event.id, { topic: event.topic, occurredAt: event.occurredAt.toISOString() }));
  };

  const finish = () => {
    if (!finished) {
      finished = true;
      clearInterval(heartbeat);
      clearTimeout(stalled);
      pending.length = 0;
      onClose();
    }
  };

  const drop = (reason: 'stalled' | 'queue_full') => {
    if (!finished) {
      logger('warn', 'changes.subscriber_dropped', { reason, requestId: response.locals['requestId'] });
      response.destroy();
      finish();
    }
  };

  const enqueue = (event: ChangeEvent) => {
    if (finished) {
      return;
    }
    if (!blocked && opened) {
      send(event);
      return;
    }
    const same = pending.findIndex((waiting) => waiting.topic === event.topic);
    if (same !== -1) {
      pending.splice(same, 1);
    }
    pending.push(event);
    if (pending.length > limits.maxQueuedEvents) {
      drop('queue_full');
    }
  };

  return {
    open(start, hooks) {
      onClose = hooks.onClose;
      response.on('close', finish);
      response.on('drain', () => {
        blocked = false;
        clearTimeout(stalled);
        while (!blocked && pending.length > 0) {
          send(pending.shift() as ChangeEvent);
        }
      });
      response.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      opened = true;
      write(`retry: ${limits.retryMs}\n\n`);
      if (start.kind === 'resync') {
        write(frame('resync', start.position, { reason: start.reason }));
      } else {
        start.events.forEach(enqueue);
      }
      heartbeat = setInterval(() => {
        if (!blocked) {
          write(': keep-alive\n\n');
        }
        hooks.onHeartbeat();
      }, limits.heartbeatMs);
    },
    change: enqueue,
    end() {
      if (!finished) {
        if (opened) {
          response.end();
        }
        finish();
      }
    },
  };
}

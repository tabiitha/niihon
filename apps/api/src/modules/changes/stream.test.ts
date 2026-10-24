import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import type { Response } from 'express';

import type { ChangeEvent } from '../../changes/feed.ts';
import { createEventWriter, defaultStreamLimits, type StreamLimits } from './stream.ts';

/** Stands in for the HTTP response: records what is written and accepts more while `accepting`. */
class FakeResponse extends EventEmitter {
  readonly chunks: string[] = [];
  readonly locals = { requestId: 'req-1' };
  statusCode = 0;
  headers: Record<string, string> = {};
  accepting = true;
  ended = false;
  destroyed = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  set(headers: Record<string, string>) {
    this.headers = { ...this.headers, ...headers };
    return this;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.chunks.push(chunk);
    return this.accepting;
  }
  end() {
    this.ended = true;
    this.emit('close');
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
  /** The `change` events written so far, as `topic@sequence`. */
  changes() {
    return this.chunks
      .filter((chunk) => chunk.startsWith('event: change'))
      .map((chunk) => `${JSON.parse(chunk.split('data: ')[1] as string).topic}@${chunk.split('\n')[1]?.split('.')[1]}`);
  }
}

let sequence = 0;
const event = (topic: string): ChangeEvent => ({ id: `stream.${(sequence += 1)}`, topic, occurredAt: new Date('2026-10-24T08:00:00.000Z') });

function writerFor(limits: Partial<StreamLimits> = {}) {
  sequence = 0;
  const response = new FakeResponse();
  const logs: string[] = [];
  let closed = 0;
  let heartbeats = 0;
  const writer = createEventWriter(response as unknown as Response, { ...defaultStreamLimits, ...limits }, (_level, name, fields) =>
    logs.push(`${name}:${String(fields?.['reason'])}`),
  );
  return {
    response,
    logs,
    writer,
    closed: () => closed,
    heartbeats: () => heartbeats,
    open: (start: Parameters<typeof writer.open>[0] = { kind: 'replay', events: [] }) =>
      writer.open(start, { onHeartbeat: () => (heartbeats += 1), onClose: () => (closed += 1) }),
  };
}

describe('event stream writer', () => {
  it('opens an uncached event stream with a reconnection delay, then a resync event at the current position', () => {
    const { response, writer, open } = writerFor();
    open({ kind: 'resync', reason: 'new_subscription', position: 'stream.7' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.headers, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    assert.deepEqual(response.chunks, ['retry: 2000\n\n', 'event: resync\nid: stream.7\ndata: {"reason":"new_subscription"}\n\n']);
    writer.change({ id: 'stream.8', topic: 'sessions', occurredAt: new Date('2026-10-24T08:00:00.000Z') });
    assert.equal(response.chunks[2], 'event: change\nid: stream.8\ndata: {"topic":"sessions","occurredAt":"2026-10-24T08:00:00.000Z"}\n\n');
    writer.end();
  });

  it('queues while the connection is full, keeping only the newest event of each topic, and flushes on drain', () => {
    const { response, writer, open } = writerFor();
    open({ kind: 'replay', events: [event('decks')] });
    response.accepting = false;
    writer.change(event('a'));
    writer.change(event('b'));
    writer.change(event('a'));
    writer.change(event('c'));
    writer.change(event('b'));
    response.accepting = true;
    response.emit('drain');
    assert.deepEqual(response.changes(), ['decks@1', 'a@2', 'a@4', 'c@5', 'b@6']);
    writer.end();
  });

  it('disconnects a subscriber that still falls behind, freeing its queue and subscription', () => {
    const { response, writer, open, logs, closed } = writerFor({ maxQueuedEvents: 3 });
    open();
    response.accepting = false;
    writer.change(event('blocks'));
    for (const topic of ['t1', 't2', 't3', 't1']) {
      writer.change(event(topic));
    }
    assert.equal(response.destroyed, false, 'merged events do not count twice');
    writer.change(event('t4'));
    assert.equal(response.destroyed, true);
    assert.equal(closed(), 1);
    assert.deepEqual(logs, ['changes.subscriber_dropped:queue_full']);
    writer.change(event('after'));
    response.emit('drain');
    assert.deepEqual(response.changes(), ['blocks@1']);
  });

  it('disconnects a subscriber whose connection accepts nothing for too long', async () => {
    const { response, writer, open, logs, closed } = writerFor({ drainTimeoutMs: 20 });
    open();
    response.accepting = false;
    writer.change(event('stuck'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(response.destroyed, true);
    assert.equal(closed(), 1);
    assert.deepEqual(logs, ['changes.subscriber_dropped:stalled']);
  });

  it('keeps a connection that drains in time', async () => {
    const { response, writer, open } = writerFor({ drainTimeoutMs: 40 });
    open();
    response.accepting = false;
    writer.change(event('slow'));
    response.accepting = true;
    response.emit('drain');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(response.destroyed, false);
    writer.end();
  });

  it('sends a comment line on each heartbeat and stops everything once ended', async () => {
    const { response, writer, open, heartbeats, closed } = writerFor({ heartbeatMs: 10 });
    open();
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.ok(heartbeats() >= 2);
    assert.ok(response.chunks.includes(': keep-alive\n\n'));
    writer.end();
    writer.end();
    const count = heartbeats();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(heartbeats(), count);
    assert.equal(response.ended, true);
    assert.equal(closed(), 1);
  });

  it('frees everything when the client goes away', () => {
    const { response, writer, open, closed } = writerFor();
    open();
    response.emit('close');
    writer.change(event('gone'));
    assert.equal(closed(), 1);
    assert.deepEqual(response.changes(), []);
  });
});

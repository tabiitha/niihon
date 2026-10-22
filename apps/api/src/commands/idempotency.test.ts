import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import express from 'express';

import { domainRefusal, postCommand, recordEffect, startCommandApp, type CommandApp } from '../../test/fixtures/command-app.ts';
import { addOperation } from '../contract/operation.ts';
import { DatabaseBusyError } from '../database/write-gate.ts';
import { unusedDatabase } from '../../test/fixtures/unused-database.ts';
import { canonicalJson, createCommands } from './idempotency.ts';

const newKey = () => randomUUID();

describe('idempotent commands', () => {
  let app: CommandApp;
  beforeEach(async () => {
    app = await startCommandApp();
  });
  afterEach(() => app.stop());

  it('runs a command without a key every time, as before', async () => {
    assert.equal((await app.post('/effects', { label: 'a' })).status, 201);
    assert.equal((await app.post('/effects', { label: 'a' })).status, 201);
    assert.equal(await app.effects(), 2);
    assert.equal(await app.records(), 0);
  });

  it('answers a retry after the commit with the confirmed response, without repeating the effect', async () => {
    const key = newKey();
    const first = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('idempotent-replayed'), null);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retry = await app.post('/effects', { label: 'a' }, { key });
      assert.equal(retry.status, 201);
      assert.deepEqual(retry.body, first.body);
      assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    }
    assert.equal(await app.effects(), 1);
    assert.equal(await app.records(), 1);
  });

  it('treats inputs that differ only by key order as the same command', async () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } }), '{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}');
    const key = newKey();
    const first = await app.post('/effects', { label: 'a' }, { key });
    const retry = await app.post('/effects', JSON.parse('{"label":"a"}'), { key });
    assert.deepEqual(retry.body, first.body);
  });

  it('refuses a key reused with other content, another operation, or another caller, and does nothing', async () => {
    const key = newKey();
    const first = await app.post('/effects', { label: 'a' }, { key, caller: 'profile:one' });
    assert.equal(first.status, 201);

    const reuses = [
      await app.post('/effects', { label: 'b' }, { key, caller: 'profile:one' }),
      await app.post('/other-effects', { label: 'a' }, { key, caller: 'profile:one' }),
      await app.post('/effects', { label: 'a' }, { key, caller: 'profile:two' }),
      await app.post('/effects', { label: 'a' }, { key }),
    ];
    for (const reuse of reuses) {
      assert.equal(reuse.status, 422);
      assert.equal(reuse.body.error.code, 'idempotency_key_reused');
      // The refusal discloses nothing about the original command.
      assert.ok(!JSON.stringify(reuse.body).includes(first.body.id));
    }
    assert.equal(await app.effects(), 1);
    // The rightful retry still gets its response.
    assert.deepEqual((await app.post('/effects', { label: 'a' }, { key, caller: 'profile:one' })).body, first.body);
  });

  it('refuses a malformed key before doing anything', async () => {
    for (const key of ['short', 'has space inside the key', 'x'.repeat(65), 'quoted"key"value!!', `${newKey()}, ${newKey()}`]) {
      const response = await app.post('/effects', { label: 'a' }, { key });
      assert.equal(response.status, 400, key);
      assert.equal(response.body.error.code, 'validation_failed');
      assert.deepEqual(response.body.error.issues.map((issue: { path: string }) => issue.path), ['header.Idempotency-Key']);
    }
    assert.equal(await app.effects(), 0);
  });

  it('lets one of many concurrent requests with the same key run, and gives the others its result or a retryable refusal', async () => {
    const key = newKey();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.hooks.beforeCommit = () => held;
    const first = app.post('/effects', { label: 'a' }, { key });
    // Wait until the first request is inside its handler, then race it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const racing = await Promise.all(Array.from({ length: 10 }, () => app.post('/effects', { label: 'a' }, { key })));
    for (const response of racing) {
      assert.equal(response.status, 409);
      assert.equal(response.body.error.code, 'idempotency_key_in_use');
      assert.equal(response.headers.get('retry-after'), '1');
    }
    release();
    const committed = await first;
    assert.equal(committed.status, 201);
    delete app.hooks.beforeCommit;

    const afterwards = await Promise.all(Array.from({ length: 10 }, () => app.post('/effects', { label: 'a' }, { key })));
    for (const response of afterwards) {
      assert.ok(response.status === 201 || response.status === 409, String(response.status));
      if (response.status === 201) {
        assert.deepEqual(response.body, committed.body);
      }
    }
    assert.deepEqual((await app.post('/effects', { label: 'a' }, { key })).body, committed.body);
    assert.equal(await app.effects(), 1);
  });

  it('runs concurrent commands with different keys independently', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => app.post('/effects', { label: `e${index}` }, { key: newKey() })));
    assert.ok(responses.every((response) => response.status === 201));
    assert.equal(await app.effects(), 20);
    assert.equal(await app.records(), 20);
  });

  it('keeps a command that failed before its commit replayable: nothing was stored, and the retry runs it once', async () => {
    const key = newKey();
    app.hooks.insideCommit = () => {
      throw new Error('crash inside the transaction');
    };
    const failed = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(failed.status, 500);
    assert.equal(await app.effects(), 0);
    assert.equal(await app.records(), 0);

    app.hooks.insideCommit = () => {
      throw new DatabaseBusyError('busy');
    };
    const busy = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(busy.status, 503);
    assert.equal(busy.body.error.code, 'database_busy');
    assert.equal(await app.effects(), 0);

    delete app.hooks.insideCommit;
    const retry = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), null);
    assert.equal(await app.effects(), 1);
  });

  it('does not store a domain refusal, so the same key is decided again', async () => {
    const key = newKey();
    app.hooks.beforeCommit = () => {
      throw domainRefusal();
    };
    const refused = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'fixture_refused');
    delete app.hooks.beforeCommit;
    assert.equal((await app.post('/effects', { label: 'a' }, { key })).status, 201);
    assert.equal(await app.effects(), 1);
  });

  it('answers the confirmed result when the response of a committed command was lost', async () => {
    const key = newKey();
    app.hooks.afterCommit = () => {
      throw new Error('lost after the commit');
    };
    assert.equal((await app.post('/effects', { label: 'a' }, { key })).status, 500);
    delete app.hooks.afterCommit;
    const retry = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    assert.equal(retry.body.label, 'a');
    assert.equal(await app.effects(), 1);
  });

  it('keeps the confirmed result across a restart, and refuses rather than repeats when the installation key changed', async () => {
    const key = newKey();
    const first = await app.post('/effects', { label: 'a' }, { key });
    const { dataDir } = app;
    await app.stop({ keepData: true });

    app = await startCommandApp({ dataDir });
    const retry = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(retry.status, 201);
    assert.deepEqual(retry.body, first.body);
    await app.stop({ keepData: true });

    app = await startCommandApp({ dataDir, key: randomBytes(32) });
    const withOtherKey = await app.post('/effects', { label: 'a' }, { key });
    assert.equal(withOtherKey.status, 422);
    assert.equal(await app.effects(), 1);
  });

  it('refuses a response too large to store and rolls the effect back', async () => {
    const response = await app.post('/large-effects', undefined, { key: newKey() });
    assert.equal(response.status, 500);
    assert.equal(await app.effects(), 0);
    assert.equal(await app.records(), 0);
  });
});

describe('retention and bounds', () => {
  let app: CommandApp | undefined;
  afterEach(() => app?.stop());

  it('forgets a command after the retention, then purges expired records in batches', async () => {
    let clock = Date.parse('2026-10-22T10:00:00.000Z');
    app = await startCommandApp({ now: () => new Date(clock), limits: { retentionMs: 60_000, purgeBatch: 2 } });
    const key = newKey();
    await app.post('/effects', { label: 'a' }, { key });
    for (let index = 0; index < 4; index += 1) {
      await app.post('/effects', { label: `old${index}` }, { key: newKey() });
    }
    assert.equal(await app.records(), 5);

    clock += 59_999;
    assert.equal((await app.post('/effects', { label: 'b' }, { key })).status, 422);

    clock += 1;
    // The key is reusable once its record expired; this command also purges expired records.
    const reused = await app.post('/effects', { label: 'b' }, { key });
    assert.equal(reused.status, 201);
    assert.equal(reused.headers.get('idempotent-replayed'), null);
    // The reused key's old record and two more expired ones are gone; the new record was added.
    assert.equal(await app.records(), 3);
    await app.post('/effects', { label: 'c' }, { key: newKey() });
    assert.equal(await app.records(), 2);
    assert.equal(await app.effects(), 7);
  });

  it('purges only expired records and keeps every unexpired proof', async () => {
    let clock = Date.parse('2026-10-22T10:00:00.000Z');
    app = await startCommandApp({ now: () => new Date(clock), limits: { retentionMs: 60_000, purgeBatch: 100 } });
    const oldKeys: string[] = [newKey(), newKey()];
    for (const key of oldKeys) {
      await app.post('/effects', { label: 'old' }, { key });
    }
    clock += 30_000;
    const liveKey = newKey();
    const live = await app.post('/effects', { label: 'live' }, { key: liveKey });
    clock += 30_000;
    // The first two expired a moment ago, the third has 30 s left; this command purges.
    await app.post('/effects', { label: 'new' }, { key: newKey() });
    const kept = await app.database.reader.idempotencyRecord.findMany({ select: { key: true } });
    assert.equal(kept.length, 2);
    assert.ok(kept.some((record) => record.key === liveKey));
    assert.ok(!kept.some((record) => oldKeys.includes(record.key)));
    assert.deepEqual((await app.post('/effects', { label: 'live' }, { key: liveKey })).body, live.body);
  });

  it('refuses a keyed command when the records are full, without doing it, while unkeyed commands still run', async () => {
    app = await startCommandApp({ limits: { maxRecords: 2 } });
    await app.post('/effects', { label: 'a' }, { key: newKey() });
    await app.post('/effects', { label: 'b' }, { key: newKey() });
    let handled = 0;
    app.hooks.beforeCommit = () => {
      handled += 1;
    };
    const full = await app.post('/effects', { label: 'c' }, { key: newKey() });
    // Refused before the handler runs, so no work a domain does before its commit is spent.
    assert.equal(handled, 0);
    delete app.hooks.beforeCommit;
    assert.equal(full.status, 503);
    assert.equal(full.body.error.code, 'idempotency_capacity_reached');
    assert.equal(full.headers.get('retry-after'), '60');
    assert.equal(await app.effects(), 2);
    assert.equal((await app.post('/effects', { label: 'c' })).status, 201);
  });

  it('counts only unexpired records against the bound, even before the expired ones are purged', async () => {
    let clock = Date.parse('2026-10-22T10:00:00.000Z');
    app = await startCommandApp({ now: () => new Date(clock), limits: { maxRecords: 2, purgeBatch: 1, retentionMs: 60_000 } });
    for (const label of ['a', 'b']) {
      await app.post('/effects', { label }, { key: newKey() });
    }
    await app.database.write((transaction) =>
      transaction.idempotencyRecord.createMany({
        data: Array.from({ length: 5 }, (_, index) => ({
          key: `expired-record-key-${index}`,
          caller: 'anonymous',
          operation: 'recordEffect',
          fingerprint: '0'.repeat(64),
          status: 201,
          response: '{}',
          createdAt: new Date(clock - 120_000),
          expiresAt: new Date(clock - 60_000),
        })),
      }),
    );
    clock += 60_000;
    // The two live records expired now too; seven expired records remain after this command's purge of one.
    assert.equal((await app.post('/effects', { label: 'c' }, { key: newKey() })).status, 201);
    assert.equal((await app.post('/effects', { label: 'd' }, { key: newKey() })).status, 201);
    assert.equal(await app.records(), 7);
    assert.equal((await app.post('/effects', { label: 'e' }, { key: newKey() })).body.error.code, 'idempotency_capacity_reached');
  });

  it('refuses to add an idempotent operation without the command layer, or one with several success responses', () => {
    const router = express.Router();
    assert.throws(() => addOperation(router, recordEffect), /must be added with context.commands.add/);
    const commands = createCommands({ database: unusedDatabase });
    assert.throws(
      () => commands.add(router, { ...recordEffect, responses: { ...recordEffect.responses, 200: recordEffect.responses[201] } }),
      /exactly one success response/,
    );
    assert.throws(() => commands.add(router, { ...recordEffect, idempotent: false }), /declared idempotent/);
  });
});

describe('crash of the server process', () => {
  const crashFixture = fileURLToPath(new URL('../../test/fixtures/command-crash.ts', import.meta.url));
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nihon-command-crash-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  /** Starts the fixture server, sends one keyed command, and kills the process at `point`. */
  async function crashDuringCommand(dataDir: string, point: 'inside' | 'after', key: string): Promise<void> {
    const child = spawn(process.execPath, [crashFixture, dataDir, point], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const lines = createInterface({ input: child.stdout! });
    const expected = point === 'inside' ? 'fixture.inside' : 'fixture.committed';
    let pending: Promise<unknown> | undefined;
    try {
      for await (const line of lines) {
        const { event, port } = JSON.parse(line) as { event: string; port?: number };
        if (event === 'fixture.listening') {
          // The response never comes: the process dies first.
          pending = postCommand(port!, '/effects', { label: 'crash' }, { key }).catch(() => undefined);
        } else if (event === expected) {
          break;
        }
      }
    } finally {
      child.kill('SIGKILL');
      await exited;
      await pending;
    }
  }

  it('leaves nothing when killed before the commit, so the retry after restart runs the command once', async () => {
    const dataDir = join(root, 'data');
    const key = newKey();
    await crashDuringCommand(dataDir, 'inside', key);

    const app = await startCommandApp({ dataDir });
    try {
      assert.equal(await app.effects(), 0);
      assert.equal(await app.records(), 0);
      const retry = await app.post('/effects', { label: 'crash' }, { key });
      assert.equal(retry.status, 201);
      assert.equal(retry.headers.get('idempotent-replayed'), null);
      assert.equal(await app.effects(), 1);
    } finally {
      await app.stop({ keepData: true });
    }
  });

  it('keeps the confirmed result when killed after the commit, so the retry after restart returns it without a second effect', async () => {
    const dataDir = join(root, 'data');
    const key = newKey();
    await crashDuringCommand(dataDir, 'after', key);

    const app = await startCommandApp({ dataDir });
    try {
      assert.equal(await app.effects(), 1);
      const retry = await app.post('/effects', { label: 'crash' }, { key });
      assert.equal(retry.status, 201);
      assert.equal(retry.headers.get('idempotent-replayed'), 'true');
      assert.equal(retry.body.label, 'crash');
      assert.equal(await app.effects(), 1);
      assert.equal((await app.post('/effects', { label: 'other' }, { key })).status, 422);
    } finally {
      await app.stop({ keepData: true });
    }
  });
});

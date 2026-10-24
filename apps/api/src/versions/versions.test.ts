import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import express from 'express';
import { z } from 'zod';

import { errorResponseSchema } from '../contract/conventions.ts';
import { addEventStream, addOperation, defineOperation } from '../contract/operation.ts';
import {
  readWithVersion,
  startVersionedApp,
  type Answer,
  type VersionedApp,
} from '../../test/fixtures/versioned-app.ts';
import { formatVersion, initialVersion, maxVersion, parseIfMatch, parseVersion, versionSchema } from './token.ts';
import { requireWritten, versionConflict } from './versions.ts';

const errorOf = (answer: Answer) => errorResponseSchema.parse(answer.body).error;

describe('version tokens', () => {
  it('round-trips the stored versions clients can name', () => {
    for (const version of [initialVersion, 2, 41, maxVersion]) {
      assert.equal(parseVersion(formatVersion(version)), version);
      assert.equal(versionSchema.safeParse(formatVersion(version)).success, true);
    }
    assert.equal(formatVersion(maxVersion + 1), `v${maxVersion + 1}`, 'the last write still fits a 32-bit integer');
  });

  it('refuses a version that no stored aggregate can have', () => {
    assert.throws(() => formatVersion(0), RangeError);
    assert.throws(() => formatVersion(1.5), RangeError);
    assert.throws(() => formatVersion(maxVersion + 2), RangeError);
    for (const token of ['', 'v', 'v0', 'v01', 'v-1', '3', 'V3', 'v3 ', 'v1.5', `v${maxVersion + 1}`, 'v99999999999']) {
      assert.equal(parseVersion(token), undefined, token);
    }
  });

  it('reads one quoted version from If-Match and nothing else', () => {
    assert.equal(parseIfMatch('"v3"'), 3);
    for (const value of ['v3', '*', 'W/"v3"', '"v3", "v4"', '"v3""', '""', '"', '', '"v0"', ' "v3"']) {
      assert.equal(parseIfMatch(value), undefined, value);
    }
  });
});

describe('conditional writes', () => {
  it('accepts exactly one changed row', () => {
    assert.doesNotThrow(() => requireWritten(1));
    assert.doesNotThrow(() => requireWritten({ count: 1 }));
  });

  it('raises the explicit conflict when no row changed', () => {
    for (const result of [0, { count: 0 }]) {
      assert.throws(
        () => requireWritten(result),
        (error: unknown) => {
          assert.deepEqual(error, versionConflict());
          assert.equal((error as { status: number }).status, 412);
          assert.equal((error as { code: string }).code, 'version_conflict');
          return true;
        },
      );
    }
  });

  it('refuses to commit a write that changed several aggregates', () => {
    assert.throws(() => requireWritten(2), /exactly one aggregate/);
    assert.throws(() => requireWritten({ count: 3 }), /exactly one aggregate/);
  });

  it('rejects an operation that reads or streams yet expects a version', () => {
    assert.throws(() => addOperation(express.Router(), readWithVersion), /cannot expect a version/);
    const stream = defineOperation({
      operationId: 'followVersioned',
      method: 'get',
      path: '/stream',
      summary: 'Follow',
      expectsVersion: true,
      responses: { 200: { description: 'Events', events: { change: z.object({}) } } },
    });
    assert.throws(() => addEventStream(express.Router(), stream), /not a bodiless event stream/);
  });
});

describe('a conflict inside a write transaction', () => {
  let app: VersionedApp;
  before(async () => {
    app = await startVersionedApp();
  });
  after(() => app.stop());

  it('roll back together: a write that lost the comparison undoes everything the transaction did', async () => {
    const note = await app.newNote('raced');
    const before = await app.count('FixtureNoteLog');

    await assert.rejects(
      app.database.write(async (transaction) => {
        await transaction.$executeRaw`INSERT INTO "FixtureNoteLog" ("noteId", "title") VALUES (${note.id}, 'partial')`;
        // Another client's write lands after this one read version 1.
        await transaction.$executeRaw`UPDATE "FixtureNote" SET "title" = 'theirs', "version" = "version" + 1 WHERE "id" = ${note.id}`;
        requireWritten(
          await transaction.$executeRaw`UPDATE "FixtureNote" SET "title" = 'mine', "version" = "version" + 1 WHERE "id" = ${note.id} AND "version" = ${1}`,
        );
      }),
      { code: 'version_conflict', status: 412 },
    );

    assert.equal(await app.count('FixtureNoteLog'), before, 'the insert before the comparison was rolled back');
    const [row] = await app.database.reader.$queryRaw<{ title: string; version: number }[]>`SELECT "title", "version" FROM "FixtureNote" WHERE "id" = ${note.id}`;
    assert.deepEqual(row, { title: 'raced', version: 1 }, 'the other client\'s write rolled back with the transaction too');
  });
});

describe('concurrent modifications over HTTP', () => {
  let app: VersionedApp;
  before(async () => {
    app = await startVersionedApp();
  });
  after(() => app.stop());
  afterEach(() => {
    app.logs.length = 0;
  });

  it('hands out the first version when a resource is created and keeps reading it', async () => {
    const note = await app.newNote('first');
    assert.equal(note.version, 'v1');
    const read = await app.send('GET', `/notes/${note.id}`);
    assert.deepEqual([read.status, read.body], [200, note]);
  });

  it('applies a change made on the current version and moves the resource to the next one', async () => {
    const note = await app.newNote('draft');
    const renamed = await app.send('PUT', `/notes/${note.id}`, { title: 'final' }, { ifMatch: `"${note.version}"` });
    assert.deepEqual([renamed.status, renamed.body], [200, { id: note.id, title: 'final', version: 'v2' }]);
    assert.deepEqual((await app.send('GET', `/notes/${note.id}`)).body, renamed.body);
  });

  it('lets only one of many concurrent writes on the same version succeed', async () => {
    const note = await app.newNote('contended');
    const logsBefore = await app.count('FixtureNoteLog');
    const attempts = Array.from({ length: 16 }, (_, index) =>
      app.send('PUT', `/notes/${note.id}`, { title: `writer-${index}` }, { ifMatch: `"${note.version}"` }),
    );
    const answers = await Promise.all(attempts);

    const winners = answers.filter((answer) => answer.status === 200);
    const losers = answers.filter((answer) => answer.status === 412);
    assert.equal(winners.length, 1, 'exactly one write succeeds');
    assert.equal(losers.length, answers.length - 1, 'every other write is told of the conflict');
    for (const loser of losers) {
      assert.equal(errorOf(loser).code, 'version_conflict');
    }
    const stored = (await app.send('GET', `/notes/${note.id}`)).body;
    assert.deepEqual(stored, winners[0]?.body, 'the stored state is the winner\'s');
    assert.equal(stored.version, 'v2', 'one write, one version step');
    assert.equal((await app.count('FixtureNoteLog')) - logsBefore, 1, 'the losers left no trace');
  });

  it('refuses a stale version with an explicit conflict and leaves the resource untouched', async () => {
    const note = await app.newNote('shared');
    await app.send('PUT', `/notes/${note.id}`, { title: 'by someone else' }, { ifMatch: `"${note.version}"` });
    const logsBefore = await app.count('FixtureNoteLog');

    const stale = await app.send('PUT', `/notes/${note.id}`, { title: 'by me' }, { ifMatch: `"${note.version}"` });

    assert.equal(stale.status, 412);
    const error = errorOf(stale);
    assert.equal(error.code, 'version_conflict');
    assert.ok(error.requestId.length > 0);
    assert.equal(error.issues, undefined);
    assert.equal(JSON.stringify(stale.body).includes('by someone else'), false, 'the conflict carries no state');
    assert.deepEqual((await app.send('GET', `/notes/${note.id}`)).body, { id: note.id, title: 'by someone else', version: 'v2' });
    assert.equal(await app.count('FixtureNoteLog'), logsBefore, 'the write done before the comparison was rolled back');
  });

  it('lets the client read the state after a conflict and retry from it', async () => {
    const note = await app.newNote('mine');
    await app.send('PUT', `/notes/${note.id}`, { title: 'theirs' }, { ifMatch: `"${note.version}"` });
    assert.equal((await app.send('PUT', `/notes/${note.id}`, { title: 'mine, again' }, { ifMatch: `"${note.version}"` })).status, 412);

    const current = (await app.send('GET', `/notes/${note.id}`)).body;
    assert.equal(current.title, 'theirs');
    const retried = await app.send('PUT', `/notes/${note.id}`, { title: `${current.title} + mine` }, { ifMatch: `"${current.version}"` });
    assert.deepEqual([retried.status, retried.body.title, retried.body.version], [200, 'theirs + mine', 'v3']);
  });

  it('keeps aggregates independent: a conflict on one does not touch another', async () => {
    const note = await app.newNote('note');
    const tag = await app.newTag('tag');
    await app.send('PUT', `/notes/${note.id}`, { title: 'moved on' }, { ifMatch: `"${note.version}"` });
    assert.equal((await app.send('PUT', `/notes/${note.id}`, { title: 'late' }, { ifMatch: `"${note.version}"` })).status, 412);

    assert.deepEqual((await app.send('GET', `/tags/${tag.id}`)).body, tag, 'the tag kept its state and version');
    const relabelled = await app.send('PUT', `/tags/${tag.id}`, { label: 'renamed' }, { ifMatch: `"${tag.version}"` });
    assert.deepEqual([relabelled.status, relabelled.body.version], [200, 'v2']);
    assert.equal((await app.send('GET', `/notes/${note.id}`)).body.version, 'v2', 'and the tag write did not move the note');
  });

  it('never moves a version backwards or reuses one', async () => {
    const note = await app.newNote('counter');
    const seen = [note.version];
    for (let step = 0; step < 20; step += 1) {
      const current = seen.at(-1)!;
      const written = await app.send('PUT', `/notes/${note.id}`, { title: `step ${step}` }, { ifMatch: `"${current}"` });
      assert.equal(written.status, 200);
      // A failed or refused attempt in between changes nothing.
      assert.equal((await app.send('PUT', `/notes/${note.id}`, { title: 'stale' }, { ifMatch: `"${current}"` })).status, 412);
      assert.equal((await app.send('PUT', `/notes/${note.id}`, { title: 'x'.repeat(65) }, { ifMatch: `"${written.body.version}"` })).status, 400);
      assert.equal((await app.send('GET', `/notes/${note.id}`)).body.version, written.body.version);
      seen.push(written.body.version);
    }
    const numbers = seen.map((token) => parseVersion(token)!);
    assert.deepEqual(numbers, Array.from({ length: 21 }, (_, index) => index + 1));
  });

  it('refuses a version that is ahead of the resource', async () => {
    const note = await app.newNote('present');
    const ahead = await app.send('PUT', `/notes/${note.id}`, { title: 'future' }, { ifMatch: '"v9"' });
    assert.equal(ahead.status, 412);
    assert.equal((await app.send('GET', `/notes/${note.id}`)).body.version, 'v1');
  });

  it('asks for the precondition instead of overwriting blindly', async () => {
    const note = await app.newNote('guarded');
    const missing = await app.send('PUT', `/notes/${note.id}`, { title: 'blind' });
    assert.equal(missing.status, 428);
    assert.equal(errorOf(missing).code, 'precondition_required');
    assert.deepEqual((await app.send('GET', `/notes/${note.id}`)).body, note);
  });

  it('rejects a malformed precondition as an invalid request', async () => {
    const note = await app.newNote('strict');
    for (const ifMatch of ['v1', '*', 'W/"v1"', '"v1", "v2"', '"abc"', '""']) {
      const refused = await app.send('PUT', `/notes/${note.id}`, { title: 'x' }, { ifMatch });
      assert.equal(refused.status, 400, ifMatch);
      const error = errorOf(refused);
      assert.equal(error.code, 'validation_failed');
      assert.deepEqual(error.issues?.map((issue) => issue.path), ['header.If-Match']);
    }
    assert.deepEqual((await app.send('GET', `/notes/${note.id}`)).body, note);
  });

  it('reports an invalid body before the missing precondition', async () => {
    const note = await app.newNote('ordered');
    const refused = await app.send('PUT', `/notes/${note.id}`, { title: 'x'.repeat(65) });
    assert.equal(errorOf(refused).code, 'validation_failed');
  });

  it('answers not found, not a conflict, for a resource that does not exist', async () => {
    const answer = await app.send('PUT', '/notes/missing', { title: 'x' }, { ifMatch: '"v1"' });
    assert.deepEqual([answer.status, errorOf(answer).code], [404, 'fixture_note_not_found']);
    const deleted = await app.send('DELETE', '/notes/missing', undefined, { ifMatch: '"v1"' });
    assert.deepEqual([deleted.status, errorOf(deleted).code], [404, 'fixture_note_not_found']);
  });

  it('guards deletion the same way', async () => {
    const note = await app.newNote('doomed');
    const moved = await app.send('PUT', `/notes/${note.id}`, { title: 'saved' }, { ifMatch: `"${note.version}"` });

    const stale = await app.send('DELETE', `/notes/${note.id}`, undefined, { ifMatch: `"${note.version}"` });
    assert.deepEqual([stale.status, errorOf(stale).code], [412, 'version_conflict']);
    assert.equal((await app.send('GET', `/notes/${note.id}`)).status, 200, 'the note survived the stale delete');

    const deleted = await app.send('DELETE', `/notes/${note.id}`, undefined, { ifMatch: `"${moved.body.version}"` });
    assert.deepEqual([deleted.status, deleted.body], [200, { id: note.id }]);
    assert.equal((await app.send('GET', `/notes/${note.id}`)).status, 404);
    const afterwards = await app.send('PUT', `/notes/${note.id}`, { title: 'zombie' }, { ifMatch: `"${moved.body.version}"` });
    assert.equal(afterwards.status, 404, 'a deleted resource is not brought back by an old version');
  });
});

describe('versions and idempotency keys', () => {
  let app: VersionedApp;
  before(async () => {
    app = await startVersionedApp();
  });
  after(() => app.stop());

  const key = () => crypto.randomUUID();

  it('replays a committed write under its key even though its version is now stale', async () => {
    const note = await app.newNote('retried');
    const retryKey = key();
    const first = await app.send('PUT', `/notes/${note.id}`, { title: 'once' }, { ifMatch: `"${note.version}"`, key: retryKey });
    const logsAfterFirst = await app.count('FixtureNoteLog');
    const replay = await app.send('PUT', `/notes/${note.id}`, { title: 'once' }, { ifMatch: `"${note.version}"`, key: retryKey });

    assert.deepEqual([replay.status, replay.body], [first.status, first.body]);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    assert.equal(await app.count('FixtureNoteLog'), logsAfterFirst, 'the effect was not repeated');
    assert.equal((await app.send('GET', `/notes/${note.id}`)).body.version, 'v2');
  });

  it('does not accept the same key for another expected version', async () => {
    const note = await app.newNote('fingerprinted');
    const reusedKey = key();
    await app.send('PUT', `/notes/${note.id}`, { title: 'one' }, { ifMatch: '"v1"', key: reusedKey });
    const reused = await app.send('PUT', `/notes/${note.id}`, { title: 'one' }, { ifMatch: '"v2"', key: reusedKey });
    assert.deepEqual([reused.status, errorOf(reused).code], [422, 'idempotency_key_reused']);
  });

  it('leaves no record behind a conflict, so the key can be used again with the fresh version', async () => {
    const note = await app.newNote('unrecorded');
    await app.send('PUT', `/notes/${note.id}`, { title: 'other' }, { ifMatch: '"v1"' });
    const recordsBefore = await app.database.reader.idempotencyRecord.count();
    const retryKey = key();

    const stale = await app.send('PUT', `/notes/${note.id}`, { title: 'mine' }, { ifMatch: '"v1"', key: retryKey });
    assert.equal(stale.status, 412);
    assert.equal(await app.database.reader.idempotencyRecord.count(), recordsBefore, 'a refused command stores nothing');

    const fresh = await app.send('PUT', `/notes/${note.id}`, { title: 'mine' }, { ifMatch: '"v2"', key: retryKey });
    assert.deepEqual([fresh.status, fresh.body.version], [200, 'v3']);
  });
});

describe('an abandoned request', () => {
  it('does not undo the write that was running when the client left', async () => {
    const app = await startVersionedApp({ hooks: { insideRename: () => new Promise((resolve) => setTimeout(resolve, 200)) } });
    try {
      const note = await app.newNote('abandoned');
      const controller = new AbortController();
      const request = fetch(`http://127.0.0.1:${app.port}/api/fixture/notes/${note.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-match': `"${note.version}"` },
        body: JSON.stringify({ title: 'still written' }),
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 50);
      await assert.rejects(request, { name: 'AbortError' });

      // The client is gone; the write finishes on its own.
      const deadline = Date.now() + 5_000;
      let stored = (await app.send('GET', `/notes/${note.id}`)).body;
      while (stored.version === note.version && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        stored = (await app.send('GET', `/notes/${note.id}`)).body;
      }
      assert.deepEqual(stored, { id: note.id, title: 'still written', version: 'v2' });
    } finally {
      await app.stop();
    }
  });
});

describe('versions across a restart', () => {
  it('keep their value, so a version issued before the restart still conflicts after it', async () => {
    const first = await startVersionedApp();
    let second: VersionedApp | undefined;
    try {
      const note = await first.newNote('durable');
      const renamed = await first.send('PUT', `/notes/${note.id}`, { title: 'before restart' }, { ifMatch: `"${note.version}"` });
      await first.stop({ keepData: true });

      second = await startVersionedApp({ dataDir: first.dataDir });
      assert.deepEqual((await second.send('GET', `/notes/${note.id}`)).body, renamed.body);
      assert.equal((await second.send('PUT', `/notes/${note.id}`, { title: 'late' }, { ifMatch: `"${note.version}"` })).status, 412);
      const next = await second.send('PUT', `/notes/${note.id}`, { title: 'after restart' }, { ifMatch: `"${renamed.body.version}"` });
      assert.deepEqual([next.status, next.body.version], [200, 'v3']);
    } finally {
      await second?.stop();
    }
  });
});

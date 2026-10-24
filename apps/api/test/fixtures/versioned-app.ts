import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { createApp } from '../../src/app.ts';
import { loadCommandKey } from '../../src/commands/command-key.ts';
import { createCommands } from '../../src/commands/idempotency.ts';
import { idempotencyKeyHeader, identifierSchema } from '../../src/contract/conventions.ts';
import { addOperation, ApiError, defineOperation } from '../../src/contract/operation.ts';
import { openDatabase, type Database } from '../../src/database/database.ts';
import { createJsonLogger } from '../../src/log.ts';
import type { ApiModule } from '../../src/modules/api-module.ts';
import { formatVersion, ifMatchHeader, initialVersion, versionSchema } from '../../src/versions/token.ts';
import { requireWritten } from '../../src/versions/versions.ts';

// Two unrelated aggregates, notes and tags, each in its own table with its own `version` column.
// They are created by the fixture, so the guarantees under test belong to no domain.
const noteSchema = z.object({ id: identifierSchema, title: z.string(), version: versionSchema });
const tagSchema = z.object({ id: identifierSchema, label: z.string(), version: versionSchema });
const noteParams = z.object({ noteId: identifierSchema });
const tagParams = z.object({ tagId: identifierSchema });

export const createNote = defineOperation({
  operationId: 'createNote',
  method: 'post',
  path: '/notes',
  summary: 'Create one fixture note',
  body: z.strictObject({ title: z.string().max(64) }),
  idempotent: true,
  responses: { 201: { description: 'The note was created.', schema: noteSchema } },
});
export const getNote = defineOperation({
  operationId: 'getNote',
  method: 'get',
  path: '/notes/{noteId}',
  summary: 'Read one fixture note',
  params: noteParams,
  responses: { 200: { description: 'The note.', schema: noteSchema } },
  errors: { 404: 'No note has this identifier (`fixture_note_not_found`).' },
});
export const renameNote = defineOperation({
  operationId: 'renameNote',
  method: 'put',
  path: '/notes/{noteId}',
  summary: 'Rename a fixture note if nobody else changed it',
  params: noteParams,
  body: z.strictObject({ title: z.string().max(64) }),
  idempotent: true,
  expectsVersion: true,
  responses: { 200: { description: 'The renamed note.', schema: noteSchema } },
  errors: { 404: 'No note has this identifier (`fixture_note_not_found`).' },
});
export const deleteNote = defineOperation({
  operationId: 'deleteNote',
  method: 'delete',
  path: '/notes/{noteId}',
  summary: 'Delete a fixture note if nobody else changed it',
  params: noteParams,
  idempotent: true,
  expectsVersion: true,
  responses: { 200: { description: 'The note was deleted.', schema: z.object({ id: identifierSchema }) } },
  errors: { 404: 'No note has this identifier (`fixture_note_not_found`).' },
});
export const createTag = defineOperation({
  operationId: 'createTag',
  method: 'post',
  path: '/tags',
  summary: 'Create one fixture tag',
  body: z.strictObject({ label: z.string().max(64) }),
  idempotent: true,
  responses: { 201: { description: 'The tag was created.', schema: tagSchema } },
});
export const getTag = defineOperation({
  operationId: 'getTag',
  method: 'get',
  path: '/tags/{tagId}',
  summary: 'Read one fixture tag',
  params: tagParams,
  responses: { 200: { description: 'The tag.', schema: tagSchema } },
  errors: { 404: 'No tag has this identifier (`fixture_tag_not_found`).' },
});
export const relabelTag = defineOperation({
  operationId: 'relabelTag',
  method: 'put',
  path: '/tags/{tagId}',
  summary: 'Relabel a fixture tag if nobody else changed it',
  params: tagParams,
  body: z.strictObject({ label: z.string().max(64) }),
  idempotent: true,
  expectsVersion: true,
  responses: { 200: { description: 'The relabelled tag.', schema: tagSchema } },
  errors: { 404: 'No tag has this identifier (`fixture_tag_not_found`).' },
});

/** An operation that reads and wrongly expects a version; registering it must fail. */
export const readWithVersion = defineOperation({
  operationId: 'readWithVersion',
  method: 'get',
  path: '/notes-versioned',
  summary: 'A read that wrongly expects a version',
  expectsVersion: true,
  responses: { 200: { description: 'Never served.' } },
});

interface NoteRow {
  readonly id: string;
  readonly title: string;
  readonly version: number | bigint;
}
interface TagRow {
  readonly id: string;
  readonly label: string;
  readonly version: number | bigint;
}

const noteNotFound = () => new ApiError(404, 'fixture_note_not_found', 'No note has this identifier.');
const tagNotFound = () => new ApiError(404, 'fixture_tag_not_found', 'No tag has this identifier.');

export async function createVersionedTables(database: Database): Promise<void> {
  await database.write(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "FixtureNote" ("id" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT ${initialVersion})`,
    );
    await transaction.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "FixtureTag" ("id" TEXT PRIMARY KEY, "label" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT ${initialVersion})`,
    );
    // Written by every rename before the version is compared, to show that a conflict undoes it.
    await transaction.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "FixtureNoteLog" ("sequence" INTEGER PRIMARY KEY AUTOINCREMENT, "noteId" TEXT NOT NULL, "title" TEXT NOT NULL)',
    );
  });
}

const noteBody = (row: NoteRow) => ({ id: row.id, title: row.title, version: formatVersion(Number(row.version)) });
const tagBody = (row: TagRow) => ({ id: row.id, label: row.label, version: formatVersion(Number(row.version)) });

export function createVersionedModule(): ApiModule {
  return {
    id: 'fixture',
    operations: [createNote, getNote, renameNote, deleteNote, createTag, getTag, relabelTag],
    register(router, { database, commands }) {
      commands.add(router, createNote).handle(async ({ body }, commit) => {
        const note = await commit(async (transaction) => {
          const id = randomUUID();
          await transaction.$executeRaw`INSERT INTO "FixtureNote" ("id", "title") VALUES (${id}, ${body.title})`;
          return { id, title: body.title, version: formatVersion(initialVersion) };
        });
        return { status: 201, body: note };
      });
      addOperation(router, getNote).handle(async ({ params }) => {
        const [row] = await database.reader.$queryRaw<NoteRow[]>`SELECT "id", "title", "version" FROM "FixtureNote" WHERE "id" = ${params.noteId}`;
        if (row === undefined) {
          throw noteNotFound();
        }
        return { status: 200, body: noteBody(row) };
      });
      commands.add(router, renameNote).handle(async ({ params, body, expectedVersion }, commit) => {
        const note = await commit(async (transaction) => {
          const [current] = await transaction.$queryRaw<NoteRow[]>`SELECT "id", "title", "version" FROM "FixtureNote" WHERE "id" = ${params.noteId}`;
          if (current === undefined) {
            throw noteNotFound();
          }
          await transaction.$executeRaw`INSERT INTO "FixtureNoteLog" ("noteId", "title") VALUES (${params.noteId}, ${body.title})`;
          // The compare and the write are one statement: no other write can slip in between.
          requireWritten(
            await transaction.$executeRaw`UPDATE "FixtureNote" SET "title" = ${body.title}, "version" = "version" + 1 WHERE "id" = ${params.noteId} AND "version" = ${expectedVersion}`,
          );
          return { id: params.noteId, title: body.title, version: formatVersion(expectedVersion + 1) };
        });
        return { status: 200, body: note };
      });
      commands.add(router, deleteNote).handle(async ({ params, expectedVersion }, commit) => {
        const result = await commit(async (transaction) => {
          const [current] = await transaction.$queryRaw<NoteRow[]>`SELECT "id" FROM "FixtureNote" WHERE "id" = ${params.noteId}`;
          if (current === undefined) {
            throw noteNotFound();
          }
          requireWritten(await transaction.$executeRaw`DELETE FROM "FixtureNote" WHERE "id" = ${params.noteId} AND "version" = ${expectedVersion}`);
          return { id: params.noteId };
        });
        return { status: 200, body: result };
      });

      commands.add(router, createTag).handle(async ({ body }, commit) => {
        const tag = await commit(async (transaction) => {
          const id = randomUUID();
          await transaction.$executeRaw`INSERT INTO "FixtureTag" ("id", "label") VALUES (${id}, ${body.label})`;
          return { id, label: body.label, version: formatVersion(initialVersion) };
        });
        return { status: 201, body: tag };
      });
      addOperation(router, getTag).handle(async ({ params }) => {
        const [row] = await database.reader.$queryRaw<TagRow[]>`SELECT "id", "label", "version" FROM "FixtureTag" WHERE "id" = ${params.tagId}`;
        if (row === undefined) {
          throw tagNotFound();
        }
        return { status: 200, body: tagBody(row) };
      });
      commands.add(router, relabelTag).handle(async ({ params, body, expectedVersion }, commit) => {
        const tag = await commit(async (transaction) => {
          const [current] = await transaction.$queryRaw<TagRow[]>`SELECT "id" FROM "FixtureTag" WHERE "id" = ${params.tagId}`;
          if (current === undefined) {
            throw tagNotFound();
          }
          requireWritten(
            await transaction.$executeRaw`UPDATE "FixtureTag" SET "label" = ${body.label}, "version" = "version" + 1 WHERE "id" = ${params.tagId} AND "version" = ${expectedVersion}`,
          );
          return { id: params.tagId, label: body.label, version: formatVersion(expectedVersion + 1) };
        });
        return { status: 200, body: tag };
      });
    },
  };
}

export interface Answer {
  readonly status: number;
  readonly body: any;
  readonly headers: Headers;
}

export interface RequestOptions {
  /** Raw `If-Match` value, sent as given. */
  readonly ifMatch?: string;
  readonly key?: string;
}

export interface VersionedApp {
  readonly port: number;
  readonly dataDir: string;
  readonly database: Database;
  readonly logs: string[];
  send(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<Answer>;
  /** Creates a note and returns it as the API answered. */
  newNote(title: string): Promise<{ id: string; title: string; version: string }>;
  newTag(label: string): Promise<{ id: string; label: string; version: string }>;
  count(table: string): Promise<number>;
  stop(options?: { keepData?: boolean }): Promise<void>;
}

/** The fixture module over a real database, the real command layer, and the real HTTP adapter. */
export async function startVersionedApp(options: { dataDir?: string } = {}): Promise<VersionedApp> {
  const dataDir = options.dataDir ?? join(mkdtempSync(join(tmpdir(), 'nihon-versions-')), 'data');
  const { database } = await openDatabase({ dataDir });
  await createVersionedTables(database);
  const logs: string[] = [];
  const server: Server = createServer(
    createApp({
      version: '1.2.3',
      modules: [createVersionedModule()],
      database,
      commands: createCommands({ database, key: loadCommandKey(dataDir) }),
      logger: createJsonLogger((line) => logs.push(line)),
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const app: VersionedApp = {
    port,
    dataDir,
    database,
    logs,
    async send(method, path, body, { ifMatch, key } = {}) {
      const response = await fetch(`http://127.0.0.1:${port}/api/fixture${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(ifMatch === undefined ? {} : { [ifMatchHeader]: ifMatch }),
          ...(key === undefined ? {} : { [idempotencyKeyHeader]: key }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text === '' ? undefined : JSON.parse(text), headers: response.headers };
    },
    async newNote(title) {
      return (await app.send('POST', '/notes', { title })).body;
    },
    async newTag(label) {
      return (await app.send('POST', '/tags', { label })).body;
    },
    async count(table) {
      return Number((await database.reader.$queryRawUnsafe<{ count: bigint | number }[]>(`SELECT COUNT(*) AS count FROM "${table}"`))[0]?.count);
    },
    async stop({ keepData = false } = {}) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await database.close();
      if (!keepData) {
        rmSync(join(dataDir, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
  return app;
}

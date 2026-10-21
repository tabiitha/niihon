import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { PrismaClient } from '../generated/prisma/client.ts';
import { databaseFileName, openDatabase, snapshotsDirName, type Database, type DatabaseLimits } from './database.ts';
import { IncompatibleDatabaseError } from './migrations.ts';
import { maxSnapshots, MigrationFailedError, migrationsTable } from './migrator.ts';
import { DatabaseBusyError } from './write-gate.ts';

// Migrations as Prisma Migrate writes them for SQLite, forming successive releases.
const fixtures = {
  '20260101000000_create_parent': `-- CreateTable
CREATE TABLE "Parent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Parent_name_key" ON "Parent"("name");
`,
  // ON DELETE CASCADE: redefining "Parent" with foreign keys enforced would delete every child.
  '20260201000000_create_child': `-- CreateTable
CREATE TABLE "Child" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "parentId" INTEGER NOT NULL,
    CONSTRAINT "Child_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
`,
  // Transforms existing rows through Prisma's table redefinition.
  '20260301000000_add_parent_label': `-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Parent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_Parent" ("id", "name", "label") SELECT "id", "name", upper("name") FROM "Parent";
DROP TABLE "Parent";
ALTER TABLE "new_Parent" RENAME TO "Parent";
CREATE UNIQUE INDEX "Parent_name_key" ON "Parent"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
`,
  // Changes rows, then fails on its second statement.
  '20260301000000_broken': `UPDATE "Parent" SET "name" = 'changed';
INSERT INTO "Missing" ("id") SELECT 1;
`,
  // Succeeds statement by statement but leaves a row that violates a foreign key.
  '20260301000000_orphan': `PRAGMA foreign_keys=OFF;
INSERT INTO "Child" ("parentId") SELECT 999;
PRAGMA foreign_keys=ON;
`,
} as const;

type FixtureName = keyof typeof fixtures;

const release1: FixtureName[] = ['20260101000000_create_parent'];
const release2: FixtureName[] = [...release1, '20260201000000_create_child', '20260301000000_add_parent_label'];

const fast: Partial<DatabaseLimits> = { busyTimeoutMs: 1_000, maxWriteWaitMs: 200, maxTransactionMs: 500 };
const checksPermissions = process.platform !== 'win32';

describe('installation database', () => {
  let root: string;
  let dataDir: string;
  const opened: Database[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nihon-database-'));
    dataDir = join(root, 'data');
    mkdirSync(dataDir);
  });
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((database) => database.close()));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  let releases = 0;
  function migrationsFor(names: readonly FixtureName[]): string {
    const directory = join(root, `release-${(releases += 1)}`);
    for (const name of names) {
      mkdirSync(join(directory, name), { recursive: true });
      writeFileSync(join(directory, name, 'migration.sql'), fixtures[name]);
    }
    mkdirSync(directory, { recursive: true });
    return directory;
  }

  async function open(names: readonly FixtureName[], limits: Partial<DatabaseLimits> = fast) {
    const result = await openDatabase({ dataDir, migrationsDir: migrationsFor(names), limits });
    opened.push(result.database);
    return result;
  }

  async function closeAll(): Promise<void> {
    await Promise.all(opened.splice(0).map((database) => database.close()));
  }

  const databasePath = () => join(dataDir, databaseFileName);
  const fingerprint = () => createHash('sha256').update(readFileSync(databasePath())).digest('hex');

  /** Opens any SQLite file read-only through Prisma, for assertions only. */
  async function inspect<T>(path: string, query: (client: PrismaClient) => Promise<T>): Promise<T> {
    const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: path, readonly: true, fileMustExist: true }) });
    try {
      return await query(client);
    } finally {
      await client.$disconnect();
    }
  }

  const tables = (client: PrismaClient) =>
    client
      .$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      .then((rows) => rows.map((row) => row.name));

  const history = (client: PrismaClient) =>
    client.$queryRawUnsafe<Array<{ name: string; applied_at: string }>>(
      `SELECT name, applied_at FROM "${migrationsTable}" ORDER BY name`,
    );

  async function addParents(database: Database, ...names: string[]): Promise<void> {
    await database.write(async (transaction) => {
      for (const name of names) {
        await transaction.$executeRaw`INSERT INTO "Parent" ("name") VALUES (${name})`;
      }
    });
  }

  describe('fresh installation', () => {
    it('creates the database in WAL mode, applies every migration, and takes no snapshot', async () => {
      const { database, migration } = await open(release2);
      assert.deepEqual(migration.applied, release2);
      assert.equal(migration.schemaVersion, '20260301000000_add_parent_label');
      assert.equal(migration.snapshot, null);

      const [mode] = await database.reader.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode');
      assert.equal(mode?.journal_mode, 'wal');
      assert.deepEqual(await tables(database.reader), ['Child', 'Parent', migrationsTable]);
      assert.deepEqual(readdirSync(dataDir).includes(snapshotsDirName), false);
    });

    it('creates the database file readable and writable by the server user only', { skip: !checksPermissions }, async () => {
      const { database } = await open(release1);
      await addParents(database, 'a');
      assert.equal(statSync(databasePath()).mode & 0o777, 0o600);
      assert.equal(statSync(`${databasePath()}-wal`).mode & 0o777, 0o600);
    });

    it('records an empty history when the server packages no migration yet', async () => {
      const { database, migration } = await open([]);
      assert.deepEqual(migration, { applied: [], schemaVersion: null, snapshot: null });
      assert.deepEqual(await tables(database.reader), [migrationsTable]);
    });
  });

  describe('restart', () => {
    it('reapplies nothing and keeps the data', async () => {
      const first = await open(release2);
      await first.database.write((transaction) => transaction.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES ('kana', 'KANA')`);
      const recorded = await history(first.database.reader);
      await closeAll();

      const { database, migration } = await open(release2);
      assert.deepEqual(migration, { applied: [], schemaVersion: '20260301000000_add_parent_label', snapshot: null });
      assert.deepEqual(await history(database.reader), recorded);
      assert.deepEqual(await database.reader.$queryRaw`SELECT "name", "label" FROM "Parent"`, [{ name: 'kana', label: 'KANA' }]);
    });
  });

  describe('migration from a previous version', () => {
    it('transforms existing data and snapshots the previous version first', async () => {
      const previous = await open(release1);
      await addParents(previous.database, 'kana', 'kanji');
      await closeAll();

      const { database, migration } = await open(release2);
      assert.deepEqual(migration.applied, ['20260201000000_create_child', '20260301000000_add_parent_label']);
      assert.deepEqual(await database.reader.$queryRaw`SELECT "name", "label" FROM "Parent" ORDER BY "id"`, [
        { name: 'kana', label: 'KANA' },
        { name: 'kanji', label: 'KANJI' },
      ]);

      const snapshot = migration.snapshot;
      assert.ok(snapshot !== null);
      assert.match(snapshot, /nihon-\d{8}T\d{9}Z-20260101000000_create_parent\.db$/);
      if (checksPermissions) {
        assert.equal(statSync(snapshot).mode & 0o777, 0o600);
      }
      await inspect(snapshot, async (client) => {
        assert.deepEqual(await tables(client), ['Parent', migrationsTable]);
        assert.deepEqual(await client.$queryRaw`SELECT "name" FROM "Parent" ORDER BY "id"`, [{ name: 'kana' }, { name: 'kanji' }]);
      });
    });

    it('keeps the rows that reference a redefined table', async () => {
      const previous = await open([...release1, '20260201000000_create_child']);
      await addParents(previous.database, 'kana');
      await previous.database.write((transaction) => transaction.$executeRaw`INSERT INTO "Child" ("parentId") SELECT "id" FROM "Parent"`);
      await closeAll();

      const { database } = await open(release2);
      assert.deepEqual(await database.reader.$queryRaw`SELECT COUNT(*) AS "count" FROM "Child"`, [{ count: 1n }]);
      await assert.rejects(
        database.write((transaction) => transaction.$executeRaw`INSERT INTO "Child" ("parentId") VALUES (999)`),
        /constraint|violat/i,
      );
    });

    it('keeps only the most recent snapshots and removes interrupted ones', async () => {
      await open(release1);
      await closeAll();
      const directory = join(dataDir, snapshotsDirName);
      mkdirSync(directory);
      const older = ['nihon-20250101T000000000Z-a.db', 'nihon-20250201T000000000Z-a.db', 'nihon-20250301T000000000Z-a.db'];
      for (const name of [...older, 'nihon-20250401T000000000Z-a.db.partial']) {
        writeFileSync(join(directory, name), '');
      }

      const { migration } = await open(release2);
      const kept = readdirSync(directory).sort();
      assert.equal(kept.length, maxSnapshots);
      assert.deepEqual(kept.slice(0, -1), older.slice(-(maxSnapshots - 1)));
      assert.equal(join(directory, kept.at(-1)!), migration.snapshot);
    });
  });

  describe('migration failure', () => {
    it('rolls back the whole run, leaving the previous version usable', async () => {
      const previous = await open(release1);
      await addParents(previous.database, 'kana');
      await closeAll();

      await assert.rejects(
        open([...release1, '20260201000000_create_child', '20260301000000_broken']),
        (error) =>
          error instanceof MigrationFailedError &&
          error.migration === '20260301000000_broken' &&
          /no such table: Missing/.test(error.message),
      );
      // The rolled-back database is its own backup; the snapshot taken for this run is removed.
      assert.deepEqual(readdirSync(join(dataDir, snapshotsDirName)), []);

      const { database, migration } = await open(release1);
      assert.deepEqual(migration.applied, []);
      assert.deepEqual(await tables(database.reader), ['Parent', migrationsTable]);
      assert.deepEqual(await database.reader.$queryRaw`SELECT "name" FROM "Parent"`, [{ name: 'kana' }]);
      assert.deepEqual(
        (await history(database.reader)).map((row) => row.name),
        release1,
      );
    });

    it('keeps earlier snapshots however often a failing migration is retried', async () => {
      await open(release1);
      await closeAll();
      const { migration } = await open([...release1, '20260201000000_create_child']);
      await closeAll();
      for (let attempt = 0; attempt < maxSnapshots + 1; attempt += 1) {
        await assert.rejects(open([...release1, '20260201000000_create_child', '20260301000000_broken']), MigrationFailedError);
      }
      assert.deepEqual(
        readdirSync(join(dataDir, snapshotsDirName)).map((name) => join(dataDir, snapshotsDirName, name)),
        [migration.snapshot],
      );
    });

    it('rolls back a migration that leaves a foreign key violated', async () => {
      await open([...release1, '20260201000000_create_child']);
      await closeAll();
      await assert.rejects(
        open([...release1, '20260201000000_create_child', '20260301000000_orphan']),
        (error) => error instanceof MigrationFailedError && /violate a foreign key/.test(error.message),
      );
      await inspect(databasePath(), async (client) => {
        assert.deepEqual(await client.$queryRaw`SELECT COUNT(*) AS "count" FROM "Child"`, [{ count: 0n }]);
      });
    });
  });

  describe('incompatible database', () => {
    it('refuses a database migrated by a newer release and leaves it untouched', async () => {
      await open(release2);
      await closeAll();
      const before = fingerprint();
      await assert.rejects(
        open(release1),
        (error) => error instanceof IncompatibleDatabaseError && error.reason === 'newer',
      );
      assert.equal(fingerprint(), before);
    });

    it('refuses a database whose applied migration was modified', async () => {
      await open(release1);
      await closeAll();
      const directory = migrationsFor(release1);
      writeFileSync(join(directory, release1[0]!, 'migration.sql'), `${fixtures[release1[0]!]}-- edited\n`);
      await assert.rejects(
        openDatabase({ dataDir, migrationsDir: directory, limits: fast }),
        (error) => error instanceof IncompatibleDatabaseError && error.reason === 'modified',
      );
    });

    it('refuses an SQLite file that a Nihon server did not create, without converting it to WAL', async () => {
      const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databasePath() }) });
      await client.$executeRawUnsafe('CREATE TABLE "foreign" ("id" INTEGER)');
      await client.$disconnect();
      const before = fingerprint();

      await assert.rejects(
        open(release1),
        (error) => error instanceof IncompatibleDatabaseError && error.reason === 'unrecognized',
      );
      assert.equal(fingerprint(), before);
      await inspect(databasePath(), async (reader) => {
        assert.deepEqual(await reader.$queryRawUnsafe('PRAGMA journal_mode'), [{ journal_mode: 'delete' }]);
      });
    });
  });

  describe('integrity constraints', () => {
    it('enforces foreign keys, uniqueness, and NOT NULL on writes, rolling back the whole transaction', async () => {
      const { database } = await open(release2);
      await addParents(database, 'kana');

      const attempts: Array<[string, (transaction: Parameters<Parameters<Database['write']>[0]>[0]) => Promise<unknown>]> = [
        ['foreign key', (transaction) => transaction.$executeRaw`INSERT INTO "Child" ("parentId") VALUES (999)`],
        ['unique', (transaction) => transaction.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES ('kana', 'X')`],
        ['not null', (transaction) => transaction.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES (NULL, 'X')`],
      ];
      for (const [constraint, violate] of attempts) {
        await assert.rejects(
          database.write(async (transaction) => {
            await transaction.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES ('kanji', 'KANJI')`;
            await violate(transaction);
          }),
          /constraint|violat/i,
          constraint,
        );
      }
      assert.deepEqual(await database.reader.$queryRaw`SELECT "name" FROM "Parent"`, [{ name: 'kana' }]);
    });
  });

  describe('connections', () => {
    it('refuses writes through the read-only reader', async () => {
      const { database } = await open(release2);
      await assert.rejects(
        database.reader.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES ('kana', 'KANA')`,
        /readonly/i,
      );
    });

    it('shows readers committed data only', async () => {
      const { database } = await open(release2);
      await database.write(async (transaction) => {
        await transaction.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES ('kana', 'KANA')`;
        assert.deepEqual(await database.reader.$queryRaw`SELECT COUNT(*) AS "count" FROM "Parent"`, [{ count: 0n }]);
      });
      assert.deepEqual(await database.reader.$queryRaw`SELECT COUNT(*) AS "count" FROM "Parent"`, [{ count: 1n }]);
    });

    it('serializes concurrent writes', async () => {
      const { database } = await open(release2, { ...fast, maxWriteWaitMs: 5_000 });
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          database.write(async (transaction) => {
            const [row] = await transaction.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS "count" FROM "Parent"`;
            await new Promise((resolve) => setImmediate(resolve));
            await transaction.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES (${`p${index}`}, ${String(row?.count)})`;
          }),
        ),
      );
      const labels = await database.reader.$queryRaw<Array<{ label: string }>>`SELECT "label" FROM "Parent" ORDER BY "id"`;
      assert.deepEqual(
        labels.map((row) => row.label),
        Array.from({ length: 20 }, (_, index) => String(index)),
      );
    });

    it('bounds the wait for a concurrent write', async () => {
      const { database } = await open(release2, { ...fast, maxWriteWaitMs: 50, maxTransactionMs: 2_000 });
      let release!: () => void;
      const holding = database.write(() => new Promise<void>((resolve) => (release = resolve)));
      await assert.rejects(database.write(() => Promise.resolve()), DatabaseBusyError);
      release();
      await holding;
    });

    it('rolls back a transaction that stays open too long', async () => {
      const { database } = await open(release2, { ...fast, maxTransactionMs: 50 });
      await assert.rejects(
        database.write(async (transaction) => {
          await transaction.$executeRaw`INSERT INTO "Parent" ("name", "label") VALUES ('slow', 'SLOW')`;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }),
      );
      assert.deepEqual(await database.reader.$queryRaw`SELECT COUNT(*) AS "count" FROM "Parent"`, [{ count: 0n }]);
      await addParents(database, 'next');
    });
  });
});

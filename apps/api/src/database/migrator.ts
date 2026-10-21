import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { IncompatibleDatabaseError, planMigrations, type AppliedMigration, type Migration } from './migrations.ts';

/** Bookkeeping table of the migrations applied by the server; Prisma's CLI never writes it. */
export const migrationsTable = 'nihon_schema_migrations';
/** Snapshots kept in the snapshots directory; older ones are deleted after a new one is taken. */
export const maxSnapshots = 3;

/** A migration run failed; the transaction was rolled back and the database is unchanged. */
export class MigrationFailedError extends Error {
  override name = 'MigrationFailedError';

  readonly migration: string | null;
  readonly snapshot: string | null;

  constructor(migration: string | null, snapshot: string | null, cause: unknown) {
    const reason = describe(cause);
    super(
      migration === null
        ? `Preparing the database migration failed: ${reason}`
        : `Migration ${migration} failed and was rolled back: ${reason}`,
      { cause },
    );
    this.migration = migration;
    this.snapshot = snapshot;
  }
}

/** Driver adapter errors carry the SQLite message in their cause; Prisma replaces the message with a kind. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const { cause } = error;
  if (typeof cause === 'object' && cause !== null && 'originalMessage' in cause && typeof cause.originalMessage === 'string') {
    return cause.originalMessage;
  }
  return error.message;
}

export interface MigrationOptions {
  readonly databasePath: string;
  readonly snapshotsDir: string;
  readonly migrations: readonly Migration[];
  /** SQLite busy timeout while migrating, in milliseconds. */
  readonly busyTimeoutMs: number;
  readonly now?: () => Date;
}

export interface MigrationOutcome {
  /** Migrations applied by this run, in order. */
  readonly applied: readonly string[];
  /** Latest migration recorded in the database, or null when the server packages none yet. */
  readonly schemaVersion: string | null;
  /** Snapshot taken before this run, or null when nothing was migrated or the database was new. */
  readonly snapshot: string | null;
}

type Connection = Awaited<ReturnType<PrismaBetterSqlite3['connect']>>;

const text = { scalarType: 'string', arity: 'scalar' } as const;

/**
 * Brings the database to the schema packaged with the server before it serves requests.
 *
 * All pending migrations run in one transaction with their bookkeeping rows, so a failure leaves
 * the database exactly at the previous release's schema. Before migrating an existing database,
 * a consistent snapshot is written to `snapshotsDir`. A database migrated by a newer release, or
 * one this server does not recognize, is refused untouched.
 */
export async function migrateDatabase(options: MigrationOptions): Promise<MigrationOutcome> {
  const { databasePath, snapshotsDir, migrations, busyTimeoutMs, now = () => new Date() } = options;
  createPrivateFile(databasePath);
  const connection = await new PrismaBetterSqlite3({ url: databasePath, timeout: busyTimeoutMs }).connect();
  try {
    // Checked before any change, so a refused database is left exactly as found.
    const applied = await readApplied(connection);
    const pending = planMigrations(applied, migrations);

    const journalMode = await scalar(connection, 'PRAGMA journal_mode = WAL');
    if (journalMode !== 'wal') {
      throw new Error(`SQLite refused write-ahead logging (journal mode "${String(journalMode)}").`);
    }
    await connection.executeScript('PRAGMA synchronous = FULL');
    // Prisma's table redefinitions need foreign keys off outside the transaction; they are checked
    // explicitly before committing.
    await connection.executeScript('PRAGMA foreign_keys = OFF');

    const tracked = applied.length > 0 || (await hasTable(connection, migrationsTable));
    if (pending.length === 0 && tracked) {
      return { applied: [], schemaVersion: applied.at(-1)?.name ?? null, snapshot: null };
    }

    let snapshot: string | null = null;
    let current: string | null = null;
    try {
      if (applied.length > 0) {
        snapshot = await takeSnapshot(connection, snapshotsDir, applied.at(-1)!.name, now());
      }
      await connection.executeScript('BEGIN IMMEDIATE');
      try {
        await connection.executeScript(
          `CREATE TABLE IF NOT EXISTS "${migrationsTable}" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "applied_at" TEXT NOT NULL)`,
        );
        const appliedAt = now().toISOString();
        for (const migration of pending) {
          current = migration.name;
          await connection.executeScript(migration.sql);
          await connection.executeRaw({
            sql: `INSERT INTO "${migrationsTable}" ("name", "checksum", "applied_at") VALUES (?, ?, ?)`,
            args: [migration.name, migration.checksum, appliedAt],
            argTypes: [text, text, text],
          });
        }
        current = pending.at(-1)?.name ?? null;
        const violations = await connection.queryRaw({ sql: 'PRAGMA foreign_key_check', args: [], argTypes: [] });
        if (violations.rows.length > 0) {
          throw new Error(`${violations.rows.length} rows violate a foreign key after migrating.`);
        }
        await connection.executeScript('COMMIT');
      } catch (error) {
        await connection.executeScript('ROLLBACK');
        throw error;
      }
    } catch (error) {
      throw new MigrationFailedError(current, snapshot, error);
    }
    return { applied: pending.map((migration) => migration.name), schemaVersion: migrations.at(-1)?.name ?? null, snapshot };
  } finally {
    await connection.dispose();
  }
}

/** Creates the file readable and writable by the server's user only; SQLite gives its WAL files the same mode. */
function createPrivateFile(path: string): void {
  closeSync(openSync(path, 'a', 0o600));
}

async function scalar(connection: Connection, sql: string): Promise<unknown> {
  const result = await connection.queryRaw({ sql, args: [], argTypes: [] });
  return result.rows[0]?.[0];
}

async function hasTable(connection: Connection, table: string): Promise<boolean> {
  const result = await connection.queryRaw({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
    argTypes: [text],
  });
  return result.rows.length > 0;
}

async function readApplied(connection: Connection): Promise<AppliedMigration[]> {
  if (!(await hasTable(connection, migrationsTable))) {
    const tables = await connection.queryRaw({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
      args: [],
      argTypes: [],
    });
    if (tables.rows.length > 0) {
      throw new IncompatibleDatabaseError(
        'unrecognized',
        'The database file holds tables but no Nihon migration history; it was not created by a Nihon server.',
      );
    }
    return [];
  }
  const result = await connection.queryRaw({
    sql: `SELECT "name", "checksum" FROM "${migrationsTable}" ORDER BY "name"`,
    args: [],
    argTypes: [],
  });
  return result.rows.map(([name, checksum]) => ({ name: String(name), checksum: String(checksum) }));
}

/**
 * Writes a consistent copy of the database with `VACUUM INTO`, which reads one transaction
 * snapshot even while WAL frames are pending. The copy is synced to disk before it takes its
 * final name, so an interrupted snapshot never looks complete.
 */
async function takeSnapshot(connection: Connection, directory: string, schemaVersion: string, at: Date): Promise<string> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = at.toISOString().replaceAll(/[-:.]/g, '');
  const path = join(directory, `nihon-${stamp}-${schemaVersion}.db`);
  const partial = `${path}.partial`;
  rmSync(partial, { force: true });
  // VACUUM INTO fills an existing empty file, which keeps its private mode.
  createPrivateFile(partial);
  await connection.executeRaw({ sql: 'VACUUM INTO ?', args: [partial], argTypes: [text] });
  const descriptor = openSync(partial, 'r+');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(partial, path);
  pruneSnapshots(directory);
  return path;
}

function pruneSnapshots(directory: string): void {
  const files = readdirSync(directory).filter((name) => name.startsWith('nihon-'));
  for (const name of files.filter((file) => file.endsWith('.partial'))) {
    rmSync(join(directory, name), { force: true });
  }
  const snapshots = files.filter((file) => file.endsWith('.db')).sort();
  for (const name of snapshots.slice(0, Math.max(0, snapshots.length - maxSnapshots))) {
    rmSync(join(directory, name), { force: true });
  }
}

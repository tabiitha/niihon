import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { PrismaClient, type Prisma } from '../generated/prisma/client.ts';
import { loadMigrations } from './migrations.ts';
import { migrateDatabase, type MigrationOutcome } from './migrator.ts';
import { createWriteGate } from './write-gate.ts';

/** The single database of an installation, in the data directory. */
export const databaseFileName = 'nihon.db';
/** Directory of the snapshots taken before migrating, in the data directory. */
export const snapshotsDirName = 'snapshots';
/** Migrations packaged with the server: apps/api/prisma/migrations, from both src/ and dist/. */
export const packagedMigrationsDir = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

export interface DatabaseLimits {
  /** SQLite busy timeout of each connection. */
  readonly busyTimeoutMs: number;
  /** Longest wait of a write for its turn before `DatabaseBusyError`. */
  readonly maxWriteWaitMs: number;
  /** Writes allowed to wait at once. */
  readonly maxQueuedWrites: number;
  /** A write transaction still open after this delay is rolled back. */
  readonly maxTransactionMs: number;
}

export const defaultDatabaseLimits: DatabaseLimits = {
  busyTimeoutMs: 5_000,
  maxWriteWaitMs: 5_000,
  maxQueuedWrites: 64,
  maxTransactionMs: 5_000,
};

export type TransactionClient = Prisma.TransactionClient;

/**
 * Access to the installation database, owned by the server. Reads use a read-only connection that
 * sees committed data only; every write runs in a short transaction on the single writer
 * connection, one at a time.
 */
export interface Database {
  /** Read-only Prisma client; any write through it fails. */
  readonly reader: PrismaClient;
  /**
   * Runs `work` in a write transaction once earlier writes have finished. Fails with
   * `DatabaseBusyError` when the wait exceeds the limit, and rolls back on any error or when the
   * transaction outlives `maxTransactionMs`.
   */
  write<T>(work: (transaction: TransactionClient) => Promise<T>): Promise<T>;
  /** Refuses new writes, lets the running one finish, then closes both connections. */
  close(): Promise<void>;
}

export interface DatabaseOptions {
  readonly dataDir: string;
  readonly migrationsDir?: string;
  readonly limits?: Partial<DatabaseLimits>;
}

export interface OpenedDatabase {
  readonly database: Database;
  readonly migration: MigrationOutcome;
}

/**
 * Migrates the installation database to the packaged schema, then opens its connections. The
 * caller must already own the data directory (see instance-lock.ts).
 */
export async function openDatabase(options: DatabaseOptions): Promise<OpenedDatabase> {
  const limits = { ...defaultDatabaseLimits, ...options.limits };
  mkdirSync(options.dataDir, { recursive: true });
  const databasePath = join(options.dataDir, databaseFileName);
  const migration = await migrateDatabase({
    databasePath,
    snapshotsDir: join(options.dataDir, snapshotsDirName),
    migrations: loadMigrations(options.migrationsDir ?? packagedMigrationsDir),
    busyTimeoutMs: limits.busyTimeoutMs,
  });

  const writer = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databasePath, timeout: limits.busyTimeoutMs, fileMustExist: true }),
  });
  const reader = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: databasePath,
      timeout: limits.busyTimeoutMs,
      fileMustExist: true,
      readonly: true,
    }),
  });
  try {
    // Connection settings; the WAL journal mode itself is persistent and set by the migration step.
    await writer.$executeRawUnsafe('PRAGMA synchronous = FULL');
    await writer.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await reader.$connect();
  } catch (error) {
    await Promise.allSettled([writer.$disconnect(), reader.$disconnect()]);
    throw error;
  }

  const gate = createWriteGate({ maxWaitMs: limits.maxWriteWaitMs, maxQueued: limits.maxQueuedWrites });
  let closed: Promise<void> | undefined;
  const database: Database = {
    reader,
    write(work) {
      return gate.run(() =>
        writer.$transaction(work, { maxWait: limits.maxWriteWaitMs, timeout: limits.maxTransactionMs }),
      );
    },
    close() {
      closed ??= gate.close().then(async () => {
        await Promise.all([writer.$disconnect(), reader.$disconnect()]);
      });
      return closed;
    },
  };
  return { database, migration };
}

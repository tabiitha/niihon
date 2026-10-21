import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One versioned Prisma SQL migration: `prisma/migrations/<name>/migration.sql`. */
export interface Migration {
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

/** A migration recorded as applied in the database. */
export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

export type IncompatibilityReason = 'newer' | 'modified' | 'out_of_order' | 'unrecognized';

/** The database cannot be used by this server; it is left untouched. */
export class IncompatibleDatabaseError extends Error {
  override name = 'IncompatibleDatabaseError';

  readonly reason: IncompatibilityReason;

  constructor(reason: IncompatibilityReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Prisma's folder naming: a 14-digit UTC timestamp, then the migration name. */
const migrationNamePattern = /^\d{14}_[A-Za-z0-9_]+$/;

/**
 * The runner wraps all pending migrations in one transaction; a migration that ends it early
 * would leave a partially migrated database.
 */
const transactionControlPattern =
  /^\s*(BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(\s+TRANSACTION)?\s*;|END\s+TRANSACTION\b|(COMMIT|ROLLBACK|SAVEPOINT|RELEASE|VACUUM)\b)/im;

/** Reads the migrations packaged with the server, in application order. */
export function loadMigrations(directory: string): Migration[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      if (!migrationNamePattern.test(name)) {
        throw new Error(`Migration folder "${name}" does not follow the <14-digit timestamp>_<name> convention.`);
      }
      const file = join(directory, name, 'migration.sql');
      if (!existsSync(file)) {
        throw new Error(`Migration "${name}" has no migration.sql.`);
      }
      // Git may check SQL out with CRLF on Windows; the checksum covers the statements, not line endings.
      const sql = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
      if (transactionControlPattern.test(sql)) {
        throw new Error(`Migration "${name}" controls transactions itself; the server applies each run in one transaction.`);
      }
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Compares the migrations recorded in the database with those packaged with the server and returns
 * the ones to apply. The applied history must be an unchanged prefix of the packaged list; anything
 * else means the database belongs to another release, and it is refused rather than altered.
 */
export function planMigrations(applied: readonly AppliedMigration[], bundled: readonly Migration[]): Migration[] {
  const bundledNames = new Set(bundled.map((migration) => migration.name));
  applied.forEach((record, index) => {
    const expected = bundled[index];
    if (!bundledNames.has(record.name)) {
      throw new IncompatibleDatabaseError(
        'newer',
        `The database was migrated by a newer Nihon release (migration ${record.name} is unknown to this server). Install that release or a later one.`,
      );
    }
    if (expected?.name !== record.name) {
      throw new IncompatibleDatabaseError(
        'out_of_order',
        `The database history diverges from this server at migration ${expected?.name ?? record.name}.`,
      );
    }
    if (expected.checksum !== record.checksum) {
      throw new IncompatibleDatabaseError(
        'modified',
        `Migration ${record.name} was applied with different contents than this server packages.`,
      );
    }
  });
  return bundled.slice(applied.length);
}

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { packagedMigrationsDir } from './database.ts';
import { IncompatibleDatabaseError, loadMigrations, planMigrations, type Migration } from './migrations.ts';

const migration = (name: string, checksum = `sum-${name}`): Migration => ({ name, checksum, sql: '' });

describe('migration planning', () => {
  const bundled = [migration('20260101000000_a'), migration('20260201000000_b'), migration('20260301000000_c')];

  it('applies every migration to a new database', () => {
    assert.deepEqual(planMigrations([], bundled), bundled);
  });

  it('applies only the migrations after the recorded history', () => {
    assert.deepEqual(planMigrations(bundled.slice(0, 1), bundled), bundled.slice(1));
    assert.deepEqual(planMigrations(bundled, bundled), []);
  });

  it('refuses a database migrated by a newer release', () => {
    const applied = [...bundled, migration('20260401000000_d')];
    assert.throws(
      () => planMigrations(applied, bundled),
      (error) => error instanceof IncompatibleDatabaseError && error.reason === 'newer',
    );
  });

  it('refuses a migration applied with other contents', () => {
    const applied = [migration('20260101000000_a', 'changed')];
    assert.throws(
      () => planMigrations(applied, bundled),
      (error) => error instanceof IncompatibleDatabaseError && error.reason === 'modified',
    );
  });

  it('refuses a history that skips a packaged migration', () => {
    const applied = [bundled[0]!, bundled[2]!];
    assert.throws(
      () => planMigrations(applied, bundled),
      (error) => error instanceof IncompatibleDatabaseError && error.reason === 'out_of_order',
    );
  });
});

describe('migration loading', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'nihon-migrations-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function write(name: string, sql: string): void {
    mkdirSync(join(directory, name));
    writeFileSync(join(directory, name, 'migration.sql'), sql);
  }

  it('reads migration folders in timestamp order and ignores other files', () => {
    write('20260201000000_second', 'CREATE TABLE "b" ("id" INTEGER);\n');
    write('20260101000000_first', 'CREATE TABLE "a" ("id" INTEGER);\n');
    writeFileSync(join(directory, 'migration_lock.toml'), 'provider = "sqlite"\n');
    assert.deepEqual(
      loadMigrations(directory).map((loaded) => loaded.name),
      ['20260101000000_first', '20260201000000_second'],
    );
  });

  it('gives the same checksum whatever the line endings of the checkout', () => {
    write('20260101000000_lf', 'CREATE TABLE "a" ("id" INTEGER);\nCREATE TABLE "b" ("id" INTEGER);\n');
    write('20260201000000_crlf', 'CREATE TABLE "a" ("id" INTEGER);\r\nCREATE TABLE "b" ("id" INTEGER);\r\n');
    const [lf, crlf] = loadMigrations(directory);
    assert.equal(lf?.checksum, crlf?.checksum);
  });

  it('rejects a folder that does not follow the Prisma naming', () => {
    write('first', 'SELECT 1;');
    assert.throws(() => loadMigrations(directory), /convention/);
  });

  it('rejects a folder without migration.sql', () => {
    mkdirSync(join(directory, '20260101000000_empty'));
    assert.throws(() => loadMigrations(directory), /no migration\.sql/);
  });

  it('rejects a migration that controls transactions itself', () => {
    for (const statement of ['BEGIN;', 'begin immediate transaction;', 'COMMIT;', 'ROLLBACK;', 'END TRANSACTION;', 'VACUUM;']) {
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory);
      write('20260101000000_tx', `CREATE TABLE "a" ("id" INTEGER);\n${statement}\n`);
      assert.throws(() => loadMigrations(directory), /controls transactions/, statement);
    }
  });

  it('accepts triggers, whose bodies use BEGIN and END', () => {
    write(
      '20260101000000_trigger',
      'CREATE TABLE "a" ("id" INTEGER, "n" INTEGER);\nCREATE TRIGGER "a_n" AFTER INSERT ON "a"\nBEGIN\n  UPDATE "a" SET "n" = 1;\nEND;\n',
    );
    assert.equal(loadMigrations(directory).length, 1);
  });
});

describe('packaged migrations', () => {
  it('load without error', () => {
    assert.doesNotThrow(() => loadMigrations(packagedMigrationsDir));
  });

  it('change the schema only; reference datasets are not shipped as migrations', () => {
    // Literal rows belong to reference-dataset updates (docs/architecture/persistence.md); copying
    // existing rows with INSERT ... SELECT, as Prisma's table redefinitions do, stays allowed.
    for (const { name, sql } of loadMigrations(packagedMigrationsDir)) {
      assert.doesNotMatch(sql, /\bINSERT\b[^;]*\bVALUES\b/i, name);
    }
  });
});

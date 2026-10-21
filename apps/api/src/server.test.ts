import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { MigrationFailedError } from './database/migrator.ts';
import { silentLogger } from './log.ts';
import { startServer, type ServerOptions } from './server.ts';

describe('server startup with the database', () => {
  let root: string;
  let dataDir: string;
  let migrationsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nihon-server-db-'));
    dataDir = join(root, 'data');
    migrationsDir = join(root, 'migrations');
    mkdirSync(migrationsDir);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function addMigration(name: string, sql: string): void {
    mkdirSync(join(migrationsDir, name));
    writeFileSync(join(migrationsDir, name, 'migration.sql'), sql);
  }

  const options = (): ServerOptions => ({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    version: '1.2.3',
    modules: [],
    logger: silentLogger,
    migrationsDir,
  });

  it('applies pending migrations before listening, and none on the next start', async () => {
    addMigration('20260101000000_create_item', 'CREATE TABLE "Item" ("id" INTEGER NOT NULL PRIMARY KEY);\n');
    const first = await startServer(options());
    assert.deepEqual(first.migration.applied, ['20260101000000_create_item']);
    const response = await fetch(`http://127.0.0.1:${first.port}/api/health`);
    assert.equal(response.status, 200);
    await first.stop();

    const second = await startServer(options());
    assert.deepEqual(second.migration, { applied: [], schemaVersion: '20260101000000_create_item', snapshot: null });
    await second.stop();
  });

  it('does not listen when a migration fails, and releases the data directory', async () => {
    addMigration('20260101000000_broken', 'CREATE TABLE "Item" ("id" INTEGER);\nINSERT INTO "Missing" ("id") SELECT 1;\n');
    await assert.rejects(startServer(options()), MigrationFailedError);

    rmSync(join(migrationsDir, '20260101000000_broken'), { recursive: true });
    const recovered = await startServer(options());
    assert.deepEqual(recovered.migration.applied, []);
    await recovered.stop();
  });
});

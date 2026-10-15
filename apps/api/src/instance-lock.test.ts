import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { acquireInstanceLock, DataDirectoryInUseError } from './instance-lock.ts';

describe('acquireInstanceLock', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nihon-lock-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a missing data directory', () => {
    const dataDir = join(root, 'nested', 'data');
    const lock = acquireInstanceLock(dataDir);
    assert.ok(existsSync(lock.path));
    lock.release();
  });

  it('refuses a second claim on the same directory', () => {
    const lock = acquireInstanceLock(root);
    try {
      assert.throws(() => acquireInstanceLock(root), (error: unknown) => {
        assert.ok(error instanceof DataDirectoryInUseError);
        assert.equal(error.dataDir, root);
        return true;
      });
    } finally {
      lock.release();
    }
  });

  it('allows a new claim after release, and release is idempotent', () => {
    const first = acquireInstanceLock(root);
    first.release();
    first.release();
    const second = acquireInstanceLock(root);
    second.release();
  });

  it('keeps separate directories independent', () => {
    const first = acquireInstanceLock(join(root, 'a'));
    const second = acquireInstanceLock(join(root, 'b'));
    first.release();
    second.release();
  });
});

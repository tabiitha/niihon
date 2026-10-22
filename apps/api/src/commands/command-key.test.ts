import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CommandKeyError, commandKeyBytes, commandKeyFileName, loadCommandKey } from './command-key.ts';

describe('loadCommandKey', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'nihon-command-key-'));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it('creates a random key readable by the server user only, then returns the same key on every start', () => {
    const key = loadCommandKey(dataDir);
    assert.equal(key.length, commandKeyBytes);
    const path = join(dataDir, commandKeyFileName);
    assert.deepEqual(readFileSync(path), key);
    assert.equal(existsSync(`${path}.partial`), false);
    if (process.platform !== 'win32') {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    assert.deepEqual(loadCommandKey(dataDir), key);

    const other = mkdtempSync(join(tmpdir(), 'nihon-command-key-'));
    try {
      assert.notDeepEqual(loadCommandKey(other), key);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('refuses a key file of the wrong size and leaves it untouched', () => {
    const path = join(dataDir, commandKeyFileName);
    writeFileSync(path, 'truncated');
    assert.throws(() => loadCommandKey(dataDir), CommandKeyError);
    assert.equal(readFileSync(path, 'utf8'), 'truncated');
  });

  it('replaces a partial file left by an interrupted creation', () => {
    writeFileSync(join(dataDir, `${commandKeyFileName}.partial`), 'half');
    assert.equal(loadCommandKey(dataDir).length, commandKeyBytes);
  });
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { dataDirEntries } from './data-dir.ts';

const sqliteBusy = 5;

export class DataDirectoryInUseError extends Error {
  override name = 'DataDirectoryInUseError';

  readonly dataDir: string;

  constructor(dataDir: string) {
    super(`Another Nihon server is already using the data directory ${dataDir}.`);
    this.dataDir = dataDir;
  }
}

export interface InstanceLock {
  readonly path: string;
  release(): void;
}

/**
 * Claims exclusive ownership of a data directory. The claim is an exclusive SQLite transaction
 * on a dedicated file: the operating system drops it when the process ends, even after a crash,
 * and it holds across containers that share the same volume. The file itself is never deleted.
 */
export function acquireInstanceLock(dataDir: string): InstanceLock {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, dataDirEntries.instanceLock);
  const database = new DatabaseSync(path, { timeout: 0 });
  try {
    database.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    database.close();
    if (isBusy(error)) {
      throw new DataDirectoryInUseError(dataDir);
    }
    throw error;
  }

  let released = false;
  return {
    path,
    release() {
      if (released) {
        return;
      }
      released = true;
      database.exec('ROLLBACK');
      database.close();
    },
  };
}

function isBusy(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'errcode' in error && error.errcode === sqliteBusy;
}

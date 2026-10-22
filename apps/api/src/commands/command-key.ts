import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/** Secret of the installation that keys the fingerprints of idempotent commands, in the data directory. */
export const commandKeyFileName = 'nihon-command.key';
export const commandKeyBytes = 32;

/** The key file exists but does not hold a key; it is left untouched. */
export class CommandKeyError extends Error {
  override name = 'CommandKeyError';
}

/**
 * Reads the installation's command key, creating it on first start. The caller must own the data
 * directory (see instance-lock.ts). The key is written to a partial file, synced, then renamed, so
 * an interrupted creation never leaves a truncated key; only the server's user can read it.
 */
export function loadCommandKey(dataDir: string): Buffer {
  const path = join(dataDir, commandKeyFileName);
  let existing: Buffer | undefined;
  try {
    existing = readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  if (existing !== undefined) {
    if (existing.length !== commandKeyBytes) {
      throw new CommandKeyError(`${path} does not hold a ${commandKeyBytes}-byte key; delete it to create a new one.`);
    }
    return existing;
  }

  const key = randomBytes(commandKeyBytes);
  const partial = `${path}.partial`;
  // A partial file left by an interrupted creation is removed, so the new one is created with mode 600.
  rmSync(partial, { force: true });
  const descriptor = openSync(partial, 'wx', 0o600);
  try {
    writeSync(descriptor, key);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(partial, path);
  return key;
}

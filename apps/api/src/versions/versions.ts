import { errorCodes } from '../contract/conventions.ts';
import { ApiError } from '../contract/operation.ts';

export { formatVersion, ifMatchHeader, initialVersion, maxVersion, parseIfMatch, parseVersion, versionSchema } from './token.ts';

/**
 * The explicit conflict: the client's version is no longer the current one, so its change was
 * based on a state that no longer exists. Throwing it inside the write transaction rolls back the
 * whole write; the client reads the resource again and decides what to do.
 */
export function versionConflict(): ApiError {
  return new ApiError(
    412,
    errorCodes.versionConflict,
    'The resource changed since the version you hold; read it again and retry from its current state.',
  );
}

/**
 * Settles a conditional write: `result` is the number of rows an `UPDATE ... WHERE id = ? AND
 * version = ?` changed (`$executeRaw`'s result, or `updateMany`'s `{ count }`). None means another
 * write got there first, so the conflict is raised and the transaction rolls back. More than one
 * means the `where` did not name a single aggregate, a bug that must not be committed.
 */
export function requireWritten(result: number | { readonly count: number }): void {
  const changed = typeof result === 'number' ? result : result.count;
  if (changed === 0) {
    throw versionConflict();
  }
  if (changed !== 1) {
    throw new Error(`A versioned write changed ${changed} rows; it must name exactly one aggregate.`);
  }
}

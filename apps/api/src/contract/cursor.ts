import type { z } from 'zod';

import { errorCodes } from './conventions.ts';
import { ApiError } from './operation.ts';

/**
 * Cursors are opaque to clients: base64url-encoded JSON describing where the next page starts.
 * A module encodes the position of the last returned item and decodes it with its own schema.
 */
export function encodeCursor(position: unknown): string {
  return Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

/** Decodes a cursor produced by `encodeCursor`; anything else is a `validation_failed` error on `query.cursor`. */
export function decodeCursor<Schema extends z.ZodType>(cursor: string, schema: Schema): z.output<Schema> {
  let position: unknown;
  try {
    position = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    position = undefined;
  }
  const result = schema.safeParse(position);
  if (!result.success) {
    throw new ApiError(400, errorCodes.validationFailed, 'The request is invalid.', [
      { path: 'query.cursor', message: 'Unknown or expired cursor; restart from the first page.' },
    ]);
  }
  return result.data;
}

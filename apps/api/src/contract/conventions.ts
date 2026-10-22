import { z } from 'zod';

/**
 * Version of the REST contract published in contracts/openapi.json. Clients send the major part
 * in the `Nihon-API-Version` header; a different major is refused. See docs/architecture/api-contract.md.
 */
export const apiVersion = '1.1.0';
export const apiMajorVersion = 1;

export const apiVersionHeader = 'Nihon-API-Version';
export const requestIdHeader = 'Nihon-Request-Id';
/** Optional client key that makes a command safe to retry; see docs/architecture/command-idempotency.md. */
export const idempotencyKeyHeader = 'Idempotency-Key';
/** Set to `true` on the stored response of a command replayed under its idempotency key. */
export const idempotentReplayedHeader = 'Idempotent-Replayed';

/** Stable error codes owned by the server foundation. Modules add their own, prefixed by their identifier. */
export const errorCodes = {
  badRequest: 'bad_request',
  validationFailed: 'validation_failed',
  unsupportedApiVersion: 'unsupported_api_version',
  payloadTooLarge: 'payload_too_large',
  unsupportedMediaType: 'unsupported_media_type',
  notFound: 'not_found',
  internalError: 'internal_error',
  stopping: 'stopping',
  databaseBusy: 'database_busy',
  idempotencyKeyInUse: 'idempotency_key_in_use',
  idempotencyKeyReused: 'idempotency_key_reused',
  idempotencyCapacityReached: 'idempotency_capacity_reached',
} as const;

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ description: 'Stable, snake_case error code. Clients branch on it, never on the message.' }),
      message: z.string().meta({ description: 'English explanation for developers; not meant for display.' }),
      requestId: z.string().meta({ description: 'Correlates the response with the server log.' }),
      issues: z
        .array(
          z.object({
            path: z.string().meta({ description: 'Location of the invalid input, such as `query.limit`.' }),
            message: z.string(),
          }),
        )
        .optional()
        .meta({ description: 'Present on `validation_failed`: one entry per invalid input.' }),
    }),
  })
  .meta({ id: 'ErrorResponse', description: 'Body of every error response.' });

export type ErrorResponse = z.output<typeof errorResponseSchema>;

/** UTC instant with millisecond precision, as produced by `Date.prototype.toISOString`. */
export const timestampSchema = z.iso
  .datetime({ precision: 3 })
  .meta({ description: 'UTC timestamp, `YYYY-MM-DDTHH:mm:ss.sssZ`.', examples: ['2026-10-15T08:30:00.000Z'] });

/** Opaque identifier: clients store and compare it, never parse it. */
export const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .meta({ description: 'Opaque identifier of 1 to 64 characters `A-Z a-z 0-9 _ -`.' });

/** Client-chosen key of one command, such as a UUID: 16 to 64 characters `A-Z a-z 0-9 _ -`. */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/)
  .meta({
    description:
      'Key chosen by the client for one command, such as a random UUID, sent unquoted: 16 to 64 characters `A-Z a-z 0-9 _ -`. Retrying with the same key and the same input returns the confirmed response without repeating the effect; a key is never reused for another command.',
    examples: ['9b2f4c1e-7d3a-4e8b-a6f0-2c5d8e1b3a77'],
  });

export const defaultPageLimit = 50;
export const maxPageLimit = 100;
export const maxCursorLength = 512;

/** Query parameters of every paginated collection. */
export const pageQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(maxPageLimit)
    .default(defaultPageLimit)
    .meta({ description: `Maximum number of items in the page, 1 to ${maxPageLimit}.` }),
  cursor: z
    .string()
    .min(1)
    .max(maxCursorLength)
    .optional()
    .meta({ description: 'Opaque `nextCursor` of the previous page; omit it for the first page.' }),
});

/** One page of a collection in a stable order; `nextCursor` is null on the last page. */
export function pageSchema<Item extends z.ZodType>(item: Item, id: string) {
  return z
    .object({
      items: z.array(item),
      nextCursor: z
        .string()
        .nullable()
        .meta({ description: 'Cursor of the next page, or null when this page is the last one.' }),
    })
    .meta({ id, description: 'One page of a collection, in a stable order.' });
}

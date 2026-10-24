import { z } from 'zod';

/** Request header that carries the version of an aggregate the client holds; see docs/architecture/concurrency.md. */
export const ifMatchHeader = 'If-Match';

/** Version of an aggregate when it is created: a `version Int @default(1)` column. */
export const initialVersion = 1;

/**
 * Largest version a client can name. The next write of that aggregate yields `maxVersion + 1`,
 * which still fits the 32-bit integer of a Prisma `Int` column.
 */
export const maxVersion = 2_147_483_646;

const versionPattern = /^v([1-9][0-9]{0,9})$/;

/** The opaque token clients receive for a stored version, such as `v3`. They compare it, never parse it. */
export function formatVersion(version: number): string {
  if (!Number.isSafeInteger(version) || version < initialVersion || version > maxVersion + 1) {
    throw new RangeError(`Version ${version} is outside ${initialVersion}..${maxVersion + 1}.`);
  }
  return `v${version}`;
}

/** The stored version a token names, or `undefined` when it is not a token this server issues. */
export function parseVersion(token: string): number | undefined {
  const digits = versionPattern.exec(token)?.[1];
  if (digits === undefined) {
    return undefined;
  }
  const version = Number(digits);
  return version <= maxVersion ? version : undefined;
}

/** The version in an `If-Match` value: exactly one quoted token, such as `"v3"`; no `*`, list, or weak tag. */
export function parseIfMatch(value: string): number | undefined {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? parseVersion(value.slice(1, -1)) : undefined;
}

/** A version token in a response body: the `version` field of an aggregate. */
export const versionSchema = z
  .string()
  .regex(versionPattern)
  .meta({
    description:
      'Opaque version of this resource, changed by every write. Clients compare it and send it back in `If-Match`, between double quotes, to change the resource only if nobody else did; they never parse it.',
    examples: ['v3'],
  });

/** The `If-Match` request header of an operation that declares `expectsVersion`. */
export const ifMatchSchema = z
  .string()
  .regex(/^"v[1-9][0-9]{0,9}"$/)
  .meta({
    description:
      'The `version` of the resource the client last read, between double quotes: `"v3"`. The change applies only if the resource is still at this version; otherwise nothing is written (`version_conflict`).',
    examples: ['"v3"'],
  });

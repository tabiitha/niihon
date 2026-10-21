import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/**
 * Argon2id parameters for new hashes. Memory 64 MiB, 3 passes, 1 lane exceed the OWASP minimum
 * (19 MiB, 2 passes, 1 lane) while hashing in about 80 ms on the reference Mac; they are written
 * into every stored hash, so changing them later does not invalidate existing passwords.
 */
export const argon2Parameters = { memoryKiB: 65_536, passes: 3, parallelism: 1, saltBytes: 16, tagBytes: 32 } as const;

/** Largest memory cost a stored hash may ask a verification to allocate. */
const maxVerifyMemoryKiB = 262_144;
const maxVerifyPasses = 10;

/** Hashes a password into a PHC string: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<tag>`. */
export async function hashPassword(password: string): Promise<string> {
  const { memoryKiB, passes, parallelism, saltBytes, tagBytes } = argon2Parameters;
  const salt = randomBytes(saltBytes);
  const tag = await derive(password, salt, { memoryKiB, passes, parallelism }, tagBytes);
  return `$argon2id$v=19$m=${memoryKiB},t=${passes},p=${parallelism}$${toBase64(salt)}$${toBase64(tag)}`;
}

/** Checks a password against a stored hash in constant time; a malformed or oversized hash never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (match === null) {
    return false;
  }
  const memoryKiB = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  if (memoryKiB > maxVerifyMemoryKiB || passes > maxVerifyPasses || parallelism > 8 || memoryKiB < 8 * parallelism || passes < 1) {
    return false;
  }
  const salt = Buffer.from(match[4] ?? '', 'base64');
  const expected = Buffer.from(match[5] ?? '', 'base64');
  if (salt.length < 8 || expected.length < 16) {
    return false;
  }
  const actual = await derive(password, salt, { memoryKiB, passes, parallelism }, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function derive(
  password: string,
  salt: Buffer,
  { memoryKiB, passes, parallelism }: { memoryKiB: number; passes: number; parallelism: number },
  tagBytes: number,
): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'),
    nonce: salt,
    parallelism,
    tagLength: tagBytes,
    memory: memoryKiB,
    passes,
  });
}

function toBase64(bytes: Buffer): string {
  return bytes.toString('base64').replaceAll('=', '');
}

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';

import { IdTokenError, verifyIdToken } from './jwt.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const now = new Date('2026-10-21T12:00:00.000Z');
const seconds = Math.floor(now.getTime() / 1000);

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(claims: Record<string, unknown>, { alg = 'RS256', kid = 'k1', key = privateKey } = {}): string {
  const input = `${encode({ alg, kid })}.${encode(claims)}`;
  const signature = alg === 'none' ? '' : sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
  return `${input}.${signature}`;
}

const validClaims = { iss: 'https://accounts.google.com', aud: 'client', sub: '1234', nonce: 'n', exp: seconds + 600, iat: seconds - 5 };
const expectations = {
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  audience: 'client',
  nonce: 'n',
  now,
  findKey: async (keyId: string) => (keyId === 'k1' ? jwk : undefined),
};

async function refused(value: string, overrides: Partial<typeof expectations> = {}): Promise<string> {
  try {
    await verifyIdToken(value, { ...expectations, ...overrides });
  } catch (error) {
    assert.ok(error instanceof IdTokenError, String(error));
    return error.message;
  }
  assert.fail('The token was accepted.');
}

describe('ID token verification', () => {
  it('accepts a correctly signed token and returns issuer and subject', async () => {
    assert.deepEqual(await verifyIdToken(token(validClaims), expectations), { issuer: 'https://accounts.google.com', subject: '1234' });
  });

  it('accepts the second spelling of the issuer and several audiences with the right authorized party', async () => {
    await verifyIdToken(token({ ...validClaims, iss: 'accounts.google.com' }), expectations);
    await verifyIdToken(token({ ...validClaims, aud: ['client', 'other'], azp: 'client' }), expectations);
  });

  it('refuses unsigned tokens and algorithms other than RS256', async () => {
    assert.match(await refused(token(validClaims, { alg: 'none' })), /malformed|algorithm/);
    assert.match(await refused(token(validClaims, { alg: 'HS256' })), /algorithm/);
  });

  it('refuses a signature made with another key, and an altered payload', async () => {
    assert.match(await refused(token(validClaims, { key: other.privateKey })), /signature/);
    const [header, , signature] = token(validClaims).split('.') as [string, string, string];
    assert.match(await refused(`${header}.${encode({ ...validClaims, sub: 'victim' })}.${signature}`), /signature/);
  });

  it('refuses an unknown key identifier', async () => {
    assert.match(await refused(token(validClaims, { kid: 'unknown' })), /key/);
  });

  it('refuses the wrong issuer, audience, authorized party, nonce, subject, and times', async () => {
    assert.match(await refused(token({ ...validClaims, iss: 'https://evil.example' })), /issuer/);
    assert.match(await refused(token({ ...validClaims, aud: 'someone-else' })), /audience/);
    assert.match(await refused(token({ ...validClaims, aud: ['client', 'other'], azp: 'other' })), /authorized party/);
    assert.match(await refused(token({ ...validClaims, nonce: 'replayed' })), /nonce/);
    assert.match(await refused(token({ ...validClaims, nonce: undefined })), /nonce/);
    assert.match(await refused(token({ ...validClaims, sub: '' })), /subject/);
    assert.match(await refused(token({ ...validClaims, sub: 'x'.repeat(256) })), /subject/);
    assert.match(await refused(token({ ...validClaims, exp: seconds - 120 })), /expired/);
    assert.match(await refused(token({ ...validClaims, exp: undefined })), /expired/);
    assert.match(await refused(token({ ...validClaims, iat: seconds + 3600 })), /future/);
  });

  it('tolerates a small clock difference', async () => {
    await verifyIdToken(token({ ...validClaims, exp: seconds - 30 }), expectations);
  });

  it('refuses malformed and oversized tokens without echoing them', async () => {
    for (const value of ['', 'a.b', 'a.b.c.d', '!!.!!.!!', `${'a'.repeat(20_000)}.b.c`]) {
      const message = await refused(value);
      assert.ok(!message.includes(value) || value === '');
    }
  });
});

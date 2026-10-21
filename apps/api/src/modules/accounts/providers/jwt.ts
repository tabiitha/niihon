import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

/** The ID token does not pass verification; the message names the failed check and never carries the token. */
export class IdTokenError extends Error {
  override name = 'IdTokenError';
}

export interface IdTokenExpectations {
  /** Accepted `iss` values. */
  readonly issuers: readonly string[];
  /** The Nihon application's client identifier; must be in `aud`. */
  readonly audience: string;
  /** The nonce sent in the authorization request. */
  readonly nonce: string;
  readonly now: Date;
  /** Tolerated clock difference with the provider, in seconds. */
  readonly clockSkewSeconds?: number;
  /** Finds the signing key with this identifier, or `undefined` when the provider publishes none. */
  readonly findKey: (keyId: string) => Promise<JsonWebKey | undefined>;
}

export interface IdTokenClaims {
  readonly issuer: string;
  readonly subject: string;
}

const maxIdTokenLength = 16 * 1024;
const maxSubjectLength = 255;

/**
 * Verifies an OpenID Connect ID token signed with RS256: signature against the provider's key,
 * issuer, audience (and `azp` when several), expiry, issue time, and nonce. Only RS256 is accepted,
 * so `none` and symmetric algorithms cannot be forced by the token.
 */
export async function verifyIdToken(token: string, expectations: IdTokenExpectations): Promise<IdTokenClaims> {
  if (token.length > maxIdTokenLength) {
    throw new IdTokenError('The ID token is too large.');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new IdTokenError('The ID token is malformed.');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeObject(encodedHeader);
  if (header['alg'] !== 'RS256') {
    throw new IdTokenError('The ID token algorithm is not RS256.');
  }
  const keyId = header['kid'];
  if (typeof keyId !== 'string' || keyId === '') {
    throw new IdTokenError('The ID token names no signing key.');
  }
  const jwk = await expectations.findKey(keyId);
  if (jwk === undefined || jwk.kty !== 'RSA') {
    throw new IdTokenError('The ID token signing key is unknown.');
  }
  let valid: boolean;
  try {
    valid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    );
  } catch {
    throw new IdTokenError('The ID token signature cannot be checked.');
  }
  if (!valid) {
    throw new IdTokenError('The ID token signature is invalid.');
  }

  const claims = decodeObject(encodedPayload);
  const skew = expectations.clockSkewSeconds ?? 60;
  const nowSeconds = Math.floor(expectations.now.getTime() / 1000);
  const issuer = claims['iss'];
  if (typeof issuer !== 'string' || !expectations.issuers.includes(issuer)) {
    throw new IdTokenError('The ID token issuer is not accepted.');
  }
  const audiences = Array.isArray(claims['aud']) ? (claims['aud'] as unknown[]) : [claims['aud']];
  if (!audiences.includes(expectations.audience)) {
    throw new IdTokenError('The ID token audience is not this application.');
  }
  if (audiences.length > 1 && claims['azp'] !== expectations.audience) {
    throw new IdTokenError('The ID token authorized party is not this application.');
  }
  const expiry = claims['exp'];
  if (typeof expiry !== 'number' || expiry + skew <= nowSeconds) {
    throw new IdTokenError('The ID token has expired.');
  }
  const issuedAt = claims['iat'];
  if (typeof issuedAt !== 'number' || issuedAt - skew > nowSeconds) {
    throw new IdTokenError('The ID token was issued in the future.');
  }
  if (claims['nonce'] !== expectations.nonce) {
    throw new IdTokenError('The ID token nonce does not match.');
  }
  const subject = claims['sub'];
  if (typeof subject !== 'string' || subject === '' || subject.length > maxSubjectLength) {
    throw new IdTokenError('The ID token subject is missing.');
  }
  return { issuer, subject };
}

function decodeObject(encoded: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // reported below
  }
  throw new IdTokenError('The ID token is malformed.');
}

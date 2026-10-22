import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Request } from 'express';

import { hashSecret, isWellFormedSecret, newSecret, readCookie, readSessionToken } from './token.ts';

function request(headers: Record<string, string>): Request {
  return { get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe('session tokens', () => {
  const token = newSecret();

  it('creates 256-bit base64url secrets and stores only their SHA-256', () => {
    assert.ok(isWellFormedSecret(token));
    assert.notEqual(newSecret(), token);
    assert.match(hashSecret(token), /^[0-9a-f]{64}$/);
    assert.ok(!hashSecret(token).includes(token));
  });

  it('reads a bearer token first, then the session cookie', () => {
    assert.equal(readSessionToken(request({ authorization: `Bearer ${token}` })), token);
    assert.equal(readSessionToken(request({ authorization: `bearer  ${token}` })), token);
    assert.equal(readSessionToken(request({ cookie: `theme=dark; nihon_session=${token}; other=1` })), token);
    const other = newSecret();
    assert.equal(readSessionToken(request({ authorization: `Bearer ${token}`, cookie: `nihon_session=${other}` })), token);
  });

  it('treats malformed or foreign credentials as absent', () => {
    for (const headers of [
      {},
      { authorization: 'Basic dXNlcjpwYXNz' },
      { authorization: `Bearer ${token}x` },
      { authorization: `Bearer ${token} extra` },
      { authorization: 'Bearer ya29.provider-access-token' },
      { cookie: 'nihon_session=short' },
      { cookie: `nihon_session_other=${token}` },
      // A malformed Authorization header does not fall back to the cookie.
      { authorization: 'Bearer nope', cookie: `nihon_session=${token}` },
    ]) {
      assert.equal(readSessionToken(request(headers)), undefined, JSON.stringify(headers));
    }
  });

  it('reads one cookie by exact name', () => {
    assert.equal(readCookie(request({ cookie: 'a=1; ab=2' }), 'ab'), '2');
    assert.equal(readCookie(request({ cookie: 'a=1' }), 'b'), undefined);
    assert.equal(readCookie(request({}), 'a'), undefined);
  });
});

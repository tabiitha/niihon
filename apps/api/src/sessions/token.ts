import { createHash, randomBytes } from 'node:crypto';

import type { CookieOptions, Request, Response } from 'express';

/** Cookie that carries the Web client's session token. HttpOnly: page scripts never see it. */
export const sessionCookieName = 'nihon_session';
/** Every API route reads the session cookie; nothing outside `/api` receives it. */
export const sessionCookiePath = '/api';

/** 32 random bytes in base64url: 43 characters `A-Z a-z 0-9 _ -`. */
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** A new opaque secret: a session token, or the binding of a provider sign-in flow. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash of a secret is stored; the secret has 256 random bits, so a fast hash is enough. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function isWellFormedSecret(value: string): boolean {
  return tokenPattern.test(value);
}

/**
 * The session token a request presents: `Authorization: Bearer <token>` (native clients) or the
 * `nihon_session` cookie (Web). A malformed value is treated as absent, so it never reaches the
 * database.
 */
export function readSessionToken(request: Request): string | undefined {
  const authorization = request.get('authorization');
  if (authorization !== undefined) {
    const match = /^Bearer[ ]+(\S+)\s*$/i.exec(authorization);
    return match?.[1] !== undefined && isWellFormedSecret(match[1]) ? match[1] : undefined;
  }
  const cookie = readCookie(request, sessionCookieName);
  return cookie !== undefined && isWellFormedSecret(cookie) ? cookie : undefined;
}

/** Value of one cookie of the request, without a parser dependency; values here are base64url. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.get('cookie');
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/**
 * Attributes of Nihon's cookies: HttpOnly, `SameSite=Strict` so no other site's page can send
 * them, and `Secure` whenever the request arrived over HTTPS (a local installation is usually
 * plain HTTP on a loopback address, where browsers would drop a `Secure` cookie).
 */
export function cookieOptions(request: Request, path: string, maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: request.secure,
    path,
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}

/** Hands a Web client its session token; the cookie expires with the session. */
export function setSessionCookie(request: Request, response: Response, token: string, expiresAt: Date, now: Date): void {
  response.cookie(sessionCookieName, token, cookieOptions(request, sessionCookiePath, Math.max(0, expiresAt.getTime() - now.getTime())));
}

export function clearSessionCookie(request: Request, response: Response): void {
  response.clearCookie(sessionCookieName, cookieOptions(request, sessionCookiePath));
}

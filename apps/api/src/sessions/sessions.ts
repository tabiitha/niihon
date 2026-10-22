import { randomUUID } from 'node:crypto';

import type { Request, RequestHandler } from 'express';

import type { Database, TransactionClient } from '../database/database.ts';
import { hashSecret, newSecret, readSessionToken } from './token.ts';

/** How a client holds its session: an HttpOnly cookie (`web`) or a bearer token (`native`). */
export const sessionClients = ['web', 'native'] as const;
export type SessionClient = (typeof sessionClients)[number];

export interface SessionLimits {
  /** Fixed lifetime of a session from its sign-in; using it does not extend it. */
  readonly lifetimeMs: number;
  /** Sessions one profile keeps; signing in once more drops its oldest. */
  readonly maxPerProfile: number;
  /** Unexpired sessions of the installation; a further sign-in is refused. */
  readonly maxSessions: number;
  /** Expired sessions deleted at most by one sign-in. */
  readonly purgeBatch: number;
}

export const defaultSessionLimits: SessionLimits = {
  lifetimeMs: 30 * 24 * 60 * 60 * 1000,
  maxPerProfile: 20,
  maxSessions: 10_000,
  purgeBatch: 100,
};

/** The signed-in session of a request and the profile it acts for, read when the request arrived. */
export interface AuthenticatedSession {
  readonly id: string;
  readonly client: string;
  readonly signedInWith: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly profile: { readonly id: string; readonly username: string; readonly role: string };
}

export interface OpenedSession {
  /** The opaque secret the client presents from now on; only its hash is stored. */
  readonly token: string;
  readonly session: AuthenticatedSession;
}

/** Too many sessions are open on the installation; nothing was created. */
export class SessionCapacityError extends Error {
  override name = 'SessionCapacityError';
}

export interface Sessions {
  /**
   * Resolves the token a request presents to its session before any route runs. A missing,
   * malformed, unknown, expired, or revoked token leaves the request anonymous: only operations
   * declared `authenticated` refuse it, so signing in again always works.
   */
  readonly authenticate: RequestHandler;
  /**
   * Opens a session inside the caller's write transaction, so it exists only if that transaction
   * commits. `replaces` names a session of the same client to revoke at the same time. Throws
   * `SessionCapacityError`.
   */
  open(
    transaction: TransactionClient,
    input: { readonly profileId: string; readonly client: SessionClient; readonly signedInWith: string; readonly replaces?: string | undefined },
  ): Promise<OpenedSession>;
  /** Deletes a session; its token then matches nothing. Revoking a session that is gone does nothing. */
  revoke(sessionId: string): Promise<void>;
}

const authenticated = new WeakMap<Request, AuthenticatedSession>();

/** The session the request was authenticated with, if any. */
export function currentSession(request: Request): AuthenticatedSession | undefined {
  return authenticated.get(request);
}

/**
 * Nihon's own opaque sessions (issue #269). The token is random and meaningless; the server keeps
 * its SHA-256 with the profile, the client kind, and a fixed expiry, so a session survives a
 * restart, and signing out deletes it so its token stops authorizing anything at once. Provider
 * tokens never become Nihon sessions.
 */
export function createSessions(options: {
  readonly database: Database;
  readonly now?: () => Date;
  readonly limits?: Partial<SessionLimits>;
}): Sessions {
  const { database } = options;
  const now = options.now ?? (() => new Date());
  const limits = { ...defaultSessionLimits, ...options.limits };

  return {
    authenticate(request, _response, next) {
      const token = readSessionToken(request);
      if (token === undefined) {
        next();
        return;
      }
      database.reader.session
        .findUnique({
          where: { tokenHash: hashSecret(token) },
          include: { profile: { select: { id: true, username: true, role: true } } },
        })
        .then((found) => {
          if (found !== null && found.expiresAt.getTime() > now().getTime()) {
            authenticated.set(request, toAuthenticated(found));
          }
          next();
        }, next);
    },

    async open(transaction, { profileId, client, signedInWith, replaces }) {
      const created = now();
      // Expired sessions leave in batches with each sign-in, so the table stays bounded without a timer.
      await transaction.$executeRaw`DELETE FROM "Session" WHERE "id" IN (SELECT "id" FROM "Session" WHERE "expiresAt" <= ${created} LIMIT ${limits.purgeBatch})`;
      if (replaces !== undefined) {
        await transaction.session.deleteMany({ where: { id: replaces } });
      }
      const kept = await transaction.session.findMany({
        where: { profileId, expiresAt: { gt: created } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        skip: limits.maxPerProfile - 1,
      });
      if (kept.length > 0) {
        await transaction.session.deleteMany({ where: { id: { in: kept.map(({ id }) => id) } } });
      }
      if ((await transaction.session.count({ where: { expiresAt: { gt: created } } })) >= limits.maxSessions) {
        throw new SessionCapacityError('Too many sessions are open.');
      }
      const token = newSecret();
      const session = await transaction.session.create({
        data: {
          id: randomUUID(),
          tokenHash: hashSecret(token),
          profileId,
          client,
          signedInWith,
          createdAt: created,
          expiresAt: new Date(created.getTime() + limits.lifetimeMs),
        },
        include: { profile: { select: { id: true, username: true, role: true } } },
      });
      return { token, session: toAuthenticated(session) };
    },

    async revoke(sessionId) {
      await database.write((transaction) => transaction.session.deleteMany({ where: { id: sessionId } }));
    },
  };
}

function toAuthenticated(row: {
  id: string;
  client: string;
  signedInWith: string;
  createdAt: Date;
  expiresAt: Date;
  profile: { id: string; username: string; role: string };
}): AuthenticatedSession {
  return {
    id: row.id,
    client: row.client,
    signedInWith: row.signedInWith,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    profile: { id: row.profile.id, username: row.profile.username, role: row.profile.role },
  };
}

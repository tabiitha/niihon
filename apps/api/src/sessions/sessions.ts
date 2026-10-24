import { randomUUID } from 'node:crypto';

import type { Request, RequestHandler } from 'express';

import type { ChangeFeed } from '../changes/feed.ts';
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
  /**
   * Unexpired sessions of the installation; signing in once more drops the oldest of all, so a
   * flood of sign-ins can sign people out but never lock anyone out of signing in again.
   */
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

/** Topic announced when sessions of a profile open or end; its clients reread their current session. */
export const sessionsTopic = 'sessions';

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

export interface Sessions {
  /**
   * Resolves the token a request presents to its session before any route runs. A missing,
   * malformed, unknown, expired, or revoked token leaves the request anonymous: only operations
   * declaring `session: 'required'` refuse it, so signing in again always works.
   */
  readonly authenticate: RequestHandler;
  /**
   * Opens a session inside the caller's write transaction, so it exists only if that transaction
   * commits. `replaces` names a session of the same client to revoke at the same time. The
   * oldest sessions of the profile, then of the installation, are dropped to stay within the
   * limits; opening a session is never refused for lack of room.
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
  /** Told of every session opened or ended, for the clients of its profile; omitted, nothing is announced. */
  readonly changes?: ChangeFeed;
  readonly now?: () => Date;
  readonly limits?: Partial<SessionLimits>;
}): Sessions {
  const { database } = options;
  const now = options.now ?? (() => new Date());
  const limits = { ...defaultSessionLimits, ...options.limits };

  /** Announces, per profile, that its sessions changed, ending the subscriptions of the removed ones. */
  const announce = (transaction: TransactionClient, opened: string | undefined, removed: readonly { id: string; profileId: string }[]) => {
    const profiles = new Map<string, string[]>(opened === undefined ? [] : [[opened, []]]);
    for (const { id, profileId } of removed) {
      profiles.set(profileId, [...(profiles.get(profileId) ?? []), id]);
    }
    for (const [profileId, endsSessions] of profiles) {
      options.changes?.publish(transaction, { topic: sessionsTopic, profileId, endsSessions });
    }
  };

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
      const removed: { id: string; profileId: string }[] = [];
      if (replaces !== undefined) {
        const replaced = await transaction.session.findUnique({ where: { id: replaces }, select: { id: true, profileId: true } });
        if (replaced !== null) {
          await transaction.session.delete({ where: { id: replaced.id } });
          removed.push(replaced);
        }
      }
      const beyondProfile = await transaction.session.findMany({
        where: { profileId, expiresAt: { gt: created } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, profileId: true },
        skip: limits.maxPerProfile - 1,
      });
      if (beyondProfile.length > 0) {
        await transaction.session.deleteMany({ where: { id: { in: beyondProfile.map(({ id }) => id) } } });
        removed.push(...beyondProfile);
      }
      const open = await transaction.session.count({ where: { expiresAt: { gt: created } } });
      if (open >= limits.maxSessions) {
        const oldest = await transaction.session.findMany({
          where: { expiresAt: { gt: created } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, profileId: true },
          take: open - limits.maxSessions + 1,
        });
        await transaction.session.deleteMany({ where: { id: { in: oldest.map(({ id }) => id) } } });
        removed.push(...oldest);
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
      announce(transaction, profileId, removed);
      return { token, session: toAuthenticated(session) };
    },

    async revoke(sessionId) {
      await database.write(async (transaction) => {
        const revoked = await transaction.session.findUnique({ where: { id: sessionId }, select: { id: true, profileId: true } });
        if (revoked !== null) {
          await transaction.session.delete({ where: { id: revoked.id } });
          announce(transaction, undefined, [revoked]);
        }
      });
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

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ApiError } from '../../contract/operation.ts';
import type { Database, TransactionClient } from '../../database/database.ts';
import { DatabaseBusyError, DatabaseClosedError } from '../../database/write-gate.ts';
import type { Logger } from '../../log.ts';
import { sessionClients, type OpenedSession, type SessionClient, type Sessions } from '../../sessions/sessions.ts';
import { hashSecret, newSecret } from '../../sessions/token.ts';
import { accountsErrorCodes } from './contract.ts';
import {
  bounded,
  busy,
  flowConsumed,
  providerFailure,
  providerUnavailable,
  redirectUriInvalid,
  stateExpired,
  stateInvalid,
} from './errors.ts';
import type { Limiter } from './limiter.ts';
import { ProviderError, type OAuthProvider, type VerifiedIdentity } from './providers/provider.ts';
import { isAcceptedRedirectUri } from './redirect.ts';
import { localRegistration, type AccountsLimits } from './service.ts';
import { normalizeUsername } from './username.ts';

export interface SignInServiceOptions {
  readonly database: Database;
  readonly logger: Logger;
  readonly sessions: Sessions;
  readonly providers: ReadonlyMap<string, OAuthProvider>;
  readonly redirectUris: readonly string[];
  readonly hashPassword: (password: string) => Promise<string>;
  readonly verifyPassword: (password: string, hash: string) => Promise<boolean>;
  /** Shared with registration: verifying a password costs as much as hashing one. */
  readonly hashLimiter: Limiter;
  readonly exchangeLimiter: Limiter;
  readonly limits: AccountsLimits;
  readonly now: () => Date;
}

export interface SignedIn {
  readonly opened: OpenedSession;
  /** Where the token goes: a cookie for `web`, the response body for `native`. */
  readonly client: SessionClient;
}

export interface StartedSignIn {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly expiresAt: string;
  /** Secret only the initiating client holds; the HTTP adapter delivers it by cookie or body. */
  readonly clientBinding: string;
  readonly client: SessionClient;
}

/** Thrown inside a write transaction to roll it back and answer with a specific error. */
class Refusal extends Error {
  override name = 'Refusal';
}

/**
 * Sign-in business rules, independent of HTTP (issue #269): a local password or a provider identity
 * already linked to a profile opens a fresh Nihon session. Provider flows are single use, bound to
 * the client that started them, and superseded by that client's next attempt.
 */
export function createSignInService(options: SignInServiceOptions) {
  const { database, logger, sessions, providers, redirectUris, hashLimiter, exchangeLimiter, limits, now } = options;

  // An unknown username is checked against this hash, so it costs as long as a wrong password and
  // the answer time does not reveal which usernames exist. It is computed when the module starts,
  // so even the first such sign-in takes the usual time; a failed computation is retried.
  let unknownAccountHash: Promise<string> | undefined;
  const comparisonHash = (): Promise<string> => {
    unknownAccountHash ??= options.hashPassword(randomBytes(16).toString('base64url')).catch((error: unknown) => {
      unknownAccountHash = undefined;
      throw error;
    });
    return unknownAccountHash;
  };
  comparisonHash().catch(() => {
    // Retried by the first sign-in that needs it.
  });
  const verifyUnknown = async (password: string): Promise<false> => {
    await options.verifyPassword(password, await comparisonHash());
    return false;
  };

  const credentialsInvalid = () => new ApiError(401, accountsErrorCodes.credentialsInvalid, 'The username or password is incorrect.');

  return {
    /** `replaces` is the session the request already presents, revoked with the new one's creation. */
    async signInLocal(input: { username: string; password: string; client: SessionClient }, replaces: string | undefined): Promise<SignedIn> {
      // A username that breaks the registration rules cannot exist; it is refused like any unknown one.
      const username = normalizeUsername(input.username);
      const found =
        username === undefined
          ? null
          : await database.reader.profile.findUnique({
              where: { usernameKey: username.key },
              select: { id: true, localCredential: { select: { passwordHash: true } } },
            });
      const storedHash = found?.localCredential?.passwordHash;
      const matches = await bounded(hashLimiter, () =>
        storedHash === undefined ? verifyUnknown(input.password) : options.verifyPassword(input.password, storedHash),
      );
      if (found === null || storedHash === undefined || !matches) {
        logger('warn', 'account.sign_in_failed', { method: localRegistration });
        throw credentialsInvalid();
      }

      let opened: OpenedSession;
      try {
        opened = await database.write(async (transaction) => {
          // The password may have changed, or the profile been deleted, while it was being verified.
          const current = await transaction.localCredential.findUnique({ where: { profileId: found.id }, select: { passwordHash: true } });
          if (current?.passwordHash !== storedHash) {
            throw new Refusal(accountsErrorCodes.credentialsInvalid);
          }
          return sessions.open(transaction, { profileId: found.id, client: input.client, signedInWith: localRegistration, replaces });
        });
      } catch (error) {
        if (error instanceof Refusal) {
          throw credentialsInvalid();
        }
        throw error;
      }
      logger('info', 'account.signed_in', { profileId: found.id, sessionId: opened.session.id, method: localRegistration, client: input.client });
      return { opened, client: input.client };
    },

    /**
     * `previousBinding` is the binding this client holds from an earlier attempt, if any: that
     * attempt is superseded and its flow deleted, so its late return is refused.
     */
    async startOAuth(
      input: { provider: string; redirectUri: string; client: SessionClient },
      previousBinding: string | undefined,
    ): Promise<StartedSignIn> {
      const provider = providers.get(input.provider);
      if (provider === undefined) {
        throw providerUnavailable();
      }
      if (!isAcceptedRedirectUri(input.redirectUri, redirectUris)) {
        throw redirectUriInvalid();
      }

      const state = newSecret();
      const clientBinding = newSecret();
      const nonce = randomBytes(16).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const created = now();
      const expiresAt = new Date(created.getTime() + limits.flowTtlMs);

      await database.write(async (transaction) => {
        await transaction.oAuthSignInFlow.deleteMany({ where: { expiresAt: { lt: created } } });
        if (previousBinding !== undefined) {
          await transaction.oAuthSignInFlow.deleteMany({ where: { bindingHash: hashSecret(previousBinding) } });
        }
        if ((await transaction.oAuthSignInFlow.count()) >= limits.maxPendingFlows) {
          throw busy('Too many provider flows are pending.');
        }
        await transaction.oAuthSignInFlow.create({
          data: {
            id: randomUUID(),
            stateHash: hashSecret(state),
            bindingHash: hashSecret(clientBinding),
            provider: provider.id,
            codeVerifier,
            nonce,
            redirectUri: input.redirectUri,
            client: input.client,
            createdAt: created,
            expiresAt,
          },
        });
      });

      return {
        authorizationUrl: provider.authorizationUrl({ state, nonce, codeChallenge, redirectUri: input.redirectUri }),
        state,
        expiresAt: expiresAt.toISOString(),
        clientBinding,
        client: input.client,
      };
    },

    async completeOAuth(
      input: { state: string; code: string },
      clientBinding: string | undefined,
      replaces: string | undefined,
    ): Promise<SignedIn> {
      if (clientBinding === undefined) {
        throw clientMismatch();
      }
      // As for registration: a slot is taken first, so a refusal for lack of capacity leaves the
      // flow intact. The binding is checked before the flow is consumed, so a stolen `state` and
      // `code` presented by another client neither succeed nor spoil the real client's attempt.
      const { identity, client } = await bounded(exchangeLimiter, async () => {
        const flow = await database.write(async (transaction) => {
          const found = await transaction.oAuthSignInFlow.findUnique({ where: { stateHash: hashSecret(input.state) } });
          if (found === null) {
            return { outcome: 'unknown' } as const;
          }
          if (found.bindingHash !== hashSecret(clientBinding)) {
            return { outcome: 'mismatch' } as const;
          }
          const deleted = await transaction.oAuthSignInFlow.deleteMany({ where: { id: found.id } });
          return deleted.count === 1 ? ({ outcome: 'consumed', flow: found } as const) : ({ outcome: 'unknown' } as const);
        });
        if (flow.outcome === 'unknown') {
          throw stateInvalid();
        }
        if (flow.outcome === 'mismatch') {
          throw clientMismatch();
        }
        const { flow: consumed } = flow;
        if (consumed.expiresAt.getTime() <= now().getTime()) {
          throw stateExpired();
        }
        const provider = providers.get(consumed.provider);
        if (provider === undefined) {
          throw providerUnavailable();
        }
        try {
          const verified = await provider.verifyCode({
            code: input.code,
            codeVerifier: consumed.codeVerifier,
            nonce: consumed.nonce,
            redirectUri: consumed.redirectUri,
          });
          return { identity: verified, client: toClient(consumed.client) };
        } catch (error) {
          if (error instanceof ProviderError) {
            logger('warn', 'account.oauth_failed', { provider: provider.id, reason: error.kind });
            throw providerFailure(error);
          }
          throw error;
        }
      });

      let signedIn: { profileId: string; opened: OpenedSession };
      try {
        signedIn = await database.write(async (transaction) => {
          const profileId = await linkedProfile(transaction, identity);
          if (profileId === undefined) {
            throw new Refusal(accountsErrorCodes.identityNotRegistered);
          }
          return { profileId, opened: await sessions.open(transaction, { profileId, client, signedInWith: identity.provider, replaces }) };
        });
      } catch (error) {
        if (error instanceof Refusal) {
          logger('warn', 'account.sign_in_failed', { method: identity.provider, reason: 'identity_not_registered' });
          throw new ApiError(401, accountsErrorCodes.identityNotRegistered, 'No profile is linked to this provider identity; register first.');
        }
        if (error instanceof DatabaseBusyError || error instanceof DatabaseClosedError) {
          // No session was opened, but the flow and the provider's single-use code are spent.
          throw flowConsumed();
        }
        throw error;
      }
      logger('info', 'account.signed_in', { profileId: signedIn.profileId, sessionId: signedIn.opened.session.id, method: identity.provider, client });
      return { opened: signedIn.opened, client };
    },
  };
}

export type SignInService = ReturnType<typeof createSignInService>;

async function linkedProfile(
  transaction: TransactionClient,
  { provider, issuer, subject }: VerifiedIdentity,
): Promise<string | undefined> {
  const link = await transaction.externalIdentity.findUnique({
    where: { provider_issuer_subject: { provider, issuer, subject } },
    select: { profileId: true },
  });
  return link?.profileId;
}

/** The flow's client was validated when the flow started. */
function toClient(value: string): SessionClient {
  if (!(sessionClients as readonly string[]).includes(value)) {
    throw new Error(`Unknown session client "${value}" in a sign-in flow.`);
  }
  return value as SessionClient;
}

function clientMismatch(): ApiError {
  return new ApiError(400, accountsErrorCodes.clientMismatch, 'This flow was started by another client.');
}

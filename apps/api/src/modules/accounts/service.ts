import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ApiError } from '../../contract/operation.ts';
import type { Commit } from '../../commands/idempotency.ts';
import type { Database, TransactionClient } from '../../database/database.ts';
import { DatabaseBusyError, DatabaseClosedError } from '../../database/write-gate.ts';
import type { Logger } from '../../log.ts';
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
  usernameTaken,
  validationFailed,
} from './errors.ts';
import type { Limiter } from './limiter.ts';
import { checkPassword } from './password.ts';
import { ProviderError, type OAuthProvider } from './providers/provider.ts';
import { isAcceptedRedirectUri } from './redirect.ts';
import { normalizeUsername, type NormalizedUsername } from './username.ts';

/** Every new account starts here; no request field can change it. */
export const defaultRole = 'user';
export const localRegistration = 'local';

export interface AccountsLimits {
  /** Password hashes computed at once; each takes 64 MiB. */
  readonly hashConcurrency: number;
  readonly hashQueue: number;
  /** Provider code exchanges running at once. */
  readonly exchangeConcurrency: number;
  readonly exchangeQueue: number;
  /** Provider flows waiting for their browser to return. */
  readonly maxPendingFlows: number;
  readonly flowTtlMs: number;
}

export const defaultAccountsLimits: AccountsLimits = {
  hashConcurrency: 2,
  hashQueue: 16,
  exchangeConcurrency: 4,
  exchangeQueue: 16,
  maxPendingFlows: 500,
  flowTtlMs: 10 * 60 * 1000,
};

export interface ProfileView {
  readonly id: string;
  readonly username: string;
  readonly role: string;
  readonly registeredWith: string;
  readonly createdAt: string;
}

export interface AccountsServiceOptions {
  readonly database: Database;
  readonly logger: Logger;
  readonly providers: ReadonlyMap<string, OAuthProvider>;
  readonly redirectUris: readonly string[];
  readonly hashPassword: (password: string) => Promise<string>;
  readonly hashLimiter: Limiter;
  readonly exchangeLimiter: Limiter;
  readonly limits: AccountsLimits;
  readonly now: () => Date;
}

/** Thrown inside a write transaction to roll it back and answer with a specific error. */
class Refusal extends Error {
  override name = 'Refusal';
}

/**
 * Registration business rules, independent of HTTP. Every account is created by one write
 * transaction that checks uniqueness and inserts the profile with its credential or provider link,
 * so a refusal leaves nothing behind; writes are serialized by the database layer, so concurrent
 * attempts are decided one after the other.
 */
export function createAccountsService(options: AccountsServiceOptions) {
  const { database, logger, providers, redirectUris, hashPassword, hashLimiter, exchangeLimiter, limits, now } = options;

  const readUsername = (input: string): NormalizedUsername => {
    const normalized = normalizeUsername(input);
    if (normalized === undefined) {
      throw validationFailed('body.username', 'The username must have 3 to 32 letters, digits, "_", "-" or ".", starting with a letter or digit.');
    }
    return normalized;
  };

  const usernameIsTaken = async (key: string): Promise<boolean> =>
    (await database.reader.profile.findUnique({ where: { usernameKey: key }, select: { id: true } })) !== null;

  return {
    providerIds(): string[] {
      return [...providers.keys()].sort();
    },

    /** `commit` carries the creation; under an idempotency key it stores the returned profile with it. */
    async registerLocal(input: { username: string; password: string }, commit: Commit): Promise<ProfileView> {
      const username = readUsername(input.username);
      const passwordProblem = checkPassword(input.password, username.key);
      if (passwordProblem !== undefined) {
        throw validationFailed('body.password', passwordProblem);
      }
      // A cheap early answer before the expensive hash; the transaction below decides for real.
      if (await usernameIsTaken(username.key)) {
        throw usernameTaken();
      }
      const passwordHash = await bounded(hashLimiter, () => hashPassword(input.password));
      const profile = await writeProfile(commit, username, { kind: 'local', passwordHash }, now());
      logger('info', 'account.registered', { profileId: profile.id, method: localRegistration });
      return profile;
    },

    async startOAuth(input: { provider: string; username: string; redirectUri: string }) {
      const provider = providers.get(input.provider);
      if (provider === undefined) {
        throw providerUnavailable();
      }
      if (!isAcceptedRedirectUri(input.redirectUri, redirectUris)) {
        throw redirectUriInvalid();
      }
      const username = readUsername(input.username);
      if (await usernameIsTaken(username.key)) {
        throw usernameTaken();
      }

      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(16).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const created = now();
      const expiresAt = new Date(created.getTime() + limits.flowTtlMs);

      await database.write(async (transaction) => {
        // Flows that were never completed are dropped here, so the table stays bounded without a timer.
        await transaction.oAuthFlow.deleteMany({ where: { expiresAt: { lt: created } } });
        if ((await transaction.oAuthFlow.count()) >= limits.maxPendingFlows) {
          throw busy('Too many provider flows are pending.');
        }
        await transaction.oAuthFlow.create({
          data: {
            id: randomUUID(),
            stateHash: hashState(state),
            provider: provider.id,
            codeVerifier,
            nonce,
            redirectUri: input.redirectUri,
            username: username.username,
            createdAt: created,
            expiresAt,
          },
        });
      });

      return {
        authorizationUrl: provider.authorizationUrl({ state, nonce, codeChallenge, redirectUri: input.redirectUri }),
        state,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async completeOAuth(input: { state: string; code: string }, commit: Commit): Promise<ProfileView> {
      // A slot is taken before the flow is consumed, so a refusal for lack of capacity leaves the
      // flow intact and the client can retry. Once consumed, the flow is gone whatever happens next:
      // a replayed or concurrent completion finds nothing, and a refused code needs a new flow.
      const { identity, username: requestedUsername } = await bounded(exchangeLimiter, async () => {
        const flow = await database.write(async (transaction) => {
          const found = await transaction.oAuthFlow.findUnique({ where: { stateHash: hashState(input.state) } });
          if (found === null) {
            return null;
          }
          const deleted = await transaction.oAuthFlow.deleteMany({ where: { id: found.id } });
          return deleted.count === 1 ? found : null;
        });
        if (flow === null) {
          throw stateInvalid();
        }
        if (flow.expiresAt.getTime() <= now().getTime()) {
          throw stateExpired();
        }
        const provider = providers.get(flow.provider);
        if (provider === undefined) {
          throw providerUnavailable();
        }
        try {
          const verified = await provider.verifyCode({
            code: input.code,
            codeVerifier: flow.codeVerifier,
            nonce: flow.nonce,
            redirectUri: flow.redirectUri,
          });
          return { identity: verified, username: flow.username };
        } catch (error) {
          if (error instanceof ProviderError) {
            logger('warn', 'account.oauth_failed', { provider: provider.id, reason: error.kind });
            throw providerFailure(error);
          }
          throw error;
        }
      });

      const username = readUsername(requestedUsername);
      let profile;
      try {
        profile = await writeProfile(commit, username, { kind: 'provider', identity }, now());
      } catch (error) {
        if (error instanceof DatabaseBusyError || error instanceof DatabaseClosedError) {
          // Nothing was created, but the flow and the provider's single-use code are spent.
          throw flowConsumed();
        }
        throw error;
      }
      logger('info', 'account.registered', { profileId: profile.id, method: identity.provider });
      return profile;
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;

type Credential =
  | { readonly kind: 'local'; readonly passwordHash: string }
  | { readonly kind: 'provider'; readonly identity: { readonly provider: string; readonly issuer: string; readonly subject: string } };

/**
 * Creates the profile and its sign-in method atomically, through the command's `commit`; a refusal
 * rolls everything back. Returns the view built inside the transaction, which is what an
 * idempotent command stores as its response.
 */
async function writeProfile(commit: Commit, username: NormalizedUsername, credential: Credential, created: Date): Promise<ProfileView> {
  try {
    return await commit(async (transaction: TransactionClient) => {
      if (
        (await transaction.profile.findUnique({ where: { usernameKey: username.key }, select: { id: true } })) !== null
      ) {
        throw new Refusal(accountsErrorCodes.usernameTaken);
      }
      if (credential.kind === 'provider') {
        const { provider, issuer, subject } = credential.identity;
        const linked = await transaction.externalIdentity.findUnique({
          where: { provider_issuer_subject: { provider, issuer, subject } },
          select: { id: true },
        });
        if (linked !== null) {
          throw new Refusal(accountsErrorCodes.identityAlreadyRegistered);
        }
      }
      const profile = await transaction.profile.create({
        data: {
          id: randomUUID(),
          username: username.username,
          usernameKey: username.key,
          role: defaultRole,
          createdAt: created,
          ...(credential.kind === 'local'
            ? { localCredential: { create: { passwordHash: credential.passwordHash, createdAt: created } } }
            : { externalIdentities: { create: { id: randomUUID(), ...credential.identity, createdAt: created } } }),
        },
      });
      return {
        id: profile.id,
        username: profile.username,
        role: profile.role,
        registeredWith: credential.kind === 'local' ? localRegistration : credential.identity.provider,
        createdAt: profile.createdAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof Refusal) {
      throw error.message === accountsErrorCodes.usernameTaken
        ? usernameTaken()
        : new ApiError(409, accountsErrorCodes.identityAlreadyRegistered, 'This provider identity already has a profile.');
    }
    throw error;
  }
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

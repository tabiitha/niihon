import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { errorCodes } from '../../contract/conventions.ts';
import { ApiError } from '../../contract/operation.ts';
import type { Database, TransactionClient } from '../../database/database.ts';
import type { Logger } from '../../log.ts';
import { accountsErrorCodes } from './contract.ts';
import { LimiterFullError, type Limiter } from './limiter.ts';
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

  const toView = (profile: { id: string; username: string; role: string; createdAt: Date }, registeredWith: string): ProfileView => ({
    id: profile.id,
    username: profile.username,
    role: profile.role,
    registeredWith,
    createdAt: profile.createdAt.toISOString(),
  });

  const bounded = async <T>(limiter: Limiter, work: () => Promise<T>): Promise<T> => {
    try {
      return await limiter.run(work);
    } catch (error) {
      if (error instanceof LimiterFullError) {
        throw busy('Too many requests are being processed.');
      }
      throw error;
    }
  };

  return {
    providerIds(): string[] {
      return [...providers.keys()].sort();
    },

    async registerLocal(input: { username: string; password: string }): Promise<ProfileView> {
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
      const profile = await writeProfile(database, username, { kind: 'local', passwordHash }, now());
      logger('info', 'account.registered', { profileId: profile.id, method: localRegistration });
      return toView(profile, localRegistration);
    },

    async startOAuth(input: { provider: string; username: string; redirectUri: string }) {
      const provider = providers.get(input.provider);
      if (provider === undefined) {
        throw new ApiError(422, accountsErrorCodes.providerUnavailable, 'This provider is not available on this installation.');
      }
      if (!isAcceptedRedirectUri(input.redirectUri, redirectUris)) {
        throw new ApiError(400, accountsErrorCodes.redirectUriInvalid, 'The return address is not accepted.');
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

    async completeOAuth(input: { state: string; code: string }): Promise<ProfileView> {
      // The flow is consumed before anything else, whatever happens next: a replayed or concurrent
      // completion finds nothing to use, and a refused code needs a new flow.
      const flow = await database.write(async (transaction) => {
        const found = await transaction.oAuthFlow.findUnique({ where: { stateHash: hashState(input.state) } });
        if (found === null) {
          return null;
        }
        const deleted = await transaction.oAuthFlow.deleteMany({ where: { id: found.id } });
        return deleted.count === 1 ? found : null;
      });
      if (flow === null) {
        throw new ApiError(400, accountsErrorCodes.stateInvalid, 'The flow is unknown or was already used.');
      }
      if (flow.expiresAt.getTime() <= now().getTime()) {
        throw new ApiError(400, accountsErrorCodes.stateExpired, 'The flow has expired; start again.');
      }
      const provider = providers.get(flow.provider);
      if (provider === undefined) {
        throw new ApiError(422, accountsErrorCodes.providerUnavailable, 'This provider is not available on this installation.');
      }

      let identity;
      try {
        identity = await bounded(exchangeLimiter, () =>
          provider.verifyCode({
            code: input.code,
            codeVerifier: flow.codeVerifier,
            nonce: flow.nonce,
            redirectUri: flow.redirectUri,
          }),
        );
      } catch (error) {
        if (error instanceof ProviderError) {
          logger('warn', 'account.oauth_failed', { provider: provider.id, reason: error.kind });
          throw providerFailure(error);
        }
        throw error;
      }

      const username = readUsername(flow.username);
      const profile = await writeProfile(database, username, { kind: 'provider', identity }, now());
      logger('info', 'account.registered', { profileId: profile.id, method: identity.provider });
      return toView(profile, identity.provider);
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;

type Credential =
  | { readonly kind: 'local'; readonly passwordHash: string }
  | { readonly kind: 'provider'; readonly identity: { readonly provider: string; readonly issuer: string; readonly subject: string } };

/** Creates the profile and its sign-in method atomically; a refusal rolls everything back. */
async function writeProfile(database: Database, username: NormalizedUsername, credential: Credential, created: Date) {
  try {
    return await database.write(async (transaction: TransactionClient) => {
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
      return await transaction.profile.create({
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

function validationFailed(path: string, message: string): ApiError {
  return new ApiError(400, errorCodes.validationFailed, 'The request is invalid.', [{ path, message }]);
}

function usernameTaken(): ApiError {
  return new ApiError(409, accountsErrorCodes.usernameTaken, 'This username is already used.');
}

function busy(message: string): ApiError {
  return new ApiError(503, accountsErrorCodes.busy, message, undefined, { 'Retry-After': '1' });
}

function providerFailure(error: ProviderError): ApiError {
  switch (error.kind) {
    case 'code_rejected':
      return new ApiError(400, accountsErrorCodes.codeRejected, 'The provider refused the authorization code.');
    case 'identity_unverified':
      return new ApiError(400, accountsErrorCodes.identityUnverified, 'The provider identity could not be verified.');
    case 'unavailable':
      return new ApiError(502, accountsErrorCodes.providerFailed, 'The provider could not be used; try again later.');
  }
}

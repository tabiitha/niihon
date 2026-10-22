import type { Request, Response, Router } from 'express';

import { addOperation } from '../../contract/operation.ts';
import { currentSession, type AuthenticatedSession } from '../../sessions/sessions.ts';
import { clearSessionCookie, cookieOptions, isWellFormedSecret, readCookie, setSessionCookie } from '../../sessions/token.ts';
import type { ApiModule } from '../api-module.ts';
import {
  completeOAuthRegistration,
  listOAuthProviders,
  registerLocalAccount,
  registrationOperations,
  startOAuthRegistration,
} from './contract.ts';
import { createLimiter } from './limiter.ts';
import { hashPassword, verifyPassword } from './password-hash.ts';
import type { FetchFunction } from './providers/http.ts';
import { createGithubProvider, githubProviderId, type GithubEndpoints } from './providers/github.ts';
import { createGoogleProvider, googleProviderId, type GoogleEndpoints } from './providers/google.ts';
import type { OAuthProvider } from './providers/provider.ts';
import { createAccountsService, defaultAccountsLimits, type AccountsLimits } from './service.ts';
import { createSignInService, type SignedIn } from './sign-in.ts';
import { completeOAuthSignIn, getCurrentSession, signIn, signInOperations, signOut, startOAuthSignIn } from './sign-in-contract.ts';

/** HttpOnly cookie holding the Web client's binding to its pending provider sign-in. */
const bindingCookieName = 'nihon_oauth_binding';
const bindingCookiePath = '/api/accounts/oauth-sign-ins';

/** Seams for tests: provider endpoints, network, clock, limits, and hashing. Production uses the defaults. */
export interface AccountsModuleOptions {
  readonly googleEndpoints?: GoogleEndpoints;
  readonly githubEndpoints?: GithubEndpoints;
  readonly fetch?: FetchFunction;
  readonly now?: () => Date;
  readonly limits?: Partial<AccountsLimits>;
  readonly hashPassword?: (password: string) => Promise<string>;
  readonly verifyPassword?: (password: string, hash: string) => Promise<boolean>;
}

/**
 * Registration of local profiles with a username and password, or with a verified Google or
 * GitHub identity (issue #233), and sign-in to them, opening Nihon sessions (issue #269). Both
 * share the provider adapters in `providers/` and the hashing and exchange limits.
 */
export function createAccountsModule(options: AccountsModuleOptions = {}): ApiModule {
  return {
    id: 'accounts',
    operations: [...registrationOperations, ...signInOperations],
    register(router: Router, { database, commands, sessions, logger, oauth }) {
      const now = options.now ?? (() => new Date());
      const limits = { ...defaultAccountsLimits, ...options.limits };
      const providers = new Map<string, OAuthProvider>();
      for (const [id, credentials] of Object.entries(oauth.providers)) {
        if (id === googleProviderId) {
          providers.set(id, createGoogleProvider({ credentials, now, endpoints: options.googleEndpoints, fetch: options.fetch }));
        } else if (id === githubProviderId) {
          providers.set(id, createGithubProvider({ credentials, endpoints: options.githubEndpoints, fetch: options.fetch }));
        }
      }
      const shared = {
        database,
        logger,
        providers,
        redirectUris: oauth.redirectUris,
        hashPassword: options.hashPassword ?? hashPassword,
        hashLimiter: createLimiter({ concurrency: limits.hashConcurrency, maxQueued: limits.hashQueue }),
        exchangeLimiter: createLimiter({ concurrency: limits.exchangeConcurrency, maxQueued: limits.exchangeQueue }),
        limits,
        now,
      };
      const service = createAccountsService(shared);
      const signInService = createSignInService({ ...shared, sessions, verifyPassword: options.verifyPassword ?? verifyPassword });

      /** A `web` client receives its token as a cookie and never sees it; a `native` one in the body. */
      const deliver = (request: Request, { opened, client }: SignedIn) => {
        const response = request.res as Response;
        if (client === 'web') {
          setSessionCookie(request, response, opened.token, opened.session.expiresAt, now());
          return { session: toSessionView(opened.session) };
        }
        return { session: toSessionView(opened.session), token: opened.token };
      };

      // Answers describe people and flows: nothing here is worth caching.
      router.use((_request, response, next) => {
        response.set('Cache-Control', 'no-store');
        next();
      });

      commands.add(router, registerLocalAccount).handle(async ({ body }, commit) => ({
        status: 201,
        body: await service.registerLocal(body, commit),
      }));
      addOperation(router, listOAuthProviders).handle(() => ({
        status: 200,
        body: { items: service.providerIds().map((id) => ({ id })) },
      }));
      addOperation(router, startOAuthRegistration).handle(async ({ body }) => ({
        status: 201,
        body: await service.startOAuth(body),
      }));
      commands.add(router, completeOAuthRegistration).handle(async ({ body }, commit) => ({
        status: 201,
        body: await service.completeOAuth(body, commit),
      }));

      addOperation(router, signIn).handle(async ({ body }, request) => ({
        status: 201,
        body: deliver(request, await signInService.signInLocal(body, currentSession(request)?.id)),
      }));
      addOperation(router, startOAuthSignIn).handle(async ({ body }, request) => {
        const previous = readCookie(request, bindingCookieName);
        const started = await signInService.startOAuth(body, previous !== undefined && isWellFormedSecret(previous) ? previous : undefined);
        const { clientBinding, client, ...flow } = started;
        if (client === 'web') {
          (request.res as Response).cookie(bindingCookieName, clientBinding, cookieOptions(request, bindingCookiePath, limits.flowTtlMs));
          return { status: 201, body: flow };
        }
        return { status: 201, body: { ...flow, clientBinding } };
      });
      addOperation(router, completeOAuthSignIn).handle(async ({ body }, request) => {
        const cookie = readCookie(request, bindingCookieName);
        const binding = body.clientBinding ?? (cookie !== undefined && isWellFormedSecret(cookie) ? cookie : undefined);
        const signedIn = await signInService.completeOAuth(body, binding, currentSession(request)?.id);
        if (cookie !== undefined) {
          (request.res as Response).clearCookie(bindingCookieName, cookieOptions(request, bindingCookiePath));
        }
        return { status: 201, body: deliver(request, signedIn) };
      });
      addOperation(router, getCurrentSession).handle((_input, request) => ({
        status: 200,
        // Declared `authenticated`: the route only runs with a session.
        body: toSessionView(currentSession(request) as AuthenticatedSession),
      }));
      addOperation(router, signOut).handle(async (_input, request) => {
        const session = currentSession(request);
        if (session !== undefined) {
          await sessions.revoke(session.id);
          logger('info', 'account.signed_out', { profileId: session.profile.id, sessionId: session.id });
        }
        clearSessionCookie(request, request.res as Response);
        return { status: 204, body: undefined };
      });
    },
  };
}

export const accountsModule = createAccountsModule();

function toSessionView(session: AuthenticatedSession) {
  return {
    id: session.id,
    profile: session.profile,
    client: session.client,
    signedInWith: session.signedInWith,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

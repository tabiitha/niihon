import type { Router } from 'express';

import { addOperation } from '../../contract/operation.ts';
import type { ApiModule } from '../api-module.ts';
import {
  accountsOperations,
  completeOAuthRegistration,
  listOAuthProviders,
  registerLocalAccount,
  startOAuthRegistration,
} from './contract.ts';
import { createLimiter } from './limiter.ts';
import { hashPassword } from './password-hash.ts';
import type { FetchFunction } from './providers/http.ts';
import { createGithubProvider, githubProviderId, type GithubEndpoints } from './providers/github.ts';
import { createGoogleProvider, googleProviderId, type GoogleEndpoints } from './providers/google.ts';
import type { OAuthProvider } from './providers/provider.ts';
import { createAccountsService, defaultAccountsLimits, type AccountsLimits } from './service.ts';

/** Seams for tests: provider endpoints, network, clock, limits, and hashing. Production uses the defaults. */
export interface AccountsModuleOptions {
  readonly googleEndpoints?: GoogleEndpoints;
  readonly githubEndpoints?: GithubEndpoints;
  readonly fetch?: FetchFunction;
  readonly now?: () => Date;
  readonly limits?: Partial<AccountsLimits>;
  readonly hashPassword?: (password: string) => Promise<string>;
}

/**
 * Registration of local profiles with a username and password, or with a verified Google or
 * GitHub identity (issue #233). Sign-in and sessions belong to #76, which reuses the provider
 * adapters in `providers/`.
 */
export function createAccountsModule(options: AccountsModuleOptions = {}): ApiModule {
  return {
    id: 'accounts',
    operations: accountsOperations,
    register(router: Router, { database, commands, logger, oauth }) {
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
      const service = createAccountsService({
        database,
        logger,
        providers,
        redirectUris: oauth.redirectUris,
        hashPassword: options.hashPassword ?? hashPassword,
        hashLimiter: createLimiter({ concurrency: limits.hashConcurrency, maxQueued: limits.hashQueue }),
        exchangeLimiter: createLimiter({ concurrency: limits.exchangeConcurrency, maxQueued: limits.exchangeQueue }),
        limits,
        now,
      });

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
    },
  };
}

export const accountsModule = createAccountsModule();

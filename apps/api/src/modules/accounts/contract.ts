import { z } from 'zod';

import { maxRedirectUriLength } from '../../config.ts';
import { identifierSchema, timestampSchema } from '../../contract/conventions.ts';
import { defineOperation } from '../../contract/operation.ts';
import { maxPasswordLength, minPasswordLength } from './password.ts';
import { maxUsernameLength, minUsernameLength } from './username.ts';

/** Raw input bounds, applied before the finer rules; the rules themselves report precise issues. */
export const maxRawUsernameLength = 256;
export const maxRawPasswordLength = 512;
export const maxCodeLength = 2048;
export const maxStateLength = 128;
/** Registration bodies are small: a username, a password, or one provider return. */
export const maxRegistrationBodyBytes = 8 * 1024;

export const usernameField = z.string().min(1).max(maxRawUsernameLength).meta({
  description: `Account name, ${minUsernameLength} to ${maxUsernameLength} characters after Unicode NFKC normalization: letters of any script, digits, \`_\`, \`-\`, \`.\`, starting with a letter or digit. Two names that normalize to the same lowercase form are the same name.`,
  examples: ['sakura_42'],
});

export const providerField = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/)
  .meta({ description: 'Provider identifier as listed by `listOAuthProviders`, such as `google` or `github`.', examples: ['google'] });

export const profileSchema = z
  .object({
    id: identifierSchema,
    username: z.string().meta({ description: 'Display form of the username, NFKC-normalized, case preserved.' }),
    role: z.string().meta({
      description: 'Permission role. Every new account is `user`; the role cannot be chosen at registration.',
      examples: ['user'],
    }),
    registeredWith: z.string().meta({
      description: 'How the profile was created: `local` for a username and password, otherwise the provider identifier.',
      examples: ['local'],
    }),
    createdAt: timestampSchema,
  })
  .meta({ id: 'Profile', description: 'A local Nihon profile. It carries no credential and no provider data.' });

export const localRegistrationSchema = z
  .strictObject({
    username: usernameField,
    password: z.string().min(1).max(maxRawPasswordLength).meta({
      description: `Local password, ${minPasswordLength} to ${maxPasswordLength} characters after Unicode NFKC normalization, no control characters, different from the username. Hashed with Argon2id; never stored or returned as given.`,
    }),
  })
  .meta({ id: 'LocalRegistration', description: 'Credentials of a new local account. Fields other than these two, such as `role`, are refused.' });

export const oauthProviderListSchema = z
  .object({
    items: z.array(z.object({ id: providerField })).meta({ description: 'Providers this installation is configured for; empty when it has none or is offline.' }),
  })
  .meta({ id: 'OAuthProviderList', description: 'Providers available for registration.' });

export const redirectUriField = z.string().min(1).max(maxRedirectUriLength).meta({
  description:
    'Where the browser returns after the provider: an `http://127.0.0.1`, `http://localhost`, or `http://[::1]` address, or an address the installation lists in `NIHON_OAUTH_REDIRECT_URIS`. Must also be registered with the provider.',
});

export const stateField = z.string().regex(/^[A-Za-z0-9_-]+$/).max(maxStateLength).meta({ description: '`state` of the flow, as returned by the provider.' });
export const codeField = z.string().min(1).max(maxCodeLength).meta({ description: 'Authorization code the provider returned to `redirectUri`.' });

export const oauthStartSchema = z
  .strictObject({
    provider: providerField,
    username: usernameField,
    redirectUri: redirectUriField,
  })
  .meta({ id: 'OAuthRegistrationStart', description: 'Starts a provider registration for a chosen username.' });

export const oauthStartedSchema = z
  .object({
    authorizationUrl: z.string().meta({ description: 'Address to open in the browser to authenticate with the provider.' }),
    state: z.string().meta({
      description: 'Value the provider returns to `redirectUri`. The client compares it with the returned one, then sends it to `completeOAuthRegistration`.',
    }),
    expiresAt: timestampSchema.meta({ description: 'The flow can be completed until this instant.' }),
  })
  .meta({ id: 'OAuthRegistrationStarted', description: 'A provider registration waiting for the browser to return.' });

export const oauthCompleteSchema = z
  .strictObject({
    state: stateField,
    code: codeField,
  })
  .meta({ id: 'OAuthRegistrationCompletion', description: 'The provider answer for a started registration. A flow can be completed once.' });

export const registerLocalAccount = defineOperation({
  operationId: 'registerLocalAccount',
  method: 'post',
  path: '/local-registrations',
  summary: 'Register a local account with a username and password',
  description:
    'Works offline. Creates the profile and its credential together or not at all. No session is opened. With an `Idempotency-Key`, a retry after the profile was created returns the same profile instead of `accounts_username_taken`.',
  body: localRegistrationSchema,
  maxBodyBytes: maxRegistrationBodyBytes,
  idempotent: true,
  responses: { 201: { description: 'The profile was created.', schema: profileSchema } },
  errors: {
    409: 'The normalized username is already used (`accounts_username_taken`).',
    503: 'Too many registrations are being processed; retry after `Retry-After` (`accounts_busy`).',
  },
});

export const listOAuthProviders = defineOperation({
  operationId: 'listOAuthProviders',
  method: 'get',
  path: '/oauth-providers',
  summary: 'List the providers available for registration',
  responses: { 200: { description: 'The configured providers.', schema: oauthProviderListSchema } },
});

export const startOAuthRegistration = defineOperation({
  operationId: 'startOAuthRegistration',
  method: 'post',
  path: '/oauth-registrations',
  summary: 'Start registering with a Google or GitHub identity',
  description:
    'Requires Internet to reach the provider. The username is checked now and again when the flow completes. The flow expires after 10 minutes.',
  body: oauthStartSchema,
  maxBodyBytes: maxRegistrationBodyBytes,
  responses: { 201: { description: 'The flow was created.', schema: oauthStartedSchema } },
  errors: {
    400: '`redirectUri` is not an accepted return address (`accounts_oauth_redirect_uri_invalid`).',
    409: 'The normalized username is already used (`accounts_username_taken`).',
    422: 'The provider is unknown or not configured on this installation (`accounts_oauth_provider_unavailable`).',
    503: 'Too many provider flows are pending; retry after `Retry-After` (`accounts_busy`).',
  },
});

export const completeOAuthRegistration = defineOperation({
  operationId: 'completeOAuthRegistration',
  method: 'post',
  path: '/oauth-registrations/completion',
  summary: 'Complete a provider registration with the returned code',
  description:
    'Verifies the code and identity with the provider, then creates the profile and its provider link together or not at all. The flow is consumed by the first attempt that obtains an exchange slot and the database write turn, successful or not: a replayed or concurrent completion creates nothing, while a `503` refusal for lack of capacity leaves the flow intact. An email address is neither required nor read, and profiles are never merged by email. With an `Idempotency-Key`, a retry after the profile was created returns the same profile instead of `accounts_oauth_state_invalid`, without calling the provider again.',
  body: oauthCompleteSchema,
  maxBodyBytes: maxRegistrationBodyBytes,
  idempotent: true,
  responses: { 201: { description: 'The profile and its provider link were created.', schema: profileSchema } },
  errors: {
    400: 'The flow is unknown or already used (`accounts_oauth_state_invalid`), expired (`accounts_oauth_state_expired`), the provider refused the code (`accounts_oauth_code_rejected`), or the identity could not be verified (`accounts_oauth_identity_unverified`).',
    409: 'The username was taken meanwhile (`accounts_username_taken`), or this provider identity already has a profile (`accounts_identity_already_registered`).',
    422: 'The flow was started for a provider this installation no longer has configured (`accounts_oauth_provider_unavailable`); the flow is consumed.',
    502: 'The provider could not be reached or answered unusably (`accounts_oauth_provider_failed`); the flow is consumed, start a new registration.',
    503: 'Too many provider exchanges are running (`accounts_busy`, `Retry-After` set): the flow is untouched, retry the same completion. If instead the database stayed busy after the provider answered (`accounts_oauth_flow_consumed`, no `Retry-After`), nothing was created and the flow is used up: start a new registration.',
  },
});

export const registrationOperations = [registerLocalAccount, listOAuthProviders, startOAuthRegistration, completeOAuthRegistration];

/** Stable error codes of the accounts module. */
export const accountsErrorCodes = {
  usernameTaken: 'accounts_username_taken',
  busy: 'accounts_busy',
  redirectUriInvalid: 'accounts_oauth_redirect_uri_invalid',
  providerUnavailable: 'accounts_oauth_provider_unavailable',
  stateInvalid: 'accounts_oauth_state_invalid',
  stateExpired: 'accounts_oauth_state_expired',
  codeRejected: 'accounts_oauth_code_rejected',
  identityUnverified: 'accounts_oauth_identity_unverified',
  providerFailed: 'accounts_oauth_provider_failed',
  identityAlreadyRegistered: 'accounts_identity_already_registered',
  flowConsumed: 'accounts_oauth_flow_consumed',
  credentialsInvalid: 'accounts_credentials_invalid',
  clientMismatch: 'accounts_oauth_client_mismatch',
  identityNotRegistered: 'accounts_identity_not_registered',
} as const;

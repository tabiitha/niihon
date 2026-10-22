import { z } from 'zod';

import { identifierSchema, timestampSchema } from '../../contract/conventions.ts';
import { defineOperation } from '../../contract/operation.ts';
import { sessionClients } from '../../sessions/sessions.ts';
import {
  codeField,
  maxRawPasswordLength,
  maxRegistrationBodyBytes,
  providerField,
  redirectUriField,
  stateField,
  usernameField,
} from './contract.ts';

/** Sign-in bodies are as small as registration ones: credentials or one provider return. */
const maxSignInBodyBytes = maxRegistrationBodyBytes;

const clientField = z.enum(sessionClients).meta({
  description:
    'How this client keeps its session. `web`: the server sets an HttpOnly `nihon_session` cookie and the response carries no token. `native`: the response carries `token`, which the client keeps in secure storage and sends as `Authorization: Bearer <token>`.',
  examples: ['web'],
});

const clientBindingField = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({ description: 'Secret that ties a provider sign-in to the client that started it. Never put it in a URL.' });

export const sessionSchema = z
  .object({
    id: identifierSchema,
    profile: z
      .object({
        id: identifierSchema,
        username: z.string().meta({ description: 'Display form of the username.' }),
        role: z.string().meta({ description: 'Permission role of the profile, such as `user`.', examples: ['user'] }),
      })
      .meta({ id: 'SessionProfile', description: 'The profile the session acts for.' }),
    client: z.string().meta({ description: 'Client kind the session was opened for: `web` or `native`.', examples: ['web'] }),
    signedInWith: z.string().meta({ description: '`local` for a password, otherwise the provider identifier.', examples: ['local'] }),
    createdAt: timestampSchema,
    expiresAt: timestampSchema.meta({ description: 'The session stops authorizing anything at this instant; using it does not extend it.' }),
  })
  .meta({ id: 'Session', description: 'A signed-in Nihon session. It never carries the token or any provider token.' });

export const signedInSchema = z
  .object({
    session: sessionSchema,
    token: z.string().optional().meta({
      description:
        'Present for a `native` client only: the opaque session token, shown once. Send it as `Authorization: Bearer <token>`; keep it in secure storage, never in a URL or a log.',
    }),
  })
  .meta({ id: 'SignedIn', description: 'A new session. A `web` client receives its token as an HttpOnly cookie instead.' });

export const localSignInSchema = z
  .strictObject({
    username: usernameField,
    password: z.string().min(1).max(maxRawPasswordLength).meta({ description: 'Local password of the profile.' }),
    client: clientField,
  })
  .meta({ id: 'LocalSignIn', description: 'Credentials of an existing local profile.' });

export const oauthSignInStartSchema = z
  .strictObject({
    provider: providerField,
    redirectUri: redirectUriField,
    client: clientField,
  })
  .meta({ id: 'OAuthSignInStart', description: 'Starts signing in with a provider identity already linked to a profile.' });

export const oauthSignInStartedSchema = z
  .object({
    authorizationUrl: z.string().meta({ description: 'Address to open in the browser to authenticate with the provider.' }),
    state: z.string().meta({
      description: 'Value the provider returns to `redirectUri`. The client compares it with the returned one, then sends it to `completeOAuthSignIn`.',
    }),
    expiresAt: timestampSchema.meta({ description: 'The flow can be completed until this instant.' }),
    clientBinding: clientBindingField.optional().meta({
      description:
        'Present for a `native` client only: send it back to `completeOAuthSignIn`. A `web` client holds it as an HttpOnly cookie instead. Only the client that started the flow can complete it.',
    }),
  })
  .meta({ id: 'OAuthSignInStarted', description: 'A provider sign-in waiting for the browser to return.' });

export const oauthSignInCompleteSchema = z
  .strictObject({
    state: stateField,
    code: codeField,
    clientBinding: clientBindingField.optional().meta({ description: '`clientBinding` of the start response; required for a `native` flow, omitted on the Web.' }),
  })
  .meta({ id: 'OAuthSignInCompletion', description: 'The provider answer for a started sign-in. A flow can be completed once.' });

const replacesSession =
  'A session the request already presents (cookie or bearer token) is revoked in the same transaction, so switching profiles on one client leaves no session behind.';

export const signIn = defineOperation({
  operationId: 'signIn',
  method: 'post',
  path: '/sessions',
  summary: 'Sign in with a username and password',
  description: `Works offline. Opens a new session that expires 30 days later. An unknown username and a wrong password are refused alike. ${replacesSession}`,
  body: localSignInSchema,
  maxBodyBytes: maxSignInBodyBytes,
  responses: { 201: { description: 'The session was opened.', schema: signedInSchema } },
  errors: {
    401: 'The username and password do not match a profile with a local password (`accounts_credentials_invalid`).',
    503: 'Too many sign-ins are being processed or too many sessions are open; retry after `Retry-After` (`accounts_busy`).',
  },
});

export const startOAuthSignIn = defineOperation({
  operationId: 'startOAuthSignIn',
  method: 'post',
  path: '/oauth-sign-ins',
  summary: 'Start signing in with a Google or GitHub identity',
  description:
    'Requires Internet to reach the provider. The flow expires after 10 minutes and can only be completed by the client that started it. Starting again from the same browser supersedes its previous flow, whose late return is then refused.',
  body: oauthSignInStartSchema,
  maxBodyBytes: maxSignInBodyBytes,
  responses: { 201: { description: 'The flow was created.', schema: oauthSignInStartedSchema } },
  errors: {
    400: '`redirectUri` is not an accepted return address (`accounts_oauth_redirect_uri_invalid`).',
    422: 'The provider is unknown or not configured on this installation (`accounts_oauth_provider_unavailable`).',
    503: 'Too many provider flows are pending; retry after `Retry-After` (`accounts_busy`).',
  },
});

export const completeOAuthSignIn = defineOperation({
  operationId: 'completeOAuthSignIn',
  method: 'post',
  path: '/oauth-sign-ins/completion',
  summary: 'Complete a provider sign-in with the returned code',
  description: `Checks that the flow belongs to this client, consumes it, verifies the code and identity with the provider, then opens a session for the profile linked to that identity. The provider's tokens are discarded: they never authorize Nihon operations. An email address is neither required nor read. ${replacesSession}`,
  body: oauthSignInCompleteSchema,
  maxBodyBytes: maxSignInBodyBytes,
  responses: { 201: { description: 'The session was opened.', schema: signedInSchema } },
  errors: {
    400: 'The flow is unknown, already used, or superseded (`accounts_oauth_state_invalid`), expired (`accounts_oauth_state_expired`), started by another client (`accounts_oauth_client_mismatch`, the flow is untouched), the provider refused the code (`accounts_oauth_code_rejected`), or the identity could not be verified (`accounts_oauth_identity_unverified`).',
    401: 'The verified provider identity is not linked to any profile (`accounts_identity_not_registered`); register first.',
    422: 'The flow was started for a provider this installation no longer has configured (`accounts_oauth_provider_unavailable`); the flow is consumed.',
    502: 'The provider could not be reached or answered unusably (`accounts_oauth_provider_failed`); the flow is consumed, start again.',
    503: 'Too many provider exchanges are running (`accounts_busy`, `Retry-After` set): the flow is untouched, retry the same completion. If instead the database stayed busy after the provider answered (`accounts_oauth_flow_consumed`, no `Retry-After`), no session was opened and the flow is used up: start again.',
  },
});

export const getCurrentSession = defineOperation({
  operationId: 'getCurrentSession',
  method: 'get',
  path: '/sessions/current',
  summary: 'Read the session this request is signed in with',
  authenticated: true,
  responses: { 200: { description: 'The current session.', schema: sessionSchema } },
});

export const signOut = defineOperation({
  operationId: 'signOut',
  method: 'delete',
  path: '/sessions/current',
  summary: 'Sign out: revoke the session this request presents',
  description:
    'The session is deleted at once: its token no longer authorizes any operation, on any client. The Web cookie is cleared. Always answers `204`, also when the session had already expired or been revoked, so a retry is safe. It does not disconnect any provider account.',
  responses: { 204: { description: 'No session remains for the presented token.' } },
});

export const signInOperations = [signIn, startOAuthSignIn, completeOAuthSignIn, getCurrentSession, signOut];

import type { OAuthClientCredentials } from '../../../config.ts';
import { fetchJson, stringField, type FetchFunction } from './http.ts';
import { createKeySet } from './jwks.ts';
import { IdTokenError, verifyIdToken } from './jwt.ts';
import { ProviderError, type OAuthProvider } from './provider.ts';

export const googleProviderId = 'google';

export interface GoogleEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly issuers: readonly string[];
}

/** Published in https://accounts.google.com/.well-known/openid-configuration. */
export const googleEndpoints: GoogleEndpoints = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};

/** The issuer recorded for Google identities, whichever of its two spellings the token carries. */
const googleIssuer = 'https://accounts.google.com';

/**
 * Google OpenID Connect, authorization code flow with PKCE. Only the `openid` scope is requested:
 * Nihon needs the stable `sub`, and neither the email address nor the name is read or kept.
 */
export function createGoogleProvider(options: {
  readonly credentials: OAuthClientCredentials;
  readonly endpoints?: GoogleEndpoints | undefined;
  readonly fetch?: FetchFunction | undefined;
  readonly now?: (() => Date) | undefined;
}): OAuthProvider {
  const { credentials, endpoints = googleEndpoints, fetch: fetchImpl = fetch, now = () => new Date() } = options;
  const keys = createKeySet(endpoints.jwksUri, fetchImpl, now);

  return {
    id: googleProviderId,
    authorizationUrl({ state, nonce, codeChallenge, redirectUri }) {
      const url = new URL(endpoints.authorizationEndpoint);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return url.toString();
    },
    async verifyCode({ code, codeVerifier, nonce, redirectUri }) {
      const response = await fetchJson(fetchImpl, endpoints.tokenEndpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code_verifier: codeVerifier,
        }),
      });
      if (response.status === 400 && stringField(response.json, 'error') === 'invalid_grant') {
        throw new ProviderError('code_rejected', 'Google refused the authorization code.');
      }
      const idToken = stringField(response.json, 'id_token');
      if (response.status !== 200 || idToken === undefined) {
        throw new ProviderError('unavailable', 'Google did not return an ID token.');
      }
      try {
        const claims = await verifyIdToken(idToken, {
          issuers: endpoints.issuers,
          audience: credentials.clientId,
          nonce,
          now: now(),
          findKey: (keyId) => keys.findKey(keyId),
        });
        return {
          provider: googleProviderId,
          issuer: googleIssuer,
          subject: claims.subject,
        };
      } catch (error) {
        if (error instanceof IdTokenError) {
          throw new ProviderError('identity_unverified', error.message);
        }
        throw error;
      }
    },
  };
}

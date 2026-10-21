import type { OAuthClientCredentials } from '../../../config.ts';
import { fetchJson, stringField, type FetchFunction } from './http.ts';
import { ProviderError, type OAuthProvider } from './provider.ts';

export const githubProviderId = 'github';
/** Recorded as the issuer of GitHub identities: GitHub OAuth is not OpenID Connect and has none. */
export const githubIssuer = 'https://github.com';

export interface GithubEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userEndpoint: string;
}

export const githubEndpoints: GithubEndpoints = {
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  tokenEndpoint: 'https://github.com/login/oauth/access_token',
  userEndpoint: 'https://api.github.com/user',
};

/** Token errors that mean the client's code or return address is wrong, rather than the installation. */
const rejectedCodeErrors = new Set(['bad_verification_code', 'redirect_uri_mismatch', 'access_denied']);

/**
 * GitHub OAuth app, authorization code flow with PKCE. No scope is requested: the numeric user
 * `id` from the public profile is the subject. The login (renamable), name, and email are ignored,
 * so a private or missing email changes nothing. The access token lives for this call only.
 */
export function createGithubProvider(options: {
  readonly credentials: OAuthClientCredentials;
  readonly endpoints?: GithubEndpoints | undefined;
  readonly fetch?: FetchFunction | undefined;
}): OAuthProvider {
  const { credentials, endpoints = githubEndpoints, fetch: fetchImpl = fetch } = options;

  return {
    id: githubProviderId,
    authorizationUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(endpoints.authorizationEndpoint);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },
    async verifyCode({ code, codeVerifier, redirectUri }) {
      const token = await fetchJson(fetchImpl, endpoints.tokenEndpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      const failure = stringField(token.json, 'error');
      if (failure !== undefined && rejectedCodeErrors.has(failure)) {
        throw new ProviderError('code_rejected', 'GitHub refused the authorization code.');
      }
      const accessToken = stringField(token.json, 'access_token');
      if (token.status !== 200 || failure !== undefined || accessToken === undefined) {
        throw new ProviderError('unavailable', 'GitHub did not return an access token.');
      }

      const user = await fetchJson(fetchImpl, endpoints.userEndpoint, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${accessToken}`,
          'user-agent': 'nihon',
          'x-github-api-version': '2022-11-28',
        },
      });
      const id = typeof user.json === 'object' && user.json !== null && 'id' in user.json ? user.json.id : undefined;
      if (user.status !== 200) {
        throw new ProviderError('unavailable', 'GitHub did not return the user.');
      }
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
        throw new ProviderError('identity_unverified', 'GitHub returned no user identifier.');
      }
      return { provider: githubProviderId, issuer: githubIssuer, subject: String(id) };
    },
  };
}

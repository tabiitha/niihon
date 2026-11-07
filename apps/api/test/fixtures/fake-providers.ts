import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from 'node:crypto';

/** One request received by a fake provider, for assertions on what Nihon sent. */
export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly form: Readonly<Record<string, string>>;
}

export interface FakeAnswer {
  readonly status: number;
  readonly body: unknown;
  /** Waits this long before answering, to make exchanges overlap. */
  readonly delayMs?: number;
  readonly headers?: Record<string, string>;
}

export const googleClient = { clientId: 'google-client-id', clientSecret: 'google-client-secret' };
export const githubClient = { clientId: 'github-client-id', clientSecret: 'github-client-secret' };

export interface FakeProviders {
  readonly origin: string;
  readonly endpoints: {
    readonly google: { authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string; issuers: readonly string[] };
    readonly github: { authorizationEndpoint: string; tokenEndpoint: string; userEndpoint: string };
  };
  readonly requests: ReceivedRequest[];
  /** Answer of the Google token endpoint; defaults to `invalid_grant`. */
  googleToken: (form: Readonly<Record<string, string>>) => FakeAnswer | Promise<FakeAnswer>;
  githubToken: (form: Readonly<Record<string, string>>) => FakeAnswer | Promise<FakeAnswer>;
  githubUser: (headers: IncomingMessage['headers']) => FakeAnswer | Promise<FakeAnswer>;
  /**
   * Answer of the provider's authorization page, which receives the browser (query parameters of the
   * authorization address). Absent by default: the page does not exist. A test or fixture server that
   * plays the user's approval answers with a redirect to the return address.
   */
  authorize?: (provider: 'google' | 'github', query: URLSearchParams) => FakeAnswer;
  /** Signs an ID token with the key the fake publishes (or `key` when given). */
  signIdToken(claims: Record<string, unknown>, options?: { key?: KeyObject; kid?: string; alg?: string }): string;
  /** Keys published at `jwksUri`. */
  jwks: JsonWebKey[];
  stop(): Promise<void>;
}

const issuer = 'https://accounts.google.com';

export function newSigningKey(): { privateKey: KeyObject; jwk: JsonWebKey } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

/** Plays Google and GitHub on a loopback port so registration flows run without Internet access. */
export async function startFakeProviders(): Promise<FakeProviders> {
  const { privateKey, jwk } = newSigningKey();
  const requests: ReceivedRequest[] = [];

  const state: FakeProviders = {
    origin: '',
    endpoints: undefined as never,
    requests,
    googleToken: () => ({ status: 400, body: { error: 'invalid_grant' } }),
    githubToken: () => ({ status: 200, body: { error: 'bad_verification_code' } }),
    githubUser: () => ({ status: 401, body: { message: 'Bad credentials' } }),
    jwks: [{ ...jwk, kid: 'fake-key-1', alg: 'RS256', use: 'sig' } as JsonWebKey],
    signIdToken(claims, { key = privateKey, kid = 'fake-key-1', alg = 'RS256' } = {}) {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const signingInput = `${encode({ alg, kid, typ: 'JWT' })}.${encode(claims)}`;
      const signature = alg === 'none' ? '' : sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url');
      return `${signingInput}.${signature}`;
    },
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      void (async () => {
        const { pathname: path, searchParams } = new URL(request.url ?? '/', 'http://fake');
        const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
        requests.push({ method: request.method ?? 'GET', path, headers: request.headers, form });
        let answer: FakeAnswer = { status: 404, body: { error: 'not_found' } };
        if (path === '/google/certs') {
          answer = { status: 200, body: { keys: state.jwks } };
        } else if (path === '/google/token') {
          answer = await state.googleToken(form);
        } else if (path === '/github/token') {
          answer = await state.githubToken(form);
        } else if (path === '/github/user') {
          answer = await state.githubUser(request.headers);
        } else if ((path === '/google/authorize' || path === '/github/authorize') && state.authorize !== undefined) {
          answer = state.authorize(path.startsWith('/google') ? 'google' : 'github', searchParams);
        }
        if (answer.delayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
        }
        response.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
        response.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(state, {
    origin,
    endpoints: {
      google: {
        authorizationEndpoint: `${origin}/google/authorize`,
        tokenEndpoint: `${origin}/google/token`,
        jwksUri: `${origin}/google/certs`,
        issuers: [issuer, 'accounts.google.com'],
      },
      github: {
        authorizationEndpoint: `${origin}/github/authorize`,
        tokenEndpoint: `${origin}/github/token`,
        userEndpoint: `${origin}/github/user`,
      },
    },
  });
  return state;
}

export const googleIssuer = issuer;

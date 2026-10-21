import assert from 'node:assert/strict';
import { createHash, type JsonWebKey } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { startAccountsApp, type AccountsApp } from '../../../test/fixtures/accounts-app.ts';
import {
  githubClient,
  googleClient,
  googleIssuer,
  newSigningKey,
  startFakeProviders,
  type FakeProviders,
} from '../../../test/fixtures/fake-providers.ts';
import { argon2Parameters, verifyPassword } from './password-hash.ts';

const redirectUri = 'http://127.0.0.1:4000/auth/callback';
const oauth = { providers: { google: googleClient, github: githubClient }, redirectUris: [] as string[] };
const password = 'correct horse battery';

describe('local registration', () => {
  let app: AccountsApp;
  beforeEach(async () => {
    // Any network use fails the test: registering locally must not need Internet.
    app = await startAccountsApp({
      module: {
        fetch: () => {
          throw new Error('Local registration must not use the network.');
        },
      },
    });
  });
  afterEach(() => app.stop());

  const profiles = () => app.database.reader.profile.count();

  it('creates a profile with the user role and an Argon2id credential, without network, email, or external account', async () => {
    const response = await app.post('/local-registrations', { username: 'Sakura_42', password });
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.body).sort(), ['createdAt', 'id', 'registeredWith', 'role', 'username']);
    assert.equal(response.body.username, 'Sakura_42');
    assert.equal(response.body.role, 'user');
    assert.equal(response.body.registeredWith, 'local');
    assert.match(response.body.id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const stored = await app.database.reader.profile.findUniqueOrThrow({
      where: { id: response.body.id },
      include: { localCredential: true, externalIdentities: true },
    });
    assert.equal(stored.role, 'user');
    assert.equal(stored.usernameKey, 'sakura_42');
    assert.equal(stored.externalIdentities.length, 0);
    const hash = stored.localCredential?.passwordHash ?? '';
    assert.ok(hash.startsWith(`$argon2id$v=19$m=${argon2Parameters.memoryKiB},t=${argon2Parameters.passes},p=`));
    assert.ok(!hash.includes(password));
    assert.equal(await verifyPassword(password, hash), true);
  });

  it('refuses a username that normalizes to an existing one, without creating anything', async () => {
    assert.equal((await app.post('/local-registrations', { username: 'Sakura', password })).status, 201);
    for (const username of ['sakura', 'SAKURA', 'ｓａｋｕｒａ', ' Sakura ']) {
      const response = await app.post('/local-registrations', { username, password });
      assert.equal(response.status, 409, username);
      assert.equal(response.body.error.code, 'accounts_username_taken');
    }
    assert.equal(await profiles(), 1);
    assert.equal(await app.database.reader.localCredential.count(), 1);
  });

  it('refuses invalid usernames and passwords with field issues and creates nothing', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ username: 'ab', password }, 'body.username'],
      [{ username: 'has space', password }, 'body.username'],
      [{ username: '_leading', password }, 'body.username'],
      [{ username: 'a'.repeat(300), password }, 'body.username'],
      [{ username: 'valid_name', password: 'short' }, 'body.password'],
      [{ username: 'valid_name', password: ' '.repeat(12) }, 'body.password'],
      [{ username: 'valid_name', password: 'a'.repeat(129) }, 'body.password'],
      [{ username: 'valid_name', password: 'a'.repeat(600) }, 'body.password'],
      [{ username: 'valid_name', password: 'tab\tinside-password' }, 'body.password'],
      [{ username: 'Valid_Name', password: 'valid_name' }, 'body.password'],
      [{ username: 'valid_name' }, 'body.password'],
      [{ password }, 'body.username'],
      [{ username: 42, password }, 'body.username'],
      [{ username: 'valid_name', password: ['a'] }, 'body.password'],
    ];
    for (const [body, path] of cases) {
      const response = await app.post('/local-registrations', body);
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(response.body.error.code, 'validation_failed');
      assert.ok(response.body.error.issues.some((issue: { path: string }) => issue.path === path), `${path}: ${JSON.stringify(response.body)}`);
    }
    assert.equal(await profiles(), 0);
  });

  it('refuses injected role and any other unexpected fields, naming them without echoing values', async () => {
    for (const extra of [{ role: 'admin' }, { isAdmin: true }, { roles: ['admin'] }, { id: 'chosen-id' }, { createdAt: '2020-01-01T00:00:00.000Z' }]) {
      const response = await app.post('/local-registrations', { username: 'sneaky', password, ...extra });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'validation_failed');
      const [key] = Object.keys(extra);
      assert.deepEqual(response.body.error.issues, [{ path: `body.${key}`, message: 'Unrecognized field.' }]);
    }
    const proto = await app.post('/local-registrations', undefined, { raw: `{"username":"sneaky","password":"${password}","__proto__":{"role":"admin"}}` });
    assert.equal(proto.status, 400);
    assert.equal(await profiles(), 0);
  });

  it('refuses unreadable, mistyped, and oversized bodies with stable codes', async () => {
    const malformed = await app.post('/local-registrations', undefined, { raw: '{"username": ' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'bad_request');

    const wrongType = await app.post('/local-registrations', { username: 'valid_name', password }, { contentType: 'text/plain' });
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.body.error.code, 'unsupported_media_type');

    const array = await app.post('/local-registrations', ['x']);
    assert.equal(array.status, 400);

    const large = await app.post('/local-registrations', { username: 'valid_name', password: 'a'.repeat(20_000) });
    assert.equal(large.status, 413);
    assert.equal(large.body.error.code, 'payload_too_large');
    assert.equal(await profiles(), 0);
  });

  it('does not echo the body of an unreadable request', async () => {
    const response = await app.post('/local-registrations', undefined, { raw: `{username: "x", password: "${password}"` });
    assert.ok(!JSON.stringify(response.body).includes(password));
    assert.ok(app.logs.every((line) => !line.includes(password)));
  });

  it('creates exactly one account when many registrations race for the same username', async () => {
    const usernames = ['Racer', 'racer', 'RACER', 'ｒａｃｅｒ', 'racer', 'Racer', 'rAcEr', 'racer'];
    const responses = await Promise.all(usernames.map((username) => app.post('/local-registrations', { username, password })));
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409]);
    for (const response of responses.filter((candidate) => candidate.status === 409)) {
      assert.equal(response.body.error.code, 'accounts_username_taken');
    }
    assert.equal(await profiles(), 1);
    assert.equal(await app.database.reader.localCredential.count(), 1);
  });

  it('keeps passwords and hashes out of responses and logs', async () => {
    const secret = 'S3cret-Passphrase-Never-Logged';
    const created = await app.post('/local-registrations', { username: 'quiet', password: secret });
    const duplicate = await app.post('/local-registrations', { username: 'quiet', password: secret });
    const invalid = await app.post('/local-registrations', { username: 'quiet2', password: secret, role: 'admin' });
    const hash = (await app.database.reader.localCredential.findFirstOrThrow()).passwordHash;
    const everything = JSON.stringify([created.body, duplicate.body, invalid.body, app.logs]);
    assert.ok(!everything.includes(secret));
    assert.ok(!everything.includes(hash));
    assert.ok(!everything.includes('argon2id'));
  });

  it('leaves no partial account when the credential cannot be written', async () => {
    await app.database.write((transaction) =>
      transaction.$executeRawUnsafe(
        `CREATE TRIGGER refuse_credential BEFORE INSERT ON "LocalCredential" BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
      ),
    );
    const response = await app.post('/local-registrations', { username: 'halfway', password });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'internal_error');
    assert.equal(await profiles(), 0);
    assert.equal(await app.database.reader.localCredential.count(), 0);
  });
});

describe('local registration limits', () => {
  it('answers 503 accounts_busy when hashing work is already queued to its limit, then recovers', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = await startAccountsApp({
      module: { limits: { hashConcurrency: 1, hashQueue: 1 }, hashPassword: async () => (await gate, '$argon2id$stub') },
    });
    try {
      const first = app.post('/local-registrations', { username: 'first_user', password });
      const second = app.post('/local-registrations', { username: 'second_user', password });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const third = await app.post('/local-registrations', { username: 'third_user', password });
      assert.equal(third.status, 503);
      assert.equal(third.body.error.code, 'accounts_busy');
      assert.equal(third.headers.get('retry-after'), '1');
      release();
      assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [201, 201]);
      assert.equal((await app.post('/local-registrations', { username: 'fourth_user', password })).status, 201);
      assert.equal(await app.database.reader.profile.count(), 3);
    } finally {
      release();
      await app.stop();
    }
  });

  it('keeps answering status reads while hashes are computed', async () => {
    const app = await startAccountsApp();
    try {
      const registrations = Array.from({ length: 10 }, (_, index) =>
        app.post('/local-registrations', { username: `parallel_${index}`, password }),
      );
      const reads = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const started = performance.now();
          const response = await fetch(`${app.baseUrl}/api/health`);
          await response.text();
          return performance.now() - started;
        }),
      );
      assert.ok(Math.max(...reads) < 1000, `slowest status read ${Math.max(...reads)} ms`);
      assert.deepEqual((await Promise.all(registrations)).map((response) => response.status), Array(10).fill(201));
    } finally {
      await app.stop();
    }
  });
});

describe('provider registration', () => {
  let app: AccountsApp;
  let fake: FakeProviders;
  let clock: Date;
  before(async () => {
    fake = await startFakeProviders();
  });
  after(() => fake.stop());
  beforeEach(async () => {
    clock = new Date();
    fake.requests.length = 0;
    fake.googleToken = () => ({ status: 400, body: { error: 'invalid_grant' } });
    fake.githubToken = () => ({ status: 200, body: { error: 'bad_verification_code' } });
    fake.githubUser = () => ({ status: 401, body: { message: 'Bad credentials' } });
    app = await startAccountsApp({
      oauth,
      module: {
        googleEndpoints: fake.endpoints.google,
        githubEndpoints: fake.endpoints.github,
        now: () => clock,
        limits: { maxPendingFlows: 5 },
      },
    });
  });
  afterEach(() => app.stop());

  const count = async () => ({
    profiles: await app.database.reader.profile.count(),
    identities: await app.database.reader.externalIdentity.count(),
    flows: await app.database.reader.oAuthFlow.count(),
  });

  async function start(provider: string, username: string, address = redirectUri) {
    return app.post('/oauth-registrations', { provider, username, redirectUri: address });
  }

  /** Makes the fake Google answer the next exchange with an ID token for `sub`, bound to this flow's nonce. */
  function googleVouches(startedUrl: string, sub: string, claims: Record<string, unknown> = {}) {
    const nonce = new URL(startedUrl).searchParams.get('nonce');
    const seconds = Math.floor(clock.getTime() / 1000);
    fake.googleToken = () => ({
      status: 200,
      body: {
        access_token: 'ya29.google-access-token',
        id_token: fake.signIdToken({
          iss: googleIssuer,
          aud: googleClient.clientId,
          sub,
          nonce,
          iat: seconds,
          exp: seconds + 3600,
          email: 'person@example.com',
          email_verified: true,
          name: 'A Person',
          ...claims,
        }),
      },
    });
  }

  function githubVouches(user: unknown) {
    fake.githubToken = () => ({ status: 200, body: { access_token: 'gho_github-access-token', token_type: 'bearer' } });
    fake.githubUser = () => ({ status: 200, body: user });
  }

  it('lists the configured providers, and none when the installation has none', async () => {
    assert.deepEqual((await app.get('/oauth-providers')).body, { items: [{ id: 'github' }, { id: 'google' }] });
    const bare = await startAccountsApp();
    try {
      assert.deepEqual((await bare.get('/oauth-providers')).body, { items: [] });
    } finally {
      await bare.stop();
    }
  });

  it('starts a Google flow with state, nonce, and PKCE, and never puts the client secret in the address', async () => {
    const response = await start('google', 'Hanami');
    assert.equal(response.status, 201);
    const url = new URL(response.body.authorizationUrl);
    assert.equal(`${url.origin}${url.pathname}`, fake.endpoints.google.authorizationEndpoint);
    assert.equal(url.searchParams.get('client_id'), googleClient.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('scope'), 'openid');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('state'), response.body.state);
    assert.ok((url.searchParams.get('nonce') ?? '').length >= 16);
    assert.ok(!response.body.authorizationUrl.includes(googleClient.clientSecret));
    assert.equal(response.body.expiresAt, new Date(clock.getTime() + 10 * 60 * 1000).toISOString());

    const flow = await app.database.reader.oAuthFlow.findFirstOrThrow();
    assert.notEqual(flow.stateHash, response.body.state, 'only a hash of the state is stored');
    assert.equal(flow.stateHash, createHash('sha256').update(response.body.state).digest('hex'));
    assert.equal(createHash('sha256').update(flow.codeVerifier).digest('base64url'), url.searchParams.get('code_challenge'));
    assert.deepEqual(await count(), { profiles: 0, identities: 0, flows: 1 });
  });

  it('starts a GitHub flow with PKCE and no scope', async () => {
    const response = await start('github', 'Hanami');
    assert.equal(response.status, 201);
    const url = new URL(response.body.authorizationUrl);
    assert.equal(`${url.origin}${url.pathname}`, fake.endpoints.github.authorizationEndpoint);
    assert.equal(url.searchParams.get('client_id'), githubClient.clientId);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), null);
    assert.equal(url.searchParams.get('state'), response.body.state);
  });

  it('refuses to start for an unknown or unconfigured provider, a foreign return address, or a bad or taken username', async () => {
    assert.equal((await start('facebook', 'Hanami')).body.error.code, 'accounts_oauth_provider_unavailable');
    assert.equal((await start('google', 'Hanami', 'https://evil.example/cb')).body.error.code, 'accounts_oauth_redirect_uri_invalid');
    assert.equal((await start('google', 'Hanami', 'http://127.0.0.1.evil.example/cb')).status, 400);
    const bad = await start('google', 'no');
    assert.equal(bad.body.error.code, 'validation_failed');
    assert.equal((await app.post('/oauth-registrations', { provider: 'GOOGLE!', username: 'Hanami', redirectUri })).status, 400);
    assert.equal((await app.post('/oauth-registrations', { provider: 'google', username: 'Hanami', redirectUri, role: 'admin' })).status, 400);

    await app.post('/local-registrations', { username: 'Taken', password });
    const taken = await start('google', 'taken');
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'accounts_username_taken');
    assert.deepEqual(await count(), { profiles: 1, identities: 0, flows: 0 });

    const bare = await startAccountsApp();
    try {
      assert.equal((await bare.post('/oauth-registrations', { provider: 'google', username: 'Hanami', redirectUri })).status, 422);
    } finally {
      await bare.stop();
    }
  });

  it('accepts a return address the installation lists', async () => {
    const custom = await startAccountsApp({
      oauth: { ...oauth, redirectUris: ['https://nihon.example/auth/callback'] },
      module: { googleEndpoints: fake.endpoints.google },
    });
    try {
      const response = await custom.post('/oauth-registrations', {
        provider: 'google',
        username: 'Hanami',
        redirectUri: 'https://nihon.example/auth/callback',
      });
      assert.equal(response.status, 201);
    } finally {
      await custom.stop();
    }
  });

  it('registers a Google identity: one profile, one link, the stable subject, and no email', async () => {
    const started = (await start('google', 'Hanami')).body;
    googleVouches(started.authorizationUrl, 'google-subject-1');
    const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'auth-code-1' });
    assert.equal(response.status, 201);
    assert.equal(response.body.username, 'Hanami');
    assert.equal(response.body.role, 'user');
    assert.equal(response.body.registeredWith, 'google');

    const profile = await app.database.reader.profile.findUniqueOrThrow({
      where: { id: response.body.id },
      include: { externalIdentities: true, localCredential: true },
    });
    assert.equal(profile.localCredential, null);
    assert.equal(profile.externalIdentities.length, 1);
    const [link] = profile.externalIdentities;
    assert.equal(link?.provider, 'google');
    assert.equal(link?.issuer, 'https://accounts.google.com');
    assert.equal(link?.subject, 'google-subject-1');
    assert.deepEqual(await count(), { profiles: 1, identities: 1, flows: 0 });

    const exchange = fake.requests.find((request) => request.path === '/google/token');
    assert.equal(exchange?.form['code'], 'auth-code-1');
    assert.equal(exchange?.form['client_secret'], googleClient.clientSecret);
    assert.equal(exchange?.form['redirect_uri'], redirectUri);
    const challenge = new URL(started.authorizationUrl).searchParams.get('code_challenge');
    assert.equal(createHash('sha256').update(exchange?.form['code_verifier'] ?? '').digest('base64url'), challenge);

    const stored = JSON.stringify(await app.database.reader.$queryRawUnsafe('SELECT * FROM "ExternalIdentity"'));
    assert.ok(!stored.includes('person@example.com') && !stored.includes('A Person'));
  });

  it('registers a GitHub identity by its numeric id, with a private email and a renamed login', async () => {
    const started = (await start('github', 'Hanami')).body;
    githubVouches({ id: 987654, login: 'renamed-later', name: null, email: null });
    const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'gh-code' });
    assert.equal(response.status, 201);
    assert.equal(response.body.registeredWith, 'github');
    const link = await app.database.reader.externalIdentity.findFirstOrThrow();
    assert.deepEqual([link.provider, link.issuer, link.subject], ['github', 'https://github.com', '987654']);

    const exchange = fake.requests.find((request) => request.path === '/github/token');
    assert.equal(exchange?.form['client_secret'], githubClient.clientSecret);
    assert.equal(createHash('sha256').update(exchange?.form['code_verifier'] ?? '').digest('base64url'), new URL(started.authorizationUrl).searchParams.get('code_challenge'));
    const user = fake.requests.find((request) => request.path === '/github/user');
    assert.equal(user?.headers.authorization, 'Bearer gho_github-access-token');
  });

  it('accepts the second spelling of the Google issuer and records one issuer', async () => {
    const started = (await start('google', 'Hanami')).body;
    googleVouches(started.authorizationUrl, 'sub-9', { iss: 'accounts.google.com' });
    assert.equal((await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' })).status, 201);
    assert.equal((await app.database.reader.externalIdentity.findFirstOrThrow()).issuer, 'https://accounts.google.com');
  });

  it('creates nothing when the callback is replayed', async () => {
    const started = (await start('google', 'Hanami')).body;
    googleVouches(started.authorizationUrl, 'sub-replay');
    const body = { state: started.state, code: 'c' };
    assert.equal((await app.post('/oauth-registrations/completion', body)).status, 201);
    const replay = await app.post('/oauth-registrations/completion', body);
    assert.equal(replay.status, 400);
    assert.equal(replay.body.error.code, 'accounts_oauth_state_invalid');
    assert.deepEqual(await count(), { profiles: 1, identities: 1, flows: 0 });
    assert.equal(fake.requests.filter((request) => request.path === '/google/token').length, 1, 'the provider is not called again');
  });

  it('creates exactly one profile and one link when the same callback arrives concurrently', async () => {
    const started = (await start('google', 'Hanami')).body;
    googleVouches(started.authorizationUrl, 'sub-race');
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => app.post('/oauth-registrations/completion', { state: started.state, code: 'c' })),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400, 400, 400, 400, 400]);
    assert.deepEqual(await count(), { profiles: 1, identities: 1, flows: 0 });
    assert.equal(fake.requests.filter((request) => request.path === '/google/token').length, 1);
  });

  it('creates one profile when two flows race for the same provider identity', async () => {
    const first = (await start('google', 'First_name')).body;
    const second = (await start('google', 'Second_name')).body;
    const sub = 'sub-shared';
    fake.googleToken = (form) => {
      const state = form['code'] === 'code-1' ? first : second;
      const seconds = Math.floor(clock.getTime() / 1000);
      return {
        status: 200,
        body: {
          id_token: fake.signIdToken({
            iss: googleIssuer,
            aud: googleClient.clientId,
            sub,
            nonce: new URL(state.authorizationUrl).searchParams.get('nonce'),
            iat: seconds,
            exp: seconds + 3600,
          }),
        },
      };
    };
    const responses = await Promise.all([
      app.post('/oauth-registrations/completion', { state: first.state, code: 'code-1' }),
      app.post('/oauth-registrations/completion', { state: second.state, code: 'code-2' }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.equal(responses.find((response) => response.status === 409)?.body.error.code, 'accounts_identity_already_registered');
    assert.deepEqual(await count(), { profiles: 1, identities: 1, flows: 0 });
  });

  it('never merges by email: another flow for a known identity or taken username adds nothing', async () => {
    const first = (await start('google', 'Hanami')).body;
    googleVouches(first.authorizationUrl, 'sub-known');
    assert.equal((await app.post('/oauth-registrations/completion', { state: first.state, code: 'c' })).status, 201);

    const again = (await start('google', 'Another')).body;
    googleVouches(again.authorizationUrl, 'sub-known');
    const duplicate = await app.post('/oauth-registrations/completion', { state: again.state, code: 'c' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'accounts_identity_already_registered');

    const different = (await start('google', 'Third_one')).body;
    googleVouches(different.authorizationUrl, 'sub-other', { email: 'person@example.com' });
    assert.equal((await app.post('/oauth-registrations/completion', { state: different.state, code: 'c' })).status, 201);
    assert.deepEqual(await count(), { profiles: 2, identities: 2, flows: 0 });
  });

  it('creates nothing when the username was taken while the browser was away', async () => {
    const started = (await start('google', 'Contested')).body;
    assert.equal((await app.post('/local-registrations', { username: 'contested', password })).status, 201);
    googleVouches(started.authorizationUrl, 'sub-late');
    const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'accounts_username_taken');
    assert.deepEqual(await count(), { profiles: 1, identities: 0, flows: 0 });
  });

  it('refuses an unknown, malformed, or expired flow', async () => {
    const unknown = await app.post('/oauth-registrations/completion', { state: 'A'.repeat(43), code: 'c' });
    assert.equal(unknown.body.error.code, 'accounts_oauth_state_invalid');
    assert.equal((await app.post('/oauth-registrations/completion', { state: 'not valid!', code: 'c' })).status, 400);
    assert.equal((await app.post('/oauth-registrations/completion', { state: 'A'.repeat(43), code: 'c'.repeat(3000) })).status, 400);

    const started = (await start('google', 'Slowpoke')).body;
    googleVouches(started.authorizationUrl, 'sub-slow');
    clock = new Date(clock.getTime() + 10 * 60 * 1000 + 1);
    const expired = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error.code, 'accounts_oauth_state_expired');
    assert.deepEqual(await count(), { profiles: 0, identities: 0, flows: 0 });
    assert.equal(fake.requests.filter((request) => request.path === '/google/token').length, 0);
  });

  it('creates nothing and consumes the flow when the provider refuses the code', async () => {
    const started = (await start('google', 'Refused')).body;
    const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'bad' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'accounts_oauth_code_rejected');
    assert.deepEqual(await count(), { profiles: 0, identities: 0, flows: 0 });
    const retry = await app.post('/oauth-registrations/completion', { state: started.state, code: 'bad' });
    assert.equal(retry.body.error.code, 'accounts_oauth_state_invalid');

    const github = (await start('github', 'Refused')).body;
    const refusedGithub = await app.post('/oauth-registrations/completion', { state: github.state, code: 'bad' });
    assert.equal(refusedGithub.body.error.code, 'accounts_oauth_code_rejected');
  });

  it('creates nothing when the ID token does not verify', async () => {
    const forged = newSigningKey();
    const cases: [string, (url: string) => void][] = [
      ['forged signature', (url) => googleVouches(url, 'sub-x', {}) ],
      ['wrong nonce', (url) => googleVouches(url, 'sub-x', { nonce: 'another-flow-nonce' })],
      ['wrong audience', (url) => googleVouches(url, 'sub-x', { aud: 'someone-elses-client' })],
      ['wrong issuer', (url) => googleVouches(url, 'sub-x', { iss: 'https://evil.example' })],
      ['expired', (url) => googleVouches(url, 'sub-x', { exp: Math.floor(clock.getTime() / 1000) - 3600 })],
      ['no subject', (url) => googleVouches(url, '')],
    ];
    for (const [label, arrange] of cases) {
      const started = (await start('google', `Case_${cases.findIndex(([name]) => name === label)}`)).body;
      arrange(started.authorizationUrl);
      if (label === 'forged signature') {
        const nonce = new URL(started.authorizationUrl).searchParams.get('nonce');
        const seconds = Math.floor(clock.getTime() / 1000);
        fake.googleToken = () => ({
          status: 200,
          body: {
            id_token: fake.signIdToken(
              { iss: googleIssuer, aud: googleClient.clientId, sub: 'sub-x', nonce, iat: seconds, exp: seconds + 3600 },
              { key: forged.privateKey },
            ),
          },
        });
      }
      const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
      assert.equal(response.status, 400, label);
      assert.equal(response.body.error.code, 'accounts_oauth_identity_unverified', label);
    }
    assert.deepEqual(await count(), { profiles: 0, identities: 0, flows: 0 });
  });

  it('ignores published keys that are not RS256 signing keys', async () => {
    const started = (await start('google', 'Keyed')).body;
    googleVouches(started.authorizationUrl, 'sub-key');
    const published = fake.jwks;
    fake.jwks = published.map((key) => ({ ...key, use: 'enc' }) as JsonWebKey);
    try {
      const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
      assert.equal(response.body.error.code, 'accounts_oauth_identity_unverified');
    } finally {
      fake.jwks = published;
    }
  });

  it('creates nothing when GitHub returns no usable user', async () => {
    for (const user of [{ login: 'no-id' }, { id: 'string-id' }, { id: -4 }, { id: 1.5 }]) {
      const started = (await start('github', 'Nobody')).body;
      githubVouches(user);
      const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
      assert.equal(response.body.error.code, 'accounts_oauth_identity_unverified', JSON.stringify(user));
    }
    assert.deepEqual(await count(), { profiles: 0, identities: 0, flows: 0 });
  });

  it('answers 502 and creates nothing when the provider fails, answers garbage, or is unreachable', async () => {
    const broken: [string, () => void][] = [
      ['server error', () => (fake.googleToken = () => ({ status: 500, body: { error: 'server_error' } }))],
      ['not JSON', () => (fake.googleToken = () => ({ status: 200, body: 'not json at all' }))],
      ['no id_token', () => (fake.googleToken = () => ({ status: 200, body: { access_token: 'x' } }))],
      ['oversized', () => (fake.googleToken = () => ({ status: 200, body: JSON.stringify({ id_token: 'x'.repeat(2 * 1024 * 1024) }) }))],
    ];
    for (const [label, arrange] of broken) {
      const started = (await start('google', 'Unlucky')).body;
      arrange();
      const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
      assert.equal(response.status, 502, label);
      assert.equal(response.body.error.code, 'accounts_oauth_provider_failed', label);
    }
    const unreachable = await startAccountsApp({
      oauth,
      module: {
        googleEndpoints: { ...fake.endpoints.google, tokenEndpoint: 'http://127.0.0.1:1/token' },
      },
    });
    try {
      const started = (await unreachable.post('/oauth-registrations', { provider: 'google', username: 'Offline', redirectUri })).body;
      const response = await unreachable.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
      assert.equal(response.status, 502);
      assert.equal(response.body.error.code, 'accounts_oauth_provider_failed');
      assert.equal(await unreachable.database.reader.profile.count(), 0);
    } finally {
      await unreachable.stop();
    }
    assert.deepEqual(await count(), { profiles: 0, identities: 0, flows: 0 });
  });

  it('does not follow a redirect answered by the provider', async () => {
    const started = (await start('google', 'Redirected')).body;
    fake.googleToken = () => ({ status: 302, body: {}, headers: { location: `${fake.origin}/google/certs` } });
    const response = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
    assert.equal(response.status, 502);
    assert.equal(response.body.error.code, 'accounts_oauth_provider_failed');
    assert.equal(fake.requests.filter((request) => request.path === '/google/certs').length, 0, 'the redirect target was not requested');
    assert.deepEqual(await count(), { profiles: 0, identities: 0, flows: 0 });
  });

  it('bounds pending flows and cleans up expired ones', async () => {
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await start('google', `Pending_${index}`)).status, 201);
    }
    const full = await start('google', 'Pending_extra');
    assert.equal(full.status, 503);
    assert.equal(full.body.error.code, 'accounts_busy');
    assert.equal(full.headers.get('retry-after'), '1');
    assert.equal((await count()).flows, 5);

    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    assert.equal((await start('google', 'Pending_after')).status, 201);
    assert.equal((await count()).flows, 1, 'expired flows were removed');
  });

  it('keeps provider secrets, codes, states, and tokens out of responses and logs', async () => {
    const started = (await start('google', 'Quiet')).body;
    googleVouches(started.authorizationUrl, 'sub-quiet');
    const done = await app.post('/oauth-registrations/completion', { state: started.state, code: 'code-that-must-not-leak' });
    const replay = await app.post('/oauth-registrations/completion', { state: started.state, code: 'code-that-must-not-leak' });
    fake.googleToken = () => ({ status: 500, body: { error: 'oops', access_token: 'ya29.leaky' } });
    const second = (await start('google', 'Quiet2')).body;
    const failed = await app.post('/oauth-registrations/completion', { state: second.state, code: 'code-that-must-not-leak' });

    const everything = JSON.stringify([done.body, replay.body, failed.body, app.logs]);
    for (const secret of [
      googleClient.clientSecret,
      githubClient.clientSecret,
      'code-that-must-not-leak',
      started.state,
      second.state,
      'ya29.google-access-token',
      'ya29.leaky',
      new URL(started.authorizationUrl).searchParams.get('nonce') ?? 'nonce',
      'person@example.com',
    ]) {
      assert.ok(!everything.includes(secret), `leaked ${secret}`);
    }
  });
});

describe('provider exchange limits', () => {
  it('answers 503 accounts_busy without consuming the flow when too many code exchanges run at once', async () => {
    const fake = await startFakeProviders();
    const app = await startAccountsApp({
      oauth,
      module: {
        googleEndpoints: fake.endpoints.google,
        limits: { exchangeConcurrency: 1, exchangeQueue: 0 },
      },
    });
    try {
      fake.googleToken = () => ({ status: 400, body: { error: 'invalid_grant' }, delayMs: 300 });
      const flows = await Promise.all(
        ['Busy_one', 'Busy_two'].map(async (username) => (await app.post('/oauth-registrations', { provider: 'google', username, redirectUri })).body),
      );
      const responses = await Promise.all(flows.map((flow) => app.post('/oauth-registrations/completion', { state: flow.state, code: 'c' })));
      assert.deepEqual(responses.map((response) => response.body.error.code).sort(), ['accounts_busy', 'accounts_oauth_code_rejected']);
      assert.equal(await app.database.reader.profile.count(), 0);

      // The refused completion left its flow intact, so retrying the same state is meaningful.
      const refusedIndex = responses.findIndex((response) => response.body.error.code === 'accounts_busy');
      const retry = await app.post('/oauth-registrations/completion', { state: flows[refusedIndex].state, code: 'c' });
      assert.equal(retry.body.error.code, 'accounts_oauth_code_rejected', 'the retried flow reached the provider');
    } finally {
      await app.stop();
      await fake.stop();
    }
  });

  it('says the flow is spent when the database stays busy after the provider answered', async () => {
    const fake = await startFakeProviders();
    const clockNow = () => new Date();
    const app = await startAccountsApp({
      oauth,
      databaseLimits: { maxWriteWaitMs: 150, maxTransactionMs: 3000 },
      module: { googleEndpoints: fake.endpoints.google, now: clockNow },
    });
    try {
      const started = (await app.post('/oauth-registrations', { provider: 'google', username: 'Unlucky_db', redirectUri })).body;
      const nonce = new URL(started.authorizationUrl).searchParams.get('nonce');
      const seconds = Math.floor(Date.now() / 1000);
      let exchangeStarted!: () => void;
      const exchangeRequested = new Promise<void>((resolve) => {
        exchangeStarted = resolve;
      });
      fake.googleToken = () => {
        exchangeStarted();
        return {
          status: 200,
          delayMs: 200,
          body: { id_token: fake.signIdToken({ iss: googleIssuer, aud: googleClient.clientId, sub: 'sub-db', nonce, iat: seconds, exp: seconds + 3600 }) },
        };
      };
      const completion = app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
      // The flow is consumed once the provider is being called: only then take the writer.
      await exchangeRequested;
      // Occupy the writer while the exchange finishes, so the final write cannot get its turn in time.
      const blocker = app.database.write(() => new Promise((resolve) => setTimeout(resolve, 600)));
      const response = await completion;
      await blocker;
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, 'accounts_oauth_flow_consumed');
      assert.equal(response.headers.get('retry-after'), null);
      assert.equal(await app.database.reader.profile.count(), 0);
      const again = await app.post('/oauth-registrations/completion', { state: started.state, code: 'c' });
      assert.equal(again.body.error.code, 'accounts_oauth_state_invalid');
    } finally {
      await app.stop();
      await fake.stop();
    }
  });

  it('answers 422 when a pending flow belongs to a provider that is no longer configured', async () => {
    const app = await startAccountsApp({ oauth: { providers: { google: googleClient }, redirectUris: [] } });
    try {
      const state = 'S'.repeat(43);
      await app.database.write((transaction) =>
        transaction.oAuthFlow.create({
          data: {
            id: 'flow-1',
            stateHash: createHash('sha256').update(state).digest('hex'),
            provider: 'github',
            codeVerifier: 'v'.repeat(43),
            nonce: 'n'.repeat(22),
            redirectUri,
            username: 'Orphaned',
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      );
      const response = await app.post('/oauth-registrations/completion', { state, code: 'c' });
      assert.equal(response.status, 422);
      assert.equal(response.body.error.code, 'accounts_oauth_provider_unavailable');
      assert.equal(await app.database.reader.oAuthFlow.count(), 0);
      assert.equal(await app.database.reader.profile.count(), 0);
    } finally {
      await app.stop();
    }
  });
});

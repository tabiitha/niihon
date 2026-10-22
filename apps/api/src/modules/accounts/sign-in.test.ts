import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { startAccountsApp, type AccountsApp, type CallResult } from '../../../test/fixtures/accounts-app.ts';
import { githubClient, googleClient, googleIssuer, startFakeProviders, type FakeProviders } from '../../../test/fixtures/fake-providers.ts';

const password = 'correct horse battery';
const redirectUri = 'http://127.0.0.1:4000/auth/callback';
const oauth = { providers: { google: googleClient, github: githubClient }, redirectUris: [] as string[] };
const day = 24 * 60 * 60 * 1000;

/** `name=value` of a cookie the response sets, with its attributes. */
function setCookie(response: CallResult, name: string): { value: string; attributes: string[] } | undefined {
  for (const header of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
    if (pair.startsWith(`${name}=`)) {
      return { value: pair.slice(name.length + 1), attributes };
    }
  }
  return undefined;
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const cookie = (value: string, name = 'nihon_session') => ({ headers: { cookie: `${name}=${value}` } });

describe('local sign-in and sessions', () => {
  let app: AccountsApp;
  let clock: Date;
  beforeEach(async () => {
    clock = new Date('2026-10-23T08:00:00.000Z');
    app = await startAccountsApp({
      now: () => clock,
      module: {
        now: () => clock,
        fetch: () => {
          throw new Error('Local sign-in must not use the network.');
        },
      },
    });
    for (const username of ['Sakura', 'Momiji']) {
      assert.equal((await app.post('/local-registrations', { username, password })).status, 201);
    }
  });
  afterEach(() => app.stop());

  const signIn = (username: string, client: 'web' | 'native', init = {}) => app.post('/sessions', { username, password, client }, init);
  const sessions = () => app.database.reader.session.count();

  it('opens a native session: a bearer token shown once, stored only as a hash, valid for 30 days', async () => {
    const response = await signIn('sakura', 'native');
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(setCookie(response, 'nihon_session'), undefined, 'a native client receives no cookie');
    const { session, token } = response.body;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(Object.keys(session).sort(), ['client', 'createdAt', 'expiresAt', 'id', 'profile', 'signedInWith']);
    assert.equal(session.profile.username, 'Sakura');
    assert.equal(session.profile.role, 'user');
    assert.equal(session.client, 'native');
    assert.equal(session.signedInWith, 'local');
    assert.equal(session.expiresAt, new Date(clock.getTime() + 30 * day).toISOString());

    const stored = await app.database.reader.session.findFirstOrThrow();
    assert.equal(stored.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.ok(!JSON.stringify(await app.database.reader.$queryRawUnsafe('SELECT * FROM "Session"')).includes(token));

    const current = await app.get('/sessions/current', bearer(token));
    assert.equal(current.status, 200);
    assert.deepEqual(current.body, session);
    assert.ok(app.logs.every((line) => !line.includes(token) && !line.includes(password)));
  });

  it('opens a Web session as an HttpOnly, SameSite=Strict cookie and never returns the token', async () => {
    const response = await signIn('Sakura', 'web');
    assert.equal(response.status, 201);
    assert.equal(response.body.token, undefined);
    assert.equal(response.body.session.client, 'web');
    const set = setCookie(response, 'nihon_session');
    assert.ok(set !== undefined);
    assert.match(set.value, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(set.attributes.includes('HttpOnly'));
    assert.ok(set.attributes.includes('SameSite=Strict'));
    assert.ok(set.attributes.includes('Path=/api'));
    assert.ok(set.attributes.includes(`Max-Age=${30 * 24 * 60 * 60}`));
    assert.ok(!set.attributes.includes('Secure'), 'plain HTTP on loopback');

    const current = await app.get('/sessions/current', cookie(set.value));
    assert.equal(current.status, 200);
    assert.equal(current.body.profile.username, 'Sakura');
  });

  it('refuses a wrong password, an unknown or impossible username, and a profile without a local password alike', async () => {
    await app.database.write((transaction) =>
      transaction.profile.create({
        data: {
          id: randomUUID(),
          username: 'Provider_only',
          usernameKey: 'provider_only',
          externalIdentities: { create: { id: randomUUID(), provider: 'google', issuer: googleIssuer, subject: 'sub-x' } },
        },
      }),
    );
    const attempts = [
      { username: 'Sakura', password: 'wrong password!' },
      { username: 'nobody_here', password },
      { username: 'a b', password },
      { username: 'Provider_only', password },
    ];
    for (const attempt of attempts) {
      const response = await app.post('/sessions', { ...attempt, client: 'native' });
      assert.equal(response.status, 401, attempt.username);
      assert.equal(response.body.error.code, 'accounts_credentials_invalid');
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal(await sessions(), 0);
    assert.ok(app.logs.every((line) => !line.includes('wrong password!') && !line.includes('nobody_here')));
    assert.equal(app.logs.filter((line) => line.includes('account.sign_in_failed')).length, 4);
  });

  it('refuses malformed sign-in bodies with field issues', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ username: 'Sakura', password }, 'body.client'],
      [{ username: 'Sakura', password, client: 'browser' }, 'body.client'],
      [{ username: 'Sakura', password: '', client: 'web' }, 'body.password'],
      [{ username: 'Sakura', password: 'a'.repeat(600), client: 'web' }, 'body.password'],
      [{ username: 'Sakura', password, client: 'web', role: 'admin' }, 'body.role'],
    ];
    for (const [body, path] of cases) {
      const response = await app.post('/sessions', body);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'validation_failed');
      assert.ok(response.body.error.issues.some((issue: { path: string }) => issue.path === path), path);
    }
    assert.equal((await app.post('/sessions', { username: 'Sakura', password, client: 'web' }, { contentType: 'text/plain' })).status, 415);
    assert.equal(await sessions(), 0);
  });

  it('refuses requests without a valid session on authenticated operations, and ignores a stale one elsewhere', async () => {
    for (const init of [{}, bearer('x'.repeat(43)), bearer('not-a-token'), { headers: { authorization: 'Basic abc' } }, cookie('y'.repeat(43))]) {
      const response = await app.get('/sessions/current', init);
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, 'authentication_required');
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    }
    // A stale cookie must never block signing in or registering again.
    assert.equal((await signIn('Sakura', 'web', cookie('y'.repeat(43)))).status, 201);
    assert.equal((await app.post('/local-registrations', { username: 'Fresh', password }, cookie('y'.repeat(43)))).status, 201);
  });

  it('stops authorizing a session once it expires, without extending it on use', async () => {
    const { token, session } = (await signIn('Sakura', 'native')).body;
    clock = new Date(clock.getTime() + 30 * day - 1);
    const current = await app.get('/sessions/current', bearer(token));
    assert.equal(current.status, 200);
    assert.equal(current.body.expiresAt, session.expiresAt, 'using a session does not extend it');
    clock = new Date(clock.getTime() + 1);
    assert.equal((await app.get('/sessions/current', bearer(token))).body.error.code, 'authentication_required');
    // Expired sessions leave the table with later sign-ins.
    assert.equal((await signIn('Sakura', 'native')).status, 201);
    assert.equal(await sessions(), 1);
  });

  it('signs out: the session is revoked at once, the cookie cleared, and a repeated sign-out is harmless', async () => {
    const web = setCookie(await signIn('Sakura', 'web'), 'nihon_session')?.value ?? '';
    const native = (await signIn('Sakura', 'native')).body.token;

    const out = await app.delete('/sessions/current', cookie(web));
    assert.equal(out.status, 204);
    assert.equal(out.body, undefined);
    const cleared = setCookie(out, 'nihon_session');
    assert.equal(cleared?.value, '');
    assert.ok(cleared?.attributes.some((attribute) => attribute.startsWith('Expires=Thu, 01 Jan 1970')));

    assert.equal((await app.get('/sessions/current', cookie(web))).status, 401, 'a revoked session authorizes nothing');
    assert.equal((await app.delete('/sessions/current', cookie(web))).status, 204);
    assert.equal((await app.delete('/sessions/current')).status, 204);
    assert.equal((await app.get('/sessions/current', bearer(native))).status, 200, 'the other client of the profile stays signed in');
    assert.equal(await sessions(), 1);
    assert.ok(app.logs.some((line) => line.includes('account.signed_out')));
  });

  it('lets two clients use the same profile or different profiles independently', async () => {
    const webSakura = setCookie(await signIn('Sakura', 'web'), 'nihon_session')?.value ?? '';
    const nativeSakura = (await signIn('Sakura', 'native')).body.token;
    const nativeMomiji = (await signIn('Momiji', 'native')).body.token;
    assert.equal((await app.get('/sessions/current', cookie(webSakura))).body.profile.username, 'Sakura');
    assert.equal((await app.get('/sessions/current', bearer(nativeSakura))).body.profile.username, 'Sakura');
    assert.equal((await app.get('/sessions/current', bearer(nativeMomiji))).body.profile.username, 'Momiji');
    assert.equal(await sessions(), 3);
    // A profile identifier sent by the client authorizes nothing: only the token does.
    assert.equal((await app.get('/sessions/current', { headers: { 'x-profile-id': randomUUID() } })).status, 401);
  });

  it('replaces the session a client presents when it signs in again, so switching profiles leaves nothing behind', async () => {
    const first = setCookie(await signIn('Sakura', 'web'), 'nihon_session')?.value ?? '';
    const switched = await signIn('Momiji', 'web', cookie(first));
    assert.equal(switched.status, 201);
    const second = setCookie(switched, 'nihon_session')?.value ?? '';
    assert.equal((await app.get('/sessions/current', cookie(first))).status, 401);
    assert.equal((await app.get('/sessions/current', cookie(second))).body.profile.username, 'Momiji');

    const native = (await signIn('Sakura', 'native')).body.token;
    const renewed = (await signIn('Sakura', 'native', bearer(native))).body.token;
    assert.equal((await app.get('/sessions/current', bearer(native))).status, 401);
    assert.equal((await app.get('/sessions/current', bearer(renewed))).status, 200);
    assert.equal(await sessions(), 2);
  });

  it('identifies the signed-in profile as the caller of idempotent commands', async () => {
    const sakura = (await signIn('Sakura', 'native')).body.token;
    const momiji = (await signIn('Momiji', 'native')).body.token;
    const idempotencyKey = randomUUID();
    const body = { username: 'Shared_key', password };
    assert.equal((await app.post('/local-registrations', body, { idempotencyKey, ...bearer(sakura) })).status, 201);
    assert.equal((await app.post('/local-registrations', body, { idempotencyKey, ...bearer(sakura) })).headers.get('idempotent-replayed'), 'true');
    const other = await app.post('/local-registrations', body, { idempotencyKey, ...bearer(momiji) });
    assert.equal(other.status, 422);
    assert.equal(other.body.error.code, 'idempotency_key_reused');
    assert.equal((await app.database.reader.idempotencyRecord.findFirstOrThrow()).caller, `profile:${(await app.get('/sessions/current', bearer(sakura))).body.profile.id}`);
  });
});

describe('session limits and restart', () => {
  it('keeps the newest sessions of a profile and refuses sign-ins beyond the installation bound', async () => {
    const app = await startAccountsApp({ sessionLimits: { maxPerProfile: 3, maxSessions: 4 } });
    try {
      await app.post('/local-registrations', { username: 'Sakura', password });
      await app.post('/local-registrations', { username: 'Momiji', password });
      const tokens = [];
      for (let index = 0; index < 4; index += 1) {
        tokens.push((await app.post('/sessions', { username: 'Sakura', password, client: 'native' })).body.token);
      }
      assert.equal((await app.get('/sessions/current', bearer(tokens[0]))).status, 401, 'the oldest session was dropped');
      for (const token of tokens.slice(1)) {
        assert.equal((await app.get('/sessions/current', bearer(token))).status, 200);
      }
      assert.equal((await app.post('/sessions', { username: 'Momiji', password, client: 'native' })).status, 201);
      const refused = await app.post('/sessions', { username: 'Momiji', password, client: 'native' });
      assert.equal(refused.status, 503);
      assert.equal(refused.body.error.code, 'accounts_busy');
      assert.equal(refused.headers.get('retry-after'), '1');
      assert.equal(await app.database.reader.session.count(), 4);
    } finally {
      await app.stop();
    }
  });

  it('keeps sessions and revocations across a server restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nihon-sessions-restart-'));
    const dataDir = join(root, 'data');
    try {
      const first = await startAccountsApp({ dataDir });
      await first.post('/local-registrations', { username: 'Sakura', password });
      const kept = (await first.post('/sessions', { username: 'Sakura', password, client: 'native' })).body.token;
      const revoked = (await first.post('/sessions', { username: 'Sakura', password, client: 'native' })).body.token;
      assert.equal((await first.delete('/sessions/current', bearer(revoked))).status, 204);
      await first.stop();

      const second = await startAccountsApp({ dataDir });
      try {
        assert.equal((await second.get('/sessions/current', bearer(kept))).body.profile.username, 'Sakura');
        assert.equal((await second.get('/sessions/current', bearer(revoked))).status, 401);
      } finally {
        await second.stop();
      }
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('answers 503 accounts_busy when password checks are queued to their limit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = await startAccountsApp({
      module: { limits: { hashConcurrency: 1, hashQueue: 1 }, verifyPassword: async () => (await gate, false) },
    });
    try {
      const pending = [1, 2].map(() => app.post('/sessions', { username: 'nobody', password, client: 'web' }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const third = await app.post('/sessions', { username: 'nobody', password, client: 'web' });
      assert.equal(third.status, 503);
      assert.equal(third.body.error.code, 'accounts_busy');
      release();
      assert.deepEqual((await Promise.all(pending)).map((response) => response.status), [401, 401]);
    } finally {
      release();
      await app.stop();
    }
  });
});

describe('provider sign-in', () => {
  let app: AccountsApp;
  let fake: FakeProviders;
  let clock: Date;
  let googleProfileId: string;
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
      now: () => clock,
      module: { googleEndpoints: fake.endpoints.google, githubEndpoints: fake.endpoints.github, now: () => clock, limits: { maxPendingFlows: 5 } },
    });
    googleProfileId = await linkProfile('Hanami', 'google', googleIssuer, 'google-sub-1');
    await linkProfile('Octo', 'github', 'https://github.com', '987654');
  });
  afterEach(() => app.stop());

  async function linkProfile(username: string, provider: string, issuer: string, subject: string): Promise<string> {
    const id = randomUUID();
    await app.database.write((transaction) =>
      transaction.profile.create({
        data: { id, username, usernameKey: username.toLowerCase(), externalIdentities: { create: { id: randomUUID(), provider, issuer, subject } } },
      }),
    );
    return id;
  }

  const start = (provider: string, client: 'web' | 'native', init = {}, address = redirectUri) =>
    app.post('/oauth-sign-ins', { provider, redirectUri: address, client }, init);
  const complete = (body: Record<string, unknown>, init = {}) => app.post('/oauth-sign-ins/completion', body, init);
  const tokenExchanges = () => fake.requests.filter((request) => request.path === '/google/token').length;

  /** The fake Google answers the next exchange with an ID token for `sub`, bound to the flow's nonce. */
  function googleVouches(authorizationUrl: string, sub: string, claims: Record<string, unknown> = {}) {
    const nonce = new URL(authorizationUrl).searchParams.get('nonce');
    const seconds = Math.floor(clock.getTime() / 1000);
    fake.googleToken = () => ({
      status: 200,
      body: {
        access_token: 'ya29.google-access-token',
        id_token: fake.signIdToken({ iss: googleIssuer, aud: googleClient.clientId, sub, nonce, iat: seconds, exp: seconds + 3600, ...claims }),
      },
    });
  }

  it('signs a native client in with Google: PKCE, a bound single-use flow, and a fresh Nihon token', async () => {
    const started = await start('google', 'native');
    assert.equal(started.status, 201);
    const { authorizationUrl, state, clientBinding, expiresAt } = started.body;
    assert.match(clientBinding, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(expiresAt, new Date(clock.getTime() + 10 * 60 * 1000).toISOString());
    assert.equal(setCookie(started, 'nihon_oauth_binding'), undefined);
    const url = new URL(authorizationUrl);
    assert.equal(url.searchParams.get('state'), state);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(!authorizationUrl.includes(clientBinding), 'the binding never travels through the browser');
    const flow = await app.database.reader.oAuthSignInFlow.findFirstOrThrow();
    assert.equal(flow.stateHash, createHash('sha256').update(state).digest('hex'));
    assert.equal(flow.bindingHash, createHash('sha256').update(clientBinding).digest('hex'));

    googleVouches(authorizationUrl, 'google-sub-1');
    const response = await complete({ state, code: 'auth-code', clientBinding });
    assert.equal(response.status, 201);
    assert.equal(response.body.session.profile.id, googleProfileId);
    assert.equal(response.body.session.signedInWith, 'google');
    assert.equal(response.body.session.client, 'native');
    const exchange = fake.requests.find((request) => request.path === '/google/token');
    assert.equal(createHash('sha256').update(exchange?.form['code_verifier'] ?? '').digest('base64url'), url.searchParams.get('code_challenge'));
    assert.equal(await app.database.reader.oAuthSignInFlow.count(), 0);

    const { token } = response.body;
    assert.equal((await app.get('/sessions/current', bearer(token))).body.profile.username, 'Hanami');
    // The provider's own tokens never authorize Nihon operations.
    for (const providerToken of ['ya29.google-access-token', fake.signIdToken({ sub: 'google-sub-1' })]) {
      assert.equal((await app.get('/sessions/current', bearer(providerToken))).status, 401);
    }
    const everything = JSON.stringify([response.body, app.logs, await app.database.reader.$queryRawUnsafe('SELECT * FROM "Session"')]);
    assert.ok(!everything.includes('ya29.google-access-token'));
    assert.ok(!JSON.stringify(app.logs).includes(token));
  });

  it('signs a Web client in with GitHub through cookies only, without any email', async () => {
    const started = await start('github', 'web');
    assert.equal(started.body.clientBinding, undefined, 'a Web client never sees its binding');
    const binding = setCookie(started, 'nihon_oauth_binding');
    assert.ok(binding !== undefined);
    assert.ok(binding.attributes.includes('HttpOnly'));
    assert.ok(binding.attributes.includes('SameSite=Strict'));
    assert.ok(binding.attributes.includes('Path=/api/accounts/oauth-sign-ins'));
    assert.ok(binding.attributes.includes('Max-Age=600'));

    fake.githubToken = () => ({ status: 200, body: { access_token: 'gho_token', token_type: 'bearer' } });
    fake.githubUser = () => ({ status: 200, body: { id: 987654, login: 'renamed', email: null, name: null } });
    const response = await complete({ state: started.body.state, code: 'gh-code' }, cookie(binding.value, 'nihon_oauth_binding'));
    assert.equal(response.status, 201);
    assert.equal(response.body.token, undefined);
    assert.equal(response.body.session.signedInWith, 'github');
    assert.equal(setCookie(response, 'nihon_oauth_binding')?.value, '', 'the binding cookie is cleared');
    const session = setCookie(response, 'nihon_session')?.value ?? '';
    assert.equal((await app.get('/sessions/current', cookie(session))).body.profile.username, 'Octo');
  });

  it('signs in with a Google ID token that carries no email', async () => {
    const { authorizationUrl, state, clientBinding } = (await start('google', 'native')).body;
    googleVouches(authorizationUrl, 'google-sub-1', { email: undefined, email_verified: undefined });
    assert.equal((await complete({ state, code: 'c', clientBinding })).status, 201);
  });

  it('refuses an identity no profile is linked to, opening no session', async () => {
    const { authorizationUrl, state, clientBinding } = (await start('google', 'native')).body;
    googleVouches(authorizationUrl, 'someone-else');
    const response = await complete({ state, code: 'c', clientBinding });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'accounts_identity_not_registered');
    assert.equal(await app.database.reader.session.count(), 0);
    assert.equal(await app.database.reader.profile.count(), 2, 'sign-in never creates a profile');
  });

  it('opens one session for duplicate or concurrent callbacks and never calls the provider twice', async () => {
    const { authorizationUrl, state, clientBinding } = (await start('google', 'native')).body;
    googleVouches(authorizationUrl, 'google-sub-1');
    const responses = await Promise.all(Array.from({ length: 6 }, () => complete({ state, code: 'c', clientBinding })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400, 400, 400, 400, 400]);
    for (const refused of responses.filter((response) => response.status === 400)) {
      assert.equal(refused.body.error.code, 'accounts_oauth_state_invalid');
    }
    const replay = await complete({ state, code: 'c', clientBinding });
    assert.equal(replay.body.error.code, 'accounts_oauth_state_invalid');
    assert.equal(await app.database.reader.session.count(), 1);
    assert.equal(tokenExchanges(), 1);
  });

  it('refuses a return presented by another client without spoiling the real one', async () => {
    const { authorizationUrl, state, clientBinding } = (await start('google', 'native')).body;
    googleVouches(authorizationUrl, 'google-sub-1');
    for (const init of [{}, cookie('z'.repeat(43), 'nihon_oauth_binding')]) {
      const stolen = await complete({ state, code: 'c' }, init);
      assert.equal(stolen.status, 400);
      assert.equal(stolen.body.error.code, 'accounts_oauth_client_mismatch');
    }
    assert.equal((await complete({ state, code: 'c', clientBinding: 'w'.repeat(43) })).body.error.code, 'accounts_oauth_client_mismatch');
    assert.equal(tokenExchanges(), 0, 'the provider is not called');
    assert.equal((await complete({ state, code: 'c', clientBinding })).status, 201);
  });

  it('refuses the late return of an attempt the same browser superseded', async () => {
    const first = await start('google', 'web');
    const firstBinding = setCookie(first, 'nihon_oauth_binding')?.value ?? '';
    const second = await start('google', 'web', cookie(firstBinding, 'nihon_oauth_binding'));
    const secondBinding = setCookie(second, 'nihon_oauth_binding')?.value ?? '';
    assert.equal(await app.database.reader.oAuthSignInFlow.count(), 1, 'the first flow was deleted');

    googleVouches(first.body.authorizationUrl, 'google-sub-1');
    for (const binding of [firstBinding, secondBinding]) {
      const late = await complete({ state: first.body.state, code: 'c' }, cookie(binding, 'nihon_oauth_binding'));
      assert.equal(late.status, 400);
      assert.equal(late.body.error.code, 'accounts_oauth_state_invalid');
    }
    googleVouches(second.body.authorizationUrl, 'google-sub-1');
    assert.equal((await complete({ state: second.body.state, code: 'c' }, cookie(secondBinding, 'nihon_oauth_binding'))).status, 201);
  });

  it('refuses an expired flow', async () => {
    const { authorizationUrl, state, clientBinding } = (await start('google', 'native')).body;
    googleVouches(authorizationUrl, 'google-sub-1');
    clock = new Date(clock.getTime() + 10 * 60 * 1000);
    const response = await complete({ state, code: 'c', clientBinding });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'accounts_oauth_state_expired');
    assert.equal(tokenExchanges(), 0);
    assert.equal(await app.database.reader.session.count(), 0);
  });

  it('keeps sign-in and registration flows apart', async () => {
    const registration = (await app.post('/oauth-registrations', { provider: 'google', username: 'Newcomer', redirectUri })).body;
    const signIn = (await start('google', 'native')).body;
    assert.equal((await complete({ state: registration.state, code: 'c', clientBinding: signIn.clientBinding })).body.error.code, 'accounts_oauth_state_invalid');
    assert.equal((await app.post('/oauth-registrations/completion', { state: signIn.state, code: 'c' })).body.error.code, 'accounts_oauth_state_invalid');
    assert.equal(await app.database.reader.oAuthFlow.count(), 1);
    assert.equal(await app.database.reader.oAuthSignInFlow.count(), 1);
  });

  it('refuses arbitrary return addresses and unknown providers', async () => {
    for (const address of ['https://evil.example/cb', 'http://127.0.0.1.evil.example/cb', 'http://user@127.0.0.1/cb', 'javascript:alert(1)']) {
      const response = await start('google', 'native', {}, address);
      assert.equal(response.status, 400, address);
      assert.equal(response.body.error.code, 'accounts_oauth_redirect_uri_invalid');
    }
    assert.equal((await start('facebook', 'native')).body.error.code, 'accounts_oauth_provider_unavailable');
    assert.equal((await app.post('/oauth-sign-ins', { provider: 'google', redirectUri, client: 'native', username: 'x' })).status, 400);
    assert.equal(await app.database.reader.oAuthSignInFlow.count(), 0);
  });

  it('maps provider refusals and failures to stable codes and consumes the flow', async () => {
    const cases: [() => void, number, string][] = [
      [() => {}, 400, 'accounts_oauth_code_rejected'],
      [() => (fake.googleToken = () => ({ status: 500, body: 'oops' })), 502, 'accounts_oauth_provider_failed'],
    ];
    for (const [arrange, status, code] of cases) {
      const { state, clientBinding } = (await start('google', 'native')).body;
      arrange();
      const response = await complete({ state, code: 'c', clientBinding });
      assert.equal(response.status, status);
      assert.equal(response.body.error.code, code);
      assert.equal((await complete({ state, code: 'c', clientBinding })).body.error.code, 'accounts_oauth_state_invalid');
    }
    const { authorizationUrl, state, clientBinding } = (await start('google', 'native')).body;
    googleVouches(authorizationUrl, 'google-sub-1', { aud: 'another-client' });
    assert.equal((await complete({ state, code: 'c', clientBinding })).body.error.code, 'accounts_oauth_identity_unverified');
    assert.equal(await app.database.reader.session.count(), 0);
  });

  it('completes a flow started before a server restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nihon-sign-in-restart-'));
    const dataDir = join(root, 'data');
    const options = {
      oauth,
      dataDir,
      now: () => clock,
      module: { googleEndpoints: fake.endpoints.google, githubEndpoints: fake.endpoints.github, now: () => clock },
    };
    try {
      const first = await startAccountsApp(options);
      await first.database.write((transaction) =>
        transaction.profile.create({
          data: { id: randomUUID(), username: 'Hanami', usernameKey: 'hanami', externalIdentities: { create: { id: randomUUID(), provider: 'google', issuer: googleIssuer, subject: 'google-sub-1' } } },
        }),
      );
      const { authorizationUrl, state, clientBinding } = (await first.post('/oauth-sign-ins', { provider: 'google', redirectUri, client: 'native' })).body;
      await first.stop();

      const second = await startAccountsApp(options);
      try {
        googleVouches(authorizationUrl, 'google-sub-1');
        const response = await second.post('/oauth-sign-ins/completion', { state, code: 'c', clientBinding });
        assert.equal(response.status, 201);
        assert.equal((await second.get('/sessions/current', bearer(response.body.token))).body.profile.username, 'Hanami');
      } finally {
        await second.stop();
      }
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

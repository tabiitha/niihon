import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createNihonClient } from '../src/index.ts';

/**
 * Compiles against the published contract (src/schema.ts, from contracts/openapi.json) and checks
 * that the generated client sends registration bodies as the server expects and types its answers.
 * The server side is covered by apps/api/src/modules/accounts/accounts.test.ts.
 */
describe('generated TypeScript client, account registration', () => {
  function clientAnswering(status: number, body: unknown, seen: Request[]) {
    return createNihonClient({
      baseUrl: 'http://127.0.0.1:4000',
      fetch: async (request) => {
        seen.push(request.clone());
        return Response.json(body, { status });
      },
    });
  }

  it('sends the local registration as JSON and types the created profile', async () => {
    const seen: Request[] = [];
    const profile = { id: 'p1', username: 'sakura', role: 'user', registeredWith: 'local', createdAt: '2026-10-21T08:00:00.000Z' };
    const client = clientAnswering(201, profile, seen);
    const { data, error } = await client.POST('/api/accounts/local-registrations', {
      body: { username: 'sakura', password: 'correct horse' },
    });
    assert.equal(error, undefined);
    assert.equal(data?.registeredWith, 'local');
    assert.equal(seen[0]?.method, 'POST');
    assert.equal(new URL(seen[0]?.url ?? '').pathname, '/api/accounts/local-registrations');
    assert.equal(seen[0]?.headers.get('content-type'), 'application/json');
    assert.equal(seen[0]?.headers.get('nihon-api-version'), '1');
    assert.deepEqual(await seen[0]?.json(), { username: 'sakura', password: 'correct horse' });
  });

  it('types the refusal of a taken username', async () => {
    const client = clientAnswering(
      409,
      { error: { code: 'accounts_username_taken', message: 'This username is already used.', requestId: 'r1' } },
      [],
    );
    const { data, error, response } = await client.POST('/api/accounts/local-registrations', {
      body: { username: 'sakura', password: 'correct horse' },
    });
    assert.equal(data, undefined);
    assert.equal(response.status, 409);
    assert.equal(error?.error.code, 'accounts_username_taken');
  });

  it('starts and completes a provider registration', async () => {
    const seen: Request[] = [];
    const started = { authorizationUrl: 'https://accounts.example/auth?x=1', state: 's'.repeat(43), expiresAt: '2026-10-21T08:10:00.000Z' };
    const client = clientAnswering(201, started, seen);
    const start = await client.POST('/api/accounts/oauth-registrations', {
      body: { provider: 'google', username: 'sakura', redirectUri: 'http://127.0.0.1:4000/auth/callback' },
    });
    assert.equal(start.data?.state, started.state);

    const completion = await client.POST('/api/accounts/oauth-registrations/completion', {
      body: { state: started.state, code: 'code-from-provider' },
    });
    assert.equal(new URL(seen[1]?.url ?? '').pathname, '/api/accounts/oauth-registrations/completion');
    assert.deepEqual(await seen[1]?.json(), { state: started.state, code: 'code-from-provider' });
    assert.equal(completion.response.status, 201);
  });

  it('sends an idempotency key with a registration and types the refusal of a reused key', async () => {
    const seen: Request[] = [];
    const client = clientAnswering(
      422,
      { error: { code: 'idempotency_key_reused', message: 'This idempotency key was already used.', requestId: 'r2' } },
      seen,
    );
    const { error, response } = await client.POST('/api/accounts/local-registrations', {
      params: { header: { 'Idempotency-Key': '9b2f4c1e-7d3a-4e8b-a6f0-2c5d8e1b3a77' } },
      body: { username: 'sakura', password: 'correct horse' },
    });
    assert.equal(seen[0]?.headers.get('idempotency-key'), '9b2f4c1e-7d3a-4e8b-a6f0-2c5d8e1b3a77');
    assert.equal(response.status, 422);
    assert.equal(error?.error.code, 'idempotency_key_reused');
  });

  it('lists the providers of the installation', async () => {
    const client = clientAnswering(200, { items: [{ id: 'github' }, { id: 'google' }] }, []);
    const { data } = await client.GET('/api/accounts/oauth-providers');
    assert.deepEqual(data?.items.map((provider) => provider.id), ['github', 'google']);
  });
});

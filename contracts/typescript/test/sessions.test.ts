import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createNihonClient } from '../src/index.ts';

/**
 * Compiles against the published contract and checks that the generated client sends sign-in
 * requests as the server expects and types its answers. The server side is covered by
 * apps/api/src/modules/accounts/sign-in.test.ts.
 */
describe('generated TypeScript client, sign-in and sessions', () => {
  const session = {
    id: 's1',
    profile: { id: 'p1', username: 'Sakura', role: 'user' },
    client: 'native',
    signedInWith: 'local',
    createdAt: '2026-10-23T08:00:00.000Z',
    expiresAt: '2026-11-22T08:00:00.000Z',
  };

  function clientAnswering(answer: () => Response, seen: Request[]) {
    return createNihonClient({
      baseUrl: 'http://127.0.0.1:4000',
      fetch: async (request) => {
        seen.push(request.clone());
        return answer();
      },
    });
  }

  it('signs in with a password and types the session and native token', async () => {
    const seen: Request[] = [];
    const client = clientAnswering(() => Response.json({ session, token: 't'.repeat(43) }, { status: 201 }), seen);
    const { data, error } = await client.POST('/api/accounts/sessions', {
      body: { username: 'sakura', password: 'correct horse', client: 'native' },
    });
    assert.equal(error, undefined);
    assert.equal(data?.session.profile.username, 'Sakura');
    assert.equal(data?.token, 't'.repeat(43));
    assert.deepEqual(await seen[0]?.json(), { username: 'sakura', password: 'correct horse', client: 'native' });
  });

  it('types the refusal of wrong credentials', async () => {
    const client = clientAnswering(
      () => Response.json({ error: { code: 'accounts_credentials_invalid', message: 'No.', requestId: 'r1' } }, { status: 401 }),
      [],
    );
    const { error, response } = await client.POST('/api/accounts/sessions', {
      body: { username: 'sakura', password: 'wrong', client: 'web' },
    });
    assert.equal(response.status, 401);
    assert.equal(error?.error.code, 'accounts_credentials_invalid');
  });

  it('starts and completes a provider sign-in with the client binding', async () => {
    const seen: Request[] = [];
    const started = { authorizationUrl: 'https://accounts.example/auth', state: 's'.repeat(43), expiresAt: '2026-10-23T08:10:00.000Z', clientBinding: 'b'.repeat(43) };
    const client = clientAnswering(() => Response.json(started, { status: 201 }), seen);
    const start = await client.POST('/api/accounts/oauth-sign-ins', {
      body: { provider: 'google', redirectUri: 'http://127.0.0.1:53682/callback', client: 'native' },
    });
    assert.equal(start.data?.clientBinding, started.clientBinding);
    await client.POST('/api/accounts/oauth-sign-ins/completion', {
      body: { state: started.state, code: 'code', clientBinding: started.clientBinding },
    });
    assert.deepEqual(await seen[1]?.json(), { state: started.state, code: 'code', clientBinding: started.clientBinding });
  });

  it('reads the current session, types its absence, and signs out with an empty answer', async () => {
    const seen: Request[] = [];
    const answers = [
      () => Response.json(session, { status: 200 }),
      () => Response.json({ error: { code: 'authentication_required', message: 'Sign in.', requestId: 'r2' } }, { status: 401 }),
      () => new Response(null, { status: 204 }),
    ];
    const client = clientAnswering(() => (answers.shift() as () => Response)(), seen);
    assert.equal((await client.GET('/api/accounts/sessions/current')).data?.expiresAt, session.expiresAt);
    assert.equal((await client.GET('/api/accounts/sessions/current')).error?.error.code, 'authentication_required');
    const out = await client.DELETE('/api/accounts/sessions/current');
    assert.equal(out.response.status, 204);
    assert.equal(seen[2]?.method, 'DELETE');
  });
});

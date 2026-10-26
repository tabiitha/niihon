import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { createApiClient, type FetchFunction } from '../../api/service.ts';
import {
  createPendingStore,
  finishProviderRegistration,
  newIdempotencyKey,
  parseProviderReturn,
  registerLocal,
  returnAddress,
  startProviderRegistration,
  webAddress,
} from './registration.ts';

const origin = 'http://127.0.0.1:4000';

class MemoryStorage {
  readonly entries = new Map<string, string>();
  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.entries.set(key, value);
  }
  removeItem(key: string) {
    this.entries.delete(key);
  }
}

function recording(answer: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetchImplementation: FetchFunction = async (request) => {
    requests.push(request.clone());
    return answer(request);
  };
  return { client: createApiClient(origin, fetchImplementation), requests };
}

const profile = { id: 'p1', username: 'sakura', role: 'user', registeredWith: 'github', createdAt: '2026-10-24T10:00:00.000Z' };
const flow = { state: 'state-1', provider: 'github', idempotencyKey: 'key-0123456789abcdef', username: 'sakura' };

describe('registration requests', () => {
  it('send the credentials and an idempotency key, and nothing else', async () => {
    const { client, requests } = recording(() => Response.json(profile, { status: 201 }));
    const key = newIdempotencyKey();
    assert.match(key, /^[A-Za-z0-9_-]{16,64}$/);
    const outcome = await registerLocal(client, { username: 'sakura', password: 'correct horse' }, key, new AbortController().signal);
    assert.equal(outcome.ok, true);
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(new URL(requests[0]!.url).pathname, '/api/accounts/local-registrations');
    assert.equal(requests[0]?.headers.get('Idempotency-Key'), key);
    assert.deepEqual(await requests[0]?.json(), { username: 'sakura', password: 'correct horse' });
  });

  it('start a provider registration that returns to the screen of this origin', () => {
    assert.equal(returnAddress(origin), 'http://127.0.0.1:4000/register');
  });

  it('open only web addresses at the provider', () => {
    assert.equal(webAddress('https://accounts.google.com/o/oauth2/v2/auth?x=1'), 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
    assert.equal(webAddress('javascript:alert(1)'), undefined);
    assert.equal(webAddress('data:text/html,x'), undefined);
    assert.equal(webAddress('not an address'), undefined);
  });
});

describe('provider return', () => {
  it('reads the code and state, or the provider refusal, from the address', () => {
    assert.deepEqual(parseProviderReturn('?code=abc&state=s1&scope=openid'), { kind: 'code', state: 's1', code: 'abc' });
    assert.deepEqual(parseProviderReturn('?error=access_denied&state=s1'), { kind: 'denied', state: 's1' });
    assert.deepEqual(parseProviderReturn('?error=access_denied'), { kind: 'denied', state: undefined });
  });

  it('is absent from an ordinary visit or a half answer', () => {
    assert.equal(parseProviderReturn(''), undefined);
    assert.equal(parseProviderReturn('?code=abc'), undefined);
    assert.equal(parseProviderReturn('?state=s1'), undefined);
    assert.equal(parseProviderReturn('?code=&state=s1'), undefined);
  });
});

describe('pending provider registration', () => {
  it('keeps only the flow reference, the provider, the retry key, and the public username', async () => {
    const storage = new MemoryStorage();
    const store = createPendingStore(storage);
    const { client } = recording(() =>
      Response.json({ authorizationUrl: 'https://github.com/login/oauth/authorize?state=state-1', state: 'state-1', expiresAt: '2026-10-24T10:10:00.000Z' }, { status: 201 }),
    );
    const result = await startProviderRegistration(client, store, { provider: 'github', username: 'sakura', origin }, new AbortController().signal);
    assert.deepEqual(result, { kind: 'redirect', address: 'https://github.com/login/oauth/authorize?state=state-1' });
    assert.equal(storage.entries.size, 1);
    const stored = JSON.parse([...storage.entries.values()][0] as string) as Record<string, string>;
    assert.deepEqual(Object.keys(stored).sort(), ['idempotencyKey', 'provider', 'state', 'username']);
    assert.equal(stored['username'], 'sakura');
    assert.equal(stored['state'], 'state-1');
  });

  it('refuses a provider registration when the browser has no storage to remember it', async () => {
    const answer = () =>
      Response.json({ authorizationUrl: 'https://github.com/login/oauth/authorize', state: 'state-1', expiresAt: '2026-10-24T10:10:00.000Z' }, { status: 201 });
    for (const storage of [undefined, { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined }]) {
      const { client } = recording(answer);
      const result = await startProviderRegistration(client, createPendingStore(storage), { provider: 'github', username: 'sakura', origin }, new AbortController().signal);
      assert.deepEqual(result, { kind: 'storage' });
    }
  });

  it('ignores a damaged entry', () => {
    const storage = new MemoryStorage();
    storage.setItem('nihon.registration.pending', '{"state": 1}');
    assert.equal(createPendingStore(storage).read(), undefined);
    storage.setItem('nihon.registration.pending', 'not json');
    assert.equal(createPendingStore(storage).read(), undefined);
  });
});

describe('finishing a provider registration', () => {
  const signal = () => new AbortController().signal;

  it('sends nothing when no registration is pending or the state is not the issued one', async () => {
    const { client, requests } = recording(() => Response.json(profile, { status: 201 }));
    const store = createPendingStore(new MemoryStorage());
    assert.deepEqual(await finishProviderRegistration(client, store, { kind: 'code', state: 'state-1', code: 'c' }, signal()), { kind: 'mismatch' });
    store.save(flow);
    assert.deepEqual(await finishProviderRegistration(client, store, { kind: 'code', state: 'forged', code: 'c' }, signal()), { kind: 'mismatch' });
    assert.deepEqual(await finishProviderRegistration(client, store, { kind: 'denied', state: undefined }, signal()), { kind: 'mismatch' });
    assert.equal(requests.length, 0);
    assert.deepEqual(store.read(), flow, 'a forged return does not cancel the pending registration');
  });

  it('forgets a registration the provider refused', async () => {
    const { client, requests } = recording(() => Response.json(profile, { status: 201 }));
    const store = createPendingStore(new MemoryStorage());
    store.save(flow);
    assert.deepEqual(await finishProviderRegistration(client, store, { kind: 'denied', state: 'state-1' }, signal()), { kind: 'denied' });
    assert.equal(store.read(), undefined);
    assert.equal(requests.length, 0);
  });

  it('completes with the retry key, sends only the state and the code, and forgets the flow', async () => {
    const { client, requests } = recording(() => Response.json(profile, { status: 201 }));
    const store = createPendingStore(new MemoryStorage());
    store.save(flow);
    const result = await finishProviderRegistration(client, store, { kind: 'code', state: 'state-1', code: 'the-code' }, signal());
    assert.equal(result.kind, 'registered');
    assert.equal(requests[0]?.headers.get('Idempotency-Key'), flow.idempotencyKey);
    assert.deepEqual(await requests[0]?.json(), { state: 'state-1', code: 'the-code' });
    assert.equal(store.read(), undefined);
  });

  it('keeps the flow for a retry only while a lost answer leaves the outcome open', async () => {
    const store = createPendingStore(new MemoryStorage());
    store.save(flow);
    const lost = recording(() => {
      throw new TypeError('fetch failed');
    });
    const first = await finishProviderRegistration(lost.client, store, { kind: 'code', state: 'state-1', code: 'c' }, signal());
    assert.deepEqual(first, { kind: 'failed', failure: { kind: 'unavailable' }, retry: 'same' });
    assert.deepEqual(store.read(), flow);

    const refused = recording(() => Response.json({ error: { code: 'accounts_oauth_code_rejected', message: 'x', requestId: 'r' } }, { status: 400 }));
    const second = await finishProviderRegistration(refused.client, store, { kind: 'code', state: 'state-1', code: 'c' }, signal());
    assert.equal(second.kind === 'failed' && second.retry, 'new');
    assert.equal(store.read(), undefined);
  });
});

describe('finishing a provider registration after the server answered with 5xx codes', () => {
  const signal = () => new AbortController().signal;
  const body = (code: string) => ({ error: { code, message: 'x', requestId: 'r' } });

  for (const [status, code, retry] of [
    [502, 'accounts_oauth_provider_failed', 'new'],
    [503, 'accounts_oauth_flow_consumed', 'new'],
    [503, 'accounts_busy', 'same'],
    [503, 'idempotency_capacity_reached', 'withoutKey'],
    [409, 'idempotency_key_in_use', 'same'],
    [500, 'internal_error', 'same'],
  ] as const) {
    it(`${code} (${String(status)}) is a server answer: ${retry === 'new' ? 'the registration starts again' : 'the same completion can be repeated'}`, async () => {
      const { client } = recording(() => Response.json(body(code), { status }));
      const store = createPendingStore(new MemoryStorage());
      store.save(flow);
      const result = await finishProviderRegistration(client, store, { kind: 'code', state: 'state-1', code: 'c' }, signal());
      assert.ok(result.kind === 'failed');
      assert.equal(result.failure.kind, 'error', 'not a stopped service');
      assert.equal(result.retry, retry);
      assert.deepEqual(store.read(), retry === 'new' ? undefined : flow);
    });
  }

  it('leaves the username for the next form when the registration ends without a profile', async () => {
    const { client } = recording(() => Response.json(body('accounts_oauth_provider_failed'), { status: 502 }));
    const store = createPendingStore(new MemoryStorage());
    store.save(flow);
    await finishProviderRegistration(client, store, { kind: 'code', state: 'state-1', code: 'c' }, signal());
    assert.equal(store.read(), undefined);
    assert.equal(store.rememberedUsername(), 'sakura');
    store.forgetUsername();
    assert.equal(store.rememberedUsername(), undefined);
  });

  it('leaves the username after a refusal at the provider, but not while the same completion can be repeated', async () => {
    const { client } = recording(() => Response.json(body('accounts_busy'), { status: 503 }));
    const store = createPendingStore(new MemoryStorage());
    store.save(flow);
    await finishProviderRegistration(client, store, { kind: 'code', state: 'state-1', code: 'c' }, signal());
    assert.equal(store.rememberedUsername(), undefined, 'the flow itself still holds it');
    assert.deepEqual(await finishProviderRegistration(client, store, { kind: 'denied', state: 'state-1' }, signal()), { kind: 'denied' });
    assert.equal(store.rememberedUsername(), 'sakura');
  });

  it('repeats a completion without a key when the server has no room to record one', async () => {
    const { client, requests } = recording(() => Response.json(body('idempotency_capacity_reached'), { status: 503 }));
    const store = createPendingStore(new MemoryStorage());
    store.save(flow);
    const answer = { kind: 'code', state: 'state-1', code: 'c' } as const;
    await finishProviderRegistration(client, store, answer, signal());
    await finishProviderRegistration(client, store, answer, signal(), { withoutKey: true });
    assert.equal(requests[0]?.headers.get('Idempotency-Key'), flow.idempotencyKey);
    assert.equal(requests[1]?.headers.has('Idempotency-Key'), false);
  });
});

describe('registration styles', () => {
  it('take every color from the theme variables, so that every appearance applies', () => {
    const css = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8');
    const accountStyles = css.slice(css.indexOf('/* Account screens'));
    assert.ok(accountStyles.length > 100, 'the account styles are present');
    assert.doesNotMatch(accountStyles, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, 'a color literal bypasses the theme');
  });
});

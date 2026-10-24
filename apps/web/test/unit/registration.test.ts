import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { describeFailure } from '../../src/modules/accounts/errors.ts';
import {
  createPendingStore,
  finishProviderRegistration,
  loadProviders,
  newIdempotencyKey,
  registerLocal,
  startProviderRegistration,
  type PendingFlow,
} from '../../src/modules/accounts/registration.ts';
import { createApiClient, type FetchFunction } from '../../src/api/service.ts';
import { startAccountsServer, type AccountsServer } from './accounts-server.ts';

// The registration operations of the Web client against the real API and database, over loopback only:
// no Internet access, no email, no external account. Google and GitHub are played by a local fake.

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

const signal = () => new AbortController().signal;
const password = 'a long enough passphrase';

describe('local registration against the real backend', () => {
  let server: AccountsServer;
  let client: ReturnType<typeof createApiClient>;
  before(async () => {
    server = await startAccountsServer();
    client = createApiClient(server.baseUrl);
  });
  after(() => server.stop());

  it('creates a local profile that only the typed username and password describe', async () => {
    const outcome = await registerLocal(client, { username: 'Sakura_Local', password }, newIdempotencyKey(), signal());
    assert.equal(outcome.ok, true);
    assert.ok(outcome.ok);
    assert.equal(outcome.data.username, 'Sakura_Local');
    assert.equal(outcome.data.role, 'user');
    assert.equal(outcome.data.registeredWith, 'local');
    assert.doesNotMatch(JSON.stringify(outcome.data), new RegExp(password));
  });

  it('shows the duplicate-username message, whatever the case, and keeps the typed name for another try', async () => {
    const outcome = await registerLocal(client, { username: 'sakura_local', password }, newIdempotencyKey(), signal());
    assert.ok(!outcome.ok);
    assert.deepEqual(describeFailure(outcome.failure).message, 'errorUsernameTaken');
    assert.equal(describeFailure(outcome.failure).field, 'username');
  });

  it('shows the invalid-password message for a password the server refuses, and creates nothing', async () => {
    const refused = await registerLocal(client, { username: 'short_password', password: 'short' }, newIdempotencyKey(), signal());
    assert.ok(!refused.ok);
    assert.deepEqual(
      { message: describeFailure(refused.failure).message, field: describeFailure(refused.failure).field },
      { message: 'errorPasswordInvalid', field: 'password' },
    );
    const accepted = await registerLocal(client, { username: 'short_password', password }, newIdempotencyKey(), signal());
    assert.equal(accepted.ok, true, 'the username was not used up by the refused attempt');
  });

  it('shows the invalid-username message', async () => {
    const outcome = await registerLocal(client, { username: 'no spaces!', password }, newIdempotencyKey(), signal());
    assert.ok(!outcome.ok);
    assert.equal(describeFailure(outcome.failure).message, 'errorUsernameInvalid');
  });

  it('returns the profile that was created when the answer was lost, instead of reporting a taken name', async () => {
    const key = newIdempotencyKey();
    let lose = true;
    const losing: FetchFunction = async (request) => {
      const response = await fetch(request);
      if (lose) {
        lose = false;
        await response.arrayBuffer();
        throw new TypeError('fetch failed');
      }
      return response;
    };
    const flaky = createApiClient(server.baseUrl, losing);
    const first = await registerLocal(flaky, { username: 'lost_answer', password }, key, signal());
    assert.deepEqual(first, { ok: false, failure: { kind: 'unavailable' } });
    assert.equal(describeFailure(first.ok ? { kind: 'error' } : first.failure).message, 'errorUnavailable');
    const retry = await registerLocal(flaky, { username: 'lost_answer', password }, key, signal());
    assert.ok(retry.ok, 'the retry with the same key returns the profile');
    assert.equal(retry.data.username, 'lost_answer');
    const another = await registerLocal(flaky, { username: 'lost_answer', password }, newIdempotencyKey(), signal());
    assert.ok(!another.ok, 'only one profile exists');
    assert.equal(describeFailure(another.failure).message, 'errorUsernameTaken');
  });

  it('ignores a request that was cancelled when the form was left', async () => {
    const controller = new AbortController();
    const pending = registerLocal(client, { username: 'left_the_form', password }, newIdempotencyKey(), controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'RequestCancelledError' });
  });

  it('reports a service that stopped as unavailable, with the typed data still in the page', async () => {
    const stopping = await startAccountsServer();
    const gone = createApiClient(stopping.baseUrl);
    await stopping.stop();
    const outcome = await registerLocal(gone, { username: 'nobody_home', password }, newIdempotencyKey(), signal());
    assert.deepEqual(outcome, { ok: false, failure: { kind: 'unavailable' } });
  });
});

describe('provider registration against the real backend and a fake provider', () => {
  let server: AccountsServer;
  let client: ReturnType<typeof createApiClient>;
  const origin = 'http://127.0.0.1:4000';
  before(async () => {
    server = await startAccountsServer();
    client = createApiClient(server.baseUrl);
  });
  after(() => server.stop());

  /** Starts a registration and returns the store that remembers it, as the browser tab would. */
  async function start(provider: string, username: string, address = origin) {
    const storage = new MemoryStorage();
    const store = createPendingStore(storage);
    const started = await startProviderRegistration(client, store, { provider, username, origin: address }, signal());
    return { storage, store, started };
  }

  it('lists the providers this installation offers', async () => {
    const outcome = await loadProviders(client, signal());
    assert.ok(outcome.ok);
    assert.deepEqual([...outcome.data].sort(), ['github', 'google']);
  });

  it('starts and completes a GitHub registration with the chosen username, without a password', async () => {
    const { storage, store, started } = await start('github', 'octo_cat');
    assert.equal(started.kind, 'redirect');
    const pending = store.read() as PendingFlow;
    assert.deepEqual(Object.keys(pending).sort(), ['idempotencyKey', 'provider', 'state']);
    assert.doesNotMatch([...storage.entries.values()].join(), /password|code/i);

    const finished = await finishProviderRegistration(client, store, { kind: 'code', state: pending.state, code: 'github:1001' }, signal());
    assert.equal(finished.kind, 'registered');
    assert.ok(finished.kind === 'registered');
    assert.equal(finished.profile.username, 'octo_cat');
    assert.equal(finished.profile.registeredWith, 'github');
    assert.equal(storage.entries.size, 0, 'nothing stays in the storage');
  });

  it('completes a Google registration, checking the nonce the browser carried to the provider', async () => {
    const { store, started } = await start('google', 'g_person');
    assert.ok(started.kind === 'redirect');
    const nonce = new URL(started.address).searchParams.get('nonce');
    const pending = store.read() as PendingFlow;
    const finished = await finishProviderRegistration(client, store, { kind: 'code', state: pending.state, code: `google:sub-1:${nonce}` }, signal());
    assert.ok(finished.kind === 'registered');
    assert.equal(finished.profile.registeredWith, 'google');
  });

  it('never creates a second profile for the same provider identity or the same flow', async () => {
    const first = await start('github', 'first_name');
    const firstPending = first.store.read() as PendingFlow;
    const registered = await finishProviderRegistration(client, first.store, { kind: 'code', state: firstPending.state, code: 'github:2002' }, signal());
    assert.equal(registered.kind, 'registered');

    // The same identity under another username is refused.
    const second = await start('github', 'second_name');
    const secondPending = second.store.read() as PendingFlow;
    const refused = await finishProviderRegistration(client, second.store, { kind: 'code', state: secondPending.state, code: 'github:2002' }, signal());
    assert.ok(refused.kind === 'failed');
    assert.equal(describeFailure(refused.failure).message, 'errorIdentityRegistered');
    assert.equal(refused.retryable, false);
    assert.equal(second.store.read(), undefined);
    // The username of the refused attempt was not used up.
    assert.equal((await registerLocal(client, { username: 'second_name', password }, newIdempotencyKey(), signal())).ok, true);

    // A replay of the completed flow reaches nobody: the state is no longer pending in this tab.
    assert.deepEqual(await finishProviderRegistration(client, first.store, { kind: 'code', state: firstPending.state, code: 'github:2002' }, signal()), { kind: 'mismatch' });
  });

  it('returns the profile of a registration whose answer was lost, never a second one', async () => {
    const { store, started } = await start('github', 'lost_flow');
    assert.ok(started.kind === 'redirect');
    const pending = store.read() as PendingFlow;
    let lose = true;
    const flaky = createApiClient(server.baseUrl, async (request) => {
      const response = await fetch(request);
      if (lose) {
        lose = false;
        await response.arrayBuffer();
        throw new TypeError('fetch failed');
      }
      return response;
    });
    const answer = { kind: 'code', state: pending.state, code: 'github:3003' } as const;
    const first = await finishProviderRegistration(flaky, store, answer, signal());
    assert.ok(first.kind === 'failed' && first.retryable);
    const retry = await finishProviderRegistration(flaky, store, answer, signal());
    assert.ok(retry.kind === 'registered');
    assert.equal(retry.profile.username, 'lost_flow');
  });

  it('shows a clear error when the provider refuses the code, and forgets the flow', async () => {
    const { store, started } = await start('github', 'refused_code');
    assert.ok(started.kind === 'redirect');
    const pending = store.read() as PendingFlow;
    const finished = await finishProviderRegistration(client, store, { kind: 'code', state: pending.state, code: 'forged-code' }, signal());
    assert.ok(finished.kind === 'failed');
    assert.equal(describeFailure(finished.failure).message, 'errorCodeRejected');
    assert.equal(store.read(), undefined);
  });

  it('refuses a username that is already taken before the provider page opens', async () => {
    await registerLocal(client, { username: 'taken_early', password }, newIdempotencyKey(), signal());
    const { storage, started } = await start('github', 'Taken_Early');
    assert.ok(started.kind === 'failed');
    assert.equal(describeFailure(started.failure).message, 'errorUsernameTaken');
    assert.equal(storage.entries.size, 0);
  });

  it('explains a provider this installation lacks and a return address the server refuses', async () => {
    const unknown = await start('gitlab', 'someone');
    assert.ok(unknown.started.kind === 'failed');
    assert.equal(describeFailure(unknown.started.failure).message, 'errorProviderUnavailable');
    const foreign = await start('github', 'someone', 'http://nihon.example.com');
    assert.ok(foreign.started.kind === 'failed');
    assert.equal(describeFailure(foreign.started.failure).message, 'errorRedirectUri');
  });
});

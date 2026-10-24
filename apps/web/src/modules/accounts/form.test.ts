import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApiClient, type FetchFunction } from '../../api/service.ts';
import { createRegistrationForm, viewOfFinish } from './form.ts';
import { createPendingStore } from './registration.ts';

const origin = 'http://127.0.0.1:4000';
const profile = { id: 'p1', username: 'sakura', role: 'user', registeredWith: 'local', createdAt: '2026-10-24T10:00:00.000Z' };
const refusal = (status: number, code: string, issues?: { path: string; message: string }[]) =>
  Response.json({ error: { code, message: 'x', requestId: 'req-1', ...(issues === undefined ? {} : { issues }) } }, { status });

class MemoryStorage {
  readonly entries = new Map<string, string>();
  getItem = (key: string) => this.entries.get(key) ?? null;
  setItem = (key: string, value: string) => void this.entries.set(key, value);
  removeItem = (key: string) => void this.entries.delete(key);
}

/** A form over a scripted server: each request takes the next answer (a function may delay it). */
function setup(...answers: ((request: Request) => Response | Promise<Response>)[]) {
  const requests: Request[] = [];
  const opened: string[] = [];
  const fetchImplementation: FetchFunction = async (request) => {
    requests.push(request.clone());
    const next = answers[Math.min(requests.length - 1, answers.length - 1)];
    return next!(request);
  };
  let counter = 0;
  const storage = new MemoryStorage();
  const form = createRegistrationForm({
    client: createApiClient(origin, fetchImplementation),
    store: createPendingStore(storage),
    origin,
    openProvider: (address) => opened.push(address),
    newKey: () => `key-${String(++counter).padStart(16, '0')}`,
  });
  const leave = form.connect();
  const fill = (username = 'sakura', password = 'a long enough passphrase', confirmation = password) => {
    form.setField('username', username);
    form.setField('password', password);
    form.setField('confirmation', confirmation);
  };
  return { form, requests, opened, storage, leave, fill };
}

describe('registration form', () => {
  it('asks for what is missing without contacting the server', async () => {
    const { form, requests, fill } = setup(() => Response.json(profile, { status: 201 }));
    await form.submit();
    assert.deepEqual(form.getState().problem, { message: 'usernameRequired', field: 'username' });
    fill('sakura', '');
    await form.submit();
    assert.equal(form.getState().problem?.message, 'passwordRequired');
    fill('sakura', 'a long enough passphrase', 'another passphrase');
    await form.submit();
    assert.deepEqual(form.getState().problem, { message: 'passwordsDiffer', field: 'confirmation' });
    assert.equal(requests.length, 0);
  });

  it('drops a second submission that arrives before the first answer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { form, requests, fill } = setup(async () => {
      await gate;
      return Response.json(profile, { status: 201 });
    });
    fill();
    const first = form.submit();
    const second = form.submit();
    assert.equal(form.getState().busy, 'local');
    release();
    await Promise.all([first, second]);
    assert.equal(requests.length, 1);
    assert.equal(form.getState().profile?.username, 'sakura');
  });

  it('clears the passwords once the profile exists, and sends the typed credentials with a key', async () => {
    const { form, requests, fill } = setup(() => Response.json(profile, { status: 201 }));
    fill();
    await form.submit();
    assert.deepEqual({ password: form.getState().password, confirmation: form.getState().confirmation, busy: form.getState().busy }, { password: '', confirmation: '', busy: undefined });
    assert.deepEqual(await requests[0]?.json(), { username: 'sakura', password: 'a long enough passphrase' });
    assert.equal(requests[0]?.headers.get('Idempotency-Key'), 'key-0000000000000001');
  });

  it('keeps the username and clears the passwords after a definite refusal, then sends a new key', async () => {
    const { form, requests, fill } = setup(
      () => refusal(409, 'accounts_username_taken'),
      () => Response.json(profile, { status: 201 }),
    );
    fill('Sakura');
    await form.submit();
    const state = form.getState();
    assert.deepEqual({ message: state.problem?.message, field: state.problem?.field }, { message: 'errorUsernameTaken', field: 'username' });
    assert.deepEqual({ username: state.username, password: state.password, confirmation: state.confirmation }, { username: 'Sakura', password: '', confirmation: '' });
    fill('Sakura2');
    await form.submit();
    assert.equal(requests[1]?.headers.get('Idempotency-Key'), 'key-0000000000000002');
  });

  it('shows the invalid-password message on the password field', async () => {
    const { form, fill } = setup(() => refusal(400, 'validation_failed', [{ path: 'body.password', message: 'short' }]));
    fill('sakura', 'short');
    await form.submit();
    assert.deepEqual({ message: form.getState().problem?.message, field: form.getState().problem?.field }, { message: 'errorPasswordInvalid', field: 'password' });
    assert.equal(form.getState().username, 'sakura');
  });

  it('keeps everything and the same key after a lost answer, so that a retry cannot create a second profile', async () => {
    const { form, requests, fill } = setup(
      () => {
        throw new TypeError('fetch failed');
      },
      () => Response.json(profile, { status: 201 }),
    );
    fill();
    await form.submit();
    assert.equal(form.getState().problem?.message, 'errorUnavailable');
    assert.deepEqual({ u: form.getState().username, p: form.getState().password, c: form.getState().confirmation }, { u: 'sakura', p: 'a long enough passphrase', c: 'a long enough passphrase' });
    await form.submit();
    assert.equal(requests[1]?.headers.get('Idempotency-Key'), requests[0]?.headers.get('Idempotency-Key'));
    assert.ok(form.getState().profile);
  });

  it('starts a new command when a field is edited after a lost answer', async () => {
    const { form, requests, fill } = setup(
      () => {
        throw new TypeError('fetch failed');
      },
      () => Response.json(profile, { status: 201 }),
    );
    fill();
    await form.submit();
    form.setField('username', 'sakura2');
    await form.submit();
    assert.notEqual(requests[1]?.headers.get('Idempotency-Key'), requests[0]?.headers.get('Idempotency-Key'));
  });

  it('keeps the data and the key while the server is busy or still running the same command', async () => {
    for (const [status, code] of [[503, 'accounts_busy'], [409, 'idempotency_key_in_use'], [500, 'internal_error']] as const) {
      const { form, requests, fill } = setup(() => refusal(status, code), () => Response.json(profile, { status: 201 }));
      fill();
      await form.submit();
      assert.equal(form.getState().password, 'a long enough passphrase', code);
      assert.notEqual(form.getState().problem?.message, 'errorUnavailable', code);
      await form.submit();
      assert.equal(requests[1]?.headers.get('Idempotency-Key'), requests[0]?.headers.get('Idempotency-Key'), code);
    }
  });

  it('sends the next attempt without a key when the server cannot record one', async () => {
    const { form, requests, fill } = setup(() => refusal(503, 'idempotency_capacity_reached'), () => Response.json(profile, { status: 201 }));
    fill();
    await form.submit();
    assert.equal(form.getState().password, 'a long enough passphrase');
    await form.submit();
    assert.equal(requests[0]?.headers.has('Idempotency-Key'), true);
    assert.equal(requests[1]?.headers.has('Idempotency-Key'), false);
    assert.ok(form.getState().profile);
  });

  it('ignores an answer that arrives after the form was left', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { form, fill, leave } = setup(async () => {
      await gate;
      return Response.json(profile, { status: 201 });
    });
    fill();
    const pending = form.submit();
    leave();
    release();
    await pending;
    assert.equal(form.getState().profile, undefined);
    assert.equal(form.getState().password, 'a long enough passphrase', 'nothing changed after leaving');
  });

  it('is usable again when the page returns from the back-forward cache', async () => {
    const { form, fill } = setup(() => new Promise<Response>(() => undefined));
    fill();
    void form.submit();
    assert.equal(form.getState().busy, 'local');
    form.restored();
    assert.equal(form.getState().busy, undefined);
  });
});

describe('provider registration from the form', () => {
  it('needs the username first and sends nothing without it', async () => {
    const { form, requests } = setup(() => Response.json({}, { status: 201 }));
    await form.continueWith('github');
    assert.deepEqual(form.getState().problem, { message: 'usernameNeededForProvider', field: 'username' });
    assert.equal(requests.length, 0);
  });

  it('opens the provider page and remembers only the flow, never the typed password', async () => {
    const { form, requests, opened, storage, fill } = setup(() =>
      Response.json({ authorizationUrl: 'https://github.com/login/oauth/authorize?state=s1', state: 's1', expiresAt: '2026-10-24T10:10:00.000Z' }, { status: 201 }),
    );
    fill('octocat', 'a long enough passphrase');
    await form.continueWith('github');
    assert.deepEqual(opened, ['https://github.com/login/oauth/authorize?state=s1']);
    assert.deepEqual(await requests[0]?.json(), { provider: 'github', username: 'octocat', redirectUri: `${origin}/register` });
    assert.doesNotMatch([...storage.entries.values()].join(), /passphrase|octocat/);
    assert.deepEqual(form.getState().busy, { provider: 'github' }, 'busy until the page is left');
  });

  it('reports a taken username before the provider page opens and keeps the form usable', async () => {
    const { form, opened, fill } = setup(() => refusal(409, 'accounts_username_taken'));
    fill('octocat');
    await form.continueWith('github');
    assert.equal(form.getState().problem?.message, 'errorUsernameTaken');
    assert.equal(form.getState().busy, undefined);
    assert.equal(form.getState().username, 'octocat');
    assert.deepEqual(opened, []);
  });
});

describe('page the provider returns to', () => {
  it('turns each outcome into a message and a retry that matches the server answer', () => {
    assert.deepEqual(viewOfFinish({ kind: 'denied' }), { kind: 'problem', problem: { message: 'errorProviderDenied' }, retry: undefined });
    assert.deepEqual(viewOfFinish({ kind: 'mismatch' }), { kind: 'problem', problem: { message: 'errorFlowInvalid' }, retry: undefined });
    const busy = viewOfFinish({ kind: 'failed', failure: { kind: 'unavailable' }, retry: 'same' });
    assert.ok(busy.kind === 'problem');
    assert.deepEqual({ message: busy.problem.message, retry: busy.retry }, { message: 'errorUnavailable', retry: 'same' });
    const consumed = viewOfFinish({ kind: 'failed', failure: { kind: 'error', status: 503, code: 'accounts_oauth_flow_consumed' }, retry: 'new' });
    assert.ok(consumed.kind === 'problem');
    assert.deepEqual({ message: consumed.problem.message, retry: consumed.retry }, { message: 'errorFlowConsumed', retry: undefined });
  });
});

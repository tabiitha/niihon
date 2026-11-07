import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApiClient, type FetchFunction } from '../../api/service.ts';
import { createRegistrationForm, deliveryOfFieldError, viewOfFinish } from './form.ts';
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
  it('asks for what is missing under each field without contacting the server, and focuses the first one', async () => {
    const { form, requests, fill } = setup(() => Response.json(profile, { status: 201 }));
    await form.submit();
    const typed = (message: string) => ({ message, from: 'typing' });
    assert.deepEqual(form.getState().errors, { username: typed('usernameRequired'), password: typed('passwordRequired') });
    assert.equal(form.getState().focus?.field, 'username');
    assert.equal(form.getState().problem, undefined, 'nothing above the form');
    fill('sakura', 'a long enough passphrase', 'another passphrase');
    await form.submit();
    assert.deepEqual(form.getState().errors, { confirmation: typed('passwordsDiffer') });
    assert.equal(form.getState().focus?.field, 'confirmation');
    assert.equal(requests.length, 0);
  });

  it('checks a field when it is left after an edit, then follows the typing', () => {
    const { form } = setup(() => Response.json(profile, { status: 201 }));
    form.leaveField('username');
    assert.deepEqual(form.getState().errors, {}, 'an untouched field is not checked');
    form.setField('username', 'a!');
    assert.deepEqual(form.getState().errors, {}, 'no error while typing a new value');
    form.leaveField('username');
    assert.equal(form.getState().errors.username?.message, 'errorUsernameInvalid');
    form.setField('username', '');
    assert.equal(form.getState().errors.username?.message, 'usernameRequired', 'the shown error follows the typing');
    form.setField('username', 'sakura');
    assert.equal(form.getState().errors.username, undefined, 'and goes away once the value is right');
  });

  it('updates the confirmation error when the password changes, and the password error when the username does', () => {
    const { form } = setup(() => Response.json(profile, { status: 201 }));
    form.setField('username', 'sakura');
    form.setField('password', 'a long enough passphrase');
    form.setField('confirmation', 'a long enough');
    form.leaveField('confirmation');
    assert.equal(form.getState().errors.confirmation?.message, 'passwordsDiffer');
    form.setField('password', 'a long enough');
    assert.equal(form.getState().errors.confirmation, undefined);
    form.setField('password', 'Sakura12');
    form.leaveField('password');
    assert.equal(form.getState().errors.password, undefined);
    form.setField('username', 'sakura12');
    assert.equal(form.getState().errors.password?.message, undefined, 'no new error appears in a field that is not being typed in');
    form.setField('password', 'SAKURA12');
    form.leaveField('password');
    assert.equal(form.getState().errors.password?.message, 'errorPasswordInvalid', 'the same as the username, whatever the case');
    form.setField('username', 'sakura13');
    assert.equal(form.getState().errors.password, undefined, 'follows the username');
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
    assert.deepEqual(state.errors, { username: { message: 'errorUsernameTaken', from: 'server' } });
    assert.equal(state.problem, undefined, 'nothing above the form');
    assert.equal(state.focus?.field, 'username');
    assert.deepEqual({ username: state.username, password: state.password, confirmation: state.confirmation }, { username: 'Sakura', password: '', confirmation: '' });
    form.setField('password', 'a long enough passphrase');
    form.leaveField('username');
    assert.equal(form.getState().errors.username?.message, 'errorUsernameTaken', 'stays until the username is edited');
    fill('Sakura2');
    assert.equal(form.getState().errors.username, undefined);
    await form.submit();
    assert.equal(requests[1]?.headers.get('Idempotency-Key'), 'key-0000000000000002');
  });

  it('shows a password the server refused under the password field, the same way as a local check', async () => {
    const { form, fill } = setup(() => refusal(400, 'validation_failed', [{ path: 'body.password', message: 'refused' }]));
    fill('sakura');
    await form.submit();
    assert.deepEqual(form.getState().errors, { password: { message: 'errorPasswordInvalid', from: 'server' } });
    assert.equal(form.getState().focus?.field, 'password');
    assert.equal(form.getState().username, 'sakura');
    form.setField('password', 'another long passphrase');
    assert.equal(form.getState().errors.password, undefined, 'typing replaces the refusal with the local check');
  });

  it('sends nothing while a field breaks the rules, and focuses the first faulty field', async () => {
    const { form, requests, fill } = setup(() => Response.json(profile, { status: 201 }));
    fill('ab', 'short');
    await form.submit();
    assert.deepEqual(Object.keys(form.getState().errors), ['username', 'password']);
    assert.equal(form.getState().focus?.field, 'username');
    const first = form.getState().focus?.count;
    await form.submit();
    assert.notEqual(form.getState().focus?.count, first, 'every blocked submit moves focus again');
    assert.equal(requests.length, 0);
  });

  it('shows a problem of no field above the form, and no field error', async () => {
    const { form, fill } = setup(() => refusal(503, 'accounts_busy'));
    fill();
    await form.submit();
    assert.equal(form.getState().problem?.message, 'errorBusy');
    assert.deepEqual(form.getState().errors, {});
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

describe('after a successful registration', () => {
  it('opens the Profile page in place of the sent form, from the form and from the provider return, without a success screen', () => {
    const page = readFileSync(fileURLToPath(new URL('RegisterPage.tsx', import.meta.url)), 'utf8');
    assert.equal(page.match(/navigate\(routes\.profile, \{ replace: true \}\)/g)?.length, 2);
    assert.doesNotMatch(page, /success(Title|Body)|'backHome'/);
  });
});

describe('how a field error reaches a screen reader', () => {
  it('moves focus to the field, or announces the error once when the field already has focus', () => {
    assert.equal(deliveryOfFieldError(false), 'focus');
    assert.equal(deliveryOfFieldError(true), 'announce');
  });

  it('asks again for each blocked submit, so that Enter twice in the same field is announced twice', async () => {
    const { form, fill } = setup(() => Response.json(profile, { status: 201 }));
    fill('sakura', 'a long enough passphrase', 'another passphrase');
    await form.submit();
    const first = form.getState().focus;
    await form.submit();
    assert.equal(form.getState().focus?.field, 'confirmation');
    assert.notEqual(form.getState().focus?.count, first?.count);
  });

  it('has one polite live region for it, and no alert that would speak a second time', () => {
    const page = readFileSync(fileURLToPath(new URL('RegisterPage.tsx', import.meta.url)), 'utf8');
    assert.equal(page.match(/aria-live="polite"/g)?.length, 1);
    assert.doesNotMatch(page, /role="alert"|aria-live="assertive"/);
    assert.match(page, /deliveryOfFieldError\(/);
  });
});

describe('provider registration from the form', () => {
  it('needs the username first and sends nothing without it', async () => {
    const { form, requests } = setup(() => Response.json({}, { status: 201 }));
    await form.continueWith('github');
    assert.deepEqual(form.getState().errors, { username: { message: 'usernameNeededForProvider', from: 'typing' } });
    form.setField('username', '_octo');
    await form.continueWith('github');
    assert.deepEqual(form.getState().errors, { username: { message: 'errorUsernameInvalid', from: 'typing' } }, 'the same rules as a local account');
    assert.equal(form.getState().focus?.field, 'username');
    assert.equal(requests.length, 0);
  });

  it('opens the provider page and remembers only the flow and the public username, never the typed password', async () => {
    const { form, requests, opened, storage, fill } = setup(() =>
      Response.json({ authorizationUrl: 'https://github.com/login/oauth/authorize?state=s1', state: 's1', expiresAt: '2026-10-24T10:10:00.000Z' }, { status: 201 }),
    );
    fill('octocat', 'a long enough passphrase');
    await form.continueWith('github');
    assert.deepEqual(opened, ['https://github.com/login/oauth/authorize?state=s1']);
    assert.deepEqual(await requests[0]?.json(), { provider: 'github', username: 'octocat', redirectUri: `${origin}/register` });
    assert.doesNotMatch([...storage.entries.values()].join(), /passphrase/);
    assert.equal(createPendingStore(storage).read()?.username, 'octocat', 'the public username is kept for the return');
    assert.deepEqual(form.getState().busy, { provider: 'github' }, 'busy until the page is left');
  });

  it('reports a taken username before the provider page opens and keeps the form usable', async () => {
    const { form, opened, fill } = setup(() => refusal(409, 'accounts_username_taken'));
    fill('octocat');
    await form.continueWith('github');
    assert.equal(form.getState().errors.username?.message, 'errorUsernameTaken');
    assert.equal(form.getState().busy, undefined);
    assert.equal(form.getState().username, 'octocat');
    assert.deepEqual(opened, []);
  });
});

describe('form after a failed provider registration', () => {
  it('shows the username of the failed attempt once, with empty passwords', () => {
    const storage = new MemoryStorage();
    const store = createPendingStore(storage);
    store.rememberUsername('octocat');
    const make = () =>
      createRegistrationForm({ client: createApiClient(origin, async () => Response.json({})), store, origin, openProvider: () => undefined });
    const form = make();
    assert.equal(form.getState().username, 'octocat');
    assert.equal(form.getState().password, '');
    assert.equal(form.getState().confirmation, '');
    form.connect();
    assert.equal(make().getState().username, '', 'forgotten once the form is shown');
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

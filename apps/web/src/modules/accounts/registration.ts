import type { NihonClient, components } from '@nihon/api-client';

import { request, type Failure, type Outcome } from '../../api/outcome.ts';
import { routes } from '../../router/routes.ts';
import { describeFailure, explainedCodes, type Retry } from './errors.ts';

export type Profile = components['schemas']['Profile'];

/**
 * The operations of the registration screen. They carry what the user typed to the server and return its
 * answer; every rule (username, password, uniqueness, roles, providers) is decided by the server. A new
 * command gets a new idempotency key; a retry after an answer was lost reuses it, so that a profile that was
 * created is returned instead of reported as taken.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function registerLocal(
  client: NihonClient,
  credentials: { readonly username: string; readonly password: string },
  idempotencyKey: string | undefined,
  signal: AbortSignal,
): Promise<Outcome<Profile>> {
  return request(
    () =>
      client.POST('/api/accounts/local-registrations', {
        body: credentials,
        // Without a key when the server has no room to record one (`idempotency_capacity_reached`).
        params: { header: idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey } },
        signal,
      }),
    signal,
    explainedCodes,
  );
}

/** The providers this installation offers; empty when it has none or is offline. */
export async function loadProviders(client: NihonClient, signal: AbortSignal): Promise<Outcome<readonly string[]>> {
  const outcome = await request(() => client.GET('/api/accounts/oauth-providers', { signal }), signal, explainedCodes);
  return outcome.ok ? { ok: true, data: outcome.data.items.map((item) => item.id) } : outcome;
}

/** Where the browser returns after the provider: this screen, on the origin that serves it. */
export function returnAddress(origin: string): string {
  return `${origin}${routes.register}`;
}

/** The provider page to open, or `undefined` when the address is not a web address. */
export function webAddress(address: string): string | undefined {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What survives the trip to the provider's page: the single-use flow reference, the retry key, and the chosen
 * username (public, so that the form can be filled in again after a failure). No secret.
 */
export interface PendingFlow {
  readonly state: string;
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly username: string;
}

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const pendingKey = 'nihon.registration.pending';
const usernameKey = 'nihon.registration.username';

/**
 * Keeps the pending provider registration in the tab's session storage, so that the screen can compare the
 * `state` the provider returns with the one the server issued. It never holds a password, an authorization
 * code, or a token; the entry is removed as soon as the registration ends. When it ends without a profile,
 * the username alone is left for the next form to show, then forgotten. A browser without storage
 * cannot continue a provider registration, which `save` reports.
 */
export function createPendingStore(storage: PendingStorage | undefined) {
  return {
    save(flow: PendingFlow): boolean {
      if (storage === undefined) {
        return false;
      }
      try {
        storage.setItem(pendingKey, JSON.stringify(flow));
        return true;
      } catch {
        return false;
      }
    },
    read(): PendingFlow | undefined {
      try {
        const raw = storage?.getItem(pendingKey);
        const value: unknown = raw === null || raw === undefined ? undefined : JSON.parse(raw);
        return isPendingFlow(value) ? value : undefined;
      } catch {
        return undefined;
      }
    },
    clear(): void {
      try {
        storage?.removeItem(pendingKey);
      } catch {
        // Nothing more can be done about a storage that refuses access.
      }
    },
    /** Leaves the username of a registration that ended without a profile, for the next form. */
    rememberUsername(username: string): void {
      try {
        storage?.setItem(usernameKey, username);
      } catch {
        // The form simply starts empty.
      }
    },
    rememberedUsername(): string | undefined {
      try {
        return storage?.getItem(usernameKey) ?? undefined;
      } catch {
        return undefined;
      }
    },
    forgetUsername(): void {
      try {
        storage?.removeItem(usernameKey);
      } catch {
        // Nothing more can be done about a storage that refuses access.
      }
    },
  };
}

export type PendingStore = ReturnType<typeof createPendingStore>;

function isPendingFlow(value: unknown): value is PendingFlow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    typeof value.state === 'string' &&
    'provider' in value &&
    typeof value.provider === 'string' &&
    'idempotencyKey' in value &&
    typeof value.idempotencyKey === 'string' &&
    'username' in value &&
    typeof value.username === 'string'
  );
}

export type StartResult =
  | { readonly kind: 'redirect'; readonly address: string }
  | { readonly kind: 'storage' }
  | { readonly kind: 'failed'; readonly failure: Failure };

/**
 * Starts a provider registration for the chosen username and remembers the flow for the return. The caller
 * opens `address` in the browser.
 */
export async function startProviderRegistration(
  client: NihonClient,
  store: PendingStore,
  input: { readonly provider: string; readonly username: string; readonly origin: string },
  signal: AbortSignal,
): Promise<StartResult> {
  const outcome = await request(
    () =>
      client.POST('/api/accounts/oauth-registrations', {
        body: { provider: input.provider, username: input.username, redirectUri: returnAddress(input.origin) },
        signal,
      }),
    signal,
    explainedCodes,
  );
  if (!outcome.ok) {
    return { kind: 'failed', failure: outcome.failure };
  }
  const address = webAddress(outcome.data.authorizationUrl);
  if (address === undefined) {
    return { kind: 'failed', failure: { kind: 'error' } };
  }
  const saved = store.save({
    state: outcome.data.state,
    provider: input.provider,
    idempotencyKey: newIdempotencyKey(),
    username: input.username,
  });
  return saved ? { kind: 'redirect', address } : { kind: 'storage' };
}

/** The provider's answer, as it arrives in the address of the screen. */
export type ProviderReturn =
  | { readonly kind: 'code'; readonly state: string; readonly code: string }
  | { readonly kind: 'denied'; readonly state: string | undefined };

/** Reads the provider's answer from the address, or `undefined` when the address is an ordinary visit. */
export function parseProviderReturn(search: string): ProviderReturn | undefined {
  const parameters = new URLSearchParams(search);
  const state = parameters.get('state') ?? undefined;
  if (parameters.has('error')) {
    return { kind: 'denied', state };
  }
  const code = parameters.get('code');
  return state === undefined || state === '' || code === null || code === '' ? undefined : { kind: 'code', state, code };
}

export type FinishResult =
  | { readonly kind: 'registered'; readonly profile: Profile }
  | { readonly kind: 'denied' }
  /** No pending registration, or another `state` than the one issued: nothing was sent to the server. */
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retry: Retry };

/**
 * Completes a provider registration from the provider's answer. The returned `state` must be the one the
 * server issued for this browser tab; otherwise nothing is sent. The pending entry is removed when the
 * registration ends, and kept while the same completion can be repeated (a lost answer, a busy server, a
 * registration still running): retrying with the same key returns the profile if one was created and never
 * creates a second one. `withoutKey` repeats it without a key, as the server asks when it cannot record one.
 */
export async function finishProviderRegistration(
  client: NihonClient,
  store: PendingStore,
  answer: ProviderReturn,
  signal: AbortSignal,
  options: { readonly withoutKey?: boolean } = {},
): Promise<FinishResult> {
  const pending = store.read();
  if (pending === undefined || answer.state === undefined || pending.state !== answer.state) {
    return { kind: 'mismatch' };
  }
  if (answer.kind === 'denied') {
    store.rememberUsername(pending.username);
    store.clear();
    return { kind: 'denied' };
  }
  const outcome = await request(
    () =>
      client.POST('/api/accounts/oauth-registrations/completion', {
        body: { state: answer.state, code: answer.code },
        params: { header: options.withoutKey === true ? {} : { 'Idempotency-Key': pending.idempotencyKey } },
        signal,
      }),
    signal,
    explainedCodes,
  );
  if (outcome.ok) {
    store.clear();
    return { kind: 'registered', profile: outcome.data };
  }
  const retry = describeFailure(outcome.failure).retry ?? 'new';
  if (retry === 'new') {
    // The flow is used up or refused: only a new registration can go on, with the same username.
    store.rememberUsername(pending.username);
    store.clear();
  }
  return { kind: 'failed', failure: outcome.failure, retry };
}

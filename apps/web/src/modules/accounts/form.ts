import type { NihonClient } from '@nihon/api-client';

import { RequestCancelledError } from '../../api/outcome.ts';
import { describeFailure, type FormField, type Problem } from './errors.ts';
import {
  newIdempotencyKey,
  registerLocal,
  startProviderRegistration,
  type FinishResult,
  type PendingStore,
  type Profile,
} from './registration.ts';

export interface FormState {
  readonly username: string;
  readonly password: string;
  readonly confirmation: string;
  /** What is being sent: the local registration, or the start of a provider registration. */
  readonly busy: 'local' | { readonly provider: string } | undefined;
  readonly problem: Problem | undefined;
  /** The created profile, once the registration is done. */
  readonly profile: Profile | undefined;
}

export interface FormDependencies {
  readonly client: NihonClient;
  readonly store: PendingStore;
  /** The origin serving the screen, where the provider returns to. */
  readonly origin: string;
  /** Opens the provider's page, leaving this one. */
  readonly openProvider: (address: string) => void;
  readonly newKey?: () => string;
}

/**
 * The state of the registration form, apart from React so that its rules can be tested. It carries what the
 * user typed to the server and shows the server's answer; it decides nothing about validity. It guarantees:
 * one request at a time (a second submit is dropped synchronously), the username kept after any failure,
 * the passwords cleared after a definite refusal or a success and kept after an uncertain outcome, one
 * idempotency key per command (reused only while the inputs are unchanged), and no state change from an
 * answer that arrives after the form was left (`connect`'s cleanup).
 */
export function createRegistrationForm(dependencies: FormDependencies) {
  const { client, store, origin, openProvider, newKey = newIdempotencyKey } = dependencies;
  let state: FormState = { username: store.rememberedUsername() ?? '', password: '', confirmation: '', busy: undefined, problem: undefined, profile: undefined };
  const listeners = new Set<() => void>();
  let sending = false;
  let pending: AbortController | undefined;
  // The key of the command being retried; `null` means the server asked for the next attempt without a key.
  let key: string | null | undefined;

  const update = (change: Partial<FormState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) {
      listener();
    }
  };

  const fail = (problem: Problem) => update({ problem });

  function begin(): AbortController {
    sending = true;
    pending?.abort();
    pending = new AbortController();
    update({ problem: undefined });
    return pending;
  }

  function end(controller: AbortController): void {
    if (!controller.signal.aborted) {
      sending = false;
      update({ busy: undefined });
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** Edits a field. Any edit makes the next attempt a new command. */
    setField(field: FormField, value: string) {
      key = undefined;
      update({ [field]: value });
    },

    /** Starts listening to answers; the returned function leaves the form and cancels what is pending. */
    connect() {
      // The username left by a failed provider registration was shown once; it is not kept any longer.
      store.forgetUsername();
      return () => {
        pending?.abort();
        sending = false;
      };
    },

    /** The page came back from the back-forward cache: whatever was pending was lost with the page. */
    restored() {
      pending?.abort();
      sending = false;
      update({ busy: undefined });
    },

    async submit(): Promise<void> {
      if (sending) {
        return;
      }
      const { username, password, confirmation } = state;
      if (username.trim() === '') {
        return fail({ message: 'usernameRequired', field: 'username' });
      }
      if (password === '') {
        return fail({ message: 'passwordRequired', field: 'password' });
      }
      if (password !== confirmation) {
        return fail({ message: 'passwordsDiffer', field: 'confirmation' });
      }
      const controller = begin();
      update({ busy: 'local' });
      if (key === undefined) {
        key = newKey();
      }
      try {
        const outcome = await registerLocal(client, { username, password }, key ?? undefined, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (outcome.ok) {
          // Nothing of the secret stays in the page once the server has answered.
          key = undefined;
          update({ password: '', confirmation: '', profile: outcome.data });
          return;
        }
        const problem = describeFailure(outcome.failure);
        if (problem.retry === 'new') {
          // A definite refusal: the username stays, the secrets are typed again.
          key = undefined;
          update({ problem, password: '', confirmation: '' });
        } else {
          key = problem.retry === 'withoutKey' ? null : key;
          update({ problem });
        }
      } catch (error) {
        if (!(error instanceof RequestCancelledError)) {
          fail({ message: 'errorGeneric', retry: 'same' });
        }
      } finally {
        end(controller);
      }
    },

    /** Starts a provider registration for the typed username; the provider's page opens on success. */
    async continueWith(provider: string): Promise<void> {
      if (sending) {
        return;
      }
      if (state.username.trim() === '') {
        return fail({ message: 'usernameNeededForProvider', field: 'username' });
      }
      const controller = begin();
      update({ busy: { provider } });
      try {
        const result = await startProviderRegistration(client, store, { provider, username: state.username, origin }, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (result.kind === 'redirect') {
          // The page is left for the provider; the form stays busy until then.
          openProvider(result.address);
          return;
        }
        fail(result.kind === 'storage' ? { message: 'errorStorage' } : describeFailure(result.failure));
      } catch (error) {
        if (!(error instanceof RequestCancelledError)) {
          fail({ message: 'errorGeneric' });
        }
      }
      end(controller);
    },
  };
}

export type RegistrationForm = ReturnType<typeof createRegistrationForm>;

/** What the page the provider returns to shows for the outcome of the completion. */
export type ReturnView =
  | { readonly kind: 'registered'; readonly profile: Profile }
  | { readonly kind: 'problem'; readonly problem: Problem; readonly retry: 'same' | 'withoutKey' | undefined };

export function viewOfFinish(result: FinishResult): ReturnView {
  switch (result.kind) {
    case 'registered':
      return { kind: 'registered', profile: result.profile };
    case 'denied':
      return { kind: 'problem', problem: { message: 'errorProviderDenied' }, retry: undefined };
    case 'mismatch':
      return { kind: 'problem', problem: { message: 'errorFlowInvalid' }, retry: undefined };
    case 'failed':
      return { kind: 'problem', problem: describeFailure(result.failure), retry: result.retry === 'new' ? undefined : result.retry };
  }
}

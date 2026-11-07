import type { NihonClient } from '@nihon/api-client';

import { RequestCancelledError } from '../../api/outcome.ts';
import { describeFailure, type FormField, type Problem, type TextKey } from './errors.ts';
import {
  newIdempotencyKey,
  registerLocal,
  startProviderRegistration,
  type FinishResult,
  type PendingStore,
  type Profile,
} from './registration.ts';
import { checkField, checkUsername, type Entries } from './rules.ts';

/** The message under one field, and where it comes from: the check while typing, or the server's refusal. */
export interface FieldError {
  readonly message: TextKey;
  readonly from: 'typing' | 'server';
}

export interface FormState {
  readonly username: string;
  readonly password: string;
  readonly confirmation: string;
  /** What is being sent: the local registration, or the start of a provider registration. */
  readonly busy: 'local' | { readonly provider: string } | undefined;
  /** The message under each faulty field. */
  readonly errors: Readonly<Partial<Record<FormField, FieldError>>>;
  /** A problem that belongs to no field, shown above the form. */
  readonly problem: Problem | undefined;
  /** The field to move focus to; `count` changes with every request, even for the same field. */
  readonly focus: { readonly field: FormField; readonly count: number } | undefined;
  /** The created profile, once the registration is done: the page then opens the Profile page. */
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

const fieldOrder: readonly FormField[] = ['username', 'password', 'confirmation'];

/**
 * The state of the registration form, apart from React so that its rules can be tested. It checks what is typed
 * with the server's rules (`rules.ts`) to help before sending: a field is checked when it is left after an edit
 * and on submit; once it shows an error, the error follows the typing; a submit with an error sends nothing and
 * focuses the first faulty field. The server still decides: its refusals of a field are shown under that field
 * the same way, and stay until that field is edited. It also guarantees: one request at a time (a second submit
 * is dropped synchronously), the username kept after any failure, the passwords cleared after a definite refusal
 * or a success and kept after an uncertain outcome, one idempotency key per command (reused only while the inputs
 * are unchanged), and no state change from an answer that arrives after the form was left (`connect`'s cleanup).
 */
export function createRegistrationForm(dependencies: FormDependencies) {
  const { client, store, origin, openProvider, newKey = newIdempotencyKey } = dependencies;
  let state: FormState = {
    username: store.rememberedUsername() ?? '',
    password: '',
    confirmation: '',
    busy: undefined,
    errors: {},
    problem: undefined,
    focus: undefined,
    profile: undefined,
  };
  const listeners = new Set<() => void>();
  let sending = false;
  let pending: AbortController | undefined;
  // The key of the command being retried; `null` means the server asked for the next attempt without a key.
  let key: string | null | undefined;
  // Fields edited since the form opened: leaving an untouched field checks nothing.
  const edited = new Set<FormField>();
  let focusCount = 0;

  const update = (change: Partial<FormState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) {
      listener();
    }
  };

  const focusOn = (field: FormField) => ({ field, count: ++focusCount });

  /** Shows a problem: under its field when it has one, otherwise above the form. */
  const fail = (problem: Problem, change: Partial<FormState> = {}) => {
    if (problem.field === undefined) {
      update({ ...change, problem });
    } else {
      update({ ...change, problem: undefined, errors: { ...state.errors, [problem.field]: { message: problem.message, from: 'server' } }, focus: focusOn(problem.field) });
    }
  };

  function withCheck(errors: FormState['errors'], field: FormField, entries: Entries): FormState['errors'] {
    const message = checkField(field, entries);
    const { [field]: _removed, ...others } = errors;
    return message === undefined ? others : { ...others, [field]: { message, from: 'typing' } };
  }

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

    /**
     * Edits a field. Any edit makes the next attempt a new command. An error already shown under this field follows
     * the typing, and so do the typing errors of the other fields (the password depends on the username, the
     * confirmation on the password); no new error appears while typing.
     */
    setField(field: FormField, value: string) {
      key = undefined;
      edited.add(field);
      const entries = { ...state, [field]: value };
      let errors = state.errors;
      for (const other of fieldOrder) {
        const shown = errors[other];
        if (shown !== undefined && (other === field || shown.from === 'typing')) {
          errors = withCheck(errors, other, entries);
        }
      }
      update({ [field]: value, errors });
    },

    /** The user left a field: it is checked if it was edited, unless the server's refusal of it is shown. */
    leaveField(field: FormField) {
      if (!edited.has(field) || state.errors[field]?.from === 'server') {
        return;
      }
      update({ errors: withCheck(state.errors, field, state) });
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
      let errors: FormState['errors'] = {};
      for (const field of fieldOrder) {
        errors = withCheck(errors, field, state);
      }
      const first = fieldOrder.find((field) => errors[field] !== undefined);
      if (first !== undefined) {
        update({ errors, problem: undefined, focus: focusOn(first) });
        return;
      }
      const { username, password } = state;
      const controller = begin();
      update({ busy: 'local', errors: {} });
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
          edited.delete('password');
          edited.delete('confirmation');
          fail(problem, { password: '', confirmation: '' });
        } else {
          key = problem.retry === 'withoutKey' ? null : key;
          fail(problem);
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
      const invalid = checkUsername(state.username);
      if (invalid !== undefined) {
        const message = invalid === 'usernameRequired' ? 'usernameNeededForProvider' : invalid;
        update({ errors: { ...state.errors, username: { message, from: 'typing' } }, problem: undefined, focus: focusOn('username') });
        return;
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

/**
 * How a field error reaches a screen reader. Moving focus to the field reads its error (`aria-describedby`) once. When
 * the field already has focus, as after Enter in that field, moving focus does nothing, so the error is announced
 * once through a polite live region instead. Never both, so that it is not announced twice.
 */
export function deliveryOfFieldError(fieldHasFocus: boolean): 'focus' | 'announce' {
  return fieldHasFocus ? 'announce' : 'focus';
}

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

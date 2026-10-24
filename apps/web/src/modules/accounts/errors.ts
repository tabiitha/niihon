import type { Failure } from '../../api/outcome.ts';
import type { accountsTexts } from './texts.ts';

export type TextKey = keyof typeof accountsTexts.texts.en;

/** The form field a problem belongs to, so that focus and the description go to the right input. */
export type FormField = 'username' | 'password' | 'confirmation';

/**
 * How the next attempt relates to the one that failed:
 * - `same`: it is not known that nothing was created, or the server is only busy; the typed data and the
 *   idempotency key are kept, so repeating returns the created profile if there is one;
 * - `withoutKey`: the server recorded too many keyed commands and did nothing; repeat without a key;
 * - `new`: a definite refusal; nothing was created, the next attempt is a new command (for a provider
 *   registration, a new registration).
 */
export type Retry = 'same' | 'withoutKey' | 'new';

/** What the screen shows for a failure: a translated message, the field that caused it, and how to go on. */
export interface Problem {
  readonly message: TextKey;
  readonly field?: FormField;
  readonly retry?: Retry;
  /** Request identifier of the server log, shown when the server gave one. */
  readonly requestId?: string;
}

/**
 * Stable error codes of the registration operations (see docs/architecture/accounts.md) and the message
 * that explains each one. The server decides what is refused; this table only chooses the words and how a
 * retry goes. A code of this table is explained even when it arrives with a 502 or 503 status.
 */
export const messageByCode: Readonly<Record<string, Problem>> = {
  accounts_username_taken: { message: 'errorUsernameTaken', field: 'username' },
  accounts_busy: { message: 'errorBusy', retry: 'same' },
  accounts_oauth_redirect_uri_invalid: { message: 'errorRedirectUri' },
  accounts_oauth_provider_unavailable: { message: 'errorProviderUnavailable' },
  accounts_oauth_state_invalid: { message: 'errorFlowInvalid' },
  accounts_oauth_state_expired: { message: 'errorFlowExpired' },
  accounts_oauth_code_rejected: { message: 'errorCodeRejected' },
  accounts_oauth_identity_unverified: { message: 'errorIdentityUnverified' },
  accounts_identity_already_registered: { message: 'errorIdentityRegistered' },
  accounts_oauth_provider_failed: { message: 'errorProviderFailed' },
  accounts_oauth_flow_consumed: { message: 'errorFlowConsumed' },
  idempotency_key_in_use: { message: 'errorInProgress', retry: 'same' },
  idempotency_capacity_reached: { message: 'errorBusy', retry: 'withoutKey' },
  idempotency_key_reused: { message: 'errorRequestInvalid' },
  payload_too_large: { message: 'errorRequestInvalid' },
  unsupported_media_type: { message: 'errorRequestInvalid' },
  database_busy: { message: 'errorBusy', retry: 'same' },
  internal_error: { message: 'errorGeneric', retry: 'same' },
};

/** The codes `messageByCode` explains: their 502 and 503 answers come from the server, not from a relay. */
export const explainedCodes: ReadonlySet<string> = new Set(Object.keys(messageByCode));

/** Chooses the message of a failed registration request. Never shows the server's English text. */
export function describeFailure(failure: Failure): Problem {
  if (failure.kind === 'unavailable') {
    return { message: 'errorUnavailable', retry: 'same' };
  }
  if (failure.kind === 'incompatible') {
    return { message: 'errorIncompatible', retry: 'new' };
  }
  const requestId = failure.requestId === undefined ? {} : { requestId: failure.requestId };
  if (failure.code === 'validation_failed') {
    const fields = failure.fields ?? [];
    if (fields.includes('body.password')) {
      return { message: 'errorPasswordInvalid', field: 'password', retry: 'new', ...requestId };
    }
    if (fields.includes('body.username')) {
      return { message: 'errorUsernameInvalid', field: 'username', retry: 'new', ...requestId };
    }
    return { message: 'errorRequestInvalid', retry: 'new', ...requestId };
  }
  const known = failure.code === undefined ? undefined : messageByCode[failure.code];
  // A server failure that no code explains leaves it open whether the profile was created.
  const unexplained: Problem = { message: 'errorGeneric', retry: failure.status === undefined || failure.status >= 500 ? 'same' : 'new' };
  const problem = known ?? unexplained;
  return { ...problem, retry: problem.retry ?? 'new', ...requestId };
}

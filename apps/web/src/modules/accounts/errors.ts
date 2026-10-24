import type { Failure } from '../../api/outcome.ts';
import type { accountsTexts } from './texts.ts';

export type TextKey = keyof typeof accountsTexts.texts.en;

/** The form field a problem belongs to, so that focus and the description go to the right input. */
export type FormField = 'username' | 'password' | 'confirmation';

/** What the screen shows for a failure: a translated message, and the field that caused it when there is one. */
export interface Problem {
  readonly message: TextKey;
  readonly field?: FormField;
  /** Request identifier of the server log, shown when the server gave one. */
  readonly requestId?: string;
}

/**
 * Stable error codes of the registration operations (see docs/architecture/accounts.md) and the message
 * that explains each one. The server decides what is refused; this table only chooses the words.
 */
export const messageByCode: Readonly<Record<string, Problem>> = {
  accounts_username_taken: { message: 'errorUsernameTaken', field: 'username' },
  accounts_busy: { message: 'errorBusy' },
  accounts_oauth_redirect_uri_invalid: { message: 'errorRedirectUri' },
  accounts_oauth_provider_unavailable: { message: 'errorProviderUnavailable' },
  accounts_oauth_state_invalid: { message: 'errorFlowInvalid' },
  accounts_oauth_state_expired: { message: 'errorFlowExpired' },
  accounts_oauth_code_rejected: { message: 'errorCodeRejected' },
  accounts_oauth_identity_unverified: { message: 'errorIdentityUnverified' },
  accounts_identity_already_registered: { message: 'errorIdentityRegistered' },
  accounts_oauth_provider_failed: { message: 'errorProviderFailed' },
  accounts_oauth_flow_consumed: { message: 'errorFlowConsumed' },
  idempotency_key_in_use: { message: 'errorBusy' },
  idempotency_capacity_reached: { message: 'errorBusy' },
  idempotency_key_reused: { message: 'errorRequestInvalid' },
};

/** Chooses the message of a failed registration request. Never shows the server's English text. */
export function describeFailure(failure: Failure): Problem {
  if (failure.kind === 'unavailable') {
    return { message: 'errorUnavailable' };
  }
  if (failure.kind === 'incompatible') {
    return { message: 'errorIncompatible' };
  }
  const requestId = failure.requestId === undefined ? {} : { requestId: failure.requestId };
  if (failure.code === 'validation_failed') {
    const fields = failure.fields ?? [];
    if (fields.includes('body.password')) {
      return { message: 'errorPasswordInvalid', field: 'password', ...requestId };
    }
    if (fields.includes('body.username')) {
      return { message: 'errorUsernameInvalid', field: 'username', ...requestId };
    }
    return { message: 'errorRequestInvalid', ...requestId };
  }
  const known = failure.code === undefined ? undefined : messageByCode[failure.code];
  return { ...(known ?? { message: 'errorGeneric' }), ...requestId };
}

/**
 * Whether the same command may be repeated with the same idempotency key. Only an answer that was not
 * received, or an unexplained server failure, leaves it unknown whether the profile was created; every
 * other answer says nothing was created, and the next attempt is a new command.
 */
export function mayHaveCreatedProfile(failure: Failure): boolean {
  return failure.kind === 'unavailable' || (failure.kind === 'error' && failure.code === undefined);
}

import { errorCodes } from '../../contract/conventions.ts';
import { ApiError } from '../../contract/operation.ts';
import { accountsErrorCodes } from './contract.ts';
import { LimiterFullError, type Limiter } from './limiter.ts';
import type { ProviderError } from './providers/provider.ts';

/** Refusals shared by registration and sign-in, with their stable codes. */

export function validationFailed(path: string, message: string): ApiError {
  return new ApiError(400, errorCodes.validationFailed, 'The request is invalid.', [{ path, message }]);
}

export function usernameTaken(): ApiError {
  return new ApiError(409, accountsErrorCodes.usernameTaken, 'This username is already used.');
}

export function busy(message: string): ApiError {
  return new ApiError(503, accountsErrorCodes.busy, message, undefined, { 'Retry-After': '1' });
}

export function providerUnavailable(): ApiError {
  return new ApiError(422, accountsErrorCodes.providerUnavailable, 'This provider is not available on this installation.');
}

export function redirectUriInvalid(): ApiError {
  return new ApiError(400, accountsErrorCodes.redirectUriInvalid, 'The return address is not accepted.');
}

export function stateInvalid(): ApiError {
  return new ApiError(400, accountsErrorCodes.stateInvalid, 'The flow is unknown or was already used.');
}

export function stateExpired(): ApiError {
  return new ApiError(400, accountsErrorCodes.stateExpired, 'The flow has expired; start again.');
}

/** The database stayed busy after a single-use flow was consumed: nothing was created, start again. */
export function flowConsumed(): ApiError {
  return new ApiError(503, accountsErrorCodes.flowConsumed, 'Nothing was created, but this flow was used up; start again.');
}

export function providerFailure(error: ProviderError): ApiError {
  switch (error.kind) {
    case 'code_rejected':
      return new ApiError(400, accountsErrorCodes.codeRejected, 'The provider refused the authorization code.');
    case 'identity_unverified':
      return new ApiError(400, accountsErrorCodes.identityUnverified, 'The provider identity could not be verified.');
    case 'unavailable':
      return new ApiError(502, accountsErrorCodes.providerFailed, 'The provider could not be used; try again later.');
  }
}

/** Runs expensive work under `limiter`, answering `503 accounts_busy` when its queue is full. */
export async function bounded<T>(limiter: Limiter, work: () => Promise<T>): Promise<T> {
  try {
    return await limiter.run(work);
  } catch (error) {
    if (error instanceof LimiterFullError) {
      throw busy('Too many requests are being processed.');
    }
    throw error;
  }
}

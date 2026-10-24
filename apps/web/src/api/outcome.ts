import type { ErrorResponse } from '@nihon/api-client';

/**
 * Why a request did not produce data, as the interface presents it:
 * - `unavailable`: the local service cannot be reached, or is stopping;
 * - `incompatible`: this client was built for another major version of the API;
 * - `error`: the service answered with an unexpected error.
 */
export type Failure =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'incompatible'; readonly serverApiVersion?: string }
  | {
      readonly kind: 'error';
      readonly status?: number;
      readonly code?: string;
      readonly requestId?: string;
      /** Paths of the invalid inputs of a `validation_failed` answer, such as `body.password`. */
      readonly fields?: readonly string[];
    };

export type Outcome<Data> = { readonly ok: true; readonly data: Data } | { readonly ok: false; readonly failure: Failure };

interface FetchResult<Data> {
  readonly data?: Data;
  readonly error?: unknown;
  readonly response: Response;
}

export class RequestCancelledError extends Error {
  override name = 'RequestCancelledError';
}

/**
 * Runs one call of the generated client and turns its result into an `Outcome`. A cancelled call throws
 * `RequestCancelledError`, so that callers ignore it instead of displaying a failure.
 */
export async function request<Data>(
  call: () => Promise<FetchResult<Data>>,
  signal?: AbortSignal,
  explainedCodes?: ReadonlySet<string>,
): Promise<Outcome<Data>> {
  let result: FetchResult<Data>;
  try {
    result = await call();
  } catch (error) {
    if (signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')) {
      throw new RequestCancelledError('The request was cancelled.', { cause: error });
    }
    // fetch rejects only when no HTTP response arrives: the service is stopped or unreachable.
    return { ok: false, failure: { kind: 'unavailable' } };
  }
  if (result.response.ok && result.data !== undefined) {
    return { ok: true, data: result.data };
  }
  return { ok: false, failure: classifyErrorResponse(result.response.status, result.error, explainedCodes) };
}

/**
 * A 502, 503, or 504 means a stopped service or a relay in front of it, unless the answer carries a stable
 * code that the caller explains itself (`explainedCodes`): the server did answer, and the code says what happened.
 */
export function classifyErrorResponse(status: number, body: unknown, explainedCodes?: ReadonlySet<string>): Failure {
  const error = isErrorResponse(body) ? body.error : undefined;
  if (error?.code === 'unsupported_api_version') {
    return { kind: 'incompatible' };
  }
  // 503 comes from the server while it stops; 502 and 504 from anything relaying to a stopped server.
  if ((status === 502 || status === 503 || status === 504) && !(error !== undefined && explainedCodes?.has(error.code) === true)) {
    return { kind: 'unavailable' };
  }
  return {
    kind: 'error',
    status,
    ...(error === undefined ? {} : { code: error.code, requestId: error.requestId }),
    ...(error?.issues === undefined ? {} : { fields: error.issues.map((issue) => issue.path) }),
  };
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'code' in body.error &&
    typeof body.error.code === 'string' &&
    'requestId' in body.error &&
    typeof body.error.requestId === 'string'
  );
}

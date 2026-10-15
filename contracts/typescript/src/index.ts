import createClient, { type Client, type ClientOptions } from 'openapi-fetch';

import type { components, paths } from './schema.ts';
import { apiMajorVersion, apiVersion } from './version.ts';

export type { components, operations, paths } from './schema.ts';
export { apiMajorVersion, apiVersion };

export const apiVersionHeader = 'Nihon-API-Version';
export const requestIdHeader = 'Nihon-Request-Id';

export type ErrorResponse = components['schemas']['ErrorResponse'];
export type NihonClient<Paths extends {} = paths> = Client<Paths>;

/**
 * Creates a typed client of the Nihon API. Every request declares the contract major version this
 * package was generated from; a server implementing another major answers `unsupported_api_version`.
 * Pass `signal` per request to cancel reads that are no longer needed.
 */
export function createNihonClient<Paths extends {} = paths>(options: ClientOptions & { baseUrl: string }): NihonClient<Paths> {
  return createClient<Paths>({
    ...options,
    headers: { ...options.headers, [apiVersionHeader]: String(apiMajorVersion) },
  });
}

/** An error response, with its stable `code`, raised by helpers that throw instead of returning it. */
export class NihonApiError extends Error {
  override name = 'NihonApiError';

  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly body: ErrorResponse;

  constructor(status: number, body: ErrorResponse) {
    super(`${body.error.code}: ${body.error.message}`);
    this.status = status;
    this.code = body.error.code;
    this.requestId = body.error.requestId;
    this.body = body;
  }
}

export interface Page<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
}

export type PageResult<Item> =
  | { readonly data: Page<Item>; readonly error?: undefined; readonly response: Response }
  | { readonly data?: undefined; readonly error: ErrorResponse; readonly response: Response };

/**
 * Walks a paginated collection one page at a time, following `nextCursor`. `fetchPage` receives the
 * cursor to send (undefined for the first page). Stopping the iteration stops fetching; an error
 * response throws `NihonApiError`.
 */
export async function* paginate<Item>(
  fetchPage: (cursor: string | undefined) => Promise<PageResult<Item>>,
): AsyncGenerator<readonly Item[], void, undefined> {
  let cursor: string | undefined;
  do {
    const result = await fetchPage(cursor);
    if (result.error !== undefined) {
      throw new NihonApiError(result.response.status, result.error);
    }
    yield result.data.items;
    cursor = result.data.nextCursor ?? undefined;
  } while (cursor !== undefined);
}

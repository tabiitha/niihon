import { apiMajorVersion, createNihonClient, type components, type NihonClient } from '@nihon/api-client';

import { request, type Outcome } from './outcome.ts';

export type Health = components['schemas']['Health'];
export type FetchFunction = (request: Request) => Promise<Response>;

/**
 * Creates the single API client of the Web interface. Pages never call `fetch` directly: they go through
 * this client, so that every request declares the contract version and shares the same failure handling.
 */
export function createApiClient(origin: string, fetchImplementation?: FetchFunction): NihonClient {
  return createNihonClient({ baseUrl: origin, ...(fetchImplementation === undefined ? {} : { fetch: fetchImplementation }) });
}

/**
 * Checks that the local service answers and implements the API major version this client was generated
 * from. The interface runs this check before showing a page, and again when the user retries.
 */
export async function checkService(client: NihonClient, signal: AbortSignal): Promise<Outcome<Health>> {
  const outcome = await request(() => client.GET('/api/health', { signal }), signal);
  if (outcome.ok && Number(outcome.data.apiVersion.split('.')[0]) !== apiMajorVersion) {
    return { ok: false, failure: { kind: 'incompatible', serverApiVersion: outcome.data.apiVersion } };
  }
  return outcome;
}

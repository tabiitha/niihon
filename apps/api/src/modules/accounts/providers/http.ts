import { ProviderError } from './provider.ts';

/** Longest wait for one provider answer. */
export const providerTimeoutMs = 10_000;
/** Largest provider answer read; anything longer is refused. */
export const maxProviderResponseBytes = 1024 * 1024;

export type FetchFunction = typeof fetch;

export interface JsonResponse {
  readonly status: number;
  readonly json: unknown;
  readonly headers: Headers;
}

/**
 * Calls a provider with a deadline, no redirect following, and a bounded answer, and parses a JSON
 * body. Network failures, timeouts, oversized or non-JSON answers become `unavailable`; the status
 * is returned for the caller to judge. Request bodies and answers are never logged.
 */
export async function fetchJson(fetchImpl: FetchFunction, url: string, init: RequestInit): Promise<JsonResponse> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(providerTimeoutMs) });
  } catch {
    throw new ProviderError('unavailable', 'The provider could not be reached.');
  }
  const text = await readBounded(response);
  try {
    return { status: response.status, json: JSON.parse(text) as unknown, headers: response.headers };
  } catch {
    throw new ProviderError('unavailable', 'The provider answered something that is not JSON.');
  }
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxProviderResponseBytes) {
    await response.body?.cancel();
    throw new ProviderError('unavailable', 'The provider answer is too large.');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body ?? []) {
      total += chunk.byteLength;
      if (total > maxProviderResponseBytes) {
        await response.body?.cancel();
        throw new ProviderError('unavailable', 'The provider answer is too large.');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    throw new ProviderError('unavailable', 'The provider answer could not be read.');
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads a string field of a parsed JSON object. */
export function stringField(value: unknown, name: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(name in value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[name];
  return typeof field === 'string' ? field : undefined;
}

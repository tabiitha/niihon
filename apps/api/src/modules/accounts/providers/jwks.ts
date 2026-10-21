import type { JsonWebKey } from 'node:crypto';

import { fetchJson, type FetchFunction } from './http.ts';
import { ProviderError } from './provider.ts';

export const jwksTtlMs = 60 * 60 * 1000;
/** An unknown key identifier triggers a refresh at most this often, so a forged `kid` cannot cause a fetch per request. */
export const jwksMinRefreshMs = 60 * 1000;

export interface KeySet {
  /** The signing key with this identifier, or `undefined`. Throws `ProviderError('unavailable')` if the set cannot be fetched. */
  findKey(keyId: string): Promise<JsonWebKey | undefined>;
}

/** A provider's published signing keys, cached in memory and refreshed on expiry or an unknown key. */
export function createKeySet(uri: string, fetchImpl: FetchFunction, now: () => Date): KeySet {
  let keys = new Map<string, JsonWebKey>();
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let refreshing: Promise<void> | undefined;

  const refresh = () => {
    refreshing ??= (async () => {
      const response = await fetchJson(fetchImpl, uri, { headers: { accept: 'application/json' } });
      const list = typeof response.json === 'object' && response.json !== null && 'keys' in response.json ? response.json.keys : undefined;
      if (response.status !== 200 || !Array.isArray(list)) {
        throw new ProviderError('unavailable', 'The provider published no signing keys.');
      }
      const next = new Map<string, JsonWebKey>();
      for (const entry of list as (JsonWebKey & { kid?: unknown })[]) {
        if (typeof entry === 'object' && entry !== null && typeof entry.kid === 'string' && entry.kty === 'RSA') {
          next.set(entry.kid, entry);
        }
      }
      keys = next;
      fetchedAt = now().getTime();
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };

  return {
    async findKey(keyId) {
      const age = now().getTime() - fetchedAt;
      if (age >= jwksTtlMs) {
        await refresh();
      }
      const known = keys.get(keyId);
      if (known !== undefined || now().getTime() - fetchedAt < jwksMinRefreshMs) {
        return known;
      }
      await refresh();
      return keys.get(keyId);
    },
  };
}

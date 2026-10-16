import { useCallback, useEffect, useState } from 'react';

import { RequestCancelledError, type Failure, type Outcome } from './outcome.ts';

export type ResourceState<Data> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: Data }
  | { readonly status: 'failed'; readonly failure: Failure };

/**
 * Loads data for the mounted component. The previous load is cancelled when the component unmounts, when
 * `key` changes (a new route or identifier), or on retry; a late answer to a cancelled load is ignored.
 * Data lives only in component state: leaving the page releases it, and reloading rebuilds it from the API.
 */
export function useResource<Data>(
  key: string,
  load: (signal: AbortSignal) => Promise<Outcome<Data>>,
): readonly [ResourceState<Data>, retry: () => void] {
  const [state, setState] = useState<ResourceState<Data>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    load(controller.signal).then(
      (outcome) => {
        if (!controller.signal.aborted) {
          setState(outcome.ok ? { status: 'ready', data: outcome.data } : { status: 'failed', failure: outcome.failure });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof RequestCancelledError)) {
          setState({ status: 'failed', failure: { kind: 'error' } });
        }
      },
    );
    return () => controller.abort();
    // `load` is intentionally excluded: `key` identifies what is loaded.
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [state, retry];
}

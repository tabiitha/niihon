import type { ReactNode } from 'react';

import { apiClient } from '../api/client.ts';
import { useResource } from '../api/resource.ts';
import { checkService } from '../api/service.ts';
import { StatusPanel } from './StatusPanel.tsx';

/**
 * Shows the page only once the local service answers with a compatible API version; otherwise shows the
 * loading, service-unavailable, incompatible-client, or error state with a retry action.
 */
export function ServiceGate({ children }: { readonly children: ReactNode }) {
  const [state, retry] = useResource('service', (signal) => checkService(apiClient, signal));
  if (state.status === 'ready') {
    return children;
  }
  return <StatusPanel failure={state.status === 'failed' ? state.failure : undefined} onRetry={retry} />;
}

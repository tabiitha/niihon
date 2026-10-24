import type { Router } from 'express';

import { addEventStream, ApiError } from '../../contract/operation.ts';
import { currentSession } from '../../sessions/sessions.ts';
import type { ApiModule } from '../api-module.ts';
import { changesErrorCodes, changesOperations, streamChanges } from './contract.ts';
import { createEventWriter, defaultStreamLimits, type StreamLimits } from './stream.ts';

export interface ChangesModuleOptions {
  readonly limits?: Partial<StreamLimits>;
  readonly now?: () => Date;
}

/**
 * Server-sent change notifications (issue #364): the HTTP side of the change feed in
 * src/changes, which every module publishes to through `context.changes`.
 */
export function createChangesModule(options: ChangesModuleOptions = {}): ApiModule {
  const limits = { ...defaultStreamLimits, ...options.limits };
  const now = options.now ?? (() => new Date());
  return {
    id: 'changes',
    operations: changesOperations,
    register(router: Router, { changes, logger }) {
      addEventStream(router, streamChanges).handle(({ query, headers }, request, response) => {
        const session = currentSession(request);
        const writer = createEventWriter(response, limits, logger);
        const subscription = changes.subscribe({
          profileId: session?.profile.id,
          sessionId: session?.id,
          lastEventId: headers['Last-Event-ID'] ?? query.lastEventId,
          deliver: (event) => writer.change(event),
          end: () => writer.end(),
        });
        if (subscription === undefined) {
          throw new ApiError(503, changesErrorCodes.capacityReached, 'Too many change subscriptions are open.', undefined, {
            'Retry-After': '5',
          });
        }
        writer.open(subscription.start, {
          onHeartbeat: () => {
            if (session !== undefined && session.expiresAt.getTime() <= now().getTime()) {
              writer.end();
            }
          },
          onClose: () => subscription.close(),
        });
      });
    },
  };
}

export const changesModule = createChangesModule();

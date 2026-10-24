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
    register(router: Router, { changes, database, logger }) {
      addEventStream(router, streamChanges).handle(({ query, headers }, request, response) => {
        if (request.destroyed || response.closed) {
          // The client left while its session was being resolved: hold no subscription for it.
          return;
        }
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
        /**
         * Ends the stream once its session is gone. Ending sessions also end their streams through
         * the feed; this check covers a session that ended before the subscription began, and expiry.
         */
        const checkSession = () => {
          if (session === undefined) {
            return;
          }
          if (session.expiresAt.getTime() <= now().getTime()) {
            writer.end();
            return;
          }
          database.reader.session.findUnique({ where: { id: session.id }, select: { id: true } }).then(
            (found) => {
              if (found === null) {
                writer.end();
              }
            },
            (error: unknown) => {
              logger('warn', 'changes.session_check_failed', { error: error instanceof Error ? error.message : String(error) });
            },
          );
        };
        writer.open(subscription.start, { onHeartbeat: checkSession, onClose: () => subscription.close() });
        checkSession();
      });
    },
  };
}

export const changesModule = createChangesModule();

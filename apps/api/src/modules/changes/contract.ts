import { z } from 'zod';

import { timestampSchema } from '../../contract/conventions.ts';
import { defineOperation } from '../../contract/operation.ts';

export const changesErrorCodes = {
  capacityReached: 'changes_capacity_reached',
} as const;

/** Stream timing and bounds published in the operation's description; see stream.ts. */
export const streamDefaults = {
  heartbeatMs: 15_000,
  maxQueuedEvents: 64,
  drainTimeoutMs: 30_000,
  retryMs: 2_000,
} as const;

/** Longest position a client may send back; longer ones are refused, unknown ones resynchronize. */
export const maxEventIdLength = 128;

const eventIdField = z
  .string()
  .min(1)
  .max(maxEventIdLength)
  .meta({ description: 'Opaque `id` of the last event the client received. Clients store it, never parse it.' });

export const changeNotificationSchema = z
  .object({
    topic: z.string().meta({
      description:
        'Family of resources that changed; reread its canonical resources. Topics are plain strings: ignore unknown ones. `sessions`: the sessions of your profile changed, reread `getCurrentSession`.',
      examples: ['sessions'],
    }),
    occurredAt: timestampSchema.meta({ description: 'When the change was committed.' }),
  })
  .meta({
    id: 'ChangeNotification',
    description: 'Data of a `change` event: a committed change visible to the subscriber. It never carries the changed data.',
  });

export const resyncNotificationSchema = z
  .object({
    reason: z.string().meta({
      description:
        'Why: `new_subscription` (no position sent), `server_restarted`, `too_far_behind` (more changes were missed than the server keeps), or `unknown_position`. Clients act the same way for every reason, including new ones.',
      examples: ['server_restarted'],
    }),
  })
  .meta({
    id: 'ResyncNotification',
    description: 'Data of a `resync` event: the missed changes cannot be listed; reread every resource the client shows.',
  });

export const streamChanges = defineOperation({
  operationId: 'streamChanges',
  method: 'get',
  path: '/stream',
  summary: 'Follow committed changes as server-sent events',
  description: `Opens a \`text/event-stream\` announcing changes after they are committed; a change never announces a transaction that was rolled back. Events invalidate: the client rereads the canonical resources of the announced topic, which stay the only source of state.

The stream starts with either a \`resync\` event, after which the client rereads everything it shows, or the changes missed since the position the client sent, one per topic. Positions are the events' \`id\`s: send the last one received in \`Last-Event-ID\` (browsers' \`EventSource\` does so when it reconnects) or in \`lastEventId\`; the header wins. A position from before a server restart, or older than the changes the server keeps, starts with \`resync\`.

A signed-in subscriber also receives the changes of its own profile, and its stream ends when its session ends; an anonymous one receives only the changes meant for everyone. A comment line is sent every ${streamDefaults.heartbeatMs / 1000} s. A subscriber that does not read is disconnected once ${streamDefaults.maxQueuedEvents} events wait for it, or after ${streamDefaults.drainTimeoutMs / 1000} s without progress; it reconnects with its last position.`,
  session: 'optional',
  query: z.object({
    lastEventId: eventIdField.optional(),
  }),
  headers: z.object({
    'Last-Event-ID': eventIdField.optional(),
  }),
  responses: {
    200: {
      description: 'The stream of `resync` and `change` events, until the client, its session, or the server ends it.',
      events: { change: changeNotificationSchema, resync: resyncNotificationSchema },
    },
  },
  errors: {
    503: 'Too many subscriptions are open (`changes_capacity_reached`); retry after `Retry-After`.',
  },
});

export const changesOperations = [streamChanges] as const;

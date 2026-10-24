import { randomBytes } from 'node:crypto';

import type { Database, TransactionClient } from '../database/database.ts';

/**
 * A committed change, announced so that clients reread the canonical resources of `topic`. It is
 * an invalidation, not a business record: it never carries the changed data.
 */
export interface Change {
  /** Resource family to reread, such as `sessions`: lowercase, 1 to 64 characters `a-z 0-9 . _ -`. */
  readonly topic: string;
  /** The only profile allowed to learn of the change; omitted, every subscriber is told. */
  readonly profileId?: string;
  /** Sessions the change ends: their subscriptions close once told of it. Never sent to clients. */
  readonly endsSessions?: readonly string[];
}

export interface ChangeEvent {
  /** `<stream>.<sequence>`: the position a client resumes after. */
  readonly id: string;
  readonly topic: string;
  readonly occurredAt: Date;
}

/** Why a subscriber must reread everything it shows instead of receiving the missed changes. */
export type ResyncReason = 'new_subscription' | 'unknown_position' | 'server_restarted' | 'too_far_behind';

/** How a new subscription starts: the latest missed change of each topic, or a full resynchronization. */
export type SubscriptionStart =
  | { readonly kind: 'replay'; readonly events: readonly ChangeEvent[] }
  | { readonly kind: 'resync'; readonly reason: ResyncReason; readonly position: string };

export interface Subscriber {
  /** The profile of the subscriber's session; omitted for an anonymous subscriber. */
  readonly profileId?: string | undefined;
  /** The session the subscription belongs to, closed when a change ends it. */
  readonly sessionId?: string | undefined;
  /** Position of the last change the client received, if it resumes. */
  readonly lastEventId?: string | undefined;
  /** Receives each later change visible to the subscriber, in commit order; must not throw. */
  readonly deliver: (event: ChangeEvent) => void;
  /** Called once when the feed ends the subscription: its session ended or the feed closed. */
  readonly end: () => void;
}

export interface Subscription {
  readonly start: SubscriptionStart;
  /** Stops deliveries; ending a subscription twice does nothing. */
  close(): void;
}

export interface ChangeFeedLimits {
  /** Changes kept for subscribers that resume; older positions resynchronize. */
  readonly retainedChanges: number;
  /** Open subscriptions; further ones are refused until one closes. */
  readonly maxSubscribers: number;
}

export const defaultChangeFeedLimits: ChangeFeedLimits = {
  retainedChanges: 1024,
  maxSubscribers: 100,
};

export interface ChangeFeed {
  /** Announces `change` once `transaction` commits; nothing is announced when it rolls back. */
  publish(transaction: TransactionClient, change: Change): void;
  /**
   * Opens a subscription and computes, at the same instant, what the subscriber missed since
   * `lastEventId`, so no change falls between the two. Returns `undefined` at capacity.
   */
  subscribe(subscriber: Subscriber): Subscription | undefined;
  /** Ends every subscription and refuses new ones; used when the server stops. */
  close(): void;
}

const topicPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface Retained extends ChangeEvent {
  readonly sequence: number;
  readonly profileId: string | undefined;
}

interface Active {
  readonly subscriber: Subscriber;
  open: boolean;
}

/**
 * Change notifications of one server process (issue #364). Changes are announced after their
 * transaction commits, numbered in commit order within a stream named at startup, and kept in a
 * bounded window. A subscriber resuming inside the window receives the latest missed change of
 * each topic; any other position — another stream after a restart, or older than the window —
 * resynchronizes. Nothing is persisted: the database stays the only source of state.
 */
export function createChangeFeed(options: {
  readonly database: Database;
  readonly now?: () => Date;
  readonly limits?: Partial<ChangeFeedLimits>;
}): ChangeFeed {
  const { database } = options;
  const now = options.now ?? (() => new Date());
  const limits = { ...defaultChangeFeedLimits, ...options.limits };
  const stream = randomBytes(9).toString('base64url');
  const retained: Retained[] = [];
  const active = new Set<Active>();
  let sequence = 0;
  let closed = false;

  const visible = (event: Retained, profileId: string | undefined) => event.profileId === undefined || event.profileId === profileId;

  const end = (entry: Active) => {
    if (entry.open) {
      entry.open = false;
      active.delete(entry);
      entry.subscriber.end();
    }
  };

  const announce = (change: Change) => {
    sequence += 1;
    const event: Retained = {
      id: `${stream}.${sequence}`,
      sequence,
      topic: change.topic,
      occurredAt: now(),
      profileId: change.profileId,
    };
    retained.push(event);
    if (retained.length > limits.retainedChanges) {
      retained.shift();
    }
    const ended = new Set(change.endsSessions);
    for (const entry of [...active]) {
      if (visible(event, entry.subscriber.profileId)) {
        entry.subscriber.deliver({ id: event.id, topic: event.topic, occurredAt: event.occurredAt });
      }
      if (entry.subscriber.sessionId !== undefined && ended.has(entry.subscriber.sessionId)) {
        end(entry);
      }
    }
  };

  const startFrom = (lastEventId: string | undefined, profileId: string | undefined): SubscriptionStart => {
    const position = `${stream}.${sequence}`;
    if (lastEventId === undefined) {
      return { kind: 'resync', reason: 'new_subscription', position };
    }
    const separator = lastEventId.lastIndexOf('.');
    const after = Number(lastEventId.slice(separator + 1));
    if (separator <= 0 || !/^\d{1,15}$/.test(lastEventId.slice(separator + 1))) {
      return { kind: 'resync', reason: 'unknown_position', position };
    }
    if (lastEventId.slice(0, separator) !== stream) {
      return { kind: 'resync', reason: 'server_restarted', position };
    }
    if (after > sequence) {
      return { kind: 'resync', reason: 'unknown_position', position };
    }
    // Every change after `after` must still be retained; the window starts after the oldest dropped one.
    const oldest = retained[0]?.sequence ?? sequence + 1;
    if (after < oldest - 1) {
      return { kind: 'resync', reason: 'too_far_behind', position };
    }
    // A change only asks to reread its topic, so the latest missed change of each topic is enough.
    const latest = new Map<string, Retained>();
    for (const event of retained) {
      if (event.sequence > after && visible(event, profileId)) {
        latest.delete(event.topic);
        latest.set(event.topic, event);
      }
    }
    return {
      kind: 'replay',
      events: [...latest.values()].map(({ id, topic, occurredAt }) => ({ id, topic, occurredAt })),
    };
  };

  return {
    publish(transaction, change) {
      if (!topicPattern.test(change.topic)) {
        throw new Error(`Invalid change topic "${change.topic}".`);
      }
      const copy: Change = { ...change, ...(change.endsSessions === undefined ? {} : { endsSessions: [...change.endsSessions] }) };
      database.afterCommit(transaction, () => {
        if (!closed) {
          announce(copy);
        }
      });
    },

    subscribe(subscriber) {
      if (closed || active.size >= limits.maxSubscribers) {
        return undefined;
      }
      const entry: Active = { subscriber, open: true };
      const start = startFrom(subscriber.lastEventId, subscriber.profileId);
      active.add(entry);
      return {
        start,
        close() {
          entry.open = false;
          active.delete(entry);
        },
      };
    },

    close() {
      closed = true;
      for (const entry of [...active]) {
        end(entry);
      }
    },
  };
}

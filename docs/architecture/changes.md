# Change Notifications and Resynchronization

The server tells connected clients that confirmed data changed, so they reread it, and lets a client that missed notifications or reconnects recover the confirmed state. Delivered by [issue #364](https://github.com/tabiitha/niihon/issues/364), the backend part of [#72](https://github.com/tabiitha/niihon/issues/72); the Web ([#365](https://github.com/tabiitha/niihon/issues/365)) and macOS ([#366](https://github.com/tabiitha/niihon/issues/366)) clients consume it. Access rules between profiles beyond the filtering below belong to [#77](https://github.com/tabiitha/niihon/issues/77).

## Principles

- **Invalidation, not a second journal.** A notification names a topic, such as `sessions`, and nothing else: the client rereads the canonical REST resources of that topic. The database remains the only source of state; notifications are never stored, and a lost notification loses nothing but a prompt to reread.
- **After commit only.** A module announces a change inside its write transaction with `context.changes.publish(transaction, { topic, profileId? })`. The feed sends it once the transaction has committed, in commit order, and never when it rolls back (business refusal, constraint violation, timeout). This relies on `database.afterCommit`, which runs callbacks after the commit and before the next write starts ([persistence](persistence.md)).
- **Recovery is always possible.** A client resumes from the last event it received. If the server still holds every change since then, it replays the latest of each topic; otherwise it says `resync`, and the client rereads everything it shows. Both paths end in the confirmed state, whatever was missed.

## Stream

`GET /api/changes/stream` (`streamChanges`) answers `200 text/event-stream`, `Cache-Control: no-store`. The session is optional.

```text
retry: 2000

event: resync
id: k3Jf9aQ2xL0b.41
data: {"reason":"new_subscription"}

event: change
id: k3Jf9aQ2xL0b.42
data: {"topic":"sessions","occurredAt":"2026-10-24T08:00:00.000Z"}

: keep-alive
```

| Event | Data (contract schema) | Client action |
| --- | --- | --- |
| `change` | `ChangeNotification`: `topic`, `occurredAt` | Reread the resources of `topic`; ignore unknown topics |
| `resync` | `ResyncNotification`: `reason` (`new_subscription`, `server_restarted`, `too_far_behind`, `unknown_position`) | Reread every resource shown, whatever the reason |

Each event's `id` is its position, `<stream>.<sequence>`: the stream is named randomly when the server starts and the sequence counts committed changes. Clients store the last `id` and never parse it. A comment line is sent every 15 s.

### Subscribing and Resuming

1. Open the stream first, then read resources when the first event arrives: a `resync`, or the replayed changes. Changes committed while the client reads are announced on the stream, so nothing falls in between.
2. Keep the `id` of the last event received.
3. On reconnection, send it as `Last-Event-ID` (browsers' `EventSource` does so itself, after the `retry` delay) or as the `lastEventId` query parameter; the header wins when both are present.

| Position sent | Stream starts with |
| --- | --- |
| None | `resync` `new_subscription` |
| Of this server process, every later change still kept | The latest missed change of each topic visible to the subscriber, in commit order (possibly none) |
| Older than the 1,024 changes kept | `resync` `too_far_behind` |
| Of a previous process (the server restarted) | `resync` `server_restarted` |
| Malformed or ahead of the server | `resync` `unknown_position` |

The `id` of a `resync` event is the current position, so the next resume starts from there. A position longer than 128 characters is refused with `400 validation_failed`. A client that switches profile starts without a position.

### Identity Filtering

A change is meant for everyone or for one profile. The subscriber's session, resolved when the stream opens, decides what it receives: a signed-in subscriber gets the changes of its profile and those for everyone; an anonymous one only those for everyone. Positions skipped by filtering are normal; a subscriber never learns another profile's changes, not even their topics.

A stream belongs to its session: it ends right after the subscriber is told of a change that ended its session (sign-out, replacement by a new sign-in, eviction beyond the session limits), and within one heartbeat after the session expires. The client then rereads its session, receives `401 authentication_required`, and signs in again.

### Published Topics

| Topic | Audience | Announced when | Reread |
| --- | --- | --- | --- |
| `sessions` | The profile | A session of the profile opens or ends: sign-in, sign-out, replacement, eviction | `getCurrentSession` |

Modules add topics with their features; topics are plain strings in the contract so that older clients ignore new ones.

## Bounds and Slow Subscribers

| Resource | Bound | Beyond it |
| --- | --- | --- |
| Changes kept for resuming | 1,024, in memory | Older positions resynchronize |
| Open subscriptions | 100 | `503 changes_capacity_reached`, `Retry-After: 5` |
| Events waiting for one subscriber | 64, after merging those of the same topic | The connection is closed; the client resumes from its position |
| Connection accepting nothing | 30 s | The connection is closed |
| Replay on resume | One event per topic | — |

The stream is written with backpressure. While a connection does not accept more, events wait in the subscriber's queue, where a newer event replaces an older one of the same topic since both only ask to reread it; heartbeats are skipped. A subscriber that still falls behind is disconnected and logged as `changes.subscriber_dropped` (`queue_full` or `stalled`), so a slow or stuck client costs a bounded amount of memory and never slows commits or other subscribers. When the server stops, it ends every stream at once, so open streams do not hold the shutdown grace period.

These bounds are a starting point; tune them after measurement.

## Source Structure

| File | Responsibility |
| --- | --- |
| `apps/api/src/database/database.ts` | `afterCommit`: callbacks run after the commit, in commit order, never after a rollback |
| `apps/api/src/changes/feed.ts` | `createChangeFeed`: publication after commit, positions, retained window, replay or resync, audiences, subscriptions and their capacity |
| `apps/api/src/contract/operation.ts` | `addEventStream` and `responses[...].events`: event-stream operations; `headers`: validated request headers |
| `apps/api/src/modules/changes/contract.ts` | `streamChanges` and the event payload schemas |
| `apps/api/src/modules/changes/stream.ts` | Writing the stream: backpressure, merged queue, heartbeat, disconnection of slow subscribers |
| `apps/api/src/modules/changes/index.ts` | The `changes` module: subscribes with the request's session, ends streams with their session |
| `apps/api/src/sessions/sessions.ts` | Announces `sessions` changes and ends the streams of removed sessions |
| `apps/api/src/changes/feed.test.ts`, `apps/api/src/modules/changes/*.test.ts` | Behavior tests, including a server restart |
| `apps/api/bench/changes.ts` | `bun run --cwd apps/api bench:changes` |

## Performance

Measured with `bun run --cwd apps/api bench:changes` against the real HTTP adapter and database: two profiles, each followed by 10 streams, plus 10 anonymous streams; 10,000 changes committed before measuring; 20 warm-up rounds, then three series of 100. A mutation is a real HTTP sign-out (no password hashing), alternating between the two profiles, timed until the response and until the profile's streams receive the change. A resume reconnects after 100 missed changes over 50 topics and reads the 51 replayed changes; a resync reconnects with a previous process's position. Apple M4 Pro, 48 GB, macOS (arm64), Node.js 26.7.0.

| Measure | Samples | p50 | p95 | Max |
| --- | --- | --- | --- | --- |
| Series 1: sign-out answered (commit included) | 100 | 0.6 ms | 0.9 ms | 1.8 ms |
| Series 1: change received by all 10 streams of the profile | 100 | 0.7 ms | 1.0 ms | 1.9 ms |
| Series 2: sign-out answered (commit included) | 100 | 0.5 ms | 0.6 ms | 1.6 ms |
| Series 2: change received by all 10 streams of the profile | 100 | 0.5 ms | 0.7 ms | 1.6 ms |
| Series 3: sign-out answered (commit included) | 100 | 0.4 ms | 0.5 ms | 0.7 ms |
| Series 3: change received by all 10 streams of the profile | 100 | 0.5 ms | 0.6 ms | 0.7 ms |
| Series 1: resume after 100 missed changes | 100 | 0.5 ms | 0.7 ms | 0.9 ms |
| Series 2: resume after 100 missed changes | 100 | 0.4 ms | 0.6 ms | 1.8 ms |
| Series 3: resume after 100 missed changes | 100 | 0.4 ms | 0.5 ms | 0.8 ms |
| Series 1: reconnect after a restart, until `resync` | 100 | 0.2 ms | 0.4 ms | 1.9 ms |
| Series 2: reconnect after a restart, until `resync` | 100 | 0.2 ms | 0.3 ms | 2.2 ms |
| Series 3: reconnect after a restart, until `resync` | 100 | 0.2 ms | 0.3 ms | 1.8 ms |

The budgets of #72 are p95 ≤ 100 ms for local reads and ≤ 200 ms for mutations. Opening the 30 streams with a full retained window added 3.3 MiB of heap to the benchmark process (server and clients together). A subscriber that never reads, alone while 100,000 changes over 1,000 topics were committed in 100 transactions (28 ms), was disconnected once, and the process RSS went from 322.0 MiB to 339.3 MiB at its peak. On macOS, SQLite's `fsync` does not force a drive cache flush, so write timings there understate Linux.

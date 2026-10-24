# Concurrent Modifications

Two clients can hold the same resource at once, a Web tab and the macOS app for example. Without a check, the second to save silently overwrites the first. This page describes how the server prevents it, delivered by [issue #71](https://github.com/tabiitha/niihon/issues/71): every aggregate carries a version, a change names the version it was based on, and the server compares and writes in one atomic statement. A change based on an outdated version is refused with an explicit conflict and writes nothing. The server never merges two changes: the client reads the current state again and decides. It follows the [REST contract](api-contract.md).

No domain owns a versioned aggregate yet. This page describes the foundation, proved on fixture tables; each domain adopts it in its own issue, with its own migration.

## Client Rules

| Rule | Behavior |
| --- | --- |
| Reading | A versioned resource carries a `version` field, an opaque token such as `v3`. Clients store and compare it, never parse it or compute the next one |
| Changing | A change to a versioned resource (`PUT`, `PATCH`, `DELETE`, or a `POST` that changes an existing aggregate) sends the version it was based on in `If-Match`, between double quotes: `If-Match: "v3"`. One version only: `*`, a list, and weak tags (`W/"v3"`) are refused |
| Success | The change applies, the resource moves to the next version, and the response carries the new `version` |
| Outdated | `412 version_conflict`: the resource changed since the client read it. Nothing was written. The error carries no resource state; the client reads the resource again, shows or reconciles the difference, and sends a new change with the new version |
| Missing | No `If-Match` is `428 precondition_required`: the server never overwrites blindly. Nothing was done |
| Malformed | `400 validation_failed` on `header.If-Match`. An invalid body or parameter is reported first |
| Unknown | A resource that does not exist is `404` with its domain code, not a conflict, even with an outdated version |
| Deleted | A deleted resource is not brought back by a change on its old version: `404` |

A conflict is a normal outcome of concurrent use, not a failure of the server. The error is a [stable code](api-contract.md#errors), so React and SwiftUI branch on it the same way. Merging the two changes, if it makes sense for a domain, is that domain's decision and is not provided here.

### Retrying and Idempotency Keys

A versioned change should be declared as a [command](command-idempotency.md) (`idempotent: true`, added with `commands.add`), so that it accepts an `Idempotency-Key`; the server does not require it. The two guarantees compose:

| Case | Answer |
| --- | --- |
| The write committed but its answer was lost; the client retries with the same key and the same `If-Match` | The stored response, `Idempotent-Replayed: true`. The version is not compared again, so the retry is not mistaken for a conflict |
| Same key, another `If-Match` | `422 idempotency_key_reused`: the expected version is part of the input the key is bound to |
| A new key with the old version, after the write committed | `412 version_conflict`: it is a new change based on a stale state |
| A conflict, then the same key with the fresh version | Works: a refused command stores nothing, so its key is not used up |

### Cancelled Requests

A client that stops waiting does not undo a write: the server does not tie a running write to the connection, so it commits or rolls back on its own (a test aborts a request while its write runs and finds the write committed). A client that abandons a request therefore treats the outcome as unknown, reads the resource again, and compares versions, or retries with the same `Idempotency-Key`. The clients are expected to cancel reads that a newer request replaced (`AbortSignal` in TypeScript, task cancellation in Swift) and to discard their results rather than apply them over a newer state; the server does not enforce this, and the Web and macOS clients ([#365](https://github.com/tabiitha/niihon/issues/365), [#366](https://github.com/tabiitha/niihon/issues/366)) implement it.

## Writing a Versioned Operation

1. Give the aggregate's table a `version Int @default(1)` column in its Prisma model, in the module's own migration. `initialVersion` is the value a new aggregate starts with. Aggregate identifiers are never reused, so an old version token cannot match a new aggregate.
2. Declare the operation with `expectsVersion: true`. The generated contract then lists the required `If-Match` header and the `412` and `428` responses, and the handler receives `input.expectedVersion` as a number. A `get` operation or an event stream cannot expect a version.
3. Expose the version in the resource schema with `versionSchema` and `formatVersion(row.version)`.
4. In the write transaction, compare and write in one statement and settle the result with `requireWritten`:

`Deck` below stands for the domain's own model:

```ts
commands.add(router, renameDeck).handle(async ({ params, body, expectedVersion }, commit) => {
  const deck = await commit(async (transaction) => {
    // The domain's own rules and its 404 first.
    const { count } = await transaction.deck.updateMany({
      where: { id: params.deckId, version: expectedVersion },
      data: { name: body.name, version: { increment: 1 } },
    });
    requireWritten({ count });                       // 0 rows: 412 version_conflict, transaction rolled back
    return toDeckBody(await transaction.deck.findUniqueOrThrow({ where: { id: params.deckId } }));
  });
  return { status: 200, body: deck };
});
```

Raw SQL works the same: `requireWritten(await transaction.$executeRaw\`UPDATE ... SET ..., "version" = "version" + 1 WHERE "id" = ${id} AND "version" = ${expectedVersion}\`)`. For a deletion, `deleteMany` or `DELETE ... WHERE "id" = ? AND "version" = ?`.

| Rule | Why |
| --- | --- |
| Compare in the `WHERE` of the write, never in a read followed by a write | The comparison and the write are then one statement: nothing can happen between them, even without the server's write queue |
| Every committed change to the aggregate adds exactly 1 to its version | The version never decreases and is never reused |
| Check that the aggregate exists before the write | So that a missing aggregate is `404`, not `412` |
| Name one aggregate in the `WHERE` | `requireWritten` refuses, and rolls back, a write that changed several rows |
| A change to something that is not part of the aggregate does not need to change its version | Choose the aggregate's boundary in the domain, then keep it |
| Publish the [change notification](changes.md) in the same transaction | It then exists only if the write committed; a refused write announces nothing |

## Guarantees

| Guarantee | How |
| --- | --- |
| Of several concurrent writes on one version, one succeeds | The comparison is part of the write statement, and writes run [one at a time](persistence.md#concurrency-and-durability); the others find the next version and are refused with `412` |
| A stale write has no partial effect | `requireWritten` throws inside the write transaction, which rolls back everything it did, including the response record of an idempotent command |
| Reading after a conflict gives the current state | Reads never wait for writes and see the committed state ([persistence](persistence.md#connections-and-transactions)) |
| Aggregates are independent | Each has its own `version`; a write on one never compares with or changes another |
| A version never goes back | Versions only increase, are stored with the data, and survive a restart |

## Limits

| Resource | Bound |
| --- | --- |
| Version token | `v` and 1 to 10 digits, at most 11 characters; the largest version a client can name is 2,147,483,646, so that the next write still fits a 32-bit `Int`. An aggregate whose version reached 2,147,483,647 (after one last write at 2,147,483,646) can no longer be changed through this protocol: a client cannot name that version |
| `If-Match` header | One version, at most 13 characters including the quotes |
| Conflict response | The standard error body only, a few hundred bytes, whatever the size of the resource |

## Performance

Measured with `bun run --cwd apps/api bench:versions` through the real HTTP adapter, command layer, and database, on the fixture notes: 10,000 notes written before timing, three series of 100 operations after 20 warm-up operations per operation, every write a keyed command. The fixture has no profiles, so the two-profile condition of the issue is not modelled; the versioned path does not depend on the caller. Results on an Apple M4 Pro with 48 GB, macOS, Node.js 26.7.0:

| Operation | p50 | p95 |
| --- | --- | --- |
| Read one note | 0.17–0.22 ms | 0.28–0.33 ms |
| Write on the current version | 0.62–0.80 ms | 0.86–1.33 ms |
| Write on a stale version, refused | 0.45–0.52 ms | 0.56–0.70 ms |
| 8 concurrent writes on one version, until all answered | 2.96–3.22 ms | 4.24–4.39 ms |

Database size 4.9 MiB including the write-ahead log; benchmark process peak RSS 359 MiB, not broken down further. The issue's budgets are p95 ≤100 ms for reads and ≤200 ms for mutations. These figures time the guard on fixture tables; a domain measures its own queries with its own data. On macOS, SQLite's `fsync` does not force the drive cache to flush, so mutation timings understate the cost of durable writes on Linux.

## Source Structure

| File | Responsibility | I/O |
| --- | --- | --- |
| `src/versions/token.ts` | The version token (`formatVersion`, `parseVersion`), the `If-Match` value (`parseIfMatch`), and their schemas | None |
| `src/versions/versions.ts` | `requireWritten` settles a conditional write; `versionConflict` is the `412` error | None |
| `src/contract/operation.ts` | `expectsVersion` on an operation, and `input.expectedVersion` read from `If-Match` before the handler runs | None |
| `contract/openapi.ts` | Publishes the required header and the `412` and `428` responses of such an operation | None |
| `test/fixtures/versioned-app.ts` | Fixture notes and tags over a real database and the real HTTP adapter, used by the tests and the benchmark | SQLite, HTTP |

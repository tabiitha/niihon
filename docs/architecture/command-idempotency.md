# Command Idempotency

A client that sends a command and gets no answer (connection lost, timeout, server restart) cannot know whether the effect happened. This page describes how the server lets it retry safely, delivered by [issue #70](https://github.com/tabiitha/niihon/issues/70): a command retried with the same key has its effect at most once, whatever the domain. It follows the [REST contract](api-contract.md) and [persistence](persistence.md) conventions.

## Client Rules

| Rule | Behavior |
| --- | --- |
| Key | The client sends `Idempotency-Key: <key>` on a command, unquoted: 16 to 64 characters `A-Z a-z 0-9 _ -`, such as a random UUID. It generates one key per command and keeps it until it has an answer it can act on. A malformed key is `400 validation_failed` on `header.Idempotency-Key` |
| Retry | Retrying with the same key and the same input after the command committed returns the stored response: same status, same body, plus `Idempotent-Replayed: true`. The effect is not repeated |
| Reuse | A key already used by another caller, another operation, or another input is refused with `422 idempotency_key_reused`, which discloses nothing about the original command. Use a new key for a new command |
| Concurrency | While a request with a key is running, another request with the same key is refused with `409 idempotency_key_in_use` and `Retry-After: 1` |
| Failure | A command that failed before its commit stored nothing: retrying with the same key runs it again. Error responses are never stored, so a retry after a domain refusal, a `503`, or a `500` is decided anew; if the failure came after the commit (the response was lost), the retry receives the committed response |
| Retention | A committed command can be replayed for 24 hours. After that its key may be used again for a new command |
| Without a key | The command runs as before, every time it is sent. The key is optional so that clients generated for an earlier 1.x contract keep working |

Only operations marked as commands accept the key; the contract lists `Idempotency-Key` as an optional header on them and documents the replay header and the three error codes. A key sent to another operation is ignored. The accounts module's `registerLocalAccount` and `completeOAuthRegistration` are commands; see [accounts](accounts.md#operations). `startOAuthRegistration` is not: its response carries the flow's `state`, which the server must never store in clear, and repeating it only creates another pending flow that expires on its own.

## Guarantee

```text
request with key K ──► K running? ──yes──► 409 idempotency_key_in_use
                          │no
                          ▼
                  unexpired record for K? ──yes──► same caller, operation, fingerprint?
                          │no                         │yes ──► stored response, Idempotent-Replayed: true
                          ▼                           │no  ──► 422 idempotency_key_reused
                  handler runs; its commit opens ONE write transaction:
                    purge a batch of expired records
                    refuse if the unexpired records are at the bound (503)
                    write the effect                  ◄── the domain's work
                    insert record {K, caller, operation, fingerprint, response}
                  COMMIT ──► response
```

- **Same transaction.** The record holding the response is inserted in the transaction that writes the effect. SQLite commits both or neither, so after a crash there is either an effect with its record or neither: a retry replays the first case and runs the command in the second. The tests kill the server process with `SIGKILL` inside the transaction and right after the commit, restart it on the same data directory, and check both outcomes.
- **One run at a time.** Requests with the same key are serialized in the process: the second is refused while the first runs, so the effect never races with itself. One server owns the database ([single instance](api-server.md#single-instance-per-data-directory)), so this in-memory set covers every request. It holds keys only while their request runs.
- **Identity.** The record associates the key with the caller, the operation identifier (the command type), and a fingerprint of the validated input (path, query, and body after parsing, with object keys sorted). Until sign-in exists ([#76](https://github.com/tabiitha/niihon/issues/76)) every request has the caller `anonymous`; #76 will identify the session's profile, and a key used by one profile is then refused to another.
- **Client disconnection.** A command whose client went away still finishes and stores its response, so a later retry receives it.

## Writing a Command

Declare the operation with `idempotent: true` and exactly one success response, then add it with `context.commands.add` instead of `addOperation` (which refuses an idempotent operation). The handler receives a `commit` function and must perform the command's effect through it, once, and respond with exactly what it returned:

```ts
commands.add(router, createItem).handle(async ({ body }, commit) => {
  const item = await commit(async (transaction) => {   // the record is written in this transaction
    const created = await transaction.item.create({ data: { ... } });
    return toItemView(created);                         // stored as the response body
  });
  return { status: 201, body: item };                   // must be that same value
});
```

Without a key, `commit` is a plain `database.write`. Work before `commit` (validation, hashing, provider calls) may run again on a retry of a command that failed before its commit; it must not have effects of its own that matter, or the domain must make them safe, as the single-use provider flow does. A second `commit`, or a response other than the committed value, is a programming error answered with `500`. The response must be at most 4 KiB of JSON; it is meant for small confirmations, never for files or large results.

## Fingerprint and Key File

The fingerprint is an HMAC-SHA256 of the operation and its input, keyed with a 32-byte secret of the installation. The input itself is never stored, and a plain hash of a body containing a password would let anyone holding a copy of the database test guesses quickly; without the secret, the fingerprint reveals nothing.

| Item | Location |
| --- | --- |
| Command key | `<NIHON_DATA_DIR>/nihon-command.key`, created on the first start, mode `600` (written to `nihon-command.key.partial`, synced, then renamed) |
| Records | Table `IdempotencyRecord` (model in `apps/api/prisma/schema/idempotency.prisma`, migration `20261022132104_idempotency`): `key` (primary key), `caller`, `operation`, `fingerprint`, `status`, `response` (JSON), `createdAt`, `expiresAt` (indexed) |

If the key file is deleted, a new key is created on the next start and pending retries of earlier commands are refused with `422` until their records expire: the server refuses rather than repeats. A key file that does not hold 32 bytes stops the start with exit code 1 and is left untouched; delete it to create a new one.

## Source Structure

| File | Responsibility |
| --- | --- |
| `apps/api/src/commands/idempotency.ts` | `createCommands`: key validation, replay or refusal, the in-process running set, and the `commit` that stores the response with the effect |
| `apps/api/src/commands/command-key.ts` | Reads or creates the installation's command key |
| `apps/api/contract/openapi.ts` | Adds the header, the replay header, and the idempotency errors to every command in the contract |
| `apps/api/test/fixtures/command-app.ts`, `command-crash.ts` | Domain-free fixture commands and the process killed before or after its commit |

## Limits

| Resource | Bound |
| --- | --- |
| Retention of a committed command | 24 hours |
| Unexpired records | 20,000; a further keyed command is refused with `503 idempotency_capacity_reached` and `Retry-After: 60`, without its effect, while commands without a key still run |
| Stored response | 4 KiB of JSON |
| Expired records deleted per keyed command | 100 |
| Key | 16 to 64 characters |

The records live in SQLite, not in memory; the in-memory set holds only the keys of running requests. Expired records are deleted in batches by later keyed commands, so the table stays bounded without a timer, and expired records never count against the bound. In the worst case, 20,000 records of 4 KiB occupy about 80 MiB; registration records take about 0.3 KiB each. These bounds are a starting point; tune them after measurement.

## Performance

Measured with `bun run --cwd apps/api bench:idempotency`: local registrations through the real HTTP adapter and database, with password hashing replaced by a constant because the issue's budget excludes it. Two callers, 10,000 unexpired records seeded before timing, then for each operation 20 warm-up operations and three series of 100. Apple M4 Pro, 48 GB, macOS (arm64), Node.js 26.7.0.

| Operation | p50 (3 series) | p95 (3 series) |
| --- | --- | --- |
| Keyed registration, first execution (mutation) | 0.77–0.95 ms | 1.12–1.27 ms |
| Unkeyed registration (mutation, reference) | 0.39–0.46 ms | 0.55–0.72 ms |
| Replay of a committed registration (read) | 0.20–0.23 ms | 0.27–0.32 ms |
| Key reused with other input (read, refused) | 0.21–0.22 ms | 0.27–0.33 ms |
| Keyed registration purging 100 expired records (mutation), with 10,000 expired records added before each series | 1.14–1.38 ms | 4.66–4.97 ms |

The issue's budgets are p95 ≤ 100 ms for reads and ≤ 200 ms for mutations, excluding password hashing. At the end the table held 11,260 records and the database with its WAL 14.9 MiB; the benchmark process (server, database, and client together) peaked at 558 MiB RSS. On macOS, SQLite's `fsync` does not force a drive cache flush, so write timings there understate Linux.

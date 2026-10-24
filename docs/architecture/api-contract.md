# REST Contract and Generated Clients

The Nihon server publishes one versioned REST contract, `contracts/openapi.json` (OpenAPI 3.1), from which the TypeScript and Swift clients are generated. This page describes the conventions every operation follows and the generation procedure, delivered by [issue #69](https://github.com/tabiitha/niihon/issues/69). The server foundation is described in the [API server architecture](api-server.md).

## Single Source

Each operation is declared once, in TypeScript, with [zod](https://zod.dev) schemas:

```ts
export const getExampleItem = defineOperation({
  operationId: 'getExampleItem',          // unique; becomes the client method name
  method: 'get',
  path: '/items/{itemId}',                // relative to /api/<module id>
  summary: 'Read one fixture item',
  params: z.object({ itemId: identifierSchema }),
  responses: { 200: { description: 'The item.', schema: exampleItemSchema } },
  errors: { 404: 'No item has this identifier (`example_item_not_found`).' },
});
```

The module lists its declarations in `ApiModule.operations` and implements each one with `addOperation(router, getExampleItem).handle((input) => ({ status: 200, body: item }))`. The same declaration:

- validates path and query parameters at runtime before the handler runs; the handler receives parsed, typed values;
- type-checks the handler's status and body against the declared responses;
- produces the OpenAPI document, which the clients are generated from.

```text
apps/api/src/**  operation declarations (zod)
      │  bun run contract:generate
      ▼
contracts/openapi.json ──► contracts/typescript/src/schema.ts            (openapi-typescript)
                      └──► contracts/swift/Sources/NihonAPIClient/Generated (swift-openapi-generator)
```

Exchange objects are designed for clients; they never mirror database tables.

A mutating operation declares its JSON request body with `body: z.strictObject({...})` and, when 16 KiB is not right, `maxBodyBytes`. The body is read with a bounded parser, validated before the handler runs, and handed over as `input.body`. A strict object refuses every field it does not list, so a client cannot inject one (such as `role`); the `validation_failed` issue names the field (`body.role`, message `Unrecognized field.`) and never echoes a value. A command that must be safe to retry is declared `idempotent: true` and accepts an optional `Idempotency-Key`; see [command idempotency](command-idempotency.md). An operation that changes an existing aggregate declares `expectsVersion: true`: the client sends the `version` it read in `If-Match`, and an outdated one is refused without writing anything; see [concurrent modifications](concurrency.md).

## Conventions

| Subject | Rule |
| --- | --- |
| Paths | `/api/<module id>/<resource>`; the foundation owns `/api/health`. Path parameters use OpenAPI `{name}` syntax |
| Identifiers | Opaque strings of 1 to 64 characters `A-Z a-z 0-9 _ -` (`identifierSchema`). Clients store and compare them, never parse them |
| Timestamps | UTC with millisecond precision, `2026-10-15T08:30:00.000Z` (`timestampSchema`, as produced by `Date.prototype.toISOString`). The Swift client decodes them with `.iso8601WithFractionalSeconds` |
| Durations | Integer milliseconds in a field named `…Ms`, such as `elapsedMs` |
| Field names | `camelCase`; error codes and enumerated values `snake_case` |
| Unknown query parameters | Ignored, so that a newer client can talk to an older server within the same major version |

### Errors

Every error response has the same body:

```json
{ "error": { "code": "validation_failed", "message": "The request is invalid.", "requestId": "…", "issues": [{ "path": "query.limit", "message": "…" }] } }
```

Clients branch on `code`, never on `message`, which is an English explanation for developers and is not displayed. `issues` is present on `validation_failed` only. Codes are stable: a code is never reused with a different meaning. Codes are plain strings in the contract, not enumerations, so that an older client keeps decoding errors that a newer server adds.

| Code | Status | Meaning |
| --- | --- | --- |
| `validation_failed` | 400 | A path or query parameter, a cursor, or a request body field is invalid or unexpected; see `issues` (paths `path.…`, `query.…`, `body.…`) |
| `unsupported_api_version` | 400 | The client was generated for another major version |
| `bad_request` | 4xx | The request could not be read (malformed URL encoding or JSON, for example) |
| `payload_too_large` | 413 | The request body exceeds the operation's limit |
| `unsupported_media_type` | 415 | An operation with a body received something other than `application/json` |
| `not_found` | 404 | No route matches |
| `internal_error` | 500 | Unexpected failure; details are in the server log under the same `requestId` |
| `stopping` | 503 | The server is shutting down |
| `database_busy` | 503 | A write could not get its turn in time; nothing was written. `Retry-After: 1` is set; see [persistence](persistence.md#concurrency-and-durability) |
| `idempotency_key_in_use` | 409 | Another request with the same `Idempotency-Key` is still running; `Retry-After: 1` is set |
| `idempotency_key_reused` | 422 | The `Idempotency-Key` was already used by another caller, operation, or input; nothing was done |
| `idempotency_capacity_reached` | 503 | Too many recent keyed commands are recorded; `Retry-After: 60` is set, nothing was done |
| `version_conflict` | 412 | The `If-Match` version is no longer the resource's current one; nothing was written. The client reads the resource again; see [concurrent modifications](concurrency.md) |
| `precondition_required` | 428 | The operation changes a versioned resource and the request has no `If-Match`; nothing was done |
| `authentication_required` | 401 | The operation needs a signed-in session and the request has none valid (never signed in, signed out, or expired); `WWW-Authenticate: Bearer` is set. See [sessions](sessions.md) |

Module codes start with the module identifier, such as `example_item_not_found`. Each operation documents its specific error statuses in `errors`; the generator adds `400` to every operation that is versioned or takes parameters or a body, `413` and `415` to every operation with a body, `409`, `422`, and `503` to every [command](command-idempotency.md), `412` and `428` to every operation declaring `expectsVersion`, `401` to every operation declaring `session: 'required'`, and a `default` error response to all of them.

An operation declaring `session: 'required'` requires a [session](sessions.md); the contract lists the `sessionCookie` (`nihon_session` cookie, Web) and `sessionToken` (`Authorization: Bearer`, native clients) security schemes on it. An operation declaring `session: 'optional'` lists them with an empty alternative: it acts on the session when the client sends one, such as `signOut`, and works without. A success response declared without a `schema`, such as the `204` of `signOut`, has no body.

### Event Streams

An operation whose success response declares `events` answers `text/event-stream` (server-sent events) instead of JSON and is added with `addEventStream`, such as [`streamChanges`](changes.md). Each event's `data` is one line of JSON; its schema is published under `components/schemas` with the identifier the response description names, so both clients can decode it. An operation may also declare optional request `headers`, such as `Last-Event-ID`, validated like its other input (`validation_failed` paths `header.…`). The TypeScript client receives the stream as the raw response body; browsers usually follow it with `EventSource`. The Swift client receives it as `HTTPBody`, which `swift-openapi-runtime` decodes with `asDecodedServerSentEvents()`.

### Request Correlation

Every response carries a `Nihon-Request-Id` header, repeated as `error.requestId` in error bodies and as `requestId` in the `request.failed` log event. A client may send its own `Nihon-Request-Id` (1 to 64 characters `A-Z a-z 0-9 . _ -`) to correlate a call with its own logs; the server reuses it, and replaces a malformed value with a new UUID.

### Pagination

A growing collection is paginated with a cursor; small fixed sets are not.

| Part | Rule |
| --- | --- |
| Query | `limit`, 1 to 100, default 50 (`pageQuerySchema`); `cursor`, at most 512 characters, omitted for the first page |
| Response | `{ "items": [...], "nextCursor": "…" \| null }` (`pageSchema(item, 'NameOfPage')`); `null` marks the last page |
| Order | Stable and documented per operation, ending with the identifier so that ties are ordered |
| Cursor | Opaque to clients. The server encodes the position after the last returned item (`encodeCursor`) and decodes it with a schema (`decodeCursor`); a malformed cursor is `validation_failed` on `query.cursor`, and the client restarts from the first page |

The TypeScript `paginate` helper walks a collection page by page; stopping the iteration stops fetching.

### Cancellation

A read that is no longer needed is cancelled by the client: pass an `AbortSignal` as `signal` to a TypeScript call, or cancel the Swift task. Cancellation stops the transport only; it never undoes a mutation that the server has already confirmed. To learn the outcome of a command whose answer was lost, retry it with the same `Idempotency-Key` ([command idempotency](command-idempotency.md)).

## Versioning and Compatibility

The contract is at version 1.4.0 (account registration added to 1.0.0 in 1.1.0, idempotency keys on commands in 1.2.0, sign-in and sessions in 1.3.0, change notifications in 1.4.0). The contract version is `info.version` in `contracts/openapi.json` (`apiVersion` in `apps/api/src/contract/conventions.ts`). Generated clients send its major part in a `Nihon-API-Version` header on every request.

| Request | Server answer |
| --- | --- |
| No `Nihon-API-Version` header | Accepted, so that tools such as `curl` keep working |
| `Nihon-API-Version: 1` (current major) | Accepted |
| Any other value | `400 unsupported_api_version` |
| `GET /api/health`, any header | `200`, with `apiVersion`, so that an incompatible client can explain the mismatch |

Within a major version, changes are additive only: new operations, new optional query parameters, new response fields, new error codes. Clients ignore unknown response fields. Removing or renaming anything, making a parameter required, changing a type, or adding a value to an enumeration that appears in a response is a breaking change: it increments the major version, and is committed as `type(scope)!:` with a `BREAKING CHANGE:` footer ([Git rules](../../GIT_RULES.md#commit-messages)).

## Generated Clients

| Client | Location | Use |
| --- | --- | --- |
| TypeScript | `contracts/typescript` (`@nihon/api-client`) | `createNihonClient({ baseUrl })` returns an [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client typed from `schema.ts`; calls return `{ data, error, response }` with a typed `error` |
| Swift | `contracts/swift` (package `NihonAPIClient`, macOS 14+) | `NihonAPI.makeClient(serverURL:)` returns the [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator) client over URLSession; each response is an enumeration of the documented statuses, such as `.ok`, `.notFound`, `.badRequest` |

Both declare the major version they were generated from (`apiMajorVersion` in `version.ts`, `NihonAPIVersion.major`). Generated files are committed, so building or running a client needs neither the generators nor network access; resolving the Swift package dependencies needs network access once, at build time.

### Generation Procedure

From the repository root, after `bun install --frozen-lockfile`:

| Command | Effect |
| --- | --- |
| `bun run contract:generate` | Rebuilds `contracts/openapi.json`, the conformance fixture contract, and both clients |
| `bun run contract:check` | Regenerates into a temporary directory and fails, listing the files, if anything committed differs |
| `… --skip-swift` | Either command without the Swift sources, on machines without a Swift toolchain |

Swift generation needs Swift 6 or newer and builds the pinned generator package `contracts/swift/Generator` on first use. Line endings are ignored when comparing, so a Windows checkout does not report drift. Commit the regenerated files with the change that caused them.

| Tool | Version | Role |
| --- | --- | --- |
| zod | 4.6.7 | Schemas and runtime validation (server dependency) |
| @asteasolutions/zod-to-openapi | 9.1.0 | OpenAPI document from the declarations (development only) |
| openapi-typescript | 7.13.0 | TypeScript declarations (generation only) |
| TypeScript | 5.9.3 | Compiler API required by openapi-typescript, isolated in `contracts/generator`; the rest of the repository uses TypeScript 7 |
| openapi-fetch | 0.17.0 | TypeScript client runtime |
| swift-openapi-generator | 1.14.1 | Swift client sources (generation only) |
| swift-openapi-runtime, swift-openapi-urlsession, swift-http-types | 1.13.1, 1.3.2, 1.8.0 | Swift client runtime |

### Conformance Fixture

`apps/api/test/fixtures/example-module.ts` is a read-only module that exercises the conventions: a paginated list, a read with a typed `404`, and UTC timestamps, over the data in `contracts/fixtures/example-items.json`. It is never registered in the server. `contracts/fixtures/openapi.json` describes it, and the generator produces a fixture client from it in each language (`contracts/typescript/test/conformance-schema.ts`, Swift target `NihonAPIConformance`).

`apps/api/test/fixtures/serve.ts` serves the real HTTP adapter with this module on a free loopback port. The client tests start it and check, from each language, a successful response, a typed error, field-level validation, pagination to the last page, and the refusal of a client generated for another major version:

```sh
bun run --cwd contracts/typescript test
swift test --package-path contracts/swift   # macOS; Node.js 24 must be on the PATH
```

CI runs the TypeScript tests and the drift check without Swift on Linux, macOS, and Windows, and the full drift check and Swift tests on macOS (`.github/workflows/api.yml`).

## Authentication Extension Points

[#233](https://github.com/tabiitha/niihon/issues/233), a part of #75, added registration (the [accounts module](accounts.md)) and [#269](https://github.com/tabiitha/niihon/issues/269), a part of #76, sign-in and sessions ([sessions](sessions.md)); #77 and #79 extend this contract with their own operations. They follow these rules so that React and SwiftUI behave the same way:

- **Three separate resources.** The sign-in session (Nihon's opaque session), a linked external identity (Google or GitHub), and the permission to use an AI provider (ChatGPT) are distinct resources with distinct operations and states. Connecting AI never changes the active profile or adds a sign-in method.
- **Provider identifiers** are stable `snake_case` strings (`google`, `github`, `chatgpt`), documented per operation as plain strings rather than response enumerations, for the compatibility reason above.
- **Intent** is explicit in the operation that starts a provider flow, such as registering, signing in, linking, reauthenticating, or connecting AI; it is never inferred from the provider's answer.
- **Public connection status** describes what a client may display (for example connected, expired, revoked); provider secrets, raw tokens, and token expiry details are never response fields.
- **Flow lifecycle.** Initiation, return, exchange, linking, unlinking, cancellation, expiry, and reauthorization each have a documented typed error code. Browser redirects to and from a provider are not JSON API operations; the JSON operations that start and finish a flow are. Return destinations are restricted to validated client locations.
- **Correlation** reuses `Nihon-Request-Id`; credentials never appear in logs, URLs, or error messages.

Provider integration tests stay in the authentication issues.

## Limits

| Resource | Bound |
| --- | --- |
| Page size | 100 items per page, 50 by default |
| Cursor | 512 characters |
| Request identifier | 64 characters |
| Version token | 11 characters (`v` and up to 10 digits); see [concurrent modifications](concurrency.md#limits) |
| Idempotency key | 16 to 64 characters; see [command idempotency](command-idempotency.md#limits) |
| Request bodies | 16 KiB unless the operation sets `maxBodyBytes` (see [API server limits](api-server.md#limits)) |

These bounds are a starting point; tune them after measurement.

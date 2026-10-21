# API Server Foundation

The Nihon API is an Express.js/TypeScript REST server running on Node.js. It is the only component that owns business rules, validation, and SQLite persistence; clients use its HTTP/JSON interface. This page describes the foundation delivered by [issue #2](https://github.com/tabiitha/niihon/issues/2). Installation commands live in the [root README](../../README.md).

## Repository Layout

| Path | Content |
| --- | --- |
| `package.json`, `bun.lock` | Bun workspace root (`apps/*`) and the single lockfile |
| `apps/api/` | The API: sources, tests, `Dockerfile`, TypeScript configuration |
| `apps/web/` | The Web client ([Web client architecture](web-client.md)) |
| `resources/themes/` | Theme tokens shared by the clients |
| `apps/api/contract/` | OpenAPI document builder and client generation ([REST contract](api-contract.md)) |
| `apps/api/prisma/`, `apps/api/prisma.config.ts` | Prisma schema and versioned SQL migrations ([persistence](persistence.md)) |
| `apps/api/bench/` | Persistence measurement script |
| `contracts/` | Published OpenAPI contract, generated TypeScript and Swift clients, conformance fixtures |
| `compose.yaml`, `.dockerignore` | Docker Compose service built from source; build-context allowlist |
| `.github/workflows/api.yml` | Application CI |
| `apps/macos/`, `.github/workflows/macos.yml` | Native macOS client and its CI, see the [macOS client](macos-client.md) |

Only what is needed exists. `packaging/macos` is created by the issue that first needs it.

## Source Structure

| File | Responsibility | I/O |
| --- | --- | --- |
| `src/config.ts` | Parses environment variables into a typed configuration | None |
| `src/modules/enablement.ts` | Chooses the enabled modules from the registry and configuration | None |
| `src/contract/` | Contract conventions (versions, errors, identifiers, timestamps, pagination) and operation declarations with runtime validation | None |
| `src/app.ts` | HTTP adapter: request identifiers, version check, health route, module mounting, Web interface, JSON errors | HTTP |
| `src/web.ts` | Serves the built Web interface outside `/api` | HTTP, file system |
| `src/instance-lock.ts` | Exclusive ownership of the data directory | File system |
| `src/database/` | Migrations, snapshots, and the reader and writer Prisma clients ([persistence](persistence.md)) | SQLite, file system |
| `src/server.ts` | Claims the directory, migrates and opens the database, listens, stops gracefully | Network, file system |
| `src/main.ts` | Process entry: configuration errors, signals, exit codes | Process |

Tests sit next to the code they cover (`*.test.ts`) and use Node's built-in test runner. `test/container.test.ts` checks a built image through the Docker CLI.

## Modules

Nihon is a modular monolith: features live in the repository and are compiled in; nothing is loaded at runtime from outside. Each feature is one folder, `apps/api/src/modules/<id>/`, containing its routes, business rules, and tests, and exporting one `ApiModule`:

```ts
export interface ApiModule {
  readonly id: string;                                // lowercase letters, digits, hyphens
  readonly operations: readonly OperationContract[];  // declarations published in the contract
  register(router: Router, context: ModuleContext): void; // routes relative to /api/<id>/
}
```

To add a module, create its folder and add one entry to `src/modules/registry.ts`. Each route is declared as an operation and added with `addOperation`, as described in the [REST contract](api-contract.md#single-source); then run `bun run contract:generate`. Modules interact only through what another module exports. The registry is empty in this foundation.

`context.database` gives the module the installation database: `database.reader` for reads and `database.write(...)` for write transactions. A module keeps its Prisma models in `apps/api/prisma/schema/<id>.prisma` and adds its migrations with `bun run db:migration`; see [persistence](persistence.md).

`NIHON_MODULES` selects the enabled modules. When it is unset, every registered module is enabled; when it is set, only the listed identifiers are (an empty value enables none). An identifier that no module carries stops startup with exit code 2. A disabled module's router is never mounted, so every path under `/api/<id>/` answers 404, exactly as if the module did not exist.

## HTTP Interface

| Request | Response |
| --- | --- |
| `GET /api/health` | `200 {"status":"ok","service":"nihon-api","version":"<apps/api/package.json version>","apiVersion":"<contract version>"}` |
| Unknown route | `404 {"error":{"code":"not_found","message":"...","requestId":"..."}}` |
| Unexpected error | `500 {"error":{"code":"internal_error",...}}`; details go to the log only |
| Any request during shutdown | `503 {"error":{"code":"stopping",...}}` with `Connection: close` |
| `Nihon-API-Version` other than the current major | `400 {"error":{"code":"unsupported_api_version",...}}`, except on `/api/health` |
| Outside `/api`, with `NIHON_WEB_DIR` set | A file of the Web build, or `index.html` for a page address; see the [Web client](web-client.md#toolchain-and-serving-topology) |

Every response carries a `Nihon-Request-Id` header. Error codes, versioning, pagination, and the other conventions are described in the [REST contract](api-contract.md).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `NIHON_DATA_DIR` | required | Data directory, created if missing; relative paths resolve from the working directory. It holds the database `nihon.db` ([persistence](persistence.md#storage)) |
| `NIHON_HOST` | `127.0.0.1` | Listening interface. The image sets `0.0.0.0` inside the container; the host publishes the port on `127.0.0.1` only |
| `NIHON_PORT` | `4000` | Listening port; `0` picks a free port |
| `NIHON_MODULES` | unset | Comma-separated module identifiers, see [Modules](#modules) |
| `NIHON_WEB_DIR` | unset (image: `/app/apps/web/dist`) | Built Web interface to serve; relative paths resolve from the working directory. Unset, only `/api` is served; without `index.html`, startup stops with exit code 2 |

`compose.yaml` additionally reads `NIHON_HOST_PORT` (default `4000`), the host loopback port.

## Lifecycle

The server writes one JSON object per line on standard output (`server.listening`, `server.stopping`, `server.stopped`, `instance.refused`, `config.invalid`, `database.migrated`, `database.incompatible`, `database.migration_failed`, `request.failed`).

On start, the server validates its configuration, claims the data directory, migrates and opens the database, then listens; `server.listening` reports the `schemaVersion`. `/api/health` therefore never answers before the schema is current.

| Exit code | Meaning |
| --- | --- |
| 0 | Stopped after SIGINT or SIGTERM |
| 1 | Unexpected failure, including a second signal during shutdown |
| 2 | Invalid configuration |
| 3 | Another server already uses the data directory |
| 4 | The database belongs to a newer release or is not a Nihon database; it is left untouched |
| 5 | A migration failed; it was rolled back and the data is unchanged |

On SIGINT or SIGTERM the server stops accepting connections, answers 503 to new requests on open connections, lets in-flight requests finish for up to 10 seconds, closes the remaining sockets, closes the database after its running write, then releases the data directory. Compose allows 15 seconds before killing the container.

### Single Instance per Data Directory

Before listening, the server opens `nihon-instance.lock` in the data directory with Node's built-in SQLite and holds an exclusive transaction on it. A second server on the same directory fails to obtain the lock immediately and exits with code 3. The operating system releases the lock when the process ends, including after a crash or `SIGKILL`, so no stale lock needs manual cleanup. The lock holds between two containers sharing a named volume, because they run on the same kernel. The file is never deleted; deleting it while a server runs would let a second server start. Network file systems and Docker bind mounts from a macOS or Windows host may not propagate locks; use the named volume.

## Limits

| Resource | Bound |
| --- | --- |
| Open connections | 256 (`maxConnections`); further connections are refused |
| Database | Two connections, writes one at a time with a 5 s wait and 64 queued at most, transactions of 5 s at most; see [persistence](persistence.md#connections-and-transactions) |
| Request bodies | Not parsed globally: unread bodies are never buffered. Each module adds a bounded parser or stream for its own routes |
| Request duration | Node defaults: 300 s per request, 60 s for headers |
| Shutdown | 10 s grace for in-flight requests |

These bounds are a starting point; tune them after measurement.

## Container Image

`apps/api/Dockerfile` builds from the repository root in four stages: generate the Prisma client and compile the API with Bun and TypeScript, build the Web client with Bun, install the API's production dependencies only with `bun install --production --omit=peer --frozen-lockfile`, then copy the JavaScript output, the Web build, the SQL migrations, and production `node_modules` into `node:24.22.0-alpine`. Base images are pinned by digest. The compile stages run on the builder's platform because they only produce JavaScript, so `linux/amd64` and `linux/arm64` images build without emulating the compiler. The production dependencies install on the target platform, inside the Node.js runtime image, because better-sqlite3 needs the native binary for that architecture and C library; `--omit=peer` leaves out the Prisma CLI that `@prisma/client` lists as an optional peer. The server runs as the `node` user, data lives in `/data` (mode `700`), and an image `HEALTHCHECK` calls `/api/health`.

## Toolchain

| Tool | Version | Role |
| --- | --- | --- |
| Node.js | 24 (image: 24.22.0) | Runtime; `engines` requires `>=24` |
| Bun | 1.4.3 | Dependency installation and scripts |
| TypeScript | 7.0.2 | Type checking and build (strict) |
| Express | 5.3.0 | HTTP framework |
| zod | 4.6.7 | Contract schemas and runtime validation |
| Prisma, better-sqlite3 | 7.10.1, 12.11.1 | Persistence, see [persistence](persistence.md#toolchain) |

Development runs the TypeScript sources directly with Node's type stripping; the configuration enables `erasableSyntaxOnly` and `rewriteRelativeImportExtensions` so the same files compile to `dist/` for production.

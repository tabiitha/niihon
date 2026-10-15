# API Server Foundation

The Nihon API is an Express.js/TypeScript REST server running on Node.js. It is the only component that will own business rules, validation, and SQLite persistence; clients use its HTTP/JSON interface. This page describes the foundation delivered by [issue #2](https://github.com/tabiitha/niihon/issues/2). Installation commands live in the [root README](../../README.md).

## Repository Layout

| Path | Content |
| --- | --- |
| `package.json`, `bun.lock` | Bun workspace root (`apps/*`) and the single lockfile |
| `apps/api/` | The API: sources, tests, `Dockerfile`, TypeScript configuration |
| `apps/api/contract/` | OpenAPI document builder and client generation ([REST contract](api-contract.md)) |
| `contracts/` | Published OpenAPI contract, generated TypeScript and Swift clients, conformance fixtures |
| `compose.yaml`, `.dockerignore` | Docker Compose service built from source; build-context allowlist |
| `.github/workflows/api.yml` | Application CI |

Only what is needed exists. `apps/web`, `apps/macos`, `resources`, and `packaging/macos` are created by the issues that first need them.

## Source Structure

| File | Responsibility | I/O |
| --- | --- | --- |
| `src/config.ts` | Parses environment variables into a typed configuration | None |
| `src/modules/enablement.ts` | Chooses the enabled modules from the registry and configuration | None |
| `src/contract/` | Contract conventions (versions, errors, identifiers, timestamps, pagination) and operation declarations with runtime validation | None |
| `src/app.ts` | HTTP adapter: request identifiers, version check, health route, module mounting, JSON errors | HTTP |
| `src/instance-lock.ts` | Exclusive ownership of the data directory | File system |
| `src/server.ts` | Claims the directory, listens, stops gracefully | Network, file system |
| `src/main.ts` | Process entry: configuration errors, signals, exit codes | Process |

Tests sit next to the code they cover (`*.test.ts`) and use Node's built-in test runner. `test/container.test.ts` checks a built image through the Docker CLI.

## Modules

Nihon is a modular monolith: features live in the repository and are compiled in; nothing is loaded at runtime from outside. Each feature is one folder, `apps/api/src/modules/<id>/`, containing its routes, business rules, and tests, and exporting one `ApiModule`:

```ts
export interface ApiModule {
  readonly id: string;                                // lowercase letters, digits, hyphens
  readonly operations: readonly OperationContract[];  // declarations published in the contract
  register(router: Router): void;                     // routes relative to /api/<id>/
}
```

To add a module, create its folder and add one entry to `src/modules/registry.ts`. Each route is declared as an operation and added with `addOperation`, as described in the [REST contract](api-contract.md#single-source); then run `bun run contract:generate`. Modules interact only through what another module exports. The registry is empty in this foundation.

`NIHON_MODULES` selects the enabled modules. When it is unset, every registered module is enabled; when it is set, only the listed identifiers are (an empty value enables none). An identifier that no module carries stops startup with exit code 2. A disabled module's router is never mounted, so every path under `/api/<id>/` answers 404, exactly as if the module did not exist. Prisma models will stay separated per module when persistence arrives; that choice belongs to the persistence issue.

## HTTP Interface

| Request | Response |
| --- | --- |
| `GET /api/health` | `200 {"status":"ok","service":"nihon-api","version":"<apps/api/package.json version>","apiVersion":"<contract version>"}` |
| Unknown route | `404 {"error":{"code":"not_found","message":"...","requestId":"..."}}` |
| Unexpected error | `500 {"error":{"code":"internal_error",...}}`; details go to the log only |
| Any request during shutdown | `503 {"error":{"code":"stopping",...}}` with `Connection: close` |
| `Nihon-API-Version` other than the current major | `400 {"error":{"code":"unsupported_api_version",...}}`, except on `/api/health` |

Every response carries a `Nihon-Request-Id` header. Error codes, versioning, pagination, and the other conventions are described in the [REST contract](api-contract.md).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `NIHON_DATA_DIR` | required | Data directory, created if missing; relative paths resolve from the working directory |
| `NIHON_HOST` | `127.0.0.1` | Listening interface. The image sets `0.0.0.0` inside the container; the host publishes the port on `127.0.0.1` only |
| `NIHON_PORT` | `4000` | Listening port; `0` picks a free port |
| `NIHON_MODULES` | unset | Comma-separated module identifiers, see [Modules](#modules) |

`compose.yaml` additionally reads `NIHON_HOST_PORT` (default `4000`), the host loopback port.

## Lifecycle

The server writes one JSON object per line on standard output (`server.listening`, `server.stopping`, `server.stopped`, `instance.refused`, `config.invalid`, `request.failed`).

| Exit code | Meaning |
| --- | --- |
| 0 | Stopped after SIGINT or SIGTERM |
| 1 | Unexpected failure, including a second signal during shutdown |
| 2 | Invalid configuration |
| 3 | Another server already uses the data directory |

On SIGINT or SIGTERM the server stops accepting connections, answers 503 to new requests on open connections, lets in-flight requests finish for up to 10 seconds, closes the remaining sockets, then releases the data directory. Compose allows 15 seconds before killing the container.

### Single Instance per Data Directory

Before listening, the server opens `nihon-instance.lock` in the data directory with Node's built-in SQLite and holds an exclusive transaction on it. A second server on the same directory fails to obtain the lock immediately and exits with code 3. The operating system releases the lock when the process ends, including after a crash or `SIGKILL`, so no stale lock needs manual cleanup. The lock holds between two containers sharing a named volume, because they run on the same kernel. The file is never deleted; deleting it while a server runs would let a second server start. Network file systems and Docker bind mounts from a macOS or Windows host may not propagate locks; use the named volume.

## Limits

| Resource | Bound |
| --- | --- |
| Open connections | 256 (`maxConnections`); further connections are refused |
| Request bodies | Not parsed globally: unread bodies are never buffered. Each module adds a bounded parser or stream for its own routes |
| Request duration | Node defaults: 300 s per request, 60 s for headers |
| Shutdown | 10 s grace for in-flight requests |

These bounds are a starting point; tune them after measurement.

## Container Image

`apps/api/Dockerfile` builds from the repository root in three stages: compile with Bun and TypeScript, install production dependencies only with `bun install --production --frozen-lockfile`, then copy the JavaScript output and production `node_modules` into `node:24.22.0-alpine`. Base images are pinned by digest. Build stages run on the builder's platform because they only produce JavaScript, so `linux/amd64` and `linux/arm64` images build without emulating the compiler. The server runs as the `node` user, data lives in `/data`, and an image `HEALTHCHECK` calls `/api/health`.

## Toolchain

| Tool | Version | Role |
| --- | --- | --- |
| Node.js | 24 (image: 24.22.0) | Runtime; `engines` requires `>=24` |
| Bun | 1.4.3 | Dependency installation and scripts |
| TypeScript | 7.0.2 | Type checking and build (strict) |
| Express | 5.3.0 | HTTP framework |
| zod | 4.6.7 | Contract schemas and runtime validation |

Development runs the TypeScript sources directly with Node's type stripping; the configuration enables `erasableSyntaxOnly` and `rewriteRelativeImportExtensions` so the same files compile to `dist/` for production.

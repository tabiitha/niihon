# Nihon

Nihon is a local Japanese-learning product targeting Windows, Linux, and macOS. The backend exposes an Express.js/TypeScript REST API on Node.js, with Prisma and SQLite. React and native Swift/SwiftUI consume the same HTTP/JSON contract. The Web client uses TypeScript, HTML, and CSS. Bun handles dependencies and build scripts; Docker packages the backend and Web delivery. Swift/SwiftUI remains native to macOS.

Rust and Unreal are removed from the active stack. Games are deferred and excluded from the current application scope.

## Project Status

The project is in early development. The Express.js/TypeScript server foundation from [issue #2](https://github.com/tabiitha/niihon/issues/2) runs and reports its availability. Since [issue #5](https://github.com/tabiitha/niihon/issues/5) it also serves the Web interface: navigation between the home, learning, kanji, library, profile, and administration spaces in English, French, and Japanese. Since [issue #73](https://github.com/tabiitha/niihon/issues/73), a native SwiftUI client for Apple silicon Macs running macOS 26 or later opens the same spaces and connects to the running server. Since [issue #233](https://github.com/tabiitha/niihon/issues/233), the API registers a local account with a username and password, or with an optional Google or GitHub identity. Since [issue #234](https://github.com/tabiitha/niihon/issues/234), the Web interface offers a registration screen at `/register`; no sign-in screen or learning feature exists yet.

## Installation

Nihon installs from source and runs its server with Docker Compose. The server stays on while Docker runs, and is reachable only from this computer at `http://127.0.0.1:4000`, where the browser opens the Web interface.

### Prerequisites

- Git.
- Docker with Compose v2: Docker Desktop on Windows and macOS, Docker Engine with the Compose plugin on Linux. Linux images exist for `amd64` and `arm64`.
- Disk space for the images: the Nihon image takes 254 MB, and building it also downloads the Bun build image.

Verified so far: Docker 29.8.0 with Compose 5.5.1 on macOS 27 (Apple silicon), and GitHub-hosted Ubuntu runners for `amd64` and `arm64`. Windows has not been tested yet.

### Start

```sh
git clone https://github.com/tabiitha/niihon.git nihon
cd nihon
docker compose up --detach --build --wait
```

Check the installation: open `http://127.0.0.1:4000` in a browser to display the Web interface, or run `curl http://127.0.0.1:4000/api/health` (on Windows, `curl.exe`), which answers `{"status":"ok","service":"nihon-api","version":"..."}`. To use another host port, set `NIHON_HOST_PORT`, for example `NIHON_HOST_PORT=4100 docker compose up --detach --build --wait`.

### Stop

```sh
docker compose stop
```

`docker compose down` also removes the container. Both keep your data, which lives in the `nihon_nihon-data` Docker volume. `docker compose down --volumes` deletes that data permanently.

### Update

```sh
git pull
docker compose up --detach --build --wait
```

On start, the server brings its database to the new release's schema before answering. It first saves a snapshot of the previous data in the volume's `snapshots` folder. If the update fails, the server stops with exit code 5 and your data stays exactly as it was; `docker compose logs api` shows the reason. See [persistence](docs/architecture/persistence.md).

## Development

Install Node.js 24.7 or newer and Bun 1.4.3, then run from the repository root:

| Command | Effect |
| --- | --- |
| `bun install --frozen-lockfile` | Install locked dependencies |
| `bun run dev` | Run the server from sources, restarting on change; data, including the database `nihon.db`, in `.local/data` |
| `bun run dev:web` | Run the Web interface with hot reload at `http://127.0.0.1:3000`, relaying `/api` to the server started by `bun run dev` |
| `bun run typecheck` | Strict type checking of the API, the TypeScript client, and the Web interface |
| `bun run build` | Compile the API to `apps/api/dist/` and the Web interface to `apps/web/dist/` |
| `bun run start` | Run the compiled server; set `NIHON_DATA_DIR` first, and `NIHON_WEB_DIR=../web/dist` to serve the Web interface |
| `bun run test` | API unit and server-process tests, TypeScript client tests, and Web interface tests |
| `bun run test:production` | After `bun run build`, test the compiled server serving the Web build |
| `bun run test:container` | Build the image and test it with Docker |
| `bun run db:generate` | Regenerate the Prisma client after a schema change; `typecheck`, `build`, `test`, and `dev` already do it |
| `bun run db:migration <name>` | Write the next SQL migration from the Prisma schema, without opening any database |
| `bun run contract:generate` | Regenerate the OpenAPI contract and the TypeScript and Swift clients; add `--skip-swift` without a Swift toolchain |
| `bun run contract:check` | Fail if the committed contract or clients differ from the server's declarations |
| `swift test --package-path contracts/swift` | Test the Swift client (macOS, Swift 6 or newer) |
| `bun run macos:generate` | Regenerate the macOS client's Swift texts and themes from the shared JSON files |
| `bun run macos:check` | Fail if those generated Swift sources differ from the JSON files |
| `apps/macos/scripts/build-app.sh` | Build the macOS client to `apps/macos/build/Nihon.app` (macOS 26, Apple silicon, Xcode 26 or newer) |
| `swift test --package-path apps/macos` | Test the macOS client's core |

Configuration, modules, exit codes, and limits are described in the [API server architecture](docs/architecture/api-server.md); the database, migrations, and snapshots in [persistence](docs/architecture/persistence.md); the REST conventions and generated clients in the [REST contract](docs/architecture/api-contract.md); safe retries of commands in [command idempotency](docs/architecture/command-idempotency.md); detection of concurrent modifications by version in [concurrent modifications](docs/architecture/concurrency.md); account registration in [accounts](docs/architecture/accounts.md); sign-in, sessions, and sign-out in [sessions](docs/architecture/sessions.md); change notifications and resynchronization in [change notifications](docs/architecture/changes.md); routes, languages, themes, and serving in the [Web client architecture](docs/architecture/web-client.md); the native app, its connection states, and its build in the [macOS client architecture](docs/architecture/macos-client.md).

## Documentation

Architecture, technical decisions, design-system guidance, API documentation, troubleshooting, and resource provenance belong in `docs/`.

Start with the [accepted project decisions](docs/PROJECT_DECISIONS.md), originally recorded on 2026-09-26 and updated on 2026-09-30. They capture the current backend, deployment target, professional delivery requirements, documentation organization, and explicitly excluded proposals.

New contributors can start with the one-page [contributor quickstart](docs/engineering/QUICKSTART.md). Contributor tooling and prompt-driven work are described in the [engineering harness and loop](docs/engineering/README.md). The harness can be checked independently with `node tools/harness/harness.mjs run tools/harness/self-check.json`; this validates developer tooling, not an application installation.

## Backlog

Use the existing indexes: [general project scope #1](https://github.com/tabiitha/niihon/issues/1) and [final optimizations #166](https://github.com/tabiitha/niihon/issues/166). Preserve [games #39](https://github.com/tabiitha/niihon/issues/39) as deferred inventory. Reconcile older stack, platform, and game assumptions with the accepted decisions before implementing an affected issue; preserve each active issue's responsibility and Goal. This local update does not close or edit GitHub issues.

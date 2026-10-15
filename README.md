# Nihon

Nihon is a local Japanese-learning product targeting Windows, Linux, and macOS. The backend exposes an Express.js/TypeScript REST API on Node.js, with Prisma and SQLite. React and native Swift/SwiftUI consume the same HTTP/JSON contract. The Web client uses TypeScript, HTML, and CSS. Bun handles dependencies and build scripts; Docker packages the backend and Web delivery. Swift/SwiftUI remains native to macOS.

Rust and Unreal are removed from the active stack. Games are deferred and excluded from the current application scope.

## Project Status

The project is in early development. The Express.js/TypeScript server foundation from [issue #2](https://github.com/tabiitha/niihon/issues/2) runs and reports its availability; no learning feature, account, or user interface exists yet.

## Installation

Nihon installs from source and runs its server with Docker Compose. The server stays on while Docker runs, and is reachable only from this computer at `http://127.0.0.1:4000`.

### Prerequisites

- Git.
- Docker with Compose v2: Docker Desktop on Windows and macOS, Docker Engine with the Compose plugin on Linux. Linux images exist for `amd64` and `arm64`.
- Disk space for the images: the API image takes 244 MB, and building it also downloads the Bun build image.

Verified so far: Docker 29.8.0 with Compose 5.5.1 on macOS 27 (Apple silicon), and GitHub-hosted Ubuntu runners for `amd64` and `arm64`. Windows has not been tested yet.

### Start

```sh
git clone https://github.com/tabiitha/niihon.git nihon
cd nihon
docker compose up --detach --build --wait
```

Check the installation: `curl http://127.0.0.1:4000/api/health` (on Windows, `curl.exe`) answers `{"status":"ok","service":"nihon-api","version":"..."}`. To use another host port, set `NIHON_HOST_PORT`, for example `NIHON_HOST_PORT=4100 docker compose up --detach --build --wait`.

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

## Development

Install Node.js 24 or newer and Bun 1.4.3, then run from the repository root:

| Command | Effect |
| --- | --- |
| `bun install --frozen-lockfile` | Install locked dependencies |
| `bun run dev` | Run the server from sources, restarting on change; data in `.local/data` |
| `bun run typecheck` | Strict type checking of the API and the TypeScript client |
| `bun run build` | Compile to `apps/api/dist/` |
| `bun run start` | Run the compiled server; set `NIHON_DATA_DIR` first |
| `bun run test` | API unit and server-process tests, and TypeScript client tests |
| `bun run test:container` | Build the image and test it with Docker |
| `bun run contract:generate` | Regenerate the OpenAPI contract and the TypeScript and Swift clients; add `--skip-swift` without a Swift toolchain |
| `bun run contract:check` | Fail if the committed contract or clients differ from the server's declarations |
| `swift test --package-path contracts/swift` | Test the Swift client (macOS, Swift 6 or newer) |

Configuration, modules, exit codes, and limits are described in the [API server architecture](docs/architecture/api-server.md); the REST conventions and generated clients in the [REST contract](docs/architecture/api-contract.md).

## Documentation

Architecture, technical decisions, design-system guidance, API documentation, troubleshooting, and resource provenance belong in `docs/`.

Start with the [accepted project decisions](docs/PROJECT_DECISIONS.md), originally recorded on 2026-09-26 and updated on 2026-09-30. They capture the current backend, deployment target, professional delivery requirements, documentation organization, and explicitly excluded proposals.

New contributors can start with the one-page [contributor quickstart](docs/engineering/QUICKSTART.md). Contributor tooling and prompt-driven work are described in the [engineering harness and loop](docs/engineering/README.md). The harness can be checked independently with `node tools/harness/harness.mjs run tools/harness/self-check.json`; this validates developer tooling, not an application installation.

## Backlog

Use the existing indexes: [general project scope #1](https://github.com/tabiitha/niihon/issues/1) and [final optimizations #166](https://github.com/tabiitha/niihon/issues/166). Preserve [games #39](https://github.com/tabiitha/niihon/issues/39) as deferred inventory. Reconcile older stack, platform, and game assumptions with the accepted decisions before implementing an affected issue; preserve each active issue's responsibility and Goal. This local update does not close or edit GitHub issues.

# Repository Guidelines

Nihon is a local Japanese-learning product for Windows, Linux, and macOS. These requirements apply regardless of contributor tooling; AI use, models, and delegation are optional.

## Project Structure and Architecture

Read [accepted decisions](docs/PROJECT_DECISIONS.md) and the selected issue before implementation. Planned directories are `apps/api` (Express.js/TypeScript REST API on Node.js), `apps/web` (React/TypeScript, HTML/CSS), and `apps/macos` (native Swift/SwiftUI). Create them only when required. The backend alone owns business validation and SQLite persistence through Prisma; clients consume HTTP/JSON. Bun handles dependencies/builds; Docker packages Web/server delivery. Bun builds and serves the Web client in development; in production, Express serves its build (see the [Web client](docs/architecture/web-client.md)).

Keep installation in `README.md`, detailed guidance in `docs/`, and assets in `resources/`. Rust and games are outside active scope. Never reuse the old project's code, schema, or architecture.

## Scope and Development Commands

Inspect Git and current issue dependencies, Goal, acceptance, and performance criteria. Keep one responsibility per realization; preserve the backlog. Issue #2 established the server foundation and module registry, excluding authentication, business persistence, and UI.

The API lives in `apps/api` (see the [API server architecture](docs/architecture/api-server.md)); its OpenAPI contract and generated TypeScript/Swift clients live in `contracts` (see the [REST contract](docs/architecture/api-contract.md)). From the root: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, `bun run test` (Node's built-in test runner), `bun run test:container` (Docker), and `bun run contract:check` after changing an operation (`contract:generate` to update). Check manifests before documenting new scripts. Developer-tool checks:

```sh
node tools/harness/harness.mjs doctor
node tools/harness/harness.mjs run tools/harness/self-check.json
```

These validate the harness, not application readiness. See the [engineering guide](docs/engineering/README.md).

## Style, Testing, and Design

Use strict TypeScript, two-space indentation, `camelCase` members, and `PascalCase` types/components; Swift uses four spaces. Separate business rules from HTTP and persistence adapters.

Use behavior-based tests for applicable success, failure, and recovery paths. Coverage thresholds remain unset. Record executed/skipped checks and the exact version. Plan pagination, streaming, bounded memory/concurrency, and cancellation where applicable; preserve confirmed mutations and tune after measurement.

Follow accepted design requirements, reusable components, responsive states, keyboard access, readable Japanese typography, reduced motion, and the WCAG 2.2 AA target. The maintainer's mockups remain local and unversioned; obtain relevant references when an interface task needs them.

## Contributions and Review

Follow [Git rules](GIT_RULES.md): English Conventional Commit subjects and PR titles, complete English descriptions followed by collapsed French. Preserve unrelated work; exclude secrets and generated evidence. Supply meaningful validation and independent review for the final version; never invent execution or approval. “Do issue #N” authorizes the full path up to a PR ready for review with `Closes #N`, without asking; approval and merge stay with the owner ([default authorization](docs/engineering/GRAPH.md#default-authorization)). Maintainers arrange additional integration checks without requiring a particular AI setup. Personal AI settings remain local and unversioned; see the [optional AI workflow](docs/engineering/LOCAL_AI_WORKFLOW.md). Maintainer automation follows the [bot identity guide](docs/engineering/GITHUB_IDENTITY.md); other contributors use their own credentials.

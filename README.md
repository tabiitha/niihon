# Nihon

Nihon is a local Japanese-learning product targeting Windows, Linux, and macOS. The backend exposes an Express.js/TypeScript REST API on Node.js, with Prisma and SQLite. React and native Swift/SwiftUI consume the same HTTP/JSON contract. The Web client uses TypeScript, HTML, and CSS. Bun handles dependencies and build scripts; Docker packages the backend and Web delivery. Swift/SwiftUI remains native to macOS.

Rust and Unreal are removed from the active stack. Games are deferred and excluded from the current application scope.

## Project Status

The project is in preparation. No runnable application or supported installation command is available yet. The first planned implementation is the Express.js/TypeScript server foundation in [issue #2](https://github.com/Bryan-da-silvaa/niihon/issues/2); preserve its minimal scope and recheck its current requirements before implementation.

## Installation

This root README will contain the installation guide as runnable releases become available: supported systems, prerequisites, release selection, Docker startup and shutdown, initial resources, demonstration data, and verification of a successful installation. Commands will be documented after they have been implemented and verified.

## Documentation

Architecture, technical decisions, design-system guidance, API documentation, troubleshooting, and resource provenance belong in `docs/`.

Start with the [accepted project decisions](docs/PROJECT_DECISIONS.md), originally recorded on 2026-09-26 and updated on 2026-09-30. They capture the current backend, deployment target, professional delivery requirements, documentation organization, and explicitly excluded proposals.

Contributor tooling and prompt-driven work are described in the [engineering harness and loop](docs/engineering/README.md). The harness can be checked independently with `node tools/harness/harness.mjs run tools/harness/self-check.json`; this validates developer tooling, not an application installation.

## Backlog

Use the existing indexes: [general project scope #1](https://github.com/Bryan-da-silvaa/niihon/issues/1) and [final optimizations #166](https://github.com/Bryan-da-silvaa/niihon/issues/166). Preserve [games #39](https://github.com/Bryan-da-silvaa/niihon/issues/39) as deferred inventory. Reconcile older stack, platform, and game assumptions with the accepted decisions before implementing an affected issue; preserve each active issue's responsibility and Goal. This local update does not close or edit GitHub issues.

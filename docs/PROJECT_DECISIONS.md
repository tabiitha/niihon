# Accepted Project Decisions

Originally recorded on **2026-09-26**, updated on **2026-09-30** for the owner's complete stack selection and game deferral. These are requirements and planning decisions, not claims of implemented functionality, completed tests, or published releases.

## Authority and Scope

Nihon should demonstrate professional delivery and maintainability for the owner's freelance career while remaining a locally deployed product.

These decisions supersede older Rust/Unreal, Next.js, game, macOS-only, and optional-development-only Docker assumptions. Read the historical `NIIHON_PASSATION.md` for unchanged functional context, then apply these corrections. Existing GitHub issues remain the detailed task inventory; obsolete stack, platform, and game assumptions must be reconciled before affected work starts. This documentation update does not update GitHub issues.

Keep the existing backlog and indexes #1 and #166; retain #39 as deferred game inventory. Each active realization has one responsibility, one Goal, acceptance criteria, and applicable performance criteria. Attach requirements to their owning issues without silently expanding a selected issue. Issue #2 remains the minimal server foundation; authentication, business persistence, and UI belong to later issues. Never reuse the old project's code, schema, or architecture.

## Current Stack and Scope — 2026-09-30

Use **Express.js, React, TypeScript, Prisma, SQLite, HTML, CSS, Bun, Docker, and Swift/SwiftUI**. Node.js executes the Express backend; Bun handles JavaScript/TypeScript dependencies and build scripts. Enable strict type checking and keep business rules separate from HTTP handlers and I/O. Express documents [TypeScript setup](https://expressjs.com/en/starter/installing/#typescript); select compatible maintained versions during implementation.

The backend exposes a **REST API with HTTP/JSON** and remains the sole authority for business rules, validation, mutations, and SQLite persistence through **Prisma**. React and Swift/SwiftUI consume one versioned OpenAPI contract, with runtime input validation and coherent errors. Streaming/SSE complements REST only where the owning responsibility needs it. Select the compatible Prisma version and SQLite adapter during the owning persistence task. Do not introduce business persistence into #2 solely because the ORM is now selected.

The frontend is **React/TypeScript with HTML and CSS**. This supersedes the earlier mandatory Next.js choice; no replacement bundler is selected yet. Frontend serving topology remains to be decided. Docker deployment, persistent storage, and the native macOS Swift/SwiftUI client retain their accepted direction.

**Rust and Unreal are removed from the active stack. Games are deferred and excluded from the current application**, including game launchers, integration, assets, packaging, and game-specific progress. The owner subsequently authorized closing the existing game issues and #39 as **not planned**, with an explicit reversible-pause notice. Preserve their identifiers, original criteria, and inventory; these closures do not establish completed work. Game-only tasks are not active delivery prerequisites. Reintroduction requires an explicit owner request.

Reconcile obsolete stack requirements and game-related dependencies before implementing affected work, starting with #2. Preserve each active responsibility, Goal, applicable runtime behavior, and performance criteria. Report discrepancies explicitly; this local record does not edit the GitHub backlog.

## Optional Authentication and ChatGPT Connection — 2026-09-30

The owner authorized adding optional Google/GitHub OAuth registration and sign-in to the existing authentication backlog, plus an optional ChatGPT connection for future AI. This supersedes the historical social-login exclusion. Local username/password access and core learning remain usable offline; external authentication and remote AI require Internet.

Keep one local Nihon profile and backend-owned opaque sessions. Never merge profiles automatically by email or grant administrator rights from provider claims. Account linking requires verified ownership and reauthentication; prevent removal of the last usable sign-in method and allow an OAuth-created account to establish a local password for offline access.

ChatGPT identity and authorization to use an eligible ChatGPT plan are separate. Connecting AI does not silently replace the active profile or add a login method. Validate eligibility, consent, loopback callbacks, and distribution terms against the current official local/open-source documentation before implementation. No AI learning feature, model, prompt, billing mechanism, or authentication library is selected by this decision.

Reuse #75 for registration and its provider-verification adapter; #76 reuses that adapter for sign-in and sessions, avoiding a dependency cycle. #77 owns access isolation; #79 owns passwords, connected accounts, ChatGPT connection, and credential revocation. Coordinate #7/#9, local recovery/deletion #84/#85, REST conventions #69, credential-safe backup/restore #112/#113, installation configuration #114, and final acceptance #38 through the existing index #1. Issue #2 remains unchanged.

Never distribute confidential provider secrets in source, browser/native bundles, or Docker images. Document installation-supplied protected configuration or a validated provider-supported public-client flow; no central cloud broker is authorized. Provider credentials stay protected in the backend, excluded from DTOs, logs, and user backups. Restoring data requires fresh provider authorization rather than reviving archived tokens.

The fourteen GitHub issue edits were published as `nihon-ia[bot]` and read back exactly. They record requirements, not implemented features or successful live integrations. Preserve each issue's responsibility, Goal, dependencies, and performance evidence; measure local work separately from provider latency and human interaction. See the [OAuth backlog update report](OAUTH_BACKLOG_UPDATE_2026-09-30.md) for ownership, verification, and recovery.

## Local Deployment and Platforms

| Part | Accepted direction |
| --- | --- |
| Product target | Local use on Windows, Linux, and macOS; exact supported OS versions and hardware require validation. |
| Server | Node.js with an Express.js/TypeScript REST API in Docker; sole business and validation authority. |
| Web | React, TypeScript, HTML, and CSS; Bun dependency/build tooling; Docker serving topology and bundler remain to be decided. |
| Persistence | Prisma with SQLite, owned exclusively by the Express.js backend. SQLite is embedded, not a separate database service. |
| Tooling | Bun for JavaScript/TypeScript dependency management and scripts; Node.js for backend execution. |
| Data and resources | Persistent Docker volumes for managed data, media, and models; explicit backup and restore procedures. |
| Processing | Transcription and other non-native service workloads run in Docker. |
| Swift/SwiftUI | A native macOS client, not a prerequisite for running the server or Web client. |

Clients use the same local API and never access SQLite directly. Publish the service to the host's loopback interface by default. Core learning remains usable without Internet after installation of the required resources; operations such as YouTube import explicitly require connectivity.

Plan Linux container images for `amd64` and `arm64`, with tests on the intended host environments. Do not infer universal hardware support from a multi-architecture image.

The previous native `whisper.cpp` Metal path is not established for the Docker runtime. Use a portable CPU baseline for planning and validate optional acceleration and performance per platform. Do not silently introduce a native transcription helper as an exception to the Docker decision.

## Documentation Organization

- The root [README.md](../README.md) is the installation entry point: prerequisites, supported releases and systems, startup and shutdown, required downloads and disk space, and successful-installation checks.
- Keep architecture, technical decisions, API documentation, design-system guidance, troubleshooting, and resource provenance under `docs/`.
- Write project documentation and issue titles in English. Issue bodies use complete English first, followed by the synchronized complete French version inside a collapsed `Version française` block, matching the established PR-description convention. Preserve issue identifiers, relationships, acceptance criteria, and performance budgets during translation; report scope discrepancies separately.
- Document only implemented installation commands as usable instructions. Distinguish planned requirements, verified behavior, and unresolved limitations.
- Create specialized documents as their subject becomes concrete, keeping the README linked to them instead of duplicating the installation guide.

## Accepted Professional Delivery Requirements

### Installation and Demonstration

Provide a short, verified installation path and versioned releases. Explain required resource downloads and storage before first use. Prepare a small demonstration dataset without personal data, allowing the implemented review, kanji, and media workflows to be explored. Use content with appropriate redistribution rights and the normal backend API and data path.

### Design System

Build reusable components progressively with the implemented features. Document:

- Semantic color roles, typography for Latin and Japanese text, spacing, shapes, icon conventions, and readable content surfaces.
- Primary and secondary actions, form controls, badges, tabs, dialogs, notifications, and paginated lists, followed by Nihon-specific learning and media components.
- Relevant states: default, hover, keyboard focus, pressed, loading, disabled, error, success, empty, and recovery. Prevent accidental repeat activation and preserve layout and user input while work is pending; the Express.js backend owns mutation guarantees.
- Responsive layouts, translated labels, text enlargement, keyboard navigation, assistive-technology behavior, and a WCAG 2.2 AA accessibility target to verify on the implementation.
- Animation purpose, timing, interruption, reduced-motion behavior, and suspension of unnecessary decorative activity when hidden. Preserve the chosen visual identity without delaying input or moving controls during activation.
- An interactive component catalogue for development, showing real components and states. Tool selection is not yet fixed.

The approved homepage reference uses a rounded pink **Start review** primary button and a separate **Discover new kana** text-and-icon action. Preserve its hierarchy and compact layout when translating the design into code. Evaluate readability on the four retained backgrounds: AM / Sakura Milk, AQ / Neon Sorbet, AH / Bloom Hour, and AL / Petal Afterglow. These are retained design alternatives, not automatic authorization for four new product theme settings.

The standalone **Service unavailable** mockup remains removed from the gallery. Its original removal reflected the previous shared Rust Web/API container: a fresh navigation could not obtain that page if the container was down. Frontend hosting is now unresolved; this stack change does not reinstate the mockup. An already loaded interface may show a connection-loss state, keep the current screen and input, and retry service access. Do not add an offline cache solely to justify the discarded mockup. A failed transcription alone should not replace the entire application with an unavailable screen.

### Reproducible Delivery

Run checks appropriate to each PR and deliver identified release artifacts with release notes. Use locked dependencies and multi-stage Docker builds. Test the supported OS and architecture combinations and report untested combinations explicitly.

The current `.gitignore` allows the shared PR template but still excludes `.github/workflows/`. When implementing repository CI, make workflows versionable with a targeted change; local ignored workflows cannot run on GitHub. Publishing the contributor harness does not create application CI workflows.

### Reliability and Performance Evidence

Verify startup and shutdown, interrupted-session recovery, persistence after restart, coherent backup and restoration, and data-preserving upgrades in the relevant issues. Keep validation tied to an identified commit or release and record skipped checks honestly.

Measure startup, idle resource use, and responsiveness during heavy processing with stated hardware, software versions, and datasets. Plan pagination, streaming, bounded memory, and cancellation where applicable; preserve confirmed mutations. Fine tuning follows measurement, and the final optimization phase remains under #166 after functional delivery.

Reuse the existing backup/restore (#112–#113), diagnostics (#36), update (#116), and validation work rather than creating duplicate responsibilities.

### Maintainability and Handoff

Provide architecture diagrams, the rationale for important technical choices, API documentation, and practical troubleshooting as the implementation develops. Record the provenance and redistribution conditions of dictionaries, fonts, media, and graphical resources in documentation and required notices; this does not add a product-facing Sources and Licenses page.

A contributor should be able to install, understand, test, and continue the project using the repository documentation.

## Explicitly Excluded Proposals

- A portfolio case study, including the proposed portfolio presentation/video deliverable.
- A dedicated program of usability tests with real Japanese learners.

These exclusions do not remove automated testing, normal manual validation, accessibility checks, or the existing technical and language review roles. Reintroduce an excluded proposal only at the owner's request.

## Implementation Follow-Up

Before starting an affected realization, recheck Git and the current issue, account for these accepted decisions, and identify its applicable delivery requirements. Resolve obsolete stack, game, macOS-only, packaging, or Metal assumptions in that scope. Prisma version/adapter, testing tools, frontend bundler and hosting, exact support matrix, acceleration backends, component-catalogue tool, and verified installation commands remain to be established by their owning work.

Recording these decisions does not start implementation, create issues, publish changes, or authorize a merge.

## Issue Translation Record — 2026-09-26

The owner subsequently authorized translation of issues #1–#10 and publication of relevant existing Web mockups. All ten titles and bilingual bodies were published as `nihon-ia[bot]` and read back for exact verification. At that publication, the repository had 194 open issues and no closed issues. Existing labels, assignees, milestones, states, dependency references, and acceptance checkboxes were preserved.

Scope-review notes identify obsolete platform, Docker, service-control, administrator-channel, and unavailable-page assumptions without silently rewriting the original acceptance criteria. Issue #10 also records the unresolved difference between English mockup copy and French/Japanese product-language requirements; the latter were not changed by translating the backlog.

The initial 24 visual references were published through immutable commit `b36c16b4912469f60dead46185471394be1a18e2` and [PR #196](https://github.com/Bryan-da-silvaa/niihon/pull/196), covering six screens in AM/AQ/AH/AL and referenced by #1, #5, #7, #9, and #10. That PR subsequently completed the gallery to 108 PNGs and was merged into `main` as `3dd5ddd`, verified from Git on 2026-09-30. Issue edits at the original translation step were limited to #1–#10; later maintenance is recorded below.

## Backlog Migration Record — 2026-09-30

The owner authorized adapting every issue to the Express.js/TypeScript REST API and closing game issues as a reversible pause. All **194 issues** were updated and read back exactly as `nihon-ia[bot]`; **112 remain open**, and **82 game issues** (#39–#68, #117–#165, #191–#193) are closed as `not_planned`, not completed. Labels, assignees, milestone assignments, acceptance-checkbox states, and embedded image URLs were preserved.

The optimization lot now waits for application validation #38 rather than game delivery #68. Shared responsibilities were clarified to exclude deferred game behavior. See the [migration and recovery report](BACKLOG_MIGRATION_2026-09-30.md) for the adaptations, verification, and original-description snapshot. No application implementation, Git publication, or merge was performed.

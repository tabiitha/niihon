# Repository Guidelines

Niihon is a Japanese-learning product deployed locally on Windows, Linux, and macOS. This guide applies to Codex, including GPT-6.1 Sol. Model and reasoning selection belong in Codex configuration; preserve existing role routing unless asked to change it.

## Context and Scope

Before implementation, inspect Git and read [accepted decisions](docs/PROJECT_DECISIONS.md), the selected GitHub issue, dependencies, Goal, acceptance criteria, and Performance. If the owner supplies historical `NIIHON_PASSATION.md`, use it for unchanged context; accepted decisions supersede its platform, stack, Docker, and game assumptions. The handoff is a local historical resource, not a prerequisite for a fresh clone. Reuse context until it changes.

Keep one responsibility and Goal per realization. Preserve indexes #1 and #166; retain #39 as deferred game inventory, closed as not planned at the owner's request. Games are outside the current application scope; closed game issues are paused, not completed. Do not implement game integration or treat game-only tasks as active prerequisites. Reintroducing games requires the owner's request. Tracking parents do not block children without explicit dependencies. Report and reconcile outdated assumptions within the selected scope. Never recreate the backlog or modify or reuse the old project's code, schema, or architecture. Configuration alone does not authorize implementation.

Issue #2 covers only the server foundation: startup, availability/version, instance uniqueness, shutdown, restart, and applicable limits. Reconcile its older stack requirements with the accepted Express.js/TypeScript backend before implementation. Authentication, business persistence, and UI belong to later issues. Final optimization #166 follows functional delivery.

## Architecture and Structure

Create directories only as required:

- `apps/api`: Express.js/TypeScript REST API running on Node.js, with one HTTP/JSON OpenAPI contract for React and SwiftUI. Separate business rules from HTTP and I/O; this backend alone owns business validation, mutations, and SQLite persistence through Prisma. Validate inputs at runtime; clients never access SQLite.
- `apps/web`: React/TypeScript with HTML and CSS. Bun manages dependencies and build scripts; the bundler and frontend serving topology remain unselected. Next.js is no longer a required framework.
- `apps/macos`: native Swift/SwiftUI client for macOS.
- `contracts`, `resources`, `tests/fixtures`, `packaging/macos`: contracts, assets, fixtures, packaging.
- `README.md`: installation; `docs/`: architecture, decisions, design system, API, troubleshooting.

Server, Web delivery, and processing run in Docker with persistent data/media/model storage. Swift/SwiftUI remains native. Rust and Unreal are removed from the active stack. Bind to loopback by default. Validate platform and acceleration support; SwiftUI is not required for Web use.

## Execution and Delegation

Complete authorized work through verification. Resolve routine choices autonomously; ask when missing information materially affects scope, data loss, or authorization. Preserve unrelated work and prepare concrete results before requesting required approval.

Follow [.codex/README.md](.codex/README.md). Implementations use a coder and `tester`; specialists address relevant risks. Assign exclusive file ownership and bounded tasks, then await evidence. Reviewers remain read-only. Report unavailable delegation tools; never claim an independent review was performed without one.

Use the [engineering harness and loop](docs/engineering/README.md) for issue work. Keep a local task packet under `.local/harness/tasks/<issue>/` with the current Goal, actual authorization, acceptance map, file ownership, and checkpoint. User prompts steer the active loop; observe, implement, verify, repair, and checkpoint until the authorized outcome is handled. Record exact source/specification evidence with `tools/harness/harness.mjs`; unconfigured checks remain incomplete, and changed inputs invalidate prior evidence. Automated success never substitutes for manual acceptance, independent review, or owner approval. Improving this toolkit does not authorize implementing #2 or publishing changes.

## Style, Testing, and Performance

Use strict TypeScript and two-space indentation; members use `camelCase`, types/components `PascalCase`. Use four-space Swift indentation. Keep business rules separate from Express handlers and Prisma persistence adapters.

Check manifests first. Issue #2 must establish verified development, build, type-check, test, formatting, and lint commands for the Node.js/TypeScript API. These commands and test tools are not available yet; do not invent runnable scripts. Bun is the accepted JavaScript/TypeScript dependency and script tool; Node.js remains the backend runtime. Prisma schema, migrations, and business persistence belong to their owning issues, not #2.

Use behavior-based test names; testing frameworks and coverage thresholds remain unset. Test relevant success, failure, and recovery paths. Run proportional checks; report observed results, skipped checks, commit SHA, and additional local diff. Repeat when changes or failures justify it. Plan pagination, streaming, bounded memory/concurrency, and cancellation where applicable; preserve confirmed mutations. Tune after reproducible measurement.

## Design and Delivery

Use retained references in `docs/ux/references/` when available. Preserve the compact homepage hierarchy: rounded pink **Start review**, separate **Discover new kana**. AM/AQ/AH/AL are design alternatives, not four authorized settings. Issues determine functionality and interface languages.

Apply reusable components, responsive states, keyboard access, readable Japanese typography, reduced motion, and the WCAG 2.2 AA target. Keep installation/demo, CI/release, reliability, and provenance requirements within their owning issues. Portfolio case studies and dedicated real-learner studies remain excluded.

## GitHub Contributions

Follow [GIT_RULES.md](GIT_RULES.md). Use English documentation, identifiers, commits, branches, titles, and review comments. Issue/PR bodies use complete English followed by synchronized collapsed French. Commit/PR titles: `type(scope): description`. Branches: `codex/<type>/<issue>-<slug>` or `tabitha/<type>/<issue>-<slug>` according to ownership.

Identify the repository by its remote. For `Bryan-da-silvaa/niihon` only, use the locally configured `codex-github` launcher for AI commits, Git network operations, and GitHub CLI/API calls as `nihon-codex[bot]`. Read the [authentication guide](docs/engineering/GITHUB_IDENTITY.md). Report missing setup or authentication failures; never fall back to owner credentials, expose secrets, or alter personal configuration. Publication/merge require task authorization. Preserve history and main-branch protection.

## Code Review Rules

Flag scope expansion, client-owned business rules/persistence, unbounded work, lost confirmed mutations, broken API contracts, and inaccessible interactions. Give actionable findings and evidence.

Every PR requires independent `reviewer_final` review of the final diff. AI-authored work also requires the owner's personal approval; owner-authored work requires the AI verdict published as an eligible formal review. Record verdicts and reviewed SHA. GitHub's one-approval minimum does not replace this routing. Orchestrator self-review cannot substitute; never approve on the owner's behalf.

## OpenAI Guidance

Verified 2026-09-30: [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [GPT-6 prompting](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices), and [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Keep this file focused on durable project instructions; assess effectiveness on actual Niihon tasks.

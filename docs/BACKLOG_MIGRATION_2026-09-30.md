# Backlog Stack Migration and Game Pause

Verified on **2026-09-30** after the owner's explicit authorization. All GitHub operations used `nihon-ia[bot]` through the Niihon launcher. This maintenance implements no application feature and creates no new issues.

## Outcome

| Measure | Verified result |
| --- | --- |
| Existing issues reviewed and updated | 194 |
| Active issues remaining open | 112 |
| Game issues closed as not planned | 82 |
| Remaining former backend references in titles/descriptions | 0 |
| Titles adapted | 12 |

The paused issues are **#39–#68, #117–#165, and #191–#193**. Each contains an English pause notice with its French translation. Closure means deferred work, not passed acceptance criteria or completed implementation. Preserve the issue inventory and reopen only when the owner explicitly restores game scope.

## Stack and Contract Changes

- Replace the former backend with an **Express.js/TypeScript REST API running on Node.js**. React and native Swift/SwiftUI consume one HTTP/JSON OpenAPI contract.
- Use **Prisma with SQLite** under the backend's sole authority. Package versioned migrations with the backend; React, Swift, and auxiliary tools never access SQLite directly.
- Keep business rules separate from HTTP and I/O, validate inputs at runtime, preserve mutation guarantees, and retain pagination, bounded streaming, memory/concurrency limits, and cancellation where applicable.
- Align frontend references with **React/TypeScript, HTML/CSS, and Bun tooling**. The frontend bundler and serving topology remain unselected. Docker remains the local service deployment direction.
- Adapt native compilation, allocations, I/O, and concurrency optimization details to Node.js/TypeScript without claiming measured gains. Issue #190 now qualifies production delivery configuration rather than native compiler flags.
- Keep #2 as a minimal server foundation; business persistence, authentication, and functional clients remain separate responsibilities. OAuth was excluded at this migration step; the owner's subsequent [OAuth backlog update](OAUTH_BACKLOG_UPDATE_2026-09-30.md) supersedes that historical exclusion for its owning issues, without adding authentication to #2.

## Game Dependencies and Shared Responsibilities

The existing GitHub dependency graph contained 93 formal edges, with no active issue formally blocked by a game issue. No formal dependency edge was changed.

Replace the final optimization lot's textual game-delivery gate #68 with existing application validation **#38**. Remove deferred game prerequisites from active optimization descriptions. Clarify game applicability in shared exercise ownership (#86), backup (#112), baseline measurement (#167), processing (#185), and logs (#186). Keep game references in the inventory as paused work.

## Validation and Recovery

All 194 issue titles, complete descriptions, and states were read back and compared exactly with the expected snapshot after publication. Verify closure reason `not_planned` for all 82 paused issues. Labels, assignees, milestone assignments, acceptance-checkbox states, and embedded image URLs were compared with the original snapshot and preserved.

Original descriptions, final descriptions, exact diffs, API results, and verification data are retained in the local sibling folder `../backlog-migration-2026-09-30/` relative to the repository root. Use that snapshot for a targeted recovery; first read current GitHub content and preserve any intervening owner edits. Do not reopen games or restore obsolete architecture automatically.

No commit, push, PR creation, or merge was performed for this maintenance. Existing unrelated platform or feature decisions still require reconciliation in their owning issues when applicable; this operation is not a full backlog translation.

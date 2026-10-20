# Start an Issue

Work on existing Nihon issue #<number> only. My intended outcome is <outcome>; priority is <priority>. Unless I narrow it here, the [default authorization](../GRAPH.md#default-authorization) applies: go up to a PR ready for review with `Closes #<number>`, never approve or merge. Constraints: <constraints, or none>.

Read AGENTS.md, the accepted decisions, current issue/dependencies, and docs/engineering/. Start from an up-to-date `main` as described in [GRAPH.md](../GRAPH.md#up-to-date-main): fetch `origin`, stop if the tree has unrelated changes, resume the issue's existing branch or create one from `main` fast-forwarded to `origin/main`. Preserve unrelated work. Prepare a local task packet with one responsibility, Goal, non-goals, allowed files, and an acceptance-to-evidence map. Qualify actual commands; do not invent application scripts.

Assign implementation, validation, and independent review according to difficulty and relevant risks. AI delegation is optional; if used, follow the user's local configuration. Assign exclusive file ownership and await real reports. Report unavailable requested tools or reviewers and leave their checks pending.

Implement the bounded behavior, run meaningful checks, observe results, and repair failures until the authorized Goal is met. Record stable evidence with the harness, plus applicable manual/performance observations. Preserve pagination, streaming, memory limits, cancellation, and confirmed mutations where applicable. Keep checkpoints concise. Before the harness gate, update the branch if `origin/main` moved and rerun the harness. Do not widen scope, weaken checks, claim unexecuted validation, or publish/merge outside my actual authorization.

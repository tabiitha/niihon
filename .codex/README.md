# Niihon Agent Organization

This configuration applies to `Bryan-da-silvaa/niihon`. The main task is the orchestrator, using GPT-6 Astra with `ultra` reasoning. Files in `agents/` define subagents; no separate orchestrator file is needed.

## Current Stack and Scope

Accepted on 2026-09-30: Express.js/TypeScript on Node.js, React/TypeScript with HTML/CSS, Prisma/SQLite, Bun tooling, Docker deployment, and native macOS Swift/SwiftUI. The backend alone owns business rules, validation, mutations, and SQLite persistence. Rust and Unreal are removed from the active stack; games and their integration are deferred. Next.js is no longer required; frontend bundler and serving topology remain open. Read [accepted project decisions](../docs/PROJECT_DECISIONS.md) before applying older handoff or issue text. Keep #2 limited to the server foundation; business persistence belongs to later issues. Configuration does not start implementation or authorize publication.

## Roles and Model Selection

Only `gpt-6.1-sol` and `gpt-6-astra` are permitted for Niihon development agents, including explicit launches and fallback delegation. This is an agent policy, not a choice of AI models for future product features.

| Agent | Model | Reasoning effort | Use |
|---|---|---|---|
| Main orchestrator | GPT-6 Astra | `ultra` | Scope, delegation, arbitration, and authorized integration. |
| `coder_light` | GPT-6.1 Sol | `low` | Mechanical, local changes with explicit requirements. |
| `coder_standard` | GPT-6.1 Sol | `high` | Routine Express/React/Prisma implementation; default coder. |
| `coder_complex` | GPT-6 Astra | `xhigh` | Concurrency, lifecycle, transactions, recovery, or difficult integration. |
| `tester` | GPT-6.1 Sol | `medium` | Run checks, reproduce failures, and write targeted tests. |
| `reviewer_final` | GPT-6 Astra | `ultra` | Independent review of the final diff and evidence. |
| `researcher` | GPT-6.1 Sol | `medium` | Focused repository, issue, and official-documentation research. |
| `performance` | GPT-6 Astra | `high` | Measurement protocol, applicable budgets, and interpretation. |
| `security_data` | GPT-6 Astra | `xhigh` | Permissions and data durability guarantees. |
| `ux_reviewer` | GPT-6 Astra | `high` | Web and SwiftUI journeys, states, and accessibility. |
| `language_reviewer` | GPT-6 Astra | `high` | Japanese, French corrections, and pedagogical consistency. |

Updated on 2026-09-30. GPT-6.1 Sol's identifier and `low`/`medium` efforts are documented by [OpenAI](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Existing Astra efforts, including `ultra`, appear in the local Codex model catalogue. API reasoning options and Codex options can differ; do not copy client-specific settings into API requests.

The role files set both `model` and `model_reasoning_effort`. Custom role settings take precedence over resolved spawn defaults, as described in the [official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents). Choose the appropriate named role rather than assuming a prompt changes its pinned effort. The general fallback remains `gpt-6-astra` with `high` reasoning.

Retired model names and pending migrations have been removed from active routing. Check model access and role discovery in a new session; a valid configuration does not prove successful loading or a real subagent launch. If a permitted model is unavailable, report it instead of silently substituting another model. These files do not change the model of an already running task.

## Delegation Protocol

For a normal implementation issue, use the main orchestrator, one coder, `tester`, and independent `reviewer_final`. Add `researcher`, `security_data`, `performance`, `ux_reviewer`, or `language_reviewer` only for an explicit question, changed boundary, or applicable acceptance criterion. Small documentation corrections may stay in the main task; publication still follows the PR approval gates. Keep the existing concurrency limit rather than launching every available role.

Use Sol high as the routine coding baseline and Astra xhigh for demonstrated complexity or high-impact failure modes. Assess routing on actual tasks: record model/effort, task type, observed duration and available resource usage, failed verification iterations, and blocking review findings in the task packet. Treat these as observations, not proof of quota savings or model superiority; do not rerun completed work merely to manufacture comparisons.

1. **Frame.** Inspect Git, accepted decisions, historical context, and the current issue: responsibility, dependencies, Goal, acceptance, and Performance. Delegate implementation when separation adds useful verification. Simple questions and documentation corrections can stay in the main task.
2. **Assign.** Give each agent a bounded task, allowed files, invariants, starting version, expected checks, and reporting format. Assign one writer per file. The orchestrator handles authorized Git operations and integration.
3. **Implement and prepare validation.** Choose the coder by difficulty and failure impact. The coder supplies meaningful tests. The tester can prepare scenarios in parallel, then run checks on a stable version. Routine test execution stays with `tester` at Sol medium. Difficult concurrency, authorization, transaction, and recovery scenarios need explicit design by the orchestrator or a bounded `coder_complex` mission; `security_data` can advise in read-only mode. Assign test files exclusively, then have `tester` execute the scenarios. Do not assume tests are easy or try to override a role's pinned effort through its prompt.
4. **Verify.** Use specialists for relevant issue risks or criteria. Assign distinct test files to concurrent writers. Run performance measurements without competing builds or heavy processing.
5. **Review.** Give the stable diff to `reviewer_final`, independently of the coder. Supply the issue, diff, evidence, and exact version; require direct inspection. Review agents remain read-only and return findings to the orchestrator.
6. **Consolidate.** Await required reports, resolve findings, and correct defects. Repeat affected checks and review after corrections. Before calling a PR ready, verify that evidence matches its latest commit. Local review does not publish a GitHub review, merge, or close an issue.

Each report states the result, affected files, observed evidence, skipped checks, and remaining work. Identify HEAD and uncommitted changes: identical HEAD values can cover different working-tree diffs.

Follow the [engineering harness and loop](../docs/engineering/README.md) for task packets, checkpoints, verification evidence, and prompt-driven steering. Changed inputs invalidate previous evidence; automated success does not replace independent review or owner approval.

## Delivery Responsibility

When the selected issue owns Docker, CI, installation, or updates, explicitly assign delivery implementation and documentation to its coder and reproducible validation to `tester`. Check installation from a disposable fresh checkout with versioned inputs and documented prerequisites, container build/start/stop/restart, persistent data, applicable update/recovery behavior, and existing CI evidence. Use isolated test data and volumes; record OS/architecture and untested combinations. Ignored local files are not available after a fresh clone. Local checks do not prove a GitHub workflow ran.

These responsibilities do not start new infrastructure, expand #2, change ignore rules, or authorize publication. Use the existing coder/tester roles; a dedicated delivery role is deferred unless repeated tasks demonstrate a need. Architecture coordination remains with the orchestrator and implementation documentation with the coder.

## Branch Ownership

Use `tabitha/<type>/<issue>-<slug>` for work the owner undertakes personally and `codex/<type>/<issue>-<slug>` for agent tasks, for example `tabitha/feat/2-server-foundation` or `codex/feat/2-server-foundation`. Preserve English naming, issue scope, and an existing owner branch unless a handoff is requested.

Branch prefixes do not select credentials or establish the GitHub PR author. Verify the authenticated identity before publication.

## Pull Request Approval Gates

Apply these requirements to every PR, including documentation:

- Owner-authored contribution: independent `reviewer_final` approval of the final diff.
- AI-authored contribution: both the owner's personal approval and independent `reviewer_final` approval of the final diff.

Record the AI verdict and reviewed SHA for both routes, plus the owner's approval evidence for AI contributions. Select the route by contribution authorship; AI work published with owner credentials still requires both reviews. Resolve blocking findings and await required approvals even when GitHub enables merging.

`reviewer_final` stays read-only; an authorized orchestrator publishes its actual report. For owner-authored PRs, the AI verdict must be submitted as an eligible formal approval using a separate reviewer identity. For AI-authored PRs, the owner's GitHub approval can satisfy the single formal approval minimum, with the independent AI verdict recorded alongside it. The orchestrator's summary cannot substitute for either reviewer.

The recorded `Protect main` ruleset requires one eligible approval and dismisses stale approvals after reviewable code changes; recheck current protection before integration. It does not enforce these author-dependent requirements, and no automated routing check is installed. A local report alone is not a GitHub approval. Never submit the owner's approval on their behalf or approve from a coder's self-report.

All Codex roles share `nihon-codex[bot]` for this repository. Verify actual PR authorship and formal approval evidence. Counted App approval eligibility on an owner-authored PR remains to be verified; keep integration pending when required approval is missing. Follow [GIT_RULES.md](../GIT_RULES.md) for protections, complete English plus collapsed French descriptions, and English squash messages.

## GitHub Identity

This rule applies only to `Bryan-da-silvaa/niihon`, including clones and worktrees. Use the locally configured `codex-github` launcher for AI commits and Git/GitHub network operations. The launcher obtains a repository-restricted installation token and sets bot commit metadata for its child command. Preserve personal Git/GitHub settings; never fall back to owner credentials or expose secrets.

```sh
"$NIIHON_GITHUB_LAUNCHER" status
"$NIIHON_GITHUB_LAUNCHER" git push -u origin codex/feat/2-server-foundation
"$NIIHON_GITHUB_LAUNCHER" gh pr create --base main --title 'feat(server): add the local HTTP server foundation' --body-file /absolute/path/pr-body.md
```

These are examples, not implementation or publication authorization. Read the [authentication guide](../docs/engineering/GITHUB_IDENTITY.md). Other projects follow their own authentication rules. Configure `NIIHON_GITHUB_LAUNCHER` locally as described in the guide; the launcher and credentials are not bundled here.

## Limits and Scope

- Keep at most three subagents open concurrently, excluding the orchestrator; close completed agents before opening more.
- Subagent files disable nested delegation. Specialists are available roles, not mandatory steps for every issue.
- Session permissions remain applicable. Review roles request a read-only sandbox and also explicitly prohibit edits because parent settings may take precedence.
- Never invent tests or measurements, silently widen an issue, recreate the backlog, or reuse the old project.
- #2 covers startup, availability/version, instance uniqueness, shutdown, restart, applicable limits, and evidence. Authentication, business persistence, and clients belong to later issues. Keep #39 as paused game inventory.
- Configuration does not prove delegation occurred. If subagent tools are unavailable, report the limitation and continue only work possible in the main task.

## Usage

Open a task in this trusted repository and use the named roles. The model picker and explicit launch settings may override project defaults; check the actual orchestrator model. Keep launches within the two-model policy.

Example prompt:

> Work only on issue #2 using Niihon roles. Select the coder by difficulty, have `tester` verify the tests and `reviewer_final` review the final diff. Assign files explicitly, await reports, and provide evidence for the final version.

After role changes, verify discovery in a new session. Configuration loading and actual subagent execution are separate checks.

References: [custom subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

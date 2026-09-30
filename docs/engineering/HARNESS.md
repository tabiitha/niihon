# Development Harness

## Responsibilities

The harness supplies reliable context and feedback around one existing GitHub issue. `AGENTS.md` is the short routing entry point; accepted decisions hold durable architecture; GitHub holds the task inventory; a local task packet records the current assignment. Contributors implement bounded work and obtain independent review; AI delegation is optional. The CLI records automated evidence; it does not dispatch models, call GitHub, publish contributions, or approve a merge.

Use Node 22 or newer and Git. No npm package or product manifest is required. Run from the checkout:

```sh
node tools/harness/harness.mjs doctor
node tools/harness/harness.mjs snapshot
node tools/harness/harness.mjs run tools/harness/self-check.json
```

The self-check tests the harness in temporary repositories. Its green result says nothing about Niihon application readiness. `doctor` reports Bun and application-manifest presence, not a validated build or successful subagent launch. Node commands here are developer-tool commands; Bun's application role remains unchanged.

## Issue-Specific Checks

Copy `templates/verification-spec.json` to `.local/harness/tasks/<issue>/verification.json` and replace its Goal/criteria with the current issue. Map each applicable criterion to meaningful tests; empty mappings remain incomplete, including manual acceptance not encoded in a check. Mark a check configured only after qualifying its actual command from a manifest or an observed executable.

Each configured check supplies an argv array, repository-relative cwd, required paths, finite timeout, and log ceiling. It runs without a shell, sequentially. Keep fixtures isolated from personal data. Report exactly what a test proves; a command returning zero does not establish that its assertions faithfully cover the Goal. Independent review inspects that mapping and any manual evidence separately.

```sh
node tools/harness/harness.mjs run .local/harness/tasks/2/verification.json
node tools/harness/harness.mjs compare .local/harness/runs/<run>/report.json .local/harness/tasks/2/verification.json
```

Paths with `<run>` are placeholders. Running the untouched application template produces `incomplete` and exit code 1. Publication authorization, required review, and manual/performance evidence are additional workflow gates, even after automated checks pass.

## Evidence and Invalidation

Each run creates a new directory under `.local/harness/runs/` with a specification copy, bounded logs, and `report.json`. It records exact arguments, exit codes, timing, missing checks, runtime, HEAD, index/status digests, and content fingerprints before/after. Untracked source and selected ignored instructions/role files participate; generated `.local/` data does not. Environment values and source contents are not stored in snapshots.

| Status | Meaning |
| --- | --- |
| `passed` | Mapped automated checks passed on unchanged captured input. |
| `failed` | A required/mapped check failed or timed out. |
| `incomplete` | Required execution, configuration, or criterion coverage is missing/cancelled. |
| `stale` | Captured source changed during the run. |

`compare` needs both the report and current specification. Changed code, staged content, untracked files, role instructions, Goal, or check definition invalidate reuse. Commit/stage operations also change the fingerprint; verify the published commit rather than treating an earlier dirty-tree report as evidence of that commit. New GitHub issue wording or external environment changes require rereading/updating the task specification; the offline CLI cannot detect them automatically.

## Resource Limits and Boundaries

Limits: 32 checks, 128 criteria, five minutes maximum per check, 1 MiB maximum retained output per check, 20,000 snapshot entries, 256 MiB streamed input hashing, and 8 MiB maximum Git command output. Missing executables never pass. Cancellation/timeouts terminate the harness-owned process group on POSIX or request tree termination on Windows. Detached processes, containers, and servers need their fixture's explicit cleanup; this is not an OS sandbox. A forcefully killed harness may leave partial evidence, which must never be reused as a passed report.

Logs are local and capped, with owner-only permissions on POSIX. Commands must not print secrets or put them in argv; the runner cannot guarantee redaction. Do not commit evidence or alter the live product database to run checks. Snapshot consistency assumes exclusive file ownership while testing; before/after hashing is not an immutable filesystem mount or tamper-proof attestation. Inspect original logs and reports during review.

Preparation tests qualify this tool on the observed macOS/Node environment. Windows/Linux execution and product verification remain separate checks. Optional AI configuration and discovery belong to the user's local setup. If a requested reviewer or tool is unavailable, report the gap; an implementation author's own check never becomes an independent review. The harness works without `.codex/` files, an AI account, or delegation tools.

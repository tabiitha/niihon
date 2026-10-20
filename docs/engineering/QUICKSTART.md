# Contributor Quickstart

One page for people contributing to Nihon, with or without an AI assistant. The detailed rules live in the linked guides; when they disagree with this page, they win.

## Before You Start

- Install Git and Node 22 or newer. Run `node tools/harness/harness.mjs doctor` from the checkout.
- Read [AGENTS.md](../../AGENTS.md) and the [accepted decisions](../PROJECT_DECISIONS.md) once.
- Work only on an existing GitHub issue. Read its Goal and acceptance criteria; do not widen them.
- For agents, “do issue #N” is enough to go up to a PR ready for review without asking; approval and merge stay with the owner ([default authorization](GRAPH.md#default-authorization)).

## For One Issue

1. **Branch** from an up-to-date `main` (`git fetch origin`, `git switch main`, `git merge --ff-only origin/main`; resume the issue's branch if it already exists): `tabitha/<type>/<issue>-<slug>` for the owner's personal work, `nihon-ai/<type>/<issue>-<slug>` for agent work, for example `nihon-ai/feat/2-server-foundation` ([Git rules](../../GIT_RULES.md)).
2. **Plan the evidence**: copy [`templates/verification-spec.json`](templates/verification-spec.json) to `.local/harness/tasks/<issue>/verification.json`, and map each acceptance criterion to the check that proves it. Keep a [task packet](templates/task-packet.md) in the same folder: it records where you are so that you, or someone else, can resume.
3. **Work in small steps**: one criterion at a time, with its tests. Commit when its checks pass, as `type(scope): description` with `Refs: #<issue>`.
4. **Collect evidence**: `node tools/harness/harness.mjs run .local/harness/tasks/<issue>/verification.json`. `passed` means the mapped checks passed on unchanged files; `failed` means a check failed or timed out; `incomplete` means something is missing or not configured; `stale` means files changed during the run.
5. **Open a draft PR** with the [PR template](../../.github/pull_request_template.md) and `Closes #<issue>` in its footer: English sections first, then the full French translation in the collapsed block. Report what you actually ran, including what you skipped and why. Before marking it ready for review, update the branch if `origin/main` moved ([how](GRAPH.md#up-to-date-main)), commit everything, and check that `node tools/harness/harness.mjs gate .local/harness/tasks/<issue>/verification.json` allows it.
6. **Get it reviewed**: someone other than the PR author must review the final diff and approve it on GitHub. Passing checks never replace that review.

## Good to Know

- Evidence and task files stay in `.local/` and are never committed.
- Personal AI configuration stays on your machine; no assistant, model, or setup is required.
- Stuck on the same failure twice? Change your hypothesis or ask, rather than rerunning the same command. The [loop guide](LOOP.md) describes the working cycle, and the [issue control graph](GRAPH.md) shows every step from issue to merge.
- Tool details and limits: [harness guide](HARNESS.md).

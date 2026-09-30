# Engineering Harness and Working Loop

Niihon's development harness combines durable context, bounded verification tools, issue-specific acceptance evidence, and independent review. The working loop uses the owner's prompts to set direction and correct the next step; routine implementation and repair continue within the authorized issue.

## Entry Points

| Need | Entry point |
| --- | --- |
| Architecture, scope, and decisions | [Accepted decisions](../PROJECT_DECISIONS.md) |
| Model routing and agent responsibilities | [Existing agent workflow](../../.codex/README.md) |
| Tools and evidence semantics | [Harness guide](HARNESS.md) |
| Prompt-driven iteration and recovery | [Loop guide](LOOP.md) |
| One bounded issue assignment | [Task packet](templates/task-packet.md) |
| Checks mapped to acceptance criteria | [Verification specification](templates/verification-spec.json) |
| Start / steer / repair / resume / review | [Prompt catalogue](prompts/README.md) |

## Current Readiness

The repository has no runnable Niihon application yet. The harness itself can be tested now with Node and Git; no dependency installation, OpenAI API key, or background automation is needed. Product build, type-check, lint, runtime tests, and performance fixtures must be established by their owning issues. Bun remains the accepted project tooling and was unavailable on the preparation machine; this does not change the stack.

`tools/harness/`, this documentation, `AGENTS.md`, `GIT_RULES.md`, the shared `.codex/` configuration/roles, and the PR template are versioned for reuse from a fresh clone. Generated runs and task state stay in the ignored `.local/harness/`; additional local Codex settings and GitHub workflow files remain ignored. Bot credentials and its launcher are external prerequisites, described in the [identity guide](GITHUB_IDENTITY.md). Configuration presence does not prove runtime discovery or authorize implementation/publication.

## Sources and Interpretation

This arrangement applies OpenAI's [plan–edit–verify–observe–repair loop and durable task context](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex), [layered repository instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md), and [subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents) to Niihon's existing issue/review rules. The task packet, evidence fingerprint, and bounded CLI are project-specific implementations, not claims that Codex automatically enforces every rule. Command execution and regression tests use [Node child processes](https://nodejs.org/api/child_process.html) and the [native test runner](https://nodejs.org/api/test.html).

# OAuth Backlog Update — 2026-09-30

The owner authorized optional Google/GitHub registration and sign-in, plus an optional ChatGPT connection for future AI. Fourteen existing GitHub issues were updated as `nihon-codex[bot]`; no issue was created or closed.

| Responsibility | Existing issues |
| --- | --- |
| Scope and coordination | #1, #7, #9 |
| Registration, sessions, permissions | #75, #76, #77 |
| Credentials, linked accounts, ChatGPT consent | #79 |
| Local password recovery and account deletion | #84, #85 |
| REST contract conventions | #69 |
| Credential-safe backup and restore | #112, #113 |
| Installation and provider configuration | #114 |
| Offline learning and online integration acceptance | #38 |

Local account access remains available offline. ChatGPT identity and AI permission are separate, and actual eligibility must be validated before implementation. No AI learning feature or authentication library was selected. Registration owns its provider-verification adapter; sign-in reuses it without a dependency cycle. Issue #2 and paused games remain outside this change.

All fourteen issues use English titles and complete English descriptions followed by collapsed French translations. Existing visual references were preserved; their owning issues describe the OAuth controls and states to add.

## Verification and Recovery

A final read of all 194 issues confirmed exact title/body matches for the fourteen updates, unchanged descriptions for the other 180 issues, and preserved states, labels, assignees, milestone assignments, and embedded image URLs. The backlog remains **112 open / 82 closed**. Existing acceptance checkbox states and dependency identifiers were retained; new requirements remain unchecked. Performance budgets were preserved, with local work measured separately from provider latency and human interaction.

Original descriptions, the publication plan, request/readback snapshots, the diff, and `verification.json` are retained in the maintainer's local sibling folder `../oauth-backlog-2026-09-30/` relative to the repository root. Those local recovery artifacts are not distributed with the repository. If rollback is requested, obtain them from the maintainer and restore only the affected title/body fields after checking for newer edits.

These are planning changes, not implementation or successful live-provider tests. No Git commit, push, PR change, or merge was performed.

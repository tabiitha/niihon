# Git Rules — Niihon

These rules apply to all contributors and agents. Preserve existing published history, including legacy `[ADD]: ...` commits.

## Language and Conventions

Use English for branch names, complete commit messages, PR titles, review comments, issue titles, release notes, technical documentation, identifiers, and code comments. PR descriptions use the bilingual layout below: English first, followed by a complete, collapsed French translation. Issue descriptions follow the same language order with a `Version française` block, while retaining the sections appropriate to each issue. Keep both languages synchronized, preserve existing issue references and the established backlog, and report scope discrepancies separately from translation.

Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) and [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow): a short-lived branch, a PR targeting `main`, review, then merge.

English, mandatory scopes, the length limit, and branch naming below are Niihon policies. Conventional Commits does not standardize branch names or PR descriptions.

| Item | Required format | Example |
| --- | --- | --- |
| Commit | `type(scope): description` | `feat(server): add the local HTTP server foundation` |
| Owner branch | `tabitha/<type>/<issue>-<slug>` | `tabitha/feat/2-server-foundation` |
| Agent branch | `codex/<type>/<issue>-<slug>` | `codex/feat/2-server-foundation` |
| PR title | `type(scope): description` | `feat(server): add the local HTTP server foundation` |

## Types and Scopes

Use these lowercase types:

| Type | Purpose |
| --- | --- |
| `feat` | New functionality |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Code formatting without behavior changes; not a visual interface change |
| `refactor` | Restructuring without functional changes |
| `perf` | Performance improvement supported by measurements |
| `test` | New or corrected tests |
| `build` | Build system, packaging, or application dependencies |
| `ci` | Continuous integration and its tools |
| `chore` | Repository or tooling maintenance outside the other categories |
| `revert` | Explicit reversal of a change |

Choose one scope matching the primary responsibility: `core`, `server`, `db`, `api`, `web`, `macos`, `assets`, `packaging`, `ci`, `deps`, `repo`, or `agents`. Use `repo` for shared conventions and `agents` for `.codex/`. Games are deferred; do not use `games` for active implementation. Add a scope only when none fits, updating this list.

## Commit Messages

- Limit the subject to 100 characters. Start the description with a lowercase imperative verb (`add`, `fix`, `ignore`), without a trailing period, emoji, or `WIP` prefix.
- Keep one coherent change per commit, including its necessary tests. Avoid vague subjects such as `update files`.
- Add a body when the motivation or consequences need explanation. Write the subject, body, and footer explanations in English. Separate subject, body, and footers with blank lines.
- Reference the existing issue with `Refs: #N`. Reserve automatic closure for the PR description.

Example contribution to #2:

```text
feat(server): add the local HTTP server foundation

Expose server availability and version so clients can check
that the local process responds.

Refs: #2
```

For a breaking change to an existing contract, Niihon requires both `type(scope)!: description` and a `BREAKING CHANGE: ...` footer explaining impact and migration. For a reversal, use `revert(scope): revert ...` and identify the reverted SHA in the body.

## Branch Names

Branch from an up-to-date `main`. Use the real issue number without `#`, followed by a short English slug in lowercase ASCII with hyphen-separated words. The type describes the intended PR outcome; individual commits may use different types.

Use `tabitha/` for tasks the owner undertakes personally and `codex/` for tasks assigned to agents. These prefixes identify task ownership only: they do not select credentials, change the PR author, or create a bot identity. When assisting with an existing owner branch, preserve its name and ownership unless the owner requests a handoff. Do not create duplicate branches for the same task by default.

Keep one responsibility and one selected issue per branch. Respect its Goal and scope; never recreate the backlog. For explicitly requested maintenance without an existing issue, use `no-issue`: `tabitha/docs/no-issue-git-rules` or `codex/docs/no-issue-git-rules`, according to task ownership.

## PR Titles and Descriptions

Write the title in English, describing the final result and following commit subject rules so it can become the squash commit subject. Use Draft status while work is incomplete, and update the title and description as the change evolves.

Complete the [PR template](.github/pull_request_template.md). Show these six sections in English first:

1. **Context and Outcome**: the concrete problem and resulting behavior.
2. **Issue and Goal**: reference, objective, and completed or outstanding acceptance criteria.
3. **Changes**: changes relevant to review; screenshots for visual changes.
4. **Validation**: commands or scenarios, results, skipped checks with reasons, and the verified SHA.
5. **Performance**: issue criteria, measurements, and reproducible conditions; pagination, streaming, limits, and cancellation where applicable.
6. **Risks and Recovery**: known limitations, compatibility, migration, and rollback where needed.

After the English sections, add one `<details>` block labeled `<summary>Version française</summary>`. Repeat all six sections inside it with their complete French translation, including validation results, limitations, and screenshot captions. Leave the block collapsed by default: do not add the `open` attribute. Keep a blank line after `</summary>` and before `</details>` so Markdown renders correctly.

Keep both versions synchronized whenever the PR changes. They must convey the same facts, measurements, risks, and outstanding work. Preserve commands, paths, identifiers, SHAs, and numerical values exactly in the translation.

Write `Not applicable — <reason>` and `Sans objet — <raison>` for sections that do not apply. Never present a planned check as executed. Evidence in both languages must match the latest commit; identify any additional local diff.

Place the issue reference once in a shared footer after `</details>`. Use `Closes #N` only when the realization meets its Goal and every acceptance criterion. Otherwise, use `Refs: #N` and explain the remaining work in both versions. For maintenance without an issue, identify the owner request instead of inventing an issue. GitHub closes issues referenced with closing keywords when the PR merges into the default branch. A child PR must not close tracking indexes #1, #39, or #166. See [GitHub issue linking rules](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

## Review and Integration

Before publication, inspect `git status --short`, the working diff, and `git diff --cached`. Stage the relevant files explicitly; preserve other contributors' changes and exclude secrets and generated files.

Apply these review requirements to every PR, including documentation changes:

| Contribution author | Required reviewers before merging |
| --- | --- |
| Owner working personally (`tabitha/`) | `reviewer_final` must independently review and approve the final diff. |
| Codex or another AI (`codex/`) | The owner must personally review and approve, and independent `reviewer_final` must review and approve the final diff. Both are mandatory. |

Record the `reviewer_final` verdict and reviewed SHA for either route. For AI-authored PRs, also record the owner's personal approval and its evidence; a positive AI verdict alone is insufficient. Wait for all required reviews and resolve blocking findings before merging, even if GitHub already enables the merge button. The orchestrator coordinates implementation, collects evidence, and integrates changes; its summary is not an independent review and cannot replace either required reviewer.

GitHub still requires only one eligible formal approval from an identity other than the PR author. For owner-authored PRs, publish the actual `reviewer_final` verdict under a separate eligible reviewer identity to satisfy that minimum. For PRs published under an AI identity, the owner's personal GitHub approval can satisfy the minimum, with the independent AI verdict recorded alongside it; a second formal GitHub approval is not required by the ruleset. A local AI report alone does not count as a GitHub approval.

Select the review route from who authored the contribution and verify the actual GitHub PR author for approval eligibility. Branch prefixes do not establish identity. AI work published with the owner's credentials still requires both reviews; do not use that credential mismatch to waive the owner's review or submit a self-approval. Resolve identity and eligibility issues before treating the approval workflow as complete.

Follow the validation workflow in [AGENTS.md](AGENTS.md) and [.codex/README.md](.codex/README.md). Resolve blocking findings and refresh affected checks and reviews before merging. Record the reviewed SHA, findings, and actual approval evidence. Never publish an approval on the owner's behalf or convert a coder's self-report into an independent approval.

Prefer **Squash and merge** to produce one coherent commit per PR on `main`. Check the proposed message: reuse the conventional PR title and retain useful explanations and footers in English. Exclude the French translation and its HTML wrapper from the squash message. GitHub's `(#PR-number)` suffix is allowed outside the 100-character limit. Message defaults depend on the repository's [squash settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests).

Delete the completed topic branch after merging. Correct `main` through a PR containing a new commit or revert instead of rewriting its history. Do not disable or bypass branch protection as part of a routine push or merge.

## Main Branch Protection

The [Protect main ruleset](https://github.com/Bryan-da-silvaa/niihon/rules/23107348) is active for `refs/heads/main`. It requires a PR for changes and blocks force pushes and branch deletion. The bypass list is empty, including for administrators and integrations.

GitHub requires at least **one approving review**. Approvals are dismissed when new reviewable commits change the diff. An eligible GitHub reviewer other than the PR author must approve; a local agent report alone does not count. The ruleset does not mandate a specific reviewer identity and does not require CI checks yet. It does not enforce the author-dependent review policy above: the orchestrator must check the required AI verdict and, for AI-authored PRs, the owner's personal approval before merging. This conditional requirement is currently enforced through local workflow instructions, not an automated GitHub check.

The `nihon-codex` GitHub App is installed on this repository. All Codex agents share `nihon-codex[bot]`; use the locally configured `codex-github` launcher for AI commits and Git/GitHub network operations. The launcher supplies repository-scoped installation credentials and bot commit metadata without changing personal Git/GitHub settings. See the [authentication guide](docs/engineering/GITHUB_IDENTITY.md). Do not publish through the owner's CLI credentials or a connector authenticated as the owner. The shared bot cannot approve its own PR. Counted approval eligibility must still be verified on an actual owner-authored PR; installing the App alone does not prove that a review satisfies protection. See [GitHub review requirements](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).

## Applying These Rules

Branch protection is enforced by GitHub through the ruleset above. Naming and description conventions remain contributor and agent instructions; no naming hook or CI check is installed. This guide and `.github/pull_request_template.md` are versioned. Agents must read the template when preparing every PR, write the completed bilingual body to a temporary file, and pass it with `gh pr create --body-file <path>` or an equivalent structured API argument. GitHub's web editor uses the template after it reaches the default branch, as described in [GitHub's template documentation](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository). Workflow files remain ignored until their owning CI issue establishes and publishes them.

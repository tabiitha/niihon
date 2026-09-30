# Niihon GitHub Identity

## Repository Scope

Identify Niihon by its Git remote: `Bryan-da-silvaa/niihon`. For this repository and its worktrees, all Codex agents contribute as `nihon-codex[bot]`. Other repositories follow their own authentication rules.

Use the maintainer-provided `codex-github` launcher for agent-authored commits, Git network operations, and GitHub CLI/API operations. It supplies repository-scoped GitHub App installation credentials and bot commit metadata without changing personal Git/GitHub settings. It is an authentication adapter, not publication authorization or a sandbox.

## Local Setup

The launcher, private key, installation credentials, and machine-specific configuration are external prerequisites; this repository does not install or distribute them. Configure the launcher path locally:

```sh
export NIIHON_GITHUB_LAUNCHER="/absolute/path/to/codex-github"
"$NIIHON_GITHUB_LAUNCHER" status
```

Run inside the target checkout. For GitHub commands outside it, pass `--repo Bryan-da-silvaa/niihon` before the command; this selects authentication, not a working directory. Check the launcher status and actual repository before publication. If setup or authentication is unavailable, report the requirement and stop dependent publication; never substitute owner credentials or an owner-authenticated connector.

```sh
"$NIIHON_GITHUB_LAUNCHER" gh api /repos/Bryan-da-silvaa/niihon --jq .full_name
"$NIIHON_GITHUB_LAUNCHER" git push -u origin codex/chore/no-issue-agent-harness
"$NIIHON_GITHUB_LAUNCHER" gh pr create --draft --base main --title 'chore(agents): publish the agent workflow and verification harness' --body-file /absolute/path/pr-body.md
```

These are examples. Commit, publication, review, and merge require the owner's task authorization. Protect private keys and tokens; never include them in arguments, logs, evidence, source, or PRs.

## Review and Integration

Review roles remain read-only and return actual reports to an authorized orchestrator. The shared bot cannot approve its own PR. AI-authored contributions require independent final review plus the owner's personal approval; owner-authored contributions require independent final review and an eligible formal approval. Verify current protection and approval eligibility before integration. Follow [Git rules](../../GIT_RULES.md); never approve for the owner or bypass protection.

See GitHub's documentation for [installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation) and [required PR approvals](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).

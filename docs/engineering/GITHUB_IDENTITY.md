# Nihon GitHub Identity

## Repository Scope

Identify Nihon by its Git remote: `Bryan-da-silvaa/niihon`. For this repository and its worktrees, the maintainer's Codex agents contribute as `nihon-ia[bot]`. Other contributors use their own identities and do not need the maintainer's launcher or App credentials. Other repositories follow their own authentication rules.

For maintainer automation, use the locally configured `nihon-github` launcher for agent-authored commits, Git network operations, and GitHub CLI/API operations. It supplies repository-scoped GitHub App installation credentials and bot commit metadata without changing personal Git/GitHub settings. It is an authentication adapter, not publication authorization or a sandbox.

## Local Setup

The launcher, private key, installation credentials, and machine-specific configuration are external prerequisites; this repository does not install or distribute them. Configure the launcher path locally:

```sh
export NIHON_GITHUB_LAUNCHER="/absolute/path/to/nihon-github"
"$NIHON_GITHUB_LAUNCHER" status
```

Run inside the target checkout. For GitHub commands outside it, pass `--repo Bryan-da-silvaa/niihon` before the command; this selects authentication, not a working directory. Check the launcher status and actual repository before publication. If setup or authentication is unavailable, report the requirement and stop dependent publication; never substitute owner credentials or an owner-authenticated connector.

```sh
"$NIHON_GITHUB_LAUNCHER" gh api /repos/Bryan-da-silvaa/niihon --jq .full_name
"$NIHON_GITHUB_LAUNCHER" git push -u origin nihon-ai/chore/no-issue-agent-harness
"$NIHON_GITHUB_LAUNCHER" gh pr create --draft --base main --title 'chore(agents): publish the agent workflow and verification harness' --body-file /absolute/path/pr-body.md
```

These are examples. Commit, publication, review, and merge require the owner's task authorization. Protect private keys and tokens; never include them in arguments, logs, evidence, source, or PRs.

## Review and Integration

Reviewers inspect the final version and supply actual evidence. The shared bot cannot approve its own PR. The maintainer arranges additional integration reviews in their local workflow; AI-authored contributions also need their personal approval. Contributors do not need a specific AI tool or model. Verify current protection and formal approval eligibility before integration. Follow [Git rules](../../GIT_RULES.md); never approve for the owner or bypass protection.

See GitHub's documentation for [installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation) and [required PR approvals](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).

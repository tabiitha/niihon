# Issue Control Graph

Every Nihon issue follows the same path from intake to merge. This page names its steps (nodes), the conditions for moving between them (edges), who or what decides each move, and the state each step reads and writes. It coordinates the existing rules; it does not replace them. [LOOP.md](LOOP.md) governs the work inside **Implement**, [HARNESS.md](HARNESS.md) the evidence, and [GIT_RULES.md](../../GIT_RULES.md) publication, review, and merge. Contributors without AI follow the same graph by hand; no assistant, model, or personal setup is required.

```text
Main path:   Intake → Plan → Implement → Harness gate → Publish → Independent review → Owner decision → Merge

Side exits:  Intake ──not ready──────────────► Ask owner ──answered──► back to the asking node
             Implement ──scope question───────► Ask owner
             Implement ──budget / prerequisite─► Blocked report ──owner decides──► Implement or End
             Harness gate ──refused────────────► Implement
             Independent review ──changes──────► Implement
             Owner decision ──changes──────────► Implement
```

## State

| Artifact | Location | Written by |
| --- | --- | --- |
| Task packet | `.local/harness/tasks/<issue>/task-packet.md` ([template](templates/task-packet.md)) | Intake, then every node |
| Verification spec | `.local/harness/tasks/<issue>/verification.json` ([template](templates/verification-spec.json)) | Intake, Plan |
| Evidence reports | `.local/harness/runs/<run>/report.json` | `harness run` during Implement |
| Commits | the issue branch | Implement (one per verified iteration) |
| Pull request | GitHub | Publish, Independent review, Owner decision |

Local state stays unversioned. The task packet is the hand-off between nodes and sessions; anything not recorded there or in Git is lost on interruption.

## Nodes

| Node | Entry condition | Work | Exits |
| --- | --- | --- | --- |
| **Intake** | Owner names an existing issue; “do issue #N” grants the [default authorization](#default-authorization) unless the owner narrows it | Read the issue revision, dependencies, and decisions; check that every acceptance criterion can be mapped to a check or explicit manual evidence | **Plan** when ready; **Ask owner** otherwise |
| **Plan** | Issue ready | Fill the required task-packet sections and the verification spec; split work by criterion and mark which criteria are independent | **Implement** |
| **Implement** | Plan recorded | Run the [LOOP.md](LOOP.md) iteration, one criterion at a time, committing each verified iteration. Independent criteria may run in parallel, one writer per file | **Harness gate** when every criterion is implemented; **Blocked report** at a budget limit or unavailable prerequisite; **Ask owner** on a scope or authorization question |
| **Harness gate** | All criteria implemented and committed | `node tools/harness/harness.mjs run <spec>`, then `node tools/harness/harness.mjs gate <spec>` on a clean tree | **Publish** when the gate allows; **Implement** otherwise, with the gate's reason |
| **Publish** | Gate allowed on the commit to publish, publication authorized ([granted by default](#default-authorization) unless the owner narrowed it) | Push the branch; open or update the draft PR with the bilingual template and the evidence for that SHA | **Independent review** |
| **Independent review** | Draft PR on the gated SHA | A reviewer who did not implement the change follows [prompts/review.md](prompts/review.md) on that SHA | **Owner decision** on `ready`; **Implement** on `changes required` or `verification incomplete` |
| **Owner decision** | Independent verdict `ready` on the current SHA; PR marked ready for review | The owner reviews, approves on GitHub, or requests changes | **Merge** on approval; **Implement** on requested changes |
| **Merge** | Eligible approval on the current SHA, branch protection satisfied | Merge following [GIT_RULES.md](../../GIT_RULES.md) and delete the branch | End |
| **Ask owner** | Unclear scope, unmapped criterion, or an action outside the recorded authorization | Write the checkpoint and one precise question | Back to the node that asked, once answered |
| **Blocked report** | Budget limit or unavailable prerequisite | Write the checkpoint and report what passes, what fails with evidence, hypotheses tried, and the decision needed ([LOOP.md](LOOP.md#default-budget)) | **Implement** when the owner extends the budget or changes the approach; End if the owner stops |

Any change pushed after **Harness gate** sends the work back through it: a new SHA needs its own passing gate, and existing review and approval no longer apply to it ([GIT_RULES.md](../../GIT_RULES.md#main-branch-protection): approvals are dismissed when new commits change the diff).

## Default Authorization

“Do issue #N”, in any language and without further restriction, authorizes the whole path up to the owner's review: implement, commit, push the branch, open the draft PR with `Closes #N`, and mark it ready for review once **Harness gate** allows the current SHA and **Independent review** returns `ready`. The agent does not ask for these steps. It never approves or merges, and the other [owner-only actions](#owner-only-actions) still need an explicit decision. The owner can narrow the authorization in the prompt, for example “inspect only” or “do not publish”; record the actual authorization in the task packet.

## Edges and Their Rules

| Edge | Condition | Decided by | Rule |
| --- | --- | --- | --- |
| Intake → Plan | Each criterion maps to a check or explicit manual evidence | Implementer | [HARNESS.md](HARNESS.md#issue-specific-checks): empty mappings stay incomplete |
| Intake → Ask owner | Unclear criterion, scope, or authorization | Implementer | [LOOP.md](LOOP.md#working-contract): never widen the issue silently |
| Implement → Implement | Next criterion or repair within budget | Implementer | [LOOP.md](LOOP.md#one-iteration) |
| Implement → Blocked report | A default or owner-defined budget limit is reached | Budget | [LOOP.md](LOOP.md#default-budget) |
| Implement → Harness gate | Every criterion implemented and committed | Implementer | [LOOP.md](LOOP.md#one-iteration) step 6 |
| Harness gate → Publish | `harness gate` exits 0 | **Code** (`harness gate`) | New rule, below |
| Harness gate → Implement | `harness gate` exits non-zero | **Code** | New rule, below |
| Publish → Independent review | Draft PR updated on the gated SHA | Implementer | New rule, below |
| Independent review → Owner decision | Verdict `ready` on the current SHA, then PR marked ready for review | Independent reviewer; marking ready guarded by `require-gate.mjs` when installed | [GIT_RULES.md](../../GIT_RULES.md#review-and-integration); [LOOP.md](LOOP.md#completion-and-feedback-into-the-harness); new rule, below |
| Independent review → Implement | `changes required` or `verification incomplete` | Independent reviewer | [prompts/review.md](prompts/review.md) |
| Owner decision → Merge | Eligible GitHub approval | Owner, **enforced by GitHub** (`Protect main` ruleset) | [GIT_RULES.md](../../GIT_RULES.md#main-branch-protection) |

### New Rules Introduced Here

1. **Gate before review.** An independent review is requested, and a PR is marked ready for review, only after `harness gate` allowed the exact commit being reviewed. The PR stays a draft until the independent verdict is `ready`, consistent with [GIT_RULES.md](../../GIT_RULES.md#review-and-integration); drafts may be opened earlier, as [GIT_RULES.md](../../GIT_RULES.md#pr-titles-and-descriptions) allows.
2. **Reviewer separation.** The independent reviewer receives the issue, the diff, the verification spec, and the reports, not the implementer's working conversation. This makes explicit the existing rule that an implementation author's own check never becomes an independent review ([HARNESS.md](HARNESS.md#resource-limits-and-boundaries)).
3. **Owner-only actions.** The actions listed under [Owner-Only Actions](#owner-only-actions) always pass through **Owner decision** and are never retried automatically.

## Failure Classification

| Failure | Recognized by | Edge |
| --- | --- | --- |
| A check fails or times out | Report status `failed` | Implement (repair, within budget) |
| Same failure repeats | Third attempt per [LOOP.md](LOOP.md#default-budget) | Blocked report |
| Missing tool, platform, or file | Check status `unavailable` | Blocked report; never counted as passing |
| Unconfigured check or unmapped criterion | Report status `incomplete` | Intake → Ask owner, or Plan if the owner already decided |
| Files changed during a run | Report status `stale` | Implement: rerun on a stable tree |
| Evidence does not match the commit | Gate reason `dirty_tree`, `no_report_for_current_content`, `environment_changed` | Implement: commit, then rerun |
| Newest run on the same content failed | Gate reason `latest_report_not_passed` | Implement; an older green run never counts |
| Missing authorization or scope question | Implementer judgment, recorded in the packet | Ask owner |
| Review findings | Reviewer verdict | Implement, then gate and review again on the new SHA |
| Interrupted session | Packet checkpoint and Git state | Resume the recorded node ([prompts/resume.md](prompts/resume.md)); check partial mutations before repeating them |

## Owner-Only Actions

These actions need the owner's explicit decision for the current task, recorded in the task packet, and are never retried automatically after a failure or interruption; check their actual state first.

- Any publication (push, PR creation, marking ready) beyond the authorization recorded at Intake (by default, the [default authorization](#default-authorization)), and every approval and merge.
- Database schema migrations and any change to the live product database.
- Adding, removing, or upgrading a dependency.
- Deleting user data, files outside the task's allowed files, or Git history.
- Changes to authentication, authorization, OAuth, credentials, or security settings, including branch protection and CI permissions.

## Enforcement Today

| Transition | Enforced by |
| --- | --- |
| Owner decision → Merge | GitHub: `Protect main` ruleset, one eligible approval, stale approvals dismissed |
| Harness gate → Publish | Code: `harness gate`; blocking only when it is run, or through the optional guard below |
| Marking a PR ready for review | Optional local guard `tools/harness/require-gate.mjs` |
| Harness self-check | CI: `.github/workflows/harness.yml` (informational, not required by the ruleset) |
| API build and tests | CI: `.github/workflows/api.yml` (informational, not required by the ruleset) |
| All other edges | Convention: this page, LOOP.md, and review |

The independent reviewer is not automated yet, and the gate does not run in CI because task specs are local. Both remain convention until their own issues add them.

## Running the Gate

```sh
node tools/harness/harness.mjs run .local/harness/tasks/<issue>/verification.json
git status --short   # must be empty: commit first
node tools/harness/harness.mjs gate .local/harness/tasks/<issue>/verification.json
```

`gate` prints JSON with `allowed`, `reason`, `head`, and the report it used, and exits 0 only when allowed. Its reasons are `passed_on_clean_head`, `no_commit`, `no_report`, `no_report_for_current_content`, `latest_report_not_passed`, `environment_changed`, and `dirty_tree`. See [HARNESS.md](HARNESS.md#harness-gate).

### Optional Guard for Assistants

`tools/harness/require-gate.mjs` refuses `gh pr ready` and `gh pr create` without `--draft` unless the gate allows the current branch. It derives the issue from the branch name (`nihon-ai/<type>/<issue>-<slug>` or `tabitha/<type>/<issue>-<slug>`) and reads `.local/harness/tasks/<issue>/verification.json`. It exits 2 with the reason on stderr when it blocks.

Any tool can call it with the command after `--`:

```sh
node tools/harness/require-gate.mjs -- gh pr ready 42
```

It also accepts the JSON that Claude Code sends to `PreToolUse` hooks on stdin. A contributor who uses Claude Code can add this to their own, unversioned `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node tools/harness/require-gate.mjs" }] }
    ]
  }
}
```

The guard matches the command text only. A review request made another way (for example through the web interface or a raw API call) bypasses it, so the convention still applies.

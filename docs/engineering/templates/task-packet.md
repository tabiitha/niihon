# Task Packet — Issue <number>

Fill the five required sections for every task. Add an optional section only when it changes how the work is done or reviewed; omit it otherwise. Write observed facts, never intended results; unknown values stay unknown.

## 1. Issue and Goal (required)

- Issue URL and revision read (updated timestamp or body digest):
- Goal, in one sentence:
- Non-goals and blocking dependencies:

## 2. Authorization (required)

- Owner instruction (inspect / implement / publish) and constraints:
- Allowed files; existing unrelated changes to preserve:

## 3. Acceptance Map (required)

| Criterion ID | Observable result | Check, fixture, or manual evidence | Status and version |
| --- | --- | --- | --- |
| A1 | Copy the actual issue requirement | Qualified command or explicitly pending | Not verified |

- Verification spec path:

## 4. Budget (required)

- Owner-defined budget or stopping condition, or `LOOP.md defaults`:

## 5. Checkpoint (required)

- Current phase and latest owner steering:
- Version: branch, HEAD, content fingerprint, additional uncommitted diff:
- Latest run report and its status; skipped checks with reasons:
- Failures, hypotheses tried, and review findings:
- Commands or processes still running, partial mutations, safe cleanup:
- Next bounded action:

## Optional Sections

Copy only the lines that apply.

- **Decisions:** accepted decisions relevant to this task.
- **Ownership and review:** implementation, validation, and independent-review owners; specialist input and reason; complex test-design owner and exclusively assigned files; delivery and fresh-checkout/CI validation owners.
- **Optional AI use:** actual delegation availability and observed model/effort; never infer a launch from configuration.
- **Performance:** pagination, streaming, memory, cancellation; measurement conditions and existing issue budgets.
- **Unavailable prerequisites:** dependencies or platforms currently unavailable.
- **Execution observations:** task type, duration, resource usage, failed verification iterations, blocking review findings.
- **Publication:** publication, review, and merge authority; independent final review, owner approval, and reviewed SHA, pending until evidenced.

Store filled packets under `.local/harness/tasks/<number>/`; do not record tokens, private keys, or personal datasets. The packet records authorization; it does not create it.

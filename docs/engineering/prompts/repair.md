# Repair an Observed Failure

Continue issue #<number>. Failure/evidence: <report path, exact command, output, expected versus actual behavior>.

First verify that the evidence matches the current source/specification. Reproduce the relevant failure, state a concrete hypothesis, and identify a check that distinguishes it from alternatives. Fix the cause within the owning responsibility and allowed files; keep assertions and acceptance requirements intact.

Rerun the failed and materially affected checks on a stable version. Record actual results, resource conditions, and remaining uncertainty. If the same attempt produces no new evidence twice, change the diagnosis or involve the relevant specialist. Keep unrelated checks reusable only when their inputs still match. Do not expand the issue or treat a missing execution as success.

# Review the Final Version

Independently review existing issue #<number> against <commit SHA / precise dirty-tree fingerprint>, its diff, current acceptance map, task packet, and verification reports. Keep this review read-only; do not change files or publish a GitHub review.

Inspect source and original evidence directly. Verify scope, observable behavior, failure/recovery paths, backend/client authority, applicable resource limits, test quality, and correspondence to the version reviewed. Check for missing runtime/manual/performance evidence; configuration or a coder's report is not proof of execution.

Return: ready, changes required, or verification incomplete. For each actionable finding give file/line, scenario, consequence, evidence, and the owning responsibility. Record the reviewed version, executed versus skipped checks, and limits. Any later change invalidates affected evidence/review. A positive verdict does not substitute for the owner's required approval or authorize merge.

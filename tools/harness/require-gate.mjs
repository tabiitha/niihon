// Optional local guard for the Harness gate of docs/engineering/GRAPH.md.
// It blocks commands that ask for review (`gh pr ready`, or `gh pr create` without `--draft`)
// unless `harness gate` passes for the current branch's issue. Draft PRs stay allowed.
//
// Usage, any of:
//   node tools/harness/require-gate.mjs -- gh pr ready 42          (wrap a command check)
//   echo '{"tool_input":{"command":"gh pr ready"}}' | node tools/harness/require-gate.mjs
//     (the stdin shape used by Claude Code PreToolUse hooks; other assistants can pass argv)
// Exit codes: 0 allowed or not a review request, 2 blocked (reason on stderr).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { gate, repositoryRoot } from './harness.mjs';

const REVIEW_REQUEST = /\bgh\s+pr\s+(ready|create)\b/;
const BRANCH_ISSUE = /^(?:tabitha|nihon-ai)\/[a-z]+\/(\d+)-/;

export function requestsReview(command) {
  const match = typeof command === 'string' ? command.match(REVIEW_REQUEST) : null;
  if (!match) return false;
  return match[1] === 'ready' ? !/\s--undo\b/.test(command) : !/\s--draft\b|\s-d\b/.test(command);
}

export function specPathForBranch(branch) {
  const issue = branch?.match(BRANCH_ISSUE)?.[1];
  return issue ? `.local/harness/tasks/${issue}/verification.json` : null;
}

export async function check(command, cwd = process.cwd()) {
  if (!requestsReview(command)) return { allowed: true, reason: 'not_a_review_request' };
  const root = repositoryRoot(cwd);
  const branch = spawnSync('git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8' }).stdout?.trim();
  const specPath = specPathForBranch(branch);
  if (!specPath) return { allowed: false, reason: 'branch_without_issue', branch };
  let spec;
  try { spec = JSON.parse(readFileSync(resolve(root, specPath), 'utf8')); }
  catch { return { allowed: false, reason: 'missing_verification_spec', spec: specPath }; }
  return { ...(await gate(root, spec)), spec: specPath };
}

function commandFromInput(args) {
  const separator = args.indexOf('--');
  if (separator !== -1) return args.slice(separator + 1).join(' ');
  if (process.stdin.isTTY) return '';
  try { return JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? ''; }
  catch { return ''; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  check(commandFromInput(process.argv.slice(2))).then((result) => {
    if (result.allowed) return;
    console.error(`Harness gate refused this review request: ${result.reason}. Run \`node tools/harness/harness.mjs gate ${result.spec ?? '<spec>'}\` for details; see docs/engineering/GRAPH.md.`);
    process.exitCode = 2;
  }).catch((error) => { console.error(`Harness gate could not run: ${error.message}`); process.exitCode = 2; });
}

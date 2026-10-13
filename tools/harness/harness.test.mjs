import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { compareReport, coverageWarnings, environment, guidanceEntries, run, runCheck, snapshot, summarize, validateGuidance, validateSpec } from './harness.mjs';

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'nihon-harness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--initial-branch=main');
  await writeFile(resolve(root, '.gitignore'), '/.local/\n/.codex/\n/.claude/\n/CLAUDE.md\n/notes/\n');
  await writeFile(resolve(root, 'source.txt'), 'initial\n');
  git('add', '.gitignore', 'source.txt');
  return { root, git };
}

const check = (overrides = {}) => ({
  id: 'behavior', required: true, configured: true,
  argv: [process.execPath, '-e', 'console.log("observed behavior")'],
  cwd: '.', requires: [], timeoutMs: 2000, maxLogBytes: 1024, ...overrides,
});
const spec = (checks = [check()]) => ({
  schemaVersion: 1, scope: 'harness', issue: 'no-issue',
  goal: 'Verify the harness behavior in an isolated repository.', checks,
  criteria: [{ id: 'C1', description: 'Observe the selected behavior', checkIds: [checks[0].id] }],
});

test('fingerprint detects working content, untracked files, and staged changes at the same HEAD', async (t) => {
  const { root, git } = await fixture(t);
  const initial = await snapshot(root);
  await writeFile(resolve(root, 'source.txt'), 'changed\n');
  const changed = await snapshot(root);
  assert.equal(changed.head, initial.head);
  assert.notEqual(changed.fingerprint, initial.fingerprint);
  assert.notEqual(changed.contentFingerprint, initial.contentFingerprint);
  git('add', 'source.txt');
  const staged = await snapshot(root);
  assert.notEqual(staged.fingerprint, changed.fingerprint);
  assert.equal(staged.contentFingerprint, changed.contentFingerprint);
  await writeFile(resolve(root, 'new.txt'), 'new evidence target');
  const untracked = await snapshot(root);
  assert.notEqual(untracked.fingerprint, staged.fingerprint);
  assert.notEqual(untracked.contentFingerprint, staged.contentFingerprint);
});

test('evidence survives staging and committing the same content, and binds to a clean commit only', async (t) => {
  const { root, git } = await fixture(t);
  const commit = (message) => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', message);
  commit('initial');
  await writeFile(resolve(root, 'source.txt'), 'tested change\n');
  const definition = spec();
  const { report } = await run(root, definition);
  assert.equal(report.status, 'passed');
  const dirty = await compareReport(root, report, definition);
  assert.equal(dirty.reusable, true);
  assert.equal(dirty.evidenceForCommit, null);
  git('add', 'source.txt');
  commit('tested change');
  const committed = await compareReport(root, report, definition);
  assert.equal(committed.reusable, true);
  assert.equal(committed.gitStateMatches, false);
  assert.equal(committed.evidenceForCommit, (await snapshot(root)).head);
});

test('a committed deletion keeps the content fingerprint of the pending deletion', async (t) => {
  const { root, git } = await fixture(t);
  await writeFile(resolve(root, 'obsolete.txt'), 'remove me\n');
  git('add', 'obsolete.txt');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'initial');
  await rm(resolve(root, 'obsolete.txt'));
  const pending = await snapshot(root);
  git('rm', '-q', '--cached', 'obsolete.txt');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'remove');
  assert.equal((await snapshot(root)).contentFingerprint, pending.contentFingerprint);
});

test('reports without a content fingerprint are never reused', async (t) => {
  const { root } = await fixture(t);
  const definition = spec();
  const { report } = await run(root, definition);
  delete report.after.contentFingerprint;
  assert.equal((await compareReport(root, report, definition)).reusable, false);
});

test('ignored agent guidance changes invalidate evidence but runtime logs do not', async (t) => {
  const { root } = await fixture(t);
  await mkdir(resolve(root, '.codex/agents'), { recursive: true });
  await writeFile(resolve(root, '.codex/agents/tester.toml'), 'model = "fixture"\n');
  const initial = await snapshot(root);
  await writeFile(resolve(root, '.codex/agents/tester.toml'), 'model = "changed-fixture"\n');
  const changed = await snapshot(root);
  assert.notEqual(changed.fingerprint, initial.fingerprint);
  await mkdir(resolve(root, '.local'), { recursive: true });
  await writeFile(resolve(root, '.local/runtime.log'), 'temporary output');
  assert.equal((await snapshot(root)).fingerprint, changed.fingerprint);
});

test('spec rejects duplicate checks, unknown mappings, unbounded timeouts, and implicit shell input', () => {
  assert.throws(() => validateSpec(spec([check(), check()])), /duplicate/);
  const badMapping = spec(); badMapping.criteria[0].checkIds = ['unknown'];
  assert.throws(() => validateSpec(badMapping), /mapping/);
  assert.throws(() => validateSpec(spec([check({ timeoutMs: 0 })])), /timeout/);
  assert.throws(() => validateSpec(spec([check({ argv: 'node --test' })])), /argv/);
  assert.throws(() => validateSpec(spec([check({ id: undefined })])), /check id/);
});

test('unconfigured required checks and uncovered manual criteria never produce green evidence', () => {
  const disabled = { id: 'pending', configured: false, required: true, reason: 'Application commands do not exist yet' };
  const definition = validateSpec(spec([disabled]));
  assert.equal(summarize(definition, [{ ...disabled, status: 'unconfigured' }], true).status, 'incomplete');
  const manual = spec(); manual.criteria[0].checkIds = [];
  assert.equal(summarize(manual, [{ id: 'behavior', required: true, status: 'passed' }], true).status, 'incomplete');
});

test('missing files and executables remain unavailable instead of being reported as passing', async (t) => {
  const { root } = await fixture(t);
  const missingFile = await runCheck(root, check({ requires: ['absent.json'] }), resolve(root, 'missing.log'));
  assert.equal(missingFile.status, 'unavailable');
  const missingCommand = await runCheck(root, check({ argv: ['nihon-nonexistent-fixture-command'] }), resolve(root, 'command.log'));
  assert.equal(missingCommand.status, 'unavailable');
});

test('nonzero exit fails and output retention stays bounded while pipes are drained', async (t) => {
  const { root } = await fixture(t);
  const failure = await runCheck(root, check({ argv: [process.execPath, '-e', 'process.exit(7)'] }), resolve(root, 'failed.log'));
  assert.equal(failure.status, 'failed'); assert.equal(failure.exitCode, 7);
  const log = resolve(root, 'volume.log');
  const noisy = await runCheck(root, check({ argv: [process.execPath, '-e', 'process.stdout.write("x".repeat(100000)); process.stderr.write("y".repeat(100000))'] }), log);
  assert.equal(noisy.status, 'passed'); assert.equal(noisy.observedLogBytes, 200000);
  assert.equal((await stat(log)).size, 1024); assert.equal(noisy.logTruncated, true);
});

test('timeout terminates a child that ignores SIGTERM', async (t) => {
  const { root } = await fixture(t);
  const result = await runCheck(root, check({ argv: [process.execPath, '-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], timeoutMs: 150 }), resolve(root, 'timeout.log'));
  assert.equal(result.status, 'timed_out'); assert.ok(result.durationMs < 3000);
});

test('cancellation releases the active check and remains incomplete', async (t) => {
  const { root } = await fixture(t);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  t.after(() => clearTimeout(timer));
  const result = await runCheck(root, check({ argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] }), resolve(root, 'cancel.log'), controller.signal);
  assert.equal(result.status, 'cancelled');
  assert.equal(summarize(spec(), [result], true).status, 'incomplete');
});

test('POSIX timeout reaches descendants in the owned process group', async (t) => {
  if (process.platform === 'win32') { t.skip('POSIX group behavior; Windows tree termination needs separate qualification'); return; }
  const { root } = await fixture(t);
  const descendant = 'process.on("SIGTERM",()=>{require("node:fs").writeFileSync("child-terminated.txt","signal observed");process.exit(0)});setInterval(()=>{},1000)';
  const parent = `require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"});process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`;
  const result = await runCheck(root, check({ argv: [process.execPath, '-e', parent], timeoutMs: 1500 }), resolve(root, 'group.log'));
  assert.equal(result.status, 'timed_out');
  assert.equal(await readFile(resolve(root, 'child-terminated.txt'), 'utf8'), 'signal observed');
});

test('check cwd cannot escape through traversal or a symlink', async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(runCheck(root, check({ cwd: '..' }), resolve(root, 'escape.log')), /escapes/);
  if (process.platform !== 'win32') {
    await symlink(tmpdir(), resolve(root, 'outside'));
    await assert.rejects(runCheck(root, check({ cwd: 'outside' }), resolve(root, 'symlink.log')), /escapes/);
  }
});

test('evidence directories reject symlinks before writing', async (t) => {
  if (process.platform === 'win32') { t.skip('Requires symlink permission on Windows'); return; }
  const { root } = await fixture(t);
  await symlink(tmpdir(), resolve(root, '.local'));
  await assert.rejects(run(root, spec()), /Unsafe evidence directory/);
});

test('stable runs record exact commands and do not fabricate independent or human review', async (t) => {
  const { root } = await fixture(t);
  const { report, reportPath } = await run(root, spec());
  assert.equal(report.status, 'passed'); assert.equal(report.scope, 'harness');
  assert.equal(report.before.fingerprint, report.after.fingerprint);
  assert.deepEqual(report.checks[0].argv, spec().checks[0].argv);
  assert.equal(report.review.independent, 'not_recorded');
  assert.equal(report.review.owner, 'not_recorded');
  assert.deepEqual(JSON.parse(await readFile(reportPath, 'utf8')), report);
});

test('a check that changes source invalidates its own run', async (t) => {
  const { root } = await fixture(t);
  const definition = spec([check({ argv: [process.execPath, '-e', 'require("node:fs").writeFileSync("source.txt","modified during check")'] })]);
  const { report } = await run(root, definition);
  assert.equal(report.checks[0].status, 'passed'); assert.equal(report.status, 'stale');
  assert.equal((await compareReport(root, report, definition)).reusable, false);
});

test('reuse requires unchanged source AND the same verification spec', async (t) => {
  const { root } = await fixture(t);
  const definition = spec();
  const { report } = await run(root, definition);
  assert.equal((await compareReport(root, report, definition)).reusable, true);
  assert.equal((await compareReport(root, report)).reusable, false);
  const changed = structuredClone(definition); changed.goal = 'A different Goal';
  assert.equal((await compareReport(root, report, changed)).reusable, false);
  await writeFile(resolve(root, 'source.txt'), 'new source');
  assert.equal((await compareReport(root, report, definition)).reusable, false);
});

test('criteria that rely only on a shared check are flagged unless a reason is given', async (t) => {
  const twoCriteria = (extra = {}) => ({
    ...spec([check({ id: 'all-tests' }), check({ id: 'startup' })]),
    criteria: [
      { id: 'C1', description: 'Starts', checkIds: ['all-tests', 'startup'] },
      { id: 'C2', description: 'Stops', checkIds: ['all-tests'], ...extra },
      { id: 'C3', description: 'Restarts', checkIds: ['all-tests'] },
    ],
  });
  const warnings = coverageWarnings(validateSpec(twoCriteria()));
  assert.deepEqual(warnings.map((warning) => warning.criterion), ['C2', 'C3']);
  assert.match(warnings[0].message, /all-tests \(C1, C2, C3\)/);
  const explained = coverageWarnings(validateSpec(twoCriteria({ sharedCheckReason: 'The suite has a single stop scenario' })));
  assert.deepEqual(explained.map((warning) => warning.criterion), ['C3']);
  assert.throws(() => validateSpec(twoCriteria({ sharedCheckReason: ' ' })), /shared-check reason/);
  const { root } = await fixture(t);
  const { report } = await run(root, twoCriteria());
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.warnings.map((warning) => warning.criterion), ['C2', 'C3']);
});

test('a single criterion per check produces no coverage warning', () => {
  assert.deepEqual(coverageWarnings(validateSpec(spec())), []);
});

test('ignored instructions of other assistants are snapshotted without any personal setup', async (t) => {
  const { root } = await fixture(t);
  await mkdir(resolve(root, '.claude/agents'), { recursive: true });
  await writeFile(resolve(root, 'CLAUDE.md'), 'Follow AGENTS.md\n');
  await writeFile(resolve(root, '.claude/agents/reviewer.md'), 'role: reviewer\n');
  await writeFile(resolve(root, '.claude/agents/notes.txt'), 'not an instruction file\n');
  const initial = await snapshot(root);
  assert.ok(initial.files.some((file) => file.path === 'CLAUDE.md'));
  assert.ok(initial.files.some((file) => file.path === '.claude/agents/reviewer.md'));
  assert.ok(!initial.files.some((file) => file.path === '.claude/agents/notes.txt'));
  await writeFile(resolve(root, '.claude/agents/reviewer.md'), 'role: stricter reviewer\n');
  assert.notEqual((await snapshot(root)).fingerprint, initial.fingerprint);
});

test('contributors add their own ignored guidance through an unversioned local file', async (t) => {
  const { root } = await fixture(t);
  await mkdir(resolve(root, 'notes'), { recursive: true });
  await writeFile(resolve(root, 'notes/prompt.md'), 'personal routing\n');
  assert.ok(!(await snapshot(root)).files.some((file) => file.path === 'notes/prompt.md'));
  await mkdir(resolve(root, '.local/harness'), { recursive: true });
  await writeFile(resolve(root, '.local/harness/guidance.json'), JSON.stringify({ paths: ['notes/*.md'] }));
  assert.ok((await guidanceEntries(root)).includes('notes/*.md'));
  const withLocal = await snapshot(root);
  assert.ok(withLocal.files.some((file) => file.path === 'notes/prompt.md'));
  await writeFile(resolve(root, 'notes/prompt.md'), 'changed routing\n');
  assert.notEqual((await snapshot(root)).fingerprint, withLocal.fingerprint);
});

test('guidance entries must stay relative, inside the repository, and use one trailing wildcard', async (t) => {
  for (const entry of ['/etc/passwd', '../outside.md', 'a/../b.md', 'dir\\file.md', '*.md', 'dir/*/x.md', 'dir/a*.md', 'dir/**.md', '', 7]) {
    assert.throws(() => validateGuidance([entry]), /Invalid guidance entry/, String(entry));
  }
  assert.deepEqual(validateGuidance(['CLAUDE.md', '.claude/agents/*.md']), ['CLAUDE.md', '.claude/agents/*.md']);
  assert.throws(() => validateGuidance(Array.from({ length: 65 }, (_, i) => `f${i}.md`)), /at most 64/);
  const { root } = await fixture(t);
  await mkdir(resolve(root, '.local/harness'), { recursive: true });
  await writeFile(resolve(root, '.local/harness/guidance.json'), JSON.stringify({ paths: ['../escape.md'] }));
  await assert.rejects(snapshot(root), /Invalid guidance entry/);
});

test('reports record tool versions and a changed toolchain invalidates reuse', async (t) => {
  const { root } = await fixture(t);
  // The fake tool reads its version from ignored local data, so only the environment changes.
  await mkdir(resolve(root, '.local'), { recursive: true });
  await writeFile(resolve(root, '.local/version.txt'), 'tool 1.0.0\n');
  const definition = { ...spec(), toolchain: [{ id: 'fixture-tool', argv: [process.execPath, '-e', 'process.stdout.write(require("node:fs").readFileSync(".local/version.txt"))'] }] };
  const { report } = await run(root, definition);
  assert.equal(report.environment.node, process.version);
  assert.match(report.environment.toolchain.find((tool) => tool.id === 'git').version, /^git version /);
  assert.equal(report.environment.toolchain.find((tool) => tool.id === 'fixture-tool').version, 'tool 1.0.0');
  const same = await compareReport(root, report, definition);
  assert.equal(same.environmentMatches, true); assert.equal(same.reusable, true);
  await writeFile(resolve(root, '.local/version.txt'), 'tool 2.0.0\n');
  const upgraded = await compareReport(root, report, definition);
  assert.equal(upgraded.sourceMatches, true); assert.equal(upgraded.specMatches, true);
  assert.equal(upgraded.environmentMatches, false); assert.equal(upgraded.reusable, false);
  const withoutEnvironment = structuredClone(report); delete withoutEnvironment.environment;
  await writeFile(resolve(root, '.local/version.txt'), 'tool 1.0.0\n');
  const legacy = await compareReport(root, withoutEnvironment, definition);
  assert.equal(legacy.environmentMatches, false); assert.equal(legacy.reusable, false);
});

test('a tool that becomes unavailable changes the environment instead of passing silently', async (t) => {
  const { root } = await fixture(t);
  const present = environment(root, { toolchain: [{ id: 'runtime', argv: [process.execPath, '--version'] }] });
  assert.equal(present.toolchain[1].version, process.version);
  const missing = environment(root, { toolchain: [{ id: 'runtime', argv: ['nihon-nonexistent-fixture-command', '--version'] }] });
  assert.equal(missing.toolchain[1].version, null);
  assert.notEqual(missing.fingerprint, present.fingerprint);
});

test('toolchain probes are bounded, explicit, and cannot redefine git', () => {
  const probe = (overrides = {}) => ({ ...spec(), toolchain: [{ id: 'bun', argv: ['bun', '--version'], ...overrides }] });
  assert.doesNotThrow(() => validateSpec(probe()));
  assert.throws(() => validateSpec(probe({ argv: 'bun --version' })), /toolchain argv/);
  assert.throws(() => validateSpec(probe({ id: 'git' })), /toolchain id/);
  assert.throws(() => validateSpec({ ...spec(), toolchain: Array.from({ length: 17 }, (_, i) => ({ id: `t${i}`, argv: ['x'] })) }), /at most 16/);
});

test('committed evidence still requires the recorded toolchain', async (t) => {
  const { root, git } = await fixture(t);
  const commit = (message) => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', message);
  commit('initial');
  await mkdir(resolve(root, '.local'), { recursive: true });
  await writeFile(resolve(root, '.local/version.txt'), 'tool 1.0.0\n');
  await writeFile(resolve(root, 'source.txt'), 'tested change\n');
  const definition = { ...spec(), toolchain: [{ id: 'fixture-tool', argv: [process.execPath, '-e', 'process.stdout.write(require("node:fs").readFileSync(".local/version.txt"))'] }] };
  const { report } = await run(root, definition);
  git('add', 'source.txt');
  commit('tested change');
  const committed = await compareReport(root, report, definition);
  assert.equal(committed.reusable, true);
  assert.equal(committed.evidenceForCommit, (await snapshot(root)).head);
  await writeFile(resolve(root, '.local/version.txt'), 'tool 2.0.0\n');
  const upgraded = await compareReport(root, report, definition);
  assert.equal(upgraded.sourceMatches, true); assert.equal(upgraded.environmentMatches, false);
  assert.equal(upgraded.reusable, false); assert.equal(upgraded.evidenceForCommit, null);
});

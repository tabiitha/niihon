import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { compareReport, run, runCheck, snapshot, summarize, validateSpec } from './harness.mjs';

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'niihon-harness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--initial-branch=main');
  await writeFile(resolve(root, '.gitignore'), '/.local/\n/.codex/\n');
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
  git('add', 'source.txt');
  assert.notEqual((await snapshot(root)).fingerprint, changed.fingerprint);
  const staged = await snapshot(root);
  await writeFile(resolve(root, 'new.txt'), 'new evidence target');
  assert.notEqual((await snapshot(root)).fingerprint, staged.fingerprint);
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
  const missingCommand = await runCheck(root, check({ argv: ['niihon-nonexistent-fixture-command'] }), resolve(root, 'command.log'));
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

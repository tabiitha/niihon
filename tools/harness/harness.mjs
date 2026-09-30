import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { lstat, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_SPEC_BYTES = 256 * 1024;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value);

function git(root, args, allowFailure = false) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT, timeout: 10000, windowsHide: true,
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new Error(`Git inspection failed: ${args[0]} (${result.error?.code ?? result.status})`);
  }
  return result.status === 0 ? result.stdout : null;
}

export function repositoryRoot(cwd = process.cwd()) {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

function contained(root, path) {
  const local = relative(root, path);
  return local === '' || (!local.startsWith(`..${sep}`) && local !== '..' && !isAbsolute(local));
}

async function localPath(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name)) throw new Error('Expected a repository-relative path');
  const path = resolve(root, name);
  if (!contained(root, path)) throw new Error('Path escapes the repository');
  const physical = await realpath(path);
  if (!contained(await realpath(root), physical)) throw new Error('Symlink escapes the repository');
  return physical;
}

async function optionalStat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Hash content, index state, untracked source, and explicitly selected ignored guidance.
// Store hashes and paths, never source contents or environment values.
export async function snapshot(root) {
  root = await realpath(root);
  const paths = new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean));
  for (const name of ['AGENTS.md', 'GIT_RULES.md', '.codex/README.md', '.codex/config.toml']) {
    if (await optionalStat(resolve(root, name))) paths.add(name);
  }
  const roles = resolve(root, '.codex/agents');
  const roleStat = await optionalStat(roles);
  if (roleStat?.isDirectory()) {
    for (const name of await readdir(roles)) if (name.endsWith('.toml')) paths.add(`.codex/agents/${name}`);
  }
  if (paths.size > MAX_FILES) throw new Error('Snapshot file ceiling exceeded');
  const files = [];
  let bytes = 0;
  for (const name of [...paths].sort()) {
    const path = resolve(root, name);
    if (!contained(root, path)) throw new Error('Snapshot path escapes repository');
    // Do not follow symlinked parent directories into another checkout or secret store.
    const parent = await realpath(dirname(path)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (parent && !contained(root, parent)) throw new Error('Snapshot parent escapes repository');
    const stat = await optionalStat(path);
    if (!stat) { files.push({ path: name, kind: 'deleted' }); continue; }
    if (stat.isSymbolicLink()) {
      files.push({ path: name, kind: 'symlink', sha256: digest(await readlink(path)) });
      continue;
    }
    if (!stat.isFile()) throw new Error(`Unsupported snapshot entry: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      bytes += chunk.length;
      if (bytes > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot byte ceiling exceeded; narrow generated/large assets deliberately');
      hash.update(chunk);
    }
    files.push({ path: name, kind: 'file', mode: stat.mode & 0o777, sha256: hash.digest('hex') });
  }
  const state = {
    head: git(root, ['rev-parse', '--verify', 'HEAD'], true)?.trim() ?? null,
    branch: git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)?.trim() ?? null,
    indexDigest: digest(git(root, ['ls-files', '--stage', '-z'])),
    statusDigest: digest(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])),
    files,
  };
  return { ...state, fingerprint: digest(canonical(state)), bytesHashed: bytes };
}

export function validateSpec(spec) {
  if (!spec || spec.schemaVersion !== 1 || !['harness', 'application'].includes(spec.scope)) throw new Error('Invalid spec version or scope');
  if (!spec.issue || !(spec.issue === 'no-issue' || Number.isSafeInteger(spec.issue) && spec.issue > 0)) throw new Error('Expected a real issue number or no-issue');
  if (typeof spec.goal !== 'string' || !spec.goal.trim()) throw new Error('A Goal is required');
  if (!Array.isArray(spec.checks) || spec.checks.length < 1 || spec.checks.length > 32) throw new Error('Expected 1–32 checks');
  if (!Array.isArray(spec.criteria) || !spec.criteria.length || spec.criteria.length > 128) throw new Error('Acceptance criteria are required');
  const ids = new Set();
  for (const check of spec.checks) {
    if (typeof check.id !== 'string' || !idPattern.test(check.id) || ids.has(check.id)) throw new Error('Invalid or duplicate check id');
    ids.add(check.id);
    if (typeof check.required !== 'boolean' || typeof check.configured !== 'boolean') throw new Error('Check required/configured must be explicit');
    if (check.configured) {
      if (!Array.isArray(check.argv) || !check.argv.length || check.argv.length > 128 || check.argv.some((arg) => typeof arg !== 'string' || !arg || arg.length > 4096 || arg.includes('\0'))) throw new Error('Expected explicit argv, never a shell command');
      if (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 300000) throw new Error('Check timeout must be 1–300000 ms');
      if (!Number.isSafeInteger(check.maxLogBytes) || check.maxLogBytes < 1 || check.maxLogBytes > 1048576) throw new Error('Log ceiling must be 1–1048576 bytes');
      if (typeof check.cwd !== 'string') throw new Error('Check cwd is required');
      if (!Array.isArray(check.requires) || check.requires.some((path) => typeof path !== 'string')) throw new Error('Check required paths must be explicit');
    } else if (typeof check.reason !== 'string' || !check.reason.trim()) throw new Error('Unconfigured checks need a reason');
  }
  const criteriaIds = new Set();
  for (const criterion of spec.criteria) {
    if (typeof criterion.id !== 'string' || !idPattern.test(criterion.id) || criteriaIds.has(criterion.id) || typeof criterion.description !== 'string' || !criterion.description.trim()) throw new Error('Invalid or duplicate criterion');
    criteriaIds.add(criterion.id);
    if (!Array.isArray(criterion.checkIds) || criterion.checkIds.some((id) => !ids.has(id)) || new Set(criterion.checkIds).size !== criterion.checkIds.length) throw new Error('Invalid criterion-to-check mapping');
  }
  return spec;
}

function terminate(child, signal = 'SIGTERM') {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      // Only terminate the tree of this harness-owned child, never by executable name.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 2000, stdio: 'ignore', windowsHide: true });
    } else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
}

export async function runCheck(root, check, logPath, signal) {
  if (!check.configured) return { id: check.id, required: check.required, status: 'unconfigured', reason: check.reason };
  let cwd;
  try {
    cwd = await localPath(root, check.cwd);
    for (const path of check.requires) await localPath(root, path);
  } catch (error) {
    if (error.code === 'ENOENT') return { id: check.id, required: check.required, status: 'unavailable', reason: 'Required directory or file is absent' };
    throw error;
  }
  if (signal?.aborted) return { id: check.id, required: check.required, status: 'cancelled', reason: 'Run cancelled before execution' };
  const started = performance.now();
  const fd = openSync(logPath, 'wx', 0o600);
  return await new Promise((resolveResult) => {
    const child = spawn(check.argv[0], check.argv.slice(1), {
      cwd, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let retained = 0;
    let observed = 0;
    let statusOverride;
    let forceTimer;
    let launchError;
    let settled = false;
    const capture = (chunk) => {
      observed += chunk.length;
      const keep = chunk.subarray(0, Math.max(0, check.maxLogBytes - retained));
      if (keep.length) { writeSync(fd, keep); retained += keep.length; }
    };
    const stop = (status) => {
      if (statusOverride || settled) return;
      statusOverride = status;
      terminate(child);
      forceTimer = setTimeout(() => terminate(child, 'SIGKILL'), 250);
    };
    const onAbort = () => stop('cancelled');
    const timeout = setTimeout(() => stop('timed_out'), check.timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => { launchError = error.code ?? 'LAUNCH_ERROR'; });
    child.on('close', (code, childSignal) => {
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      signal?.removeEventListener('abort', onAbort);
      // Also stop a descendant that detached from the parent's stdio but stayed in its process group.
      if (process.platform !== 'win32') terminate(child, 'SIGKILL');
      closeSync(fd);
      resolveResult({
        id: check.id, required: check.required,
        status: statusOverride ?? (launchError ? 'unavailable' : code === 0 ? 'passed' : 'failed'),
        exitCode: code, signal: childSignal, launchError: launchError ?? null,
        durationMs: Math.round(performance.now() - started),
        argv: check.argv, cwd: check.cwd, log: logPath,
        retainedLogBytes: retained, observedLogBytes: observed, logTruncated: observed > retained,
      });
    });
  });
}

export function summarize(spec, checks, stable) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const criteria = spec.criteria.map((criterion) => {
    const mapped = criterion.checkIds.map((id) => byId.get(id));
    const status = !mapped.length || mapped.some((check) => !check || !['passed', 'failed', 'timed_out'].includes(check.status))
      ? 'incomplete' : mapped.some((check) => check.status !== 'passed') ? 'failed' : 'passed';
    return { ...criterion, status };
  });
  const required = checks.filter((check) => check.required);
  const statuses = [...required.map((check) => check.status), ...criteria.map((criterion) => criterion.status)];
  const status = !stable ? 'stale'
    : statuses.some((status) => ['failed', 'timed_out'].includes(status)) ? 'failed'
      : statuses.some((status) => status !== 'passed') ? 'incomplete' : 'passed';
  return { status, criteria };
}

export async function run(root, spec, { signal } = {}) {
  validateSpec(spec);
  const before = await snapshot(root);
  const runs = resolve(root, '.local/harness/runs');
  // Refuse an existing symlinked output parent before writing any evidence.
  let cursor = root;
  for (const segment of ['.local', 'harness', 'runs']) {
    cursor = resolve(cursor, segment);
    const stat = await optionalStat(cursor);
    if (stat?.isSymbolicLink() || stat && !stat.isDirectory()) throw new Error('Unsafe evidence directory');
    mkdirSync(cursor, { recursive: true, mode: 0o700 });
  }
  const output = resolve(runs, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
  mkdirSync(output, { mode: 0o700 });
  const checks = [];
  for (const check of spec.checks) {
    checks.push(await runCheck(root, check, resolve(output, `${check.id}.log`), signal));
  }
  const after = await snapshot(root);
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), scope: spec.scope,
    issue: spec.issue, goal: spec.goal, specDigest: digest(canonical(spec)),
    ...summarize(spec, checks, before.fingerprint === after.fingerprint),
    root, runtime: { node: process.version, platform: process.platform, arch: process.arch },
    before, after, checks,
    review: { independent: 'not_recorded', owner: 'not_recorded' },
    meaning: 'Automated evidence only; not issue completion, independent review, publication authorization, or merge approval.',
  };
  await writeFile(resolve(output, 'spec.json'), JSON.stringify(spec, null, 2) + '\n', { mode: 0o600 });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return { report, reportPath: resolve(output, 'report.json') };
}

export async function doctor(root) {
  const exists = async (path) => Boolean(await optionalStat(resolve(root, path)));
  const bun = spawnSync('bun', ['--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 });
  return {
    root, node: process.version,
    bun: bun.status === 0 ? bun.stdout.trim() : 'unavailable',
    guidance: { agents: await exists('AGENTS.md'), decisions: await exists('docs/PROJECT_DECISIONS.md'), roles: await exists('.codex/agents') },
    application: await exists('apps/api/package.json') ? 'manifest_present_commands_must_be_qualified' : 'not_configured',
    subagents: 'Configuration presence does not establish runtime discovery or a successful independent review.',
    identity: 'Niihon contributions require codex-github; this harness makes no GitHub calls.',
  };
}

async function loadJson(path, maxBytes = MAX_SPEC_BYTES) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Expected a regular JSON file within the ${maxBytes}-byte input ceiling`);
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function compareReport(root, report, spec) {
  if (report.schemaVersion !== 1 || !report.after?.fingerprint) throw new Error('Invalid report');
  const current = await snapshot(root);
  const sourceMatches = current.fingerprint === report.after.fingerprint;
  const specMatches = spec ? digest(canonical(validateSpec(spec))) === report.specDigest : null;
  return { sourceMatches, specMatches, recordedStatus: report.status, reusable: sourceMatches && specMatches === true && report.status === 'passed' };
}

async function cli(args) {
  const [command, file, specPath] = args;
  const root = repositoryRoot();
  if (command === 'doctor' && !file) console.log(JSON.stringify(await doctor(root), null, 2));
  else if (command === 'snapshot' && !file) console.log(JSON.stringify(await snapshot(root), null, 2));
  else if (command === 'run' && file && !specPath) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const result = await run(root, await loadJson(resolve(file)), { signal: controller.signal });
      console.log(JSON.stringify({ status: result.report.status, scope: result.report.scope, report: result.reportPath }, null, 2));
      process.exitCode = result.report.status === 'passed' ? 0 : 1;
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  } else if (command === 'compare' && file) {
    const result = await compareReport(root, await loadJson(resolve(file), 32 * 1024 * 1024), specPath ? await loadJson(resolve(specPath)) : undefined);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.reusable ? 0 : 1;
  } else throw new Error('Usage: node tools/harness/harness.mjs doctor|snapshot|run SPEC.json|compare REPORT.json SPEC.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

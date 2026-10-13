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
const MAX_TOOLCHAIN = 16;
const PROBE_TIMEOUT_MS = 5000;
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

// Instruction and role files that steer contributors or assistants. They are often ignored by Git
// (personal configuration), yet changing them can change the work, so snapshots include them when
// present. Entries are exact paths or `directory/*suffix` (one level). Covers common assistants
// without requiring any of them; contributors add their own in LOCAL_GUIDANCE_FILE.
export const DEFAULT_GUIDANCE = Object.freeze([
  'AGENTS.md', 'GIT_RULES.md', 'CLAUDE.md', 'CLAUDE.local.md', '.cursorrules',
  '.github/copilot-instructions.md',
  '.codex/README.md', '.codex/config.toml', '.codex/agents/*.toml',
  '.claude/settings.json', '.claude/settings.local.json', '.claude/agents/*.md', '.claude/commands/*.md',
  '.cursor/rules/*.mdc',
]);
export const LOCAL_GUIDANCE_FILE = '.local/harness/guidance.json';
const MAX_GUIDANCE_ENTRIES = 64;

export function validateGuidance(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_GUIDANCE_ENTRIES) throw new Error(`Expected at most ${MAX_GUIDANCE_ENTRIES} guidance entries`);
  for (const entry of entries) {
    const segments = typeof entry === 'string' ? entry.split('/') : [];
    const star = entry?.indexOf?.('*') ?? -1;
    if (!segments.length || !entry || isAbsolute(entry) || entry.includes('\\') || entry.includes('\0')
      || segments.some((segment) => !segment || segment === '.' || segment === '..')
      || (star !== -1 && (star !== entry.lastIndexOf('*') || !segments.at(-1).startsWith('*') || segments.length < 2))) {
      throw new Error(`Invalid guidance entry: ${JSON.stringify(entry)} (use a relative path or directory/*suffix)`);
    }
  }
  return entries;
}

// Built-in entries plus the contributor's optional, unversioned additions: { "paths": [...] }.
export async function guidanceEntries(root) {
  const local = resolve(root, LOCAL_GUIDANCE_FILE);
  const stat = await optionalStat(local);
  if (!stat) return [...DEFAULT_GUIDANCE];
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error(`${LOCAL_GUIDANCE_FILE} must be a regular file of at most 65536 bytes`);
  const extra = JSON.parse(await readFile(local, 'utf8'))?.paths;
  return [...new Set([...DEFAULT_GUIDANCE, ...validateGuidance(extra)])];
}

async function matchGuidance(root, entries) {
  const found = [];
  for (const entry of entries) {
    if (!entry.includes('*')) {
      if (await optionalStat(resolve(root, entry))) found.push(entry);
      continue;
    }
    const directory = entry.slice(0, entry.lastIndexOf('/'));
    const suffix = entry.slice(entry.lastIndexOf('*') + 1);
    const stat = await optionalStat(resolve(root, directory));
    if (!stat?.isDirectory()) continue;
    for (const name of await readdir(resolve(root, directory))) if (name.endsWith(suffix)) found.push(`${directory}/${name}`);
  }
  return found;
}

// Hash content, index state, untracked source, and explicitly selected ignored guidance.
// Store hashes and paths, never source contents or environment values.
export async function snapshot(root) {
  root = await realpath(root);
  const paths = new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean));
  for (const name of await matchGuidance(root, await guidanceEntries(root))) paths.add(name);
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
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const state = {
    head: git(root, ['rev-parse', '--verify', 'HEAD'], true)?.trim() ?? null,
    branch: git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)?.trim() ?? null,
    indexDigest: digest(git(root, ['ls-files', '--stage', '-z'])),
    statusDigest: digest(status),
    files,
  };
  return {
    ...state,
    clean: status === '',
    // Validity of evidence: what the checks actually read on disk. Staging or committing the same
    // content keeps it; absent paths are omitted so a committed deletion equals a pending one.
    contentFingerprint: contentFingerprint(files),
    // Full Git-aware state, kept to describe exactly where the run happened.
    fingerprint: digest(canonical(state)),
    bytesHashed: bytes,
  };
}

function contentFingerprint(files) {
  return digest(canonical(files.filter((file) => file.kind !== 'deleted')));
}

const validArgv = (argv) => Array.isArray(argv) && argv.length > 0 && argv.length <= 128
  && argv.every((arg) => typeof arg === 'string' && arg && arg.length <= 4096 && !arg.includes('\0'));

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
      if (!validArgv(check.argv)) throw new Error('Expected explicit argv, never a shell command');
      if (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 300000) throw new Error('Check timeout must be 1–300000 ms');
      if (!Number.isSafeInteger(check.maxLogBytes) || check.maxLogBytes < 1 || check.maxLogBytes > 1048576) throw new Error('Log ceiling must be 1–1048576 bytes');
      if (typeof check.cwd !== 'string') throw new Error('Check cwd is required');
      if (!Array.isArray(check.requires) || check.requires.some((path) => typeof path !== 'string')) throw new Error('Check required paths must be explicit');
    } else if (typeof check.reason !== 'string' || !check.reason.trim()) throw new Error('Unconfigured checks need a reason');
  }
  if (spec.toolchain !== undefined) {
    if (!Array.isArray(spec.toolchain) || spec.toolchain.length > MAX_TOOLCHAIN) throw new Error(`Expected at most ${MAX_TOOLCHAIN} toolchain probes`);
    const probeIds = new Set();
    for (const probe of spec.toolchain) {
      if (typeof probe?.id !== 'string' || !idPattern.test(probe.id) || probeIds.has(probe.id) || probe.id === 'git') throw new Error('Invalid or duplicate toolchain id');
      probeIds.add(probe.id);
      if (!validArgv(probe.argv)) throw new Error('Expected explicit toolchain argv, never a shell command');
    }
  }
  const criteriaIds = new Set();
  for (const criterion of spec.criteria) {
    if (typeof criterion.id !== 'string' || !idPattern.test(criterion.id) || criteriaIds.has(criterion.id) || typeof criterion.description !== 'string' || !criterion.description.trim()) throw new Error('Invalid or duplicate criterion');
    criteriaIds.add(criterion.id);
    if (!Array.isArray(criterion.checkIds) || criterion.checkIds.some((id) => !ids.has(id)) || new Set(criterion.checkIds).size !== criterion.checkIds.length) throw new Error('Invalid criterion-to-check mapping');
    if (criterion.sharedCheckReason !== undefined && (typeof criterion.sharedCheckReason !== 'string' || !criterion.sharedCheckReason.trim())) throw new Error('A shared-check reason must be a non-empty string');
  }
  return spec;
}

// A check shared by several criteria turns all of them green at once, so one passing command can
// hide an uncovered criterion. Flag every criterion that relies only on shared checks, unless it
// explains why the shared check discriminates it. Warnings never change the run status.
export function coverageWarnings(spec) {
  const users = new Map();
  for (const criterion of spec.criteria) {
    for (const id of criterion.checkIds) users.set(id, [...(users.get(id) ?? []), criterion.id]);
  }
  const warnings = [];
  for (const criterion of spec.criteria) {
    if (!criterion.checkIds.length || criterion.sharedCheckReason) continue;
    if (criterion.checkIds.every((id) => users.get(id).length > 1)) {
      const shared = criterion.checkIds.map((id) => `${id} (${users.get(id).join(', ')})`).join('; ');
      warnings.push({ code: 'shared_check', criterion: criterion.id, checks: criterion.checkIds,
        message: `Criterion ${criterion.id} relies only on checks shared with other criteria: ${shared}. Add a dedicated check or a sharedCheckReason.` });
    }
  }
  return warnings;
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

// Versions of the tools checks depend on. Git is always probed (the harness needs it); a spec adds
// its own probes, e.g. { "id": "bun", "argv": ["bun", "--version"] }. Only the first output line
// is kept. A changed or newly (un)available tool changes the environment fingerprint.
export function environment(root, spec = {}) {
  const probes = [{ id: 'git', argv: ['git', '--version'] }, ...(spec.toolchain ?? [])];
  const toolchain = probes.map(({ id, argv }) => {
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: root, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024, shell: false, windowsHide: true,
    });
    const line = `${result.stdout ?? ''}`.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? '';
    return { id, argv, version: !result.error && result.status === 0 && line ? line : null };
  });
  const state = { node: process.version, platform: process.platform, arch: process.arch, toolchain };
  return { ...state, fingerprint: digest(canonical(state)) };
}

export async function run(root, spec, { signal } = {}) {
  validateSpec(spec);
  const before = await snapshot(root);
  const env = environment(root, spec);
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
    ...summarize(spec, checks, before.contentFingerprint === after.contentFingerprint),
    warnings: coverageWarnings(spec),
    root, runtime: { node: process.version, platform: process.platform, arch: process.arch },
    environment: env,
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
    guidance: {
      agents: await exists('AGENTS.md'), decisions: await exists('docs/PROJECT_DECISIONS.md'),
      // Instruction/role files that participate in snapshots, including ignored personal ones.
      snapshotted: await matchGuidance(await realpath(root), await guidanceEntries(root)),
      localAdditions: await exists(LOCAL_GUIDANCE_FILE) ? LOCAL_GUIDANCE_FILE : 'none',
    },
    application: await exists('apps/api/package.json') ? 'manifest_present_commands_must_be_qualified' : 'not_configured',
    subagents: 'Configuration presence does not establish runtime discovery or a successful independent review.',
    identity: 'Nihon contributions require nihon-github; this harness makes no GitHub calls.',
  };
}

async function loadJson(path, maxBytes = MAX_SPEC_BYTES) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Expected a regular JSON file within the ${maxBytes}-byte input ceiling`);
  return JSON.parse(await readFile(path, 'utf8'));
}

// Shared by compare and gate so that both apply exactly the same reuse rules.
function assessReport(report, specDigest, current, currentEnvironment) {
  if (report?.schemaVersion !== 1 || !report.after?.fingerprint) throw new Error('Invalid report');
  // Reports written before content fingerprints existed cannot prove content equality.
  const sourceMatches = Boolean(report.after.contentFingerprint) && current.contentFingerprint === report.after.contentFingerprint;
  const specMatches = specDigest ? specDigest === report.specDigest : null;
  // Reports without a recorded environment cannot show that the same tools would run today.
  const environmentMatches = currentEnvironment ? Boolean(report.environment?.fingerprint) && currentEnvironment.fingerprint === report.environment.fingerprint : null;
  const reusable = sourceMatches && specMatches === true && environmentMatches === true && report.status === 'passed';
  return {
    sourceMatches, specMatches, environmentMatches, recordedStatus: report.status, reusable,
    gitStateMatches: current.fingerprint === report.after.fingerprint,
    // Evidence describes a commit only when the current tree is clean: otherwise uncommitted
    // content was tested and the commit may contain only part of it.
    evidenceForCommit: reusable && current.clean ? current.head : null,
  };
}

export async function compareReport(root, report, spec) {
  if (report?.schemaVersion !== 1 || !report.after?.fingerprint) throw new Error('Invalid report');
  const current = await snapshot(root);
  const specDigest = spec ? digest(canonical(validateSpec(spec))) : null;
  return assessReport(report, specDigest, current, spec ? environment(root, spec) : null);
}

const MAX_GATE_REPORTS = 500;
const MAX_REPORT_BYTES = 32 * 1024 * 1024;

// Harness gate of the issue control graph (docs/engineering/GRAPH.md): publication or review may
// proceed only when the newest report for this spec on the current content passed, in the current
// environment, and the tree is clean so the evidence describes HEAD. An older green run never
// hides a newer red one on the same content.
export async function gate(root, spec) {
  validateSpec(spec);
  const specDigest = digest(canonical(spec));
  const current = await snapshot(root);
  const currentEnvironment = environment(root, spec);
  const refuse = (reason, details = {}) => ({ allowed: false, reason, head: current.head, ...details });
  if (!current.head) return refuse('no_commit');
  const runs = resolve(root, '.local/harness/runs');
  const runsStat = await optionalStat(runs);
  if (!runsStat?.isDirectory() || runsStat.isSymbolicLink()) return refuse('no_report');
  // Run directories start with an ISO timestamp, so a reverse name sort is newest first.
  const names = (await readdir(runs)).sort().reverse().slice(0, MAX_GATE_REPORTS);
  let forSpec = 0;
  let unreadable = 0;
  for (const name of names) {
    const path = resolve(runs, name, 'report.json');
    let report;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) { unreadable += 1; continue; }
      report = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') unreadable += 1;
      continue;
    }
    if (report?.specDigest !== specDigest) continue;
    forSpec += 1;
    let assessment;
    try { assessment = assessReport(report, specDigest, current, currentEnvironment); }
    catch { unreadable += 1; continue; }
    if (!assessment.sourceMatches) continue;
    const details = { report: path, recordedStatus: report.status, checkedReports: forSpec, unreadableReports: unreadable };
    if (report.status !== 'passed') return refuse('latest_report_not_passed', details);
    if (!assessment.environmentMatches) return refuse('environment_changed', details);
    if (!current.clean) return refuse('dirty_tree', details);
    return { allowed: true, reason: 'passed_on_clean_head', head: current.head, ...details, evidenceForCommit: assessment.evidenceForCommit };
  }
  return refuse(forSpec ? 'no_report_for_current_content' : 'no_report', { checkedReports: forSpec, unreadableReports: unreadable });
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
      console.log(JSON.stringify({ status: result.report.status, scope: result.report.scope, report: result.reportPath, warnings: result.report.warnings.map((warning) => warning.message) }, null, 2));
      process.exitCode = result.report.status === 'passed' ? 0 : 1;
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  } else if (command === 'compare' && file) {
    const result = await compareReport(root, await loadJson(resolve(file), MAX_REPORT_BYTES), specPath ? await loadJson(resolve(specPath)) : undefined);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.reusable ? 0 : 1;
  } else if (command === 'gate' && file && !specPath) {
    const result = await gate(root, await loadJson(resolve(file)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.allowed ? 0 : 1;
  } else throw new Error('Usage: node tools/harness/harness.mjs doctor|snapshot|run SPEC.json|compare REPORT.json SPEC.json|gate SPEC.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

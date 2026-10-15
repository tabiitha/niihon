import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { apiVersion } from './contract/conventions.ts';

// Exercises the real entry point in a child process. NIHON_API_ENTRY may point at the built dist/main.js.
const entry = process.env['NIHON_API_ENTRY'] ?? fileURLToPath(new URL('./main.ts', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const startTimeoutMs = 10_000;
const gracefulStopUnsupported =
  process.platform === 'win32' ? 'Windows cannot deliver SIGTERM to a Node process; Docker runs it on Linux' : false;

interface LogEvent {
  readonly event: string;
  readonly [field: string]: unknown;
}

interface ServerProcess {
  readonly child: ChildProcess;
  readonly events: LogEvent[];
  readonly exited: Promise<number | null>;
  waitFor(event: string): Promise<LogEvent>;
}

// Children still alive, with the promise of their exit, so cleanup can wait for them.
const running = new Map<ChildProcess, Promise<number | null>>();

function launch(dataDir: string, env: Record<string, string> = {}): ServerProcess {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, NIHON_DATA_DIR: dataDir, NIHON_PORT: '0', NIHON_HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const events: LogEvent[] = [];
  const waiters: Array<{ event: string; resolve: (value: LogEvent) => void }> = [];
  createInterface({ input: child.stdout! }).on('line', (line) => {
    const parsed = JSON.parse(line) as LogEvent;
    events.push(parsed);
    for (const waiter of waiters.filter((candidate) => candidate.event === parsed.event)) {
      waiter.resolve(parsed);
    }
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      running.delete(child);
      resolve(code);
    });
  });
  running.set(child, exited);
  return {
    child,
    events,
    exited,
    waitFor(event) {
      const seen = events.find((candidate) => candidate.event === event);
      if (seen) {
        return Promise.resolve(seen);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), startTimeoutMs);
        waiters.push({ event, resolve: (value) => (clearTimeout(timer), resolve(value)) });
        void exited.then((code) => {
          clearTimeout(timer);
          reject(new Error(`Server exited with ${code} before ${event}: ${JSON.stringify(events)}`));
        });
      });
    },
  };
}

async function health(listening: LogEvent): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${String(listening['port'])}/api/health`);
  assert.equal(response.status, 200);
  return response.json();
}

describe('server process', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'nihon-server-'));
  });
  afterEach(async () => {
    // Windows refuses to delete the lock file while its process is still exiting.
    const exits = [...running.values()];
    for (const child of running.keys()) {
      child.kill('SIGKILL');
    }
    await Promise.all(exits);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('starts on loopback, reports its version, and stops cleanly', { skip: gracefulStopUnsupported }, async () => {
    const server = launch(dataDir);
    const listening = await server.waitFor('server.listening');
    assert.equal(listening['host'], '127.0.0.1');
    assert.deepEqual(await health(listening), { status: 'ok', service: 'nihon-api', version, apiVersion });

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0);
    assert.ok(server.events.some((event) => event.event === 'server.stopped'));

    const restarted = launch(dataDir);
    await health(await restarted.waitFor('server.listening'));
    restarted.child.kill('SIGTERM');
    assert.equal(await restarted.exited, 0);
  });

  it('refuses a second instance on the same data directory', async () => {
    const first = launch(dataDir);
    const listening = await first.waitFor('server.listening');

    const second = launch(dataDir);
    assert.equal(await second.exited, 3);
    const refused = second.events.find((event) => event.event === 'instance.refused');
    assert.equal(refused?.['dataDir'], dataDir);

    await health(listening);
  });

  it('starts again after the previous instance crashed', async () => {
    const crashed = launch(dataDir);
    await crashed.waitFor('server.listening');
    crashed.child.kill('SIGKILL');
    await crashed.exited;

    const restarted = launch(dataDir);
    await health(await restarted.waitFor('server.listening'));
  });

  it('exits with code 2 on invalid configuration', async () => {
    const server = launch(dataDir, { NIHON_MODULES: 'unknown-module' });
    assert.equal(await server.exited, 2);
    assert.ok(server.events.some((event) => event.event === 'config.invalid'));
  });
});

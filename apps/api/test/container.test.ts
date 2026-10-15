import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';

// Runs the startup, shutdown, and second-instance checks against a built image.
// `bun run test:container` builds the image and sets NIHON_TEST_IMAGE.
const image = process.env['NIHON_TEST_IMAGE'];
if (image === undefined || image === '') {
  throw new Error('Set NIHON_TEST_IMAGE to the image to test, or run `bun run test:container`.');
}

const run = promisify(execFile);
const suffix = randomUUID().slice(0, 8);
const volume = `nihon-test-data-${suffix}`;
const primary = `nihon-test-primary-${suffix}`;
const secondary = `nihon-test-secondary-${suffix}`;

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', args, { timeout: 60_000 });
  return stdout.trim();
}

async function dockerExitCode(...args: string[]): Promise<number> {
  try {
    await run('docker', args, { timeout: 60_000 });
    return 0;
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number'
      ? error.code
      : Number.NaN;
  }
}

async function publishedAddress(container: string): Promise<{ host: string; port: string }> {
  const mapping = (await docker('port', container, '4000/tcp')).split('\n')[0] ?? '';
  const separator = mapping.lastIndexOf(':');
  return { host: mapping.slice(0, separator), port: mapping.slice(separator + 1) };
}

async function waitForHealth(container: string): Promise<unknown> {
  const { port } = await publishedAddress(container);
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`${container} did not become healthy: ${await docker('logs', container)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe(`container image ${image}`, () => {
  before(async () => {
    await docker('volume', 'create', volume);
    await docker('run', '--detach', '--name', primary, '--volume', `${volume}:/data`, '--publish', '127.0.0.1::4000', image);
  });
  after(async () => {
    await dockerExitCode('rm', '--force', primary, secondary);
    await dockerExitCode('volume', 'rm', '--force', volume);
  });

  it('starts and answers on a port published on host loopback only', async () => {
    assert.equal((await publishedAddress(primary)).host, '127.0.0.1');
    const health = (await waitForHealth(primary)) as { status: string; service: string };
    assert.equal(health.status, 'ok');
    assert.equal(health.service, 'nihon-api');
  });

  it('refuses a second container on the same data volume', async () => {
    const code = await dockerExitCode('run', '--name', secondary, '--volume', `${volume}:/data`, image);
    assert.equal(code, 3);
    assert.match(await docker('logs', secondary), /"event":"instance.refused"/);
    await waitForHealth(primary);
  });

  it('stops cleanly on docker stop and starts again on the same volume', async () => {
    await docker('stop', primary);
    assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', primary), '0');
    assert.match(await docker('logs', primary), /"event":"server.stopped"/);

    await docker('start', primary);
    await waitForHealth(primary);
  });

  it('starts without any network access', async () => {
    const offline = `nihon-test-offline-${suffix}`;
    try {
      await docker('run', '--detach', '--name', offline, '--network', 'none', image);
      const probe = "fetch('http://127.0.0.1:4000/api/health').then((r) => r.json()).then((b) => console.log(b.status))";
      const deadline = Date.now() + 20_000;
      let status = '';
      while (status !== 'ok' && Date.now() < deadline) {
        status = await docker('exec', offline, 'node', '-e', probe).catch(() => '');
        if (status !== 'ok') {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      assert.equal(status, 'ok', await docker('logs', offline));
    } finally {
      await dockerExitCode('rm', '--force', offline);
    }
  });

  it('ships no development dependency', async () => {
    const store = await docker('run', '--rm', '--entrypoint', 'ls', image, '/app/node_modules/.bun');
    assert.match(store, /^express@/m);
    assert.doesNotMatch(store, /typescript|@types/);
  });
});

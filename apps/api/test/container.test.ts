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

/** A Node.js script opening the volume's database with the image's own driver, as `db`; test setup only. */
function sqlite(body: string): string {
  return `const db = new (require('/app/apps/api/node_modules/better-sqlite3'))('/data/nihon.db'); ${body}; db.close();`;
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

  it('serves the Web interface on the same origin, including a reload of a page with a query identifier', async () => {
    const { port } = await publishedAddress(primary);
    for (const page of ['/', '/library', '/reader?media=item-01']) {
      const response = await fetch(`http://127.0.0.1:${port}${page}`, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200, page);
      assert.match(await response.text(), /<div id="root"><\/div>/, page);
      assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/, page);
    }
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
      const probe =
        "Promise.all([fetch('http://127.0.0.1:4000/api/health').then((r) => r.json()), fetch('http://127.0.0.1:4000/learn', { headers: { Accept: 'text/html' } })]).then(([b, page]) => console.log(page.ok ? b.status : 'no-page'))";
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
    assert.match(store, /^zod@/m);
    assert.match(store, /^@prisma\+client@/m);
    assert.match(store, /^better-sqlite3@/m);
    // The Web interface ships as its built files only; React and the client are bundled into them.
    // The Prisma CLI and its engines only generate the client and author migrations.
    assert.doesNotMatch(store, /typescript|@types|zod-to-openapi|react|openapi-fetch|^prisma@|@prisma\+engines/m);
  });

  it('keeps the database private to the server user in the named volume', async () => {
    await waitForHealth(primary);
    const listing = await docker('exec', primary, 'stat', '-c', '%n %U %a', '/data', '/data/nihon.db', '/data/nihon.db-wal');
    assert.deepEqual(listing.split('\n'), ['/data node 700', '/data/nihon.db node 600', '/data/nihon.db-wal node 600']);
    const mode = await docker('exec', primary, 'node', '-e', sqlite("console.log(db.pragma('journal_mode', { simple: true }))"));
    assert.equal(mode, 'wal');
  });

  it('keeps the data when the container is removed and recreated on the same volume', async () => {
    await docker('exec', primary, 'node', '-e', sqlite("db.exec('CREATE TABLE IF NOT EXISTS retention_probe (value TEXT); INSERT INTO retention_probe VALUES (\\'kept\\')')"));
    await docker('rm', '--force', primary);
    await docker('run', '--detach', '--name', primary, '--volume', `${volume}:/data`, '--publish', '127.0.0.1::4000', image);
    await waitForHealth(primary);
    assert.match(await docker('logs', primary), /"event":"server.listening"/);
    assert.doesNotMatch(await docker('logs', primary), /"event":"database.migrated"/);
    const kept = await docker('exec', primary, 'node', '-e', sqlite("console.log(db.prepare('SELECT value FROM retention_probe').pluck().get())"));
    assert.equal(kept, 'kept');
  });

  it('refuses a database migrated by a newer release and leaves the volume untouched', async () => {
    await docker('stop', primary);
    const future = `INSERT INTO nihon_schema_migrations VALUES ('29990101000000_future', 'checksum', '2999-01-01T00:00:00.000Z')`;
    await docker('run', '--rm', '--volume', `${volume}:/data`, '--entrypoint', 'node', image, '-e', sqlite(`db.exec("${future}")`));
    const before = await docker('run', '--rm', '--volume', `${volume}:/data`, '--entrypoint', 'sha256sum', image, '/data/nihon.db');

    const refused = `nihon-test-refused-${suffix}`;
    try {
      assert.equal(await dockerExitCode('run', '--name', refused, '--volume', `${volume}:/data`, image), 4);
      assert.match(await docker('logs', refused), /"event":"database.incompatible".*"reason":"newer"/);
    } finally {
      await dockerExitCode('rm', '--force', refused);
    }
    const after = await docker('run', '--rm', '--volume', `${volume}:/data`, '--entrypoint', 'sha256sum', image, '/data/nihon.db');
    assert.equal(after, before);

    await docker('run', '--rm', '--volume', `${volume}:/data`, '--entrypoint', 'node', image, '-e', sqlite(`db.exec("DELETE FROM nihon_schema_migrations WHERE name = '29990101000000_future'")`));
    await docker('start', primary);
    await waitForHealth(primary);
  });
});

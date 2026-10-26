import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { createApiClient } from '../../src/api/service.ts';
import { describeFailure } from '../../src/modules/accounts/errors.ts';
import { loadProviders, newIdempotencyKey, registerLocal } from '../../src/modules/accounts/registration.ts';

// Checks the production build as users receive it: the compiled API (apps/api/dist) serving the Web build
// (apps/web/dist) on one loopback origin. Run `bun run build` from the repository root first.
const webDir = fileURLToPath(new URL('../../dist/', import.meta.url));
const apiEntry = fileURLToPath(new URL('../../../api/dist/main.js', import.meta.url));
for (const path of [join(webDir, 'index.html'), apiEntry]) {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing: run \`bun run build\` from the repository root first.`);
  }
}

const html = { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } };
const pages = ['/', '/learn', '/kanji', '/library', '/reader?media=item-01', '/profile', '/register', '/admin'];

describe('production Web build served by the API', () => {
  let child: ChildProcess;
  let dataDir: string;
  let baseUrl: string;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'nihon-web-production-'));
    child = spawn(process.execPath, [apiEntry], {
      env: { ...process.env, NIHON_DATA_DIR: dataDir, NIHON_HOST: '127.0.0.1', NIHON_PORT: '0', NIHON_WEB_DIR: webDir },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const lines = createInterface({ input: child.stdout! });
    baseUrl = await new Promise((resolve, reject) => {
      child.once('exit', (code) => reject(new Error(`The API exited with ${String(code)}.`)));
      lines.on('line', (line) => {
        const event = JSON.parse(line) as { event: string; port?: number; webDir?: string };
        if (event.event === 'server.listening') {
          assert.equal(event.webDir, webDir);
          resolve(`http://127.0.0.1:${String(event.port)}`);
        }
      });
    });
  });
  after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('opens every space directly, as on a reload, with the same shell', async () => {
    const shell = readFileSync(join(webDir, 'index.html'), 'utf8');
    for (const page of pages) {
      const response = await fetch(baseUrl + page, html);
      assert.equal(response.status, 200, page);
      assert.equal(await response.text(), shell, page);
      assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
    }
  });

  it('loads the shell only from its own origin', async () => {
    const shell = await (await fetch(baseUrl, html)).text();
    const references = [...shell.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1] as string);
    assert.ok(references.length >= 2, 'the shell references its script and style sheet');
    for (const reference of references) {
      assert.match(reference, /^\/[^/]/, `${reference} must be a same-origin path`);
      const asset = await fetch(baseUrl + reference);
      assert.equal(asset.status, 200, reference);
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', reference);
      if (reference.endsWith('.css')) {
        assert.doesNotMatch(await asset.text(), /@import|url\(\s*['"]?(?:https?:)?\/\//, `${reference} loads a remote resource`);
      } else {
        await asset.arrayBuffer();
      }
    }
  });

  it('answers the API on the same origin', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { status: string }).status, 'ok');
  });

  it('registers a local account offline through the compiled API, and refuses a duplicate and a weak password', async () => {
    const client = createApiClient(baseUrl);
    const signal = new AbortController().signal;
    const providers = await loadProviders(client, signal);
    assert.deepEqual(providers, { ok: true, data: [] }, 'without provider credentials the installation works offline');

    const created = await registerLocal(client, { username: 'Offline_User', password: 'a long enough passphrase' }, newIdempotencyKey(), signal);
    assert.ok(created.ok);
    assert.equal(created.data.registeredWith, 'local');
    assert.equal(created.data.role, 'user');

    const duplicate = await registerLocal(client, { username: 'offline_user', password: 'a long enough passphrase' }, newIdempotencyKey(), signal);
    assert.ok(!duplicate.ok);
    assert.equal(describeFailure(duplicate.failure).message, 'errorUsernameTaken');

    const weak = await registerLocal(client, { username: 'another_user', password: 'weak' }, newIdempotencyKey(), signal);
    assert.ok(!weak.ok);
    assert.equal(describeFailure(weak.failure).message, 'errorPasswordInvalid');
  });
});

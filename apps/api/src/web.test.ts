import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createApp } from './app.ts';
import { ConfigError } from './config.ts';
import { silentLogger } from './log.ts';
import { assertWebDir, contentSecurityPolicy } from './web.ts';

const shell = '<!doctype html><title>Nihon</title><div id="root"></div>';

async function serve(webDir?: string): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer(createApp({ version: '1.2.3', modules: [], logger: silentLogger, webDir }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const html: RequestInit = { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } };

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe('Web interface serving', () => {
  let webDir: string;
  let baseUrl: string;
  let server: Server;

  before(async () => {
    webDir = mkdtempSync(join(tmpdir(), 'nihon-web-'));
    writeFileSync(join(webDir, 'index.html'), shell);
    writeFileSync(join(webDir, 'chunk-2k2eh5mk.js'), 'console.log("app");');
    writeFileSync(join(webDir, 'robots.txt'), 'User-agent: *');
    writeFileSync(join(webDir, '.secret'), 'hidden');
    ({ baseUrl, server } = await serve(webDir));
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(webDir, { recursive: true, force: true });
  });

  it('serves the shell for every page address, including a reload with a query identifier', async () => {
    for (const path of ['/', '/learn', '/library/', '/reader?media=item-01', '/no-such-page', '/a/b']) {
      const response = await fetch(baseUrl + path, html);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html/, path);
      assert.equal(await response.text(), shell, path);
      assert.equal(response.headers.get('content-security-policy'), contentSecurityPolicy);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
  });

  it('answers HEAD requests for a page without a body', async () => {
    const response = await fetch(`${baseUrl}/kanji`, { ...html, method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  });

  it('serves hashed bundle files as immutable and other files as revalidated', async () => {
    const bundle = await fetch(`${baseUrl}/chunk-2k2eh5mk.js`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/);
    assert.equal(bundle.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(await bundle.text(), 'console.log("app");');

    const plain = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(plain.headers.get('cache-control'), 'no-cache');
  });

  it('keeps missing files, hidden files, and other methods as 404', async () => {
    const cases: ReadonlyArray<readonly [string, RequestInit]> = [
      ['/chunk-missing0.js', html],
      ['/.secret', html],
      ['/learn', { ...html, method: 'POST' }],
      ['/learn', { headers: { Accept: 'application/json' } }],
    ];
    for (const [path, init] of cases) {
      const response = await fetch(baseUrl + path, init);
      assert.equal(response.status, 404, `${init.method ?? 'GET'} ${path}`);
      assert.equal(await errorCode(response), 'not_found');
    }
  });

  it('does not escape the Web directory', async () => {
    const response = await fetch(`${baseUrl}/..%2f..%2fetc%2fpasswd`, html);
    assert.notEqual(response.status, 200);
  });

  it('keeps every /api address JSON only', async () => {
    const health = await fetch(`${baseUrl}/api/health`, html);
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { status: string }).status, 'ok');
    for (const path of ['/api', '/api/missing', '/api/missing/page']) {
      const response = await fetch(baseUrl + path, html);
      assert.equal(response.status, 404, path);
      assert.equal(await errorCode(response), 'not_found', path);
    }
  });
});

describe('API without a Web directory', () => {
  it('answers page addresses with the JSON 404', async () => {
    const { baseUrl, server } = await serve();
    try {
      const response = await fetch(`${baseUrl}/`, html);
      assert.equal(response.status, 404);
      assert.equal(await errorCode(response), 'not_found');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('assertWebDir', () => {
  it('refuses a directory without index.html', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nihon-web-empty-'));
    try {
      assert.throws(() => assertWebDir(empty), ConfigError);
      writeFileSync(join(empty, 'index.html'), shell);
      assert.doesNotThrow(() => assertWebDir(empty));
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

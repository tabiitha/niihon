import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createApp, type AppOptions } from './app.ts';
import { silentLogger } from './log.ts';
import type { ApiModule } from './modules/api-module.ts';
import { selectEnabledModules } from './modules/enablement.ts';

const exampleModule: ApiModule = {
  id: 'example',
  register(router) {
    router.get('/ping', (_request, response) => {
      response.json({ pong: true });
    });
    router.post('/items', (_request, response) => {
      response.status(201).json({ created: true });
    });
    router.get('/fail', () => {
      throw new Error('boom');
    });
  },
};

async function serve(options: Partial<AppOptions> = {}): Promise<{ baseUrl: string; server: Server }> {
  const app = createApp({ version: '1.2.3', modules: [], logger: silentLogger, ...options });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('HTTP application', () => {
  let baseUrl: string;
  let server: Server;
  let stopping = false;

  before(async () => {
    ({ baseUrl, server } = await serve({ modules: [exampleModule], isStopping: () => stopping }));
  });
  after(() => close(server));

  it('reports availability and version', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'nihon-api', version: '1.2.3' });
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  it('answers unknown routes with a JSON 404', async () => {
    const response = await fetch(`${baseUrl}/api/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: 'not_found', message: 'No route matches GET /api/missing.' },
    });
  });

  it('mounts an enabled module under its identifier', async () => {
    const response = await fetch(`${baseUrl}/api/example/ping`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { pong: true });
  });

  it('hides unexpected errors behind a JSON 500', async () => {
    const response = await fetch(`${baseUrl}/api/example/fail`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: 'internal_error', message: 'An unexpected error occurred.' },
    });
  });

  it('refuses new requests while stopping', async () => {
    stopping = true;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('connection'), 'close');
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'stopping');
    } finally {
      stopping = false;
    }
  });
});

describe('disabled module', () => {
  it('exposes no route at all', async () => {
    const modules = selectEnabledModules([exampleModule], []);
    const { baseUrl, server } = await serve({ modules });
    try {
      for (const [method, path] of [
        ['GET', '/api/example/ping'],
        ['POST', '/api/example/items'],
        ['GET', '/api/example'],
      ] as const) {
        const response = await fetch(`${baseUrl}${path}`, { method });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'not_found');
      }
      assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    } finally {
      await close(server);
    }
  });
});

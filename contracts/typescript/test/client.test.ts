import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import createClient from 'openapi-fetch';

import {
  apiMajorVersion,
  apiVersion,
  apiVersionHeader,
  createNihonClient,
  NihonApiError,
  paginate,
  type NihonClient,
} from '../src/index.ts';
import type { components, paths } from './conformance-schema.ts';
import { startFixtureServer, type FixtureServer } from './fixture-server.ts';

type ExampleItem = components['schemas']['ExampleItem'];

const fixtureItems = JSON.parse(
  readFileSync(new URL('../../fixtures/example-items.json', import.meta.url), 'utf8'),
) as ExampleItem[];

describe('generated TypeScript client', () => {
  let server: FixtureServer;
  let client: NihonClient<paths>;

  before(async () => {
    server = await startFixtureServer();
    client = createNihonClient<paths>({ baseUrl: server.baseUrl });
  });
  after(() => server.stop());

  it('reads a successful response', async () => {
    const { data, error, response } = await client.GET('/api/health');
    assert.equal(error, undefined);
    assert.equal(response.status, 200);
    assert.equal(data?.status, 'ok');
    assert.equal(data?.apiVersion, apiVersion);
    assert.equal(Number(data?.apiVersion.split('.')[0]), apiMajorVersion);
    assert.match(response.headers.get('nihon-request-id') ?? '', /^[0-9a-f-]{36}$/);
  });

  it('reads one item with its UTC timestamp', async () => {
    const { data } = await client.GET('/api/example/items/{itemId}', { params: { path: { itemId: 'item-02' } } });
    assert.deepEqual(data, fixtureItems[1]);
    assert.equal(new Date(data!.createdAt).toISOString(), data!.createdAt);
  });

  it('returns a typed error', async () => {
    const { data, error, response } = await client.GET('/api/example/items/{itemId}', {
      params: { path: { itemId: 'missing' } },
    });
    assert.equal(data, undefined);
    assert.equal(response.status, 404);
    assert.equal(error?.error.code, 'example_item_not_found');
    assert.equal(error?.error.requestId, response.headers.get('nihon-request-id'));
  });

  it('reports invalid input per field', async () => {
    const { error, response } = await client.GET('/api/example/items', { params: { query: { limit: 0 } } });
    assert.equal(response.status, 400);
    assert.equal(error?.error.code, 'validation_failed');
    assert.deepEqual(
      error?.error.issues?.map((issue) => issue.path),
      ['query.limit'],
    );
  });

  it('walks every page in a stable order', async () => {
    const pages: string[][] = [];
    for await (const items of paginate((cursor) =>
      client.GET('/api/example/items', { params: { query: { limit: 2, ...(cursor === undefined ? {} : { cursor }) } } }),
    )) {
      pages.push(items.map((item) => item.id));
    }
    assert.deepEqual(pages, [['item-01', 'item-02'], ['item-03', 'item-04'], ['item-05']]);
  });

  it('refuses a tampered cursor with a typed error', async () => {
    const { error, response } = await client.GET('/api/example/items', { params: { query: { cursor: 'not-a-cursor' } } });
    assert.equal(response.status, 400);
    assert.equal(error?.error.code, 'validation_failed');
    assert.equal(error?.error.issues?.[0]?.path, 'query.cursor');
  });

  it('throws NihonApiError when a page fails', async () => {
    await assert.rejects(
      async () => {
        for await (const _ of paginate(() => client.GET('/api/example/items', { params: { query: { cursor: '!' } } }))) {
          assert.fail('no page expected');
        }
      },
      (error: unknown) => error instanceof NihonApiError && error.status === 400 && error.code === 'validation_failed',
    );
  });

  it('is refused by the server when generated for another major version', async () => {
    const incompatible = createClient<paths>({
      baseUrl: server.baseUrl,
      headers: { [apiVersionHeader]: String(apiMajorVersion + 1) },
    });
    const { data, error, response } = await incompatible.GET('/api/example/items');
    assert.equal(data, undefined);
    assert.equal(response.status, 400);
    assert.equal(error?.error.code, 'unsupported_api_version');

    const health = await incompatible.GET('/api/health');
    assert.equal(health.response.status, 200, 'health stays reachable so the client can explain the mismatch');
  });

  it('cancels a request that is no longer needed', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(client.GET('/api/example/items', { signal: controller.signal }), { name: 'AbortError' });
  });
});

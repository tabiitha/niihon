import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { z } from 'zod';

import { createApp } from '../app.ts';
import { silentLogger } from '../log.ts';
import { exampleItems, exampleModule } from '../../test/fixtures/example-module.ts';
import { unusedDatabase } from '../../test/fixtures/unused-database.ts';
import { apiMajorVersion, errorResponseSchema, timestampSchema } from './conventions.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';
import { ApiError, toExpressPath } from './operation.ts';

describe('contract conventions over HTTP', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createServer(createApp({ version: '1.2.3', modules: [exampleModule], database: unusedDatabase, logger: silentLogger }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl}${path}`, { headers });

  async function errorOf(response: Response): Promise<z.output<typeof errorResponseSchema>['error']> {
    return errorResponseSchema.parse(await response.json()).error;
  }

  it('accepts requests without a version header and with the current major', async () => {
    assert.equal((await get('/api/example/items')).status, 200);
    assert.equal((await get('/api/example/items', { 'Nihon-API-Version': String(apiMajorVersion) })).status, 200);
  });

  it('refuses another or malformed major version with a typed error', async () => {
    for (const declared of [String(apiMajorVersion + 1), '0', 'v1', '1.0']) {
      const response = await get('/api/example/items', { 'Nihon-API-Version': declared });
      assert.equal(response.status, 400, declared);
      assert.equal((await errorOf(response)).code, 'unsupported_api_version', declared);
    }
  });

  it('keeps health available to incompatible clients', async () => {
    const response = await get('/api/health', { 'Nihon-API-Version': String(apiMajorVersion + 1) });
    assert.equal(response.status, 200);
  });

  it('echoes a well-formed request identifier and replaces a malformed one', async () => {
    const echoed = await get('/api/example/items/missing', { 'Nihon-Request-Id': 'client-42' });
    assert.equal(echoed.headers.get('nihon-request-id'), 'client-42');
    assert.equal((await errorOf(echoed)).requestId, 'client-42');

    const replaced = await get('/api/health', { 'Nihon-Request-Id': 'x'.repeat(65) });
    assert.match(replaced.headers.get('nihon-request-id') ?? '', /^[0-9a-f-]{36}$/);
  });

  it('validates path and query parameters', async () => {
    const response = await get('/api/example/items?limit=500&cursor=');
    assert.equal(response.status, 400);
    const error = await errorOf(response);
    assert.equal(error.code, 'validation_failed');
    assert.deepEqual(error.issues?.map((issue) => issue.path).sort(), ['query.cursor', 'query.limit']);

    const badId = await errorOf(await get('/api/example/items/bad%20id'));
    assert.deepEqual(badId.issues?.map((issue) => issue.path), ['path.itemId']);
  });

  it('pages through a collection with a default limit and stable cursors', async () => {
    const all = (await (await get('/api/example/items')).json()) as { items: unknown[]; nextCursor: string | null };
    assert.equal(all.items.length, exampleItems.length);
    assert.equal(all.nextCursor, null);

    const first = (await (await get('/api/example/items?limit=4')).json()) as { nextCursor: string };
    const again = (await (await get('/api/example/items?limit=4')).json()) as { nextCursor: string };
    assert.equal(first.nextCursor, again.nextCursor);
    const last = (await (await get(`/api/example/items?limit=4&cursor=${first.nextCursor}`)).json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    assert.deepEqual(last.items.map((item) => item.id), ['item-05']);
    assert.equal(last.nextCursor, null);
  });
});

describe('cursors', () => {
  const schema = z.object({ after: z.string() });

  it('round-trip a position', () => {
    assert.deepEqual(decodeCursor(encodeCursor({ after: 'item-02' }), schema), { after: 'item-02' });
  });

  it('reject anything that is not a cursor of the expected shape', () => {
    for (const cursor of ['!', encodeCursor({ before: 'x' }), encodeCursor('item'), 'e30']) {
      assert.throws(
        () => decodeCursor(cursor, schema),
        (error: unknown) => error instanceof ApiError && error.code === 'validation_failed' && error.status === 400,
        cursor,
      );
    }
  });
});

describe('timestamps', () => {
  it('accept UTC instants with millisecond precision only', () => {
    assert.ok(timestampSchema.safeParse(new Date(0).toISOString()).success);
    for (const value of ['2026-10-15T08:30:00Z', '2026-10-15T08:30:00.000+02:00', '2026-10-15']) {
      assert.equal(timestampSchema.safeParse(value).success, false, value);
    }
  });
});

describe('toExpressPath', () => {
  it('converts OpenAPI path parameters', () => {
    assert.equal(toExpressPath('/items/{itemId}/tags/{tag_id}'), '/items/:itemId/tags/:tag_id');
    assert.equal(toExpressPath('/items'), '/items');
  });
});

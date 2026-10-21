import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { z } from 'zod';

import { unusedDatabase } from '../../test/fixtures/unused-database.ts';
import { createApp } from '../app.ts';
import { silentLogger } from '../log.ts';
import type { ApiModule } from '../modules/api-module.ts';
import { addOperation, ApiError, defineOperation, parseInput } from './operation.ts';

const echo = defineOperation({
  operationId: 'echo',
  method: 'post',
  path: '/echo',
  summary: 'Echo a name',
  body: z.strictObject({ name: z.string().min(1) }),
  maxBodyBytes: 64,
  responses: { 200: { description: 'The name.', schema: z.object({ name: z.string() }) } },
});

const refuse = defineOperation({
  operationId: 'refuse',
  method: 'post',
  path: '/refuse',
  summary: 'Always refuse, asking to retry',
  responses: { 200: { description: 'Never.', schema: z.object({}) } },
});

const bodyModule: ApiModule = {
  id: 'body',
  operations: [echo, refuse],
  register(router) {
    addOperation(router, echo).handle(({ body }) => ({ status: 200, body: { name: body.name } }));
    addOperation(router, refuse).handle(() => {
      throw new ApiError(503, 'body_busy', 'Busy.', undefined, { 'Retry-After': '7' });
    });
  },
};

interface ErrorBody {
  error: { code: string };
}

describe('operations with a JSON body', () => {
  let server: Server;
  let baseUrl: string;
  before(async () => {
    server = createServer(createApp({ version: '1.2.3', modules: [bodyModule], database: unusedDatabase, logger: silentLogger }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (path: string, body: string, contentType = 'application/json') =>
    fetch(`${baseUrl}/api/body${path}`, { method: 'POST', headers: { 'content-type': contentType }, body });

  it('hands the parsed body to the handler', async () => {
    const response = await post('/echo', '{"name":"さくら"}');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: 'さくら' });
  });

  it('names an unexpected field without echoing its value', async () => {
    const response = await post('/echo', '{"name":"a","role":"secret-value"}');
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.ok(!text.includes('secret-value'));
    assert.deepEqual(JSON.parse(text).error.issues, [{ path: 'body.role', message: 'Unrecognized field.' }]);
  });

  it('refuses a body above the limit, another media type, and malformed JSON', async () => {
    const large = await post('/echo', JSON.stringify({ name: 'x'.repeat(100) }));
    assert.equal(large.status, 413);
    assert.equal(((await large.json()) as ErrorBody).error.code, 'payload_too_large');

    const text = await post('/echo', '{"name":"a"}', 'text/plain');
    assert.equal(text.status, 415);
    assert.equal(((await text.json()) as ErrorBody).error.code, 'unsupported_media_type');

    const malformed = await post('/echo', '{"name":');
    assert.equal(malformed.status, 400);
    assert.equal(((await malformed.json()) as ErrorBody).error.code, 'bad_request');
  });

  it('sends the headers of an ApiError', async () => {
    const response = await post('/refuse', '{}');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '7');
  });

  it('reports unexpected keys at their own path', () => {
    assert.throws(
      () => parseInput(z.strictObject({ a: z.string() }), { a: 'x', b: 1, c: 2 }, 'body'),
      (error: unknown) =>
        error instanceof ApiError &&
        JSON.stringify(error.issues) === JSON.stringify([{ path: 'body.b', message: 'Unrecognized field.' }, { path: 'body.c', message: 'Unrecognized field.' }]),
    );
  });
});

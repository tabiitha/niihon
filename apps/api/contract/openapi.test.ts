import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { z } from 'zod';

import { defineOperation } from '../src/contract/operation.ts';
import type { ApiModule } from '../src/modules/api-module.ts';
import { registeredModules } from '../src/modules/registry.ts';
import { exampleModule } from '../test/fixtures/example-module.ts';
import { buildOpenApiDocument } from './openapi.ts';

const committed = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));

const moduleWith = (id: string, operations: ApiModule['operations']): ApiModule => ({ id, operations, register: () => {} });

const ping = defineOperation({
  operationId: 'ping',
  method: 'get',
  path: '/ping',
  summary: 'Ping',
  responses: { 200: { description: 'Pong', schema: z.object({ pong: z.boolean() }) } },
});

describe('buildOpenApiDocument', () => {
  it('matches the committed contracts', () => {
    assert.deepEqual(buildOpenApiDocument({ title: 'Nihon API', modules: registeredModules }), committed('contracts/openapi.json'));
    assert.deepEqual(
      buildOpenApiDocument({ title: 'Nihon API conformance fixture', modules: [exampleModule] }),
      committed('contracts/fixtures/openapi.json'),
    );
  });

  it('prefixes module paths and documents the common errors', () => {
    const document = buildOpenApiDocument({ title: 'Test', modules: [moduleWith('review', [ping])] });
    const operation = document.paths?.['/api/review/ping']?.get;
    assert.equal(operation?.operationId, 'ping');
    assert.deepEqual(operation?.tags, ['review']);
    assert.deepEqual(Object.keys(operation?.responses ?? {}).sort(), ['200', '400', 'default']);
  });

  it('documents the idempotency key, the replay header, and the idempotency errors of a command', () => {
    const create = defineOperation({
      operationId: 'createThing',
      method: 'post',
      path: '/things',
      summary: 'Create',
      body: z.strictObject({ name: z.string() }),
      idempotent: true,
      responses: { 201: { description: 'Created', schema: z.object({ id: z.string() }) } },
      errors: { 409: 'Taken (`thing_taken`).' },
    });
    const operation = buildOpenApiDocument({ title: 'Test', modules: [moduleWith('things', [create])] }).paths?.['/api/things/things']?.post;
    const [header] = (operation?.parameters ?? []) as { in: string; name: string; required: boolean }[];
    assert.deepEqual([header?.in, header?.name, header?.required], ['header', 'Idempotency-Key', false]);
    assert.deepEqual(Object.keys(operation?.responses ?? {}).sort(), ['201', '400', '409', '413', '415', '422', '503', 'default']);
    const responses = operation?.responses as Record<string, { description: string; headers?: Record<string, unknown> }>;
    assert.ok(responses['201']?.headers?.['Idempotent-Replayed']);
    assert.match(responses['409']?.description ?? '', /thing_taken.*idempotency_key_in_use/);
    assert.match(responses['422']?.description ?? '', /idempotency_key_reused/);
    assert.match(responses['503']?.description ?? '', /idempotency_capacity_reached/);

    const plain = buildOpenApiDocument({ title: 'Test', modules: [moduleWith('review', [ping])] }).paths?.['/api/review/ping']?.get;
    assert.equal(plain?.parameters, undefined);
  });

  it('documents an event stream, its request headers, and publishes its event payloads', () => {
    const payload = z.object({ topic: z.string() }).meta({ id: 'ThingChanged' });
    const follow = defineOperation({
      operationId: 'followThings',
      method: 'get',
      path: '/stream',
      summary: 'Follow',
      headers: z.object({ 'Last-Event-ID': z.string().optional() }),
      responses: { 200: { description: 'Events', events: { change: payload } } },
    });
    const document = buildOpenApiDocument({ title: 'Test', modules: [moduleWith('things', [follow])] });
    const operation = document.paths?.['/api/things/stream']?.get;
    const [header] = (operation?.parameters ?? []) as { in: string; name: string; required: boolean }[];
    assert.deepEqual([header?.in, header?.name, header?.required], ['header', 'Last-Event-ID', false]);
    const success = (operation?.responses as Record<string, { content?: Record<string, { schema: { description: string } }> }>)['200'];
    assert.deepEqual(Object.keys(success?.content ?? {}), ['text/event-stream']);
    assert.match(success?.content?.['text/event-stream']?.schema.description ?? '', /`change` carries `ThingChanged`/);
    assert.ok(document.components?.schemas?.['ThingChanged']);
    assert.match((operation?.responses as Record<string, { description: string }>)['400']?.description ?? '', /validation_failed/);

    const anonymous = defineOperation({ ...follow, responses: { 200: { description: 'Events', events: { change: z.object({}) } } } });
    assert.throws(() => buildOpenApiDocument({ title: 'Test', modules: [moduleWith('things', [anonymous])] }), /schema identifier/);
  });

  it('rejects duplicate operation identifiers', () => {
    assert.throws(
      () => buildOpenApiDocument({ title: 'Test', modules: [moduleWith('a', [ping]), moduleWith('b', [ping])] }),
      /declared more than once/,
    );
  });
});

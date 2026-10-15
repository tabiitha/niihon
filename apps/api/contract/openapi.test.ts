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

  it('rejects duplicate operation identifiers', () => {
    assert.throws(
      () => buildOpenApiDocument({ title: 'Test', modules: [moduleWith('a', [ping]), moduleWith('b', [ping])] }),
      /declared more than once/,
    );
  });
});

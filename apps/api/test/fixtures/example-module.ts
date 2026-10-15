import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { identifierSchema, pageQuerySchema, pageSchema, timestampSchema } from '../../src/contract/conventions.ts';
import { decodeCursor, encodeCursor } from '../../src/contract/cursor.ts';
import { addOperation, ApiError, defineOperation } from '../../src/contract/operation.ts';
import type { ApiModule } from '../../src/modules/api-module.ts';

/**
 * Conformance fixture: a read-only module that exercises the contract conventions (pagination,
 * typed errors, timestamps) for the generated clients. It is never registered in the server;
 * contracts/fixtures/openapi.json describes it, and the client tests call it through serve.ts.
 */

const exampleItemSchema = z
  .object({
    id: identifierSchema,
    label: z.string(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'ExampleItem', description: 'Fixture item.' });

export const exampleItems: readonly z.output<typeof exampleItemSchema>[] = z
  .array(exampleItemSchema)
  .parse(JSON.parse(readFileSync(new URL('../../../../contracts/fixtures/example-items.json', import.meta.url), 'utf8')))
  .toSorted((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

const cursorSchema = z.object({ after: identifierSchema });

export const listExampleItems = defineOperation({
  operationId: 'listExampleItems',
  method: 'get',
  path: '/items',
  summary: 'List fixture items by identifier',
  query: pageQuerySchema,
  responses: {
    200: { description: 'One page of items.', schema: pageSchema(exampleItemSchema, 'ExampleItemPage') },
  },
});

export const getExampleItem = defineOperation({
  operationId: 'getExampleItem',
  method: 'get',
  path: '/items/{itemId}',
  summary: 'Read one fixture item',
  params: z.object({ itemId: identifierSchema }),
  responses: {
    200: { description: 'The item.', schema: exampleItemSchema },
  },
  errors: {
    404: 'No item has this identifier (`example_item_not_found`).',
  },
});

export const exampleModule: ApiModule = {
  id: 'example',
  operations: [listExampleItems, getExampleItem],
  register(router) {
    addOperation(router, listExampleItems).handle(({ query }) => {
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorSchema).after;
      const remaining = after === undefined ? exampleItems : exampleItems.filter((item) => item.id > after);
      const items = remaining.slice(0, query.limit);
      const last = items.at(-1);
      const nextCursor =
        last !== undefined && remaining.length > items.length ? encodeCursor({ after: last.id }) : null;
      return { status: 200, body: { items, nextCursor } };
    });

    addOperation(router, getExampleItem).handle(({ params }) => {
      const item = exampleItems.find((candidate) => candidate.id === params.itemId);
      if (item === undefined) {
        throw new ApiError(404, 'example_item_not_found', `No example item has the identifier ${params.itemId}.`);
      }
      return { status: 200, body: item };
    });
  },
};

import { z } from 'zod';

import { defineOperation } from './operation.ts';

export const healthSchema = z
  .object({
    status: z.literal('ok'),
    service: z.literal('nihon-api'),
    version: z.string().meta({ description: 'Server release, from apps/api/package.json.' }),
    apiVersion: z.string().meta({ description: 'Contract version the server implements; clients compare its major part.' }),
  })
  .meta({ id: 'Health', description: 'Server availability and versions.' });

/** Unversioned so that any client can discover whether it is compatible before calling anything else. */
export const getHealth = defineOperation({
  operationId: 'getHealth',
  method: 'get',
  path: '/health',
  summary: 'Report server availability and versions',
  versioned: false,
  responses: {
    200: { description: 'The server is available.', schema: healthSchema },
  },
});

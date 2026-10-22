import { OpenApiGeneratorV31, OpenAPIRegistry, type ResponseConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { coreOperations } from '../src/app.ts';
import {
  apiMajorVersion,
  apiVersion,
  apiVersionHeader,
  errorResponseSchema,
  idempotencyKeyHeader,
  idempotencyKeySchema,
  idempotentReplayedHeader,
  requestIdHeader,
} from '../src/contract/conventions.ts';
import { defaultMaxBodyBytes, type OperationContract } from '../src/contract/operation.ts';
import type { ApiModule } from '../src/modules/api-module.ts';

export interface OpenApiDocumentOptions {
  readonly title: string;
  readonly modules: readonly ApiModule[];
}

const description = `REST contract of the local Nihon server. Generated from the server's operation declarations; do not edit.

Generated clients send \`${apiVersionHeader}: ${apiMajorVersion}\`. The server refuses a different major version with \`400 unsupported_api_version\`; \`GET /api/health\` stays available to every client and reports \`apiVersion\`. Every response carries \`${requestIdHeader}\`, also present in error bodies. Conventions: docs/architecture/api-contract.md.`;

/** Builds the OpenAPI 3.1 document of the foundation operations and the given modules. */
export function buildOpenApiDocument({ title, modules }: OpenApiDocumentOptions): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const registry = new OpenAPIRegistry();
  const groups = [
    { prefix: '/api', tag: 'server', operations: coreOperations },
    ...modules.map((module) => ({ prefix: `/api/${module.id}`, tag: module.id, operations: module.operations })),
  ];
  const operationIds = new Set<string>();
  for (const { prefix, tag, operations } of groups) {
    for (const operation of operations) {
      if (operationIds.has(operation.operationId)) {
        throw new Error(`Operation identifier "${operation.operationId}" is declared more than once.`);
      }
      operationIds.add(operation.operationId);
      if (operation.versioned === false && operation.params !== undefined) {
        throw new Error(`Unversioned operation "${operation.operationId}" must have a fixed path.`);
      }
      registry.registerPath({
        method: operation.method,
        path: prefix + operation.path,
        operationId: operation.operationId,
        summary: operation.summary,
        ...(operation.description === undefined ? {} : { description: operation.description }),
        tags: [tag],
        request: {
          ...(operation.params === undefined ? {} : { params: operation.params }),
          ...(operation.query === undefined ? {} : { query: operation.query }),
          ...(operation.idempotent === true ? { headers: z.object({ [idempotencyKeyHeader]: idempotencyKeySchema.optional() }) } : {}),
          ...(operation.body === undefined
            ? {}
            : { body: { required: true, content: { 'application/json': { schema: operation.body } } } }),
        },
        responses: responsesOf(operation),
      });
    }
  }

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title, version: apiVersion, description },
    servers: [{ url: 'http://127.0.0.1:4000', description: 'Default local installation' }],
    tags: groups.map(({ tag }) => ({ name: tag })),
  });
}

function responsesOf(operation: OperationContract): Record<string, ResponseConfig> {
  const responses: Record<string, ResponseConfig> = {};
  for (const [status, response] of Object.entries(operation.responses)) {
    responses[status] = {
      description: response.description,
      ...(operation.idempotent === true
        ? {
            headers: {
              [idempotentReplayedHeader]: {
                description: `\`true\` when this is the stored response of a command already committed under the same \`${idempotencyKeyHeader}\`; the effect was not repeated.`,
                schema: { type: 'string', enum: ['true'] },
              },
            },
          }
        : {}),
      content: { 'application/json': { schema: response.schema } },
    };
  }
  const errors: Record<string, string> = { ...operation.errors };
  if (operation.idempotent === true) {
    const idempotencyErrors: Record<number, string> = {
      409: `A request with the same \`${idempotencyKeyHeader}\` is still running; retry after \`Retry-After\` (\`idempotency_key_in_use\`).`,
      422: `The \`${idempotencyKeyHeader}\` was already used by another caller, operation, or input (\`idempotency_key_reused\`); nothing was done.`,
      503: `Too many recent keyed commands are recorded; retry after \`Retry-After\` (\`idempotency_capacity_reached\`).`,
    };
    for (const [status, meaning] of Object.entries(idempotencyErrors)) {
      errors[Number(status)] = errors[Number(status)] === undefined ? meaning : `${errors[Number(status)]} ${meaning}`;
    }
  }
  if (operation.body !== undefined) {
    errors[413] ??= `Body larger than ${String(operation.maxBodyBytes ?? defaultMaxBodyBytes)} bytes (\`payload_too_large\`).`;
    errors[415] ??= 'Body that is not `application/json` (`unsupported_media_type`).';
  }
  const commonBadRequest = [
    ...(operation.params !== undefined || operation.query !== undefined || operation.body !== undefined
      ? ['invalid input (`validation_failed`)']
      : []),
    ...(operation.versioned === false ? [] : ['incompatible client (`unsupported_api_version`)']),
  ];
  if (commonBadRequest.length > 0) {
    const common = `Refused request: ${commonBadRequest.join(' or ')}.`;
    errors[400] = errors[400] === undefined ? common : `${common} ${errors[400]}`;
  }
  for (const [status, meaning] of Object.entries(errors)) {
    responses[status] = { description: meaning, content: { 'application/json': { schema: errorResponseSchema } } };
  }
  responses['default'] = {
    description: 'Any other error, such as `internal_error` (500), `stopping` (503), or `database_busy` (503).',
    content: { 'application/json': { schema: errorResponseSchema } },
  };
  return responses;
}

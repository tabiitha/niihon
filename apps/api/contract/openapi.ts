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
import { sessionCookieName } from '../src/sessions/token.ts';

export interface OpenApiDocumentOptions {
  readonly title: string;
  readonly modules: readonly ApiModule[];
}

const description = `REST contract of the local Nihon server. Generated from the server's operation declarations; do not edit.

Generated clients send \`${apiVersionHeader}: ${apiMajorVersion}\`. The server refuses a different major version with \`400 unsupported_api_version\`; \`GET /api/health\` stays available to every client and reports \`apiVersion\`. Every response carries \`${requestIdHeader}\`, also present in error bodies. Conventions: docs/architecture/api-contract.md.`;

/** Builds the OpenAPI 3.1 document of the foundation operations and the given modules. */
export function buildOpenApiDocument({ title, modules }: OpenApiDocumentOptions): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const registry = new OpenAPIRegistry();
  if (groups(modules).some(({ operations }) => operations.some((operation) => operation.session !== undefined))) {
    registry.registerComponent('securitySchemes', sessionCookieScheme, {
      type: 'apiKey',
      in: 'cookie',
      name: sessionCookieName,
      description: 'HttpOnly session cookie set by the server for a `web` client at sign-in.',
    });
    registry.registerComponent('securitySchemes', sessionTokenScheme, {
      type: 'http',
      scheme: 'bearer',
      description: 'Opaque session token returned to a `native` client at sign-in, sent as `Authorization: Bearer <token>`.',
    });
  }
  const operationIds = new Set<string>();
  const eventSchemas: z.ZodType[] = [];
  for (const { prefix, tag, operations } of groups(modules)) {
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
        ...(operation.session === undefined
          ? {}
          : {
              // An empty requirement makes the session optional: the client sends it when it has one.
              security: [{ [sessionCookieScheme]: [] }, { [sessionTokenScheme]: [] }, ...(operation.session === 'optional' ? [{}] : [])],
            }),
        request: {
          ...(operation.params === undefined ? {} : { params: operation.params }),
          ...(operation.query === undefined ? {} : { query: operation.query }),
          ...(operation.idempotent === true || operation.headers !== undefined
            ? {
                headers: z.object({
                  ...(operation.idempotent === true ? { [idempotencyKeyHeader]: idempotencyKeySchema.optional() } : {}),
                  ...operation.headers?.shape,
                }),
              }
            : {}),
          ...(operation.body === undefined
            ? {}
            : { body: { required: true, content: { 'application/json': { schema: operation.body } } } }),
        },
        responses: responsesOf(operation),
      });
      // Event payloads are not referenced by the stream schema: publish them so clients can decode them.
      for (const response of Object.values(operation.responses)) {
        for (const schema of Object.values(response.events ?? {})) {
          const id = z.globalRegistry.get(schema)?.id;
          if (id === undefined) {
            throw new Error(`An event payload of "${operation.operationId}" needs a schema identifier (meta id).`);
          }
          eventSchemas.push(schema);
        }
      }
    }
  }

  return new OpenApiGeneratorV31([
    ...registry.definitions,
    ...eventSchemas.map((schema) => ({ type: 'schema' as const, schema })),
  ]).generateDocument({
    openapi: '3.1.0',
    info: { title, version: apiVersion, description },
    servers: [{ url: 'http://127.0.0.1:4000', description: 'Default local installation' }],
    tags: groups(modules).map(({ tag }) => ({ name: tag })),
  });
}

const sessionCookieScheme = 'sessionCookie';
const sessionTokenScheme = 'sessionToken';

function groups(modules: readonly ApiModule[]) {
  return [
    { prefix: '/api', tag: 'server', operations: coreOperations },
    ...modules.map((module) => ({ prefix: `/api/${module.id}`, tag: module.id, operations: module.operations })),
  ];
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
      ...(response.schema === undefined ? {} : { content: { 'application/json': { schema: response.schema } } }),
      ...(response.events === undefined
        ? {}
        : {
            content: {
              'text/event-stream': {
                schema: {
                  type: 'string',
                  description: `Server-sent events. Each event's \`data\` is one line of JSON: ${Object.entries(response.events)
                    .map(([name, schema]) => `\`${name}\` carries \`${String(z.globalRegistry.get(schema)?.id)}\``)
                    .join(', ')}.`,
                },
              },
            },
          }),
    };
  }
  const errors: Record<string, string> = { ...operation.errors };
  if (operation.session === 'required') {
    const meaning = 'No valid session: never signed in, signed out, or expired (`authentication_required`); sign in again.';
    errors[401] = errors[401] === undefined ? meaning : `${meaning} ${errors[401]}`;
  }
  if (operation.idempotent === true) {
    const idempotencyErrors: Record<number, string> = {
      409: `A request with the same \`${idempotencyKeyHeader}\` is still running; retry after \`Retry-After\` (\`idempotency_key_in_use\`).`,
      422: `The \`${idempotencyKeyHeader}\` was already used by another caller, operation, or input (\`idempotency_key_reused\`); nothing was done.`,
      503: `Too many recent keyed commands are recorded (\`idempotency_capacity_reached\`): nothing was done; space frees as records expire, and the command can be sent without a key.`,
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
    ...(operation.params !== undefined || operation.query !== undefined || operation.headers !== undefined || operation.body !== undefined
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

import type { Request, Router } from 'express';
import { z } from 'zod';

import { errorCodes } from './conventions.ts';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface ResponseContract {
  readonly description: string;
  readonly schema: z.ZodType;
}

/**
 * One REST operation. The same declaration validates requests at runtime and produces the
 * OpenAPI document from which the TypeScript and Swift clients are generated.
 */
export interface OperationContract {
  /** Unique across the API; becomes the generated client method name. */
  readonly operationId: string;
  readonly method: HttpMethod;
  /** Path relative to the module prefix (`/api/<id>`), with OpenAPI `{name}` parameters. */
  readonly path: string;
  readonly summary: string;
  readonly description?: string;
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  /** Success responses by status code. */
  readonly responses: Readonly<Record<number, ResponseContract>>;
  /** Error statuses this operation documents beyond the common ones, with their meaning. */
  readonly errors?: Readonly<Record<number, string>>;
  /** False only for operations a client calls before knowing whether it is compatible. */
  readonly versioned?: boolean;
}

/** Keeps the literal types of a declaration so handlers are checked against it. */
export function defineOperation<const Operation extends OperationContract>(operation: Operation): Operation {
  return operation;
}

type Parsed<Schema> = Schema extends z.ZodType ? z.output<Schema> : undefined;

export interface OperationInput<Operation extends OperationContract> {
  readonly params: Parsed<Operation extends { params: infer Schema } ? Schema : undefined>;
  readonly query: Parsed<Operation extends { query: infer Schema } ? Schema : undefined>;
}

export type OperationResult<Operation extends OperationContract> = {
  [Status in keyof Operation['responses'] & number]: {
    readonly status: Status;
    readonly body: z.input<Operation['responses'][Status]['schema']>;
  };
}[keyof Operation['responses'] & number];

export type OperationHandler<Operation extends OperationContract> = (
  input: OperationInput<Operation>,
  request: Request,
) => OperationResult<Operation> | Promise<OperationResult<Operation>>;

/** An error the client caused or can act on; the HTTP adapter turns it into an error response. */
export class ApiError extends Error {
  override name = 'ApiError';

  readonly status: number;
  readonly code: string;
  readonly issues: readonly ValidationIssue[] | undefined;

  constructor(status: number, code: string, message: string, issues?: readonly ValidationIssue[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/** Validates one request part; `location` prefixes the reported paths (`query.limit`). */
export function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown, location: string): z.output<Schema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new ApiError(
    400,
    errorCodes.validationFailed,
    'The request is invalid.',
    result.error.issues.map((issue) => ({
      path: [location, ...issue.path.map(String)].join('.'),
      message: issue.message,
    })),
  );
}

/**
 * Adds the route of `operation` to a module router, validating its path and query parameters:
 * `addOperation(router, getItem).handle((input) => ({ status: 200, body: item }))`.
 * The handler is passed separately so that its result is checked against the fixed declaration.
 */
export function addOperation<Operation extends OperationContract>(
  router: Router,
  operation: Operation,
): { handle(handler: OperationHandler<Operation>): void } {
  return {
    handle(handler) {
      router[operation.method](toExpressPath(operation.path), async (request, response) => {
        const input = {
          params: operation.params === undefined ? undefined : parseInput(operation.params, request.params, 'path'),
          query: operation.query === undefined ? undefined : parseInput(operation.query, request.query, 'query'),
        } as OperationInput<Operation>;
        const result = await handler(input, request);
        response.status(result.status).json(result.body);
      });
    },
  };
}

/** `/items/{itemId}` becomes `/items/:itemId`. */
export function toExpressPath(path: string): string {
  return path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, ':$1');
}

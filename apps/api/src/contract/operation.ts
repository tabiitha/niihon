import express, { type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';

import { currentSession } from '../sessions/sessions.ts';
import { errorCodes } from './conventions.ts';

/** Body limit of an operation that does not set `maxBodyBytes`. */
export const defaultMaxBodyBytes = 16 * 1024;

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface ResponseContract {
  readonly description: string;
  /** JSON body; omitted for a response without a body, such as `204`. */
  readonly schema?: z.ZodType;
  /**
   * A `text/event-stream` (server-sent events) response instead of a JSON body: the JSON payload
   * schema of each event type, by event name. Added with `addEventStream`.
   */
  readonly events?: Readonly<Record<string, z.ZodType>>;
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
  /** Request headers the operation reads, by their canonical name, such as `Last-Event-ID`; optional ones only. */
  readonly headers?: z.ZodObject;
  /** JSON request body. Declare it with `z.strictObject` so that unexpected fields are refused. */
  readonly body?: z.ZodType;
  /** Largest accepted body in bytes; larger ones are refused with `413 payload_too_large`. Default `defaultMaxBodyBytes`. */
  readonly maxBodyBytes?: number;
  /** Success responses by status code. */
  readonly responses: Readonly<Record<number, ResponseContract>>;
  /** Error statuses this operation documents beyond the common ones, with their meaning. */
  readonly errors?: Readonly<Record<number, string>>;
  /** False only for operations a client calls before knowing whether it is compatible. */
  readonly versioned?: boolean;
  /**
   * A command that accepts an `Idempotency-Key`. It must declare exactly one success response and
   * be registered with `context.commands.add`, which stores that response with the effect.
   */
  readonly idempotent?: boolean;
  /**
   * How the operation uses the request's signed-in session (src/sessions), published in the
   * contract so clients know to send their token. `required`: without a valid session the request
   * is refused with `401 authentication_required` before its input is read. `optional`: the
   * operation acts on the session when one is presented, such as signing out, and works without.
   */
  readonly session?: 'required' | 'optional';
}

/** Keeps the literal types of a declaration so handlers are checked against it. */
export function defineOperation<const Operation extends OperationContract>(operation: Operation): Operation {
  return operation;
}

type Parsed<Schema> = Schema extends z.ZodType ? z.output<Schema> : undefined;

export interface OperationInput<Operation extends OperationContract> {
  readonly params: Parsed<Operation extends { params: infer Schema } ? Schema : undefined>;
  readonly query: Parsed<Operation extends { query: infer Schema } ? Schema : undefined>;
  readonly body: Parsed<Operation extends { body: infer Schema } ? Schema : undefined>;
  readonly headers: Parsed<Operation extends { headers: infer Schema } ? Schema : undefined>;
}

export type OperationResult<Operation extends OperationContract> = {
  [Status in keyof Operation['responses'] & number]: {
    readonly status: Status;
    readonly body: Operation['responses'][Status] extends { schema: infer Schema extends z.ZodType } ? z.input<Schema> : undefined;
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
  /** Extra response headers, such as `Retry-After`. */
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    issues?: readonly ValidationIssue[],
    headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.headers = headers;
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
    result.error.issues.flatMap((issue) => {
      const path = [location, ...issue.path.map(String)];
      // An unexpected field is reported at its own path, without echoing its value.
      return issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => ({ path: [...path, key].join('.'), message: 'Unrecognized field.' }))
        : [{ path: path.join('.'), message: issue.message }];
    }),
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
  if (operation.idempotent === true) {
    throw new Error(`Idempotent operation "${operation.operationId}" must be added with context.commands.add.`);
  }
  if (isEventStream(operation)) {
    throw new Error(`Event stream "${operation.operationId}" must be added with addEventStream.`);
  }
  return routeOperation(router, operation);
}

/** Whether the operation answers with server-sent events rather than JSON. */
export function isEventStream(operation: OperationContract): boolean {
  return Object.values(operation.responses).some((response) => response.events !== undefined);
}

/**
 * Adds the route of an operation answering with server-sent events. Its input is validated as for
 * `addOperation`; the handler then owns `response` and writes the stream itself.
 */
export function addEventStream<Operation extends OperationContract>(
  router: Router,
  operation: Operation,
): { handle(handler: (input: OperationInput<Operation>, request: Request, response: Response) => void | Promise<void>): void } {
  if (!isEventStream(operation) || operation.body !== undefined || operation.idempotent === true) {
    throw new Error(`Operation "${operation.operationId}" is not a bodiless event stream.`);
  }
  return {
    handle(handler) {
      router[operation.method](toExpressPath(operation.path), ...parsersOf(operation), async (request, response) => {
        await handler(parseOperationInput(operation, request), request, response);
      });
    },
  };
}

/** `addOperation` without the idempotency check; only the command layer (src/commands) calls it directly. */
export function routeOperation<Operation extends OperationContract>(
  router: Router,
  operation: Operation,
): { handle(handler: OperationHandler<Operation>): void } {
  return {
    handle(handler) {
      router[operation.method](toExpressPath(operation.path), ...parsersOf(operation), async (request, response) => {
        const result = await handler(parseOperationInput(operation, request), request);
        if (result.body === undefined) {
          response.status(result.status).end();
        } else {
          response.status(result.status).json(result.body);
        }
      });
    },
  };
}

function parsersOf(operation: OperationContract): RequestHandler[] {
  return [
    ...(operation.session === 'required' ? [requireSession] : []),
    ...(operation.body === undefined ? [] : [jsonBody(operation.maxBodyBytes ?? defaultMaxBodyBytes)]),
  ];
}

function parseOperationInput<Operation extends OperationContract>(operation: Operation, request: Request): OperationInput<Operation> {
  return {
    params: operation.params === undefined ? undefined : parseInput(operation.params, request.params, 'path'),
    query: operation.query === undefined ? undefined : parseInput(operation.query, request.query, 'query'),
    body: operation.body === undefined ? undefined : parseInput(operation.body, request.body, 'body'),
    headers:
      operation.headers === undefined
        ? undefined
        : parseInput(
            operation.headers,
            Object.fromEntries(Object.keys(operation.headers.shape).map((name) => [name, request.get(name)])),
            'header',
          ),
  } as OperationInput<Operation>;
}

/** Refuses a request without a valid session before anything else of it is read. */
const requireSession: RequestHandler = (request, _response, next) => {
  next(
    currentSession(request) === undefined
      ? new ApiError(401, errorCodes.authenticationRequired, 'Sign in to use this operation.', undefined, { 'WWW-Authenticate': 'Bearer' })
      : undefined,
  );
};

/** Reads a JSON body of at most `limit` bytes; the body of a route without one is never read. */
function jsonBody(limit: number): RequestHandler {
  const parse = express.json({ limit, type: 'application/json', strict: true });
  return (request, response, next) => {
    if (!request.is('application/json')) {
      next(new ApiError(415, errorCodes.unsupportedMediaType, 'The request body must be application/json.'));
      return;
    }
    parse(request, response, next);
  };
}

/** `/items/{itemId}` becomes `/items/:itemId`. */
export function toExpressPath(path: string): string {
  return path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, ':$1');
}

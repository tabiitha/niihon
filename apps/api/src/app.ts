import { randomUUID } from 'node:crypto';

import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';

import { noOAuthSettings, type OAuthSettings } from './config.ts';
import {
  apiMajorVersion,
  apiVersion,
  apiVersionHeader,
  errorCodes,
  requestIdHeader,
  type ErrorResponse,
} from './contract/conventions.ts';
import { getHealth } from './contract/health.ts';
import { addOperation, ApiError, type OperationContract, type ValidationIssue } from './contract/operation.ts';
import type { Database } from './database/database.ts';
import { DatabaseBusyError, DatabaseClosedError } from './database/write-gate.ts';
import type { Logger } from './log.ts';
import type { ApiModule } from './modules/api-module.ts';
import { createWebHandler } from './web.ts';

export const serviceName = 'nihon-api';

/** Operations served by the foundation itself, under `/api`. */
export const coreOperations: readonly OperationContract[] = [getHealth];

export interface AppOptions {
  readonly version: string;
  readonly modules: readonly ApiModule[];
  /** The installation database, handed to each module. */
  readonly database: Database;
  readonly logger: Logger;
  /** Provider credentials for the modules that offer provider sign-up; none by default. */
  readonly oauth?: OAuthSettings;
  /** Reports whether the server is shutting down; new requests then receive 503. */
  readonly isStopping?: () => boolean;
  /** Directory of the built Web interface, served outside `/api`; omitted, only the API is served. */
  readonly webDir?: string | undefined;
}

/**
 * Builds the HTTP adapter. It parses no request body globally: each module adds the bounded
 * parser or stream its routes need, so unread bodies are never buffered.
 */
export function createApp({ version, modules, database, logger, oauth = noOAuthSettings, isStopping = () => false, webDir }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(assignRequestId);
  app.use(refuseWhileStopping(isStopping));
  app.use(refuseIncompatibleClients(unversionedPaths(modules)));

  const core = express.Router();
  addOperation(core, getHealth).handle(() => ({
    status: 200,
    body: { status: 'ok', service: serviceName, version, apiVersion },
  }));
  app.use('/api', core);

  for (const module of modules) {
    const router = express.Router();
    module.register(router, { database, logger, oauth });
    app.use(`/api/${module.id}`, router);
  }

  if (webDir !== undefined) {
    app.use(createWebHandler(webDir));
  }

  app.use(notFound);
  app.use(handleError(logger));
  return app;
}

const requestIdPattern = /^[A-Za-z0-9._-]{1,64}$/;

/** Reuses a well-formed `Nihon-Request-Id` from the client, or creates one, and echoes it. */
const assignRequestId: RequestHandler = (request, response, next) => {
  const received = request.get(requestIdHeader);
  const requestId = received !== undefined && requestIdPattern.test(received) ? received : randomUUID();
  response.locals['requestId'] = requestId;
  response.set(requestIdHeader, requestId);
  next();
};

function refuseWhileStopping(isStopping: () => boolean): RequestHandler {
  return (_request, response, next) => {
    if (!isStopping()) {
      next();
      return;
    }
    response.set('Connection', 'close');
    sendError(response, 503, errorCodes.stopping, 'The server is shutting down.');
  };
}

function unversionedPaths(modules: readonly ApiModule[]): ReadonlySet<string> {
  const groups = [
    { prefix: '/api', operations: coreOperations },
    ...modules.map((module) => ({ prefix: `/api/${module.id}`, operations: module.operations })),
  ];
  return new Set(
    groups.flatMap(({ prefix, operations }) =>
      operations.filter((operation) => operation.versioned === false).map((operation) => prefix + operation.path),
    ),
  );
}

/**
 * Clients declare the contract major version they were generated from. A request without the
 * header is accepted, so tools such as curl keep working; a different major is refused.
 */
function refuseIncompatibleClients(exempt: ReadonlySet<string>): RequestHandler {
  return (request, response, next) => {
    const declared = request.get(apiVersionHeader);
    if (declared === undefined || declared.trim() === String(apiMajorVersion) || exempt.has(request.path)) {
      next();
      return;
    }
    sendError(
      response,
      400,
      errorCodes.unsupportedApiVersion,
      `This server implements API version ${apiVersion}; update the client, which requires major version "${declared}".`,
    );
  };
}

const notFound: RequestHandler = (request, response) => {
  sendError(response, 404, errorCodes.notFound, `No route matches ${request.method} ${request.path}.`);
};

function handleError(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      response.set({ ...error.headers });
      sendError(response, error.status, error.code, error.message, error.issues);
      return;
    }
    if (error instanceof DatabaseBusyError || error instanceof DatabaseClosedError) {
      // Nothing was written: the write never got its turn. The client may retry.
      response.set('Retry-After', '1');
      sendError(response, 503, errorCodes.databaseBusy, 'The database is busy; retry the request.');
      return;
    }
    if (hasErrorType(error, 'entity.too.large')) {
      sendError(response, 413, errorCodes.payloadTooLarge, 'The request body is too large.');
      return;
    }
    const status = clientErrorStatus(error);
    if (status !== undefined) {
      sendError(response, status, errorCodes.badRequest, 'The request could not be processed.');
      return;
    }
    logger('error', 'request.failed', {
      requestId: response.locals['requestId'],
      method: request.method,
      path: request.path,
      error: error instanceof Error ? error.message : String(error),
    });
    sendError(response, 500, errorCodes.internalError, 'An unexpected error occurred.');
  };
}

function hasErrorType(error: unknown, type: string): boolean {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === type;
}

/** Express and its parsers attach a 4xx `status` to errors caused by the client. */
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

function sendError(
  response: express.Response,
  status: number,
  code: string,
  message: string,
  issues?: readonly ValidationIssue[],
): void {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      requestId: String(response.locals['requestId']),
      ...(issues === undefined ? {} : { issues: [...issues] }),
    },
  };
  response.status(status).json(body);
}

import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';

import type { Logger } from './log.ts';
import type { ApiModule } from './modules/api-module.ts';

export const serviceName = 'nihon-api';

export interface AppOptions {
  readonly version: string;
  readonly modules: readonly ApiModule[];
  readonly logger: Logger;
  /** Reports whether the server is shutting down; new requests then receive 503. */
  readonly isStopping?: () => boolean;
}

/**
 * Builds the HTTP adapter. It parses no request body globally: each module adds the bounded
 * parser or stream its routes need, so unread bodies are never buffered.
 */
export function createApp({ version, modules, logger, isStopping = () => false }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(refuseWhileStopping(isStopping));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: serviceName, version });
  });

  for (const module of modules) {
    const router = express.Router();
    module.register(router);
    app.use(`/api/${module.id}`, router);
  }

  app.use(notFound);
  app.use(handleError(logger));
  return app;
}

function refuseWhileStopping(isStopping: () => boolean): RequestHandler {
  return (_request, response, next) => {
    if (!isStopping()) {
      next();
      return;
    }
    response.set('Connection', 'close');
    sendError(response, 503, 'stopping', 'The server is shutting down.');
  };
}

const notFound: RequestHandler = (request, response) => {
  sendError(response, 404, 'not_found', `No route matches ${request.method} ${request.path}.`);
};

function handleError(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const status = clientErrorStatus(error);
    if (status !== undefined) {
      sendError(response, status, 'bad_request', 'The request could not be processed.');
      return;
    }
    logger('error', 'request.failed', {
      method: request.method,
      path: request.path,
      error: error instanceof Error ? error.message : String(error),
    });
    sendError(response, 500, 'internal_error', 'An unexpected error occurred.');
  };
}

/** Express and its parsers attach a 4xx `status` to errors caused by the client. */
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

function sendError(response: express.Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

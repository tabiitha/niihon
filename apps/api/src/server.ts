import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from './app.ts';
import { acquireInstanceLock } from './instance-lock.ts';
import type { Logger } from './log.ts';
import type { ApiModule } from './modules/api-module.ts';

/** Further connections are refused once this many sockets are open. */
export const maxConnections = 256;
/** In-flight requests may finish during this delay after a stop request; remaining sockets are then closed. */
export const shutdownGraceMs = 10_000;

export interface ServerOptions {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly version: string;
  readonly modules: readonly ApiModule[];
  readonly logger: Logger;
  readonly webDir?: string | undefined;
  readonly shutdownGraceMs?: number;
}

export interface RunningServer {
  readonly host: string;
  readonly port: number;
  /** Stops accepting connections, lets in-flight requests finish, then releases the data directory. */
  stop(): Promise<void>;
}

/**
 * Claims the data directory, then listens. Throws `DataDirectoryInUseError` when another server
 * owns the directory, and releases the claim if listening fails.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const lock = acquireInstanceLock(options.dataDir);
  let stopping = false;
  const server = createServer(
    createApp({
      version: options.version,
      modules: options.modules,
      logger: options.logger,
      isStopping: () => stopping,
      webDir: options.webDir,
    }),
  );
  server.maxConnections = maxConnections;

  try {
    await listen(server, options.host, options.port);
  } catch (error) {
    lock.release();
    throw error;
  }

  const { port } = server.address() as AddressInfo;
  let stopped: Promise<void> | undefined;
  return {
    host: options.host,
    port,
    stop() {
      stopping = true;
      stopped ??= closeServer(server, options.shutdownGraceMs ?? shutdownGraceMs).finally(() => lock.release());
      return stopped;
    },
  };
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const forceClose = setTimeout(() => server.closeAllConnections(), graceMs);
    server.close((error) => {
      clearTimeout(forceClose);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    server.closeIdleConnections();
  });
}

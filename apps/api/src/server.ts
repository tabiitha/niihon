import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from './app.ts';
import { loadCommandKey } from './commands/command-key.ts';
import { createCommands } from './commands/idempotency.ts';
import type { OAuthSettings } from './config.ts';
import { openDatabase } from './database/database.ts';
import type { MigrationOutcome } from './database/migrator.ts';
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
  readonly oauth?: OAuthSettings;
  readonly shutdownGraceMs?: number;
  /** Migrations to apply instead of those packaged with the server; tests only. */
  readonly migrationsDir?: string;
}

export interface RunningServer {
  readonly host: string;
  readonly port: number;
  /** What the database migration did before the server started listening. */
  readonly migration: MigrationOutcome;
  /**
   * Stops accepting connections, lets in-flight requests finish, closes the database, then releases
   * the data directory.
   */
  stop(): Promise<void>;
}

/**
 * Claims the data directory, migrates and opens the database, then listens, so the service is
 * only reachable once its schema is current. Throws `DataDirectoryInUseError` when another server
 * owns the directory, `IncompatibleDatabaseError` or `MigrationFailedError` when the database
 * cannot be brought to the packaged schema, and releases everything it acquired on failure.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const lock = acquireInstanceLock(options.dataDir);
  let opened;
  let commandKey;
  try {
    commandKey = loadCommandKey(options.dataDir);
    opened = await openDatabase({
      dataDir: options.dataDir,
      ...(options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir }),
    });
  } catch (error) {
    lock.release();
    throw error;
  }
  const { database, migration } = opened;
  let stopping = false;
  const server = createServer(
    createApp({
      version: options.version,
      modules: options.modules,
      database,
      commands: createCommands({ database, key: commandKey }),
      logger: options.logger,
      ...(options.oauth === undefined ? {} : { oauth: options.oauth }),
      isStopping: () => stopping,
      webDir: options.webDir,
    }),
  );
  server.maxConnections = maxConnections;

  try {
    await listen(server, options.host, options.port);
  } catch (error) {
    await database.close();
    lock.release();
    throw error;
  }

  const { port } = server.address() as AddressInfo;
  let stopped: Promise<void> | undefined;
  return {
    host: options.host,
    port,
    migration,
    stop() {
      stopping = true;
      stopped ??= closeServer(server, options.shutdownGraceMs ?? shutdownGraceMs)
        .finally(() => database.close())
        .finally(() => lock.release());
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

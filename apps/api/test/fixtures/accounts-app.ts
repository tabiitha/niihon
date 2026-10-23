import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/app.ts';
import { createCommands, type CommandLimits } from '../../src/commands/idempotency.ts';
import { noOAuthSettings, type OAuthSettings } from '../../src/config.ts';
import { openDatabase, type Database } from '../../src/database/database.ts';
import { createJsonLogger } from '../../src/log.ts';
import { createAccountsModule, type AccountsModuleOptions } from '../../src/modules/accounts/index.ts';
import { createSessions, type SessionLimits } from '../../src/sessions/sessions.ts';

export interface CallOptions {
  readonly contentType?: string;
  readonly raw?: string;
  readonly idempotencyKey?: string;
  /** Extra request headers, such as `authorization` or `cookie`. */
  readonly headers?: Record<string, string>;
}

export interface CallResult {
  readonly status: number;
  readonly body: any;
  readonly headers: Headers;
}

export interface AccountsApp {
  readonly baseUrl: string;
  readonly database: Database;
  /** Every log line the server wrote. */
  readonly logs: string[];
  post(path: string, body: unknown, init?: CallOptions): Promise<CallResult>;
  get(path: string, init?: Pick<CallOptions, 'headers'>): Promise<CallResult>;
  delete(path: string, init?: Pick<CallOptions, 'headers'>): Promise<CallResult>;
  /** Stops the server and closes the database; the data directory is deleted unless the caller supplied it. */
  stop(): Promise<void>;
}

/**
 * The accounts module over a real database in a temporary data directory, served on a loopback
 * port. Pass `dataDir` to start again on the data of an earlier app, as after a restart.
 */
export async function startAccountsApp(
  options: {
    oauth?: OAuthSettings;
    module?: AccountsModuleOptions;
    databaseLimits?: Parameters<typeof openDatabase>[0]['limits'];
    commandLimits?: Partial<CommandLimits>;
    sessionLimits?: Partial<SessionLimits>;
    /** Clock of the sessions; the module has its own in `module.now`. */
    now?: () => Date;
    dataDir?: string;
  } = {},
): Promise<AccountsApp> {
  const root = options.dataDir === undefined ? mkdtempSync(join(tmpdir(), 'nihon-accounts-')) : undefined;
  const dataDir = options.dataDir ?? join(root as string, 'data');
  const { database } = await openDatabase({ dataDir, ...(options.databaseLimits === undefined ? {} : { limits: options.databaseLimits }) });
  const logs: string[] = [];
  const logger = createJsonLogger((line) => logs.push(line));
  const server: Server = createServer(
    createApp({
      version: '1.2.3',
      modules: [createAccountsModule(options.module)],
      database,
      commands: createCommands({ database, ...(options.commandLimits === undefined ? {} : { limits: options.commandLimits }) }),
      sessions: createSessions({
        database,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.sessionLimits === undefined ? {} : { limits: options.sessionLimits }),
      }),
      logger,
      oauth: options.oauth ?? noOAuthSettings,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(path: string, init: RequestInit) {
    const response = await fetch(`${baseUrl}/api/accounts${path}`, init);
    const text = await response.text();
    return { status: response.status, body: text === '' ? undefined : JSON.parse(text), headers: response.headers };
  }

  return {
    baseUrl,
    database,
    logs,
    post: (path, body, { contentType = 'application/json', raw, idempotencyKey, headers = {} } = {}) =>
      call(path, {
        method: 'POST',
        headers: { 'content-type': contentType, ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }), ...headers },
        body: raw ?? JSON.stringify(body),
      }),
    get: (path, { headers = {} } = {}) => call(path, { headers }),
    delete: (path, { headers = {} } = {}) => call(path, { method: 'DELETE', headers }),
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await database.close();
      if (root !== undefined) {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
}

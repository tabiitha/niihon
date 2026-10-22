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

export interface AccountsApp {
  readonly baseUrl: string;
  readonly database: Database;
  /** Every log line the server wrote. */
  readonly logs: string[];
  post(path: string, body: unknown, init?: { contentType?: string; raw?: string; idempotencyKey?: string }): Promise<{ status: number; body: any; headers: Headers }>;
  get(path: string): Promise<{ status: number; body: any; headers: Headers }>;
  stop(): Promise<void>;
}

/** The accounts module over a real database in a temporary data directory, served on a loopback port. */
export async function startAccountsApp(
  options: {
    oauth?: OAuthSettings;
    module?: AccountsModuleOptions;
    databaseLimits?: Parameters<typeof openDatabase>[0]['limits'];
    commandLimits?: Partial<CommandLimits>;
  } = {},
): Promise<AccountsApp> {
  const root = mkdtempSync(join(tmpdir(), 'nihon-accounts-'));
  const { database } = await openDatabase({ dataDir: join(root, 'data'), ...(options.databaseLimits === undefined ? {} : { limits: options.databaseLimits }) });
  const logs: string[] = [];
  const logger = createJsonLogger((line) => logs.push(line));
  const server: Server = createServer(
    createApp({
      version: '1.2.3',
      modules: [createAccountsModule(options.module)],
      database,
      commands: createCommands({ database, ...(options.commandLimits === undefined ? {} : { limits: options.commandLimits }) }),
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
    post: (path, body, { contentType = 'application/json', raw, idempotencyKey } = {}) =>
      call(path, {
        method: 'POST',
        headers: { 'content-type': contentType, ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }) },
        body: raw ?? JSON.stringify(body),
      }),
    get: (path) => call(path, {}),
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

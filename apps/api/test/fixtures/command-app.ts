import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { createApp } from '../../src/app.ts';
import { loadCommandKey } from '../../src/commands/command-key.ts';
import { anonymousCaller, createCommands, type CommandLimits } from '../../src/commands/idempotency.ts';
import { idempotencyKeyHeader } from '../../src/contract/conventions.ts';
import { ApiError, defineOperation } from '../../src/contract/operation.ts';
import { openDatabase, type Database } from '../../src/database/database.ts';
import { createJsonLogger } from '../../src/log.ts';
import type { ApiModule } from '../../src/modules/api-module.ts';

/** Points where a test can fail, hold, or crash a fixture command. Every hook is optional. */
export interface CommandHooks {
  /** Before `commit`; throwing here refuses the command before any write. */
  beforeCommit?: () => Promise<void> | void;
  /** Inside the transaction, after the effect was written and before it commits. */
  insideCommit?: () => Promise<void> | void;
  /** After the commit, before the response is sent. */
  afterCommit?: () => Promise<void> | void;
}

const effectSchema = z.object({ id: z.string(), label: z.string() });
const effectInputSchema = z.strictObject({ label: z.string().max(64) });

export const recordEffect = defineOperation({
  operationId: 'recordEffect',
  method: 'post',
  path: '/effects',
  summary: 'Record one fixture effect',
  body: effectInputSchema,
  idempotent: true,
  responses: { 201: { description: 'The effect was recorded.', schema: effectSchema } },
});

export const recordOtherEffect = defineOperation({
  ...recordEffect,
  operationId: 'recordOtherEffect',
  path: '/other-effects',
});

export const recordLargeEffect = defineOperation({
  operationId: 'recordLargeEffect',
  method: 'post',
  path: '/large-effects',
  summary: 'Record one effect whose response is too large to store',
  idempotent: true,
  responses: { 201: { description: 'The effect was recorded.', schema: z.object({ padding: z.string() }) } },
});

/** Effects live in a table created by the fixture, so the commands under test belong to no domain. */
export async function createEffectTable(database: Database): Promise<void> {
  await database.write((transaction) =>
    transaction.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "FixtureEffect" ("id" TEXT PRIMARY KEY, "label" TEXT NOT NULL)'),
  );
}

export function createCommandModule(hooks: CommandHooks): ApiModule {
  return {
    id: 'fixture',
    operations: [recordEffect, recordOtherEffect, recordLargeEffect],
    register(router, { commands }) {
      for (const operation of [recordEffect, recordOtherEffect]) {
        commands.add(router, operation).handle(async ({ body }, commit) => {
          await hooks.beforeCommit?.();
          const effect = await commit(async (transaction) => {
            const id = randomUUID();
            await transaction.$executeRaw`INSERT INTO "FixtureEffect" ("id", "label") VALUES (${id}, ${body.label})`;
            await hooks.insideCommit?.();
            return { id, label: body.label };
          });
          await hooks.afterCommit?.();
          return { status: 201, body: effect };
        });
      }
      commands.add(router, recordLargeEffect).handle(async (_input, commit) => {
        const body = await commit(async (transaction) => {
          await transaction.$executeRaw`INSERT INTO "FixtureEffect" ("id", "label") VALUES (${randomUUID()}, 'large')`;
          return { padding: 'x'.repeat(8 * 1024) };
        });
        return { status: 201, body };
      });
    },
  };
}

/** Test-only caller identity: requests name their caller in this header. Real callers come with sign-in (#76). */
export const callerHeader = 'X-Fixture-Caller';

export interface CommandAppOptions {
  /** Reuses a data directory, as a restarted server would; a new temporary one by default. */
  readonly dataDir?: string;
  readonly hooks?: CommandHooks;
  readonly key?: Buffer;
  readonly now?: () => Date;
  readonly limits?: Partial<CommandLimits>;
}

export interface Answer {
  readonly status: number;
  readonly body: any;
  readonly headers: Headers;
}

export interface CommandApp {
  readonly port: number;
  readonly dataDir: string;
  readonly database: Database;
  readonly hooks: CommandHooks;
  readonly logs: string[];
  post(path: string, body?: unknown, options?: { key?: string; caller?: string }): Promise<Answer>;
  effects(): Promise<number>;
  records(): Promise<number>;
  /** Stops serving and closes the database; the data directory is deleted unless `keepData`. */
  stop(options?: { keepData?: boolean }): Promise<void>;
}

/** The fixture commands over a real database, its persistent command key, and the real HTTP adapter. */
export async function startCommandApp(options: CommandAppOptions = {}): Promise<CommandApp> {
  const dataDir = options.dataDir ?? join(mkdtempSync(join(tmpdir(), 'nihon-commands-')), 'data');
  const { database } = await openDatabase({ dataDir });
  await createEffectTable(database);
  const hooks = options.hooks ?? {};
  const logs: string[] = [];
  const commands = createCommands({
    database,
    key: options.key ?? loadCommandKey(dataDir),
    identifyCaller: (request) => request.get(callerHeader) ?? anonymousCaller,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const server: Server = createServer(
    createApp({
      version: '1.2.3',
      modules: [createCommandModule(hooks)],
      database,
      commands,
      logger: createJsonLogger((line) => logs.push(line)),
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const count = async (table: string) =>
    Number((await database.reader.$queryRawUnsafe<{ count: bigint | number }[]>(`SELECT COUNT(*) AS count FROM "${table}"`))[0]?.count);

  return {
    port,
    dataDir,
    database,
    hooks,
    logs,
    async post(path, body, { key, caller } = {}) {
      const response = await postCommand(port, path, body, { key, caller });
      const text = await response.text();
      return { status: response.status, body: text === '' ? undefined : JSON.parse(text), headers: response.headers };
    },
    effects: () => count('FixtureEffect'),
    records: () => database.reader.idempotencyRecord.count(),
    async stop({ keepData = false } = {}) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await database.close();
      if (!keepData) {
        rmSync(join(dataDir, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
}

export function postCommand(
  port: number,
  path: string,
  body: unknown,
  { key, caller }: { key?: string | undefined; caller?: string | undefined } = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/fixture${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key === undefined ? {} : { [idempotencyKeyHeader]: key }),
      ...(caller === undefined ? {} : { [callerHeader]: caller }),
    },
    body: JSON.stringify(body ?? {}),
  });
}

/** Lets a test refuse a command from a hook the way a domain rule would. */
export function domainRefusal(): ApiError {
  return new ApiError(409, 'fixture_refused', 'The fixture refused the command.');
}

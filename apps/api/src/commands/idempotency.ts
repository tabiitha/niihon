import { createHmac, randomBytes } from 'node:crypto';

import type { Request, Router } from 'express';

import {
  errorCodes,
  idempotencyKeyHeader,
  idempotencyKeySchema,
  idempotentReplayedHeader,
} from '../contract/conventions.ts';
import {
  ApiError,
  parseInput,
  routeOperation,
  type OperationContract,
  type OperationInput,
  type OperationResult,
} from '../contract/operation.ts';
import type { Database, TransactionClient } from '../database/database.ts';
import { currentSession } from '../sessions/sessions.ts';

/**
 * Runs the write that carries a command's effect. Under an idempotency key, the value `work`
 * returns is the response body, stored in the same transaction as the effect; a command calls it
 * at most once. Without a key it is a plain `database.write`.
 */
export type Commit = <T>(work: (transaction: TransactionClient) => Promise<T>) => Promise<T>;

export type CommandHandler<Operation extends OperationContract> = (
  input: OperationInput<Operation>,
  commit: Commit,
  request: Request,
) => Promise<OperationResult<Operation>>;

export interface Commands {
  /**
   * Adds the route of an idempotent command:
   * `commands.add(router, createItem).handle(async (input, commit) => ({ status: 201, body: await commit(...) }))`.
   * The handler must respond with exactly the value its `commit` returned.
   */
  add<Operation extends OperationContract>(
    router: Router,
    operation: Operation,
  ): { handle(handler: CommandHandler<Operation>): void };
}

export interface CommandLimits {
  /** How long a committed command can be replayed; its key may then be used again. */
  readonly retentionMs: number;
  /**
   * Unexpired records before a further keyed command is refused, until some expire. Commands that
   * passed the check while others commit may exceed it by at most the requests running at once.
   */
  readonly maxRecords: number;
  /** Largest stored response, in bytes of JSON. */
  readonly maxResponseBytes: number;
  /** Expired records deleted at most by one keyed command. */
  readonly purgeBatch: number;
}

export const defaultCommandLimits: CommandLimits = {
  retentionMs: 24 * 60 * 60 * 1000,
  maxRecords: 20_000,
  maxResponseBytes: 4 * 1024,
  purgeBatch: 100,
};

/** Caller of a request without a valid session. */
export const anonymousCaller = 'anonymous';

/** The default caller: the profile of the request's session (see src/sessions), or `anonymous`. */
export function sessionCaller(request: Request): string {
  const session = currentSession(request);
  return session === undefined ? anonymousCaller : `profile:${session.profile.id}`;
}

export interface CommandOptions {
  readonly database: Database;
  /** Installation secret keying the fingerprints (see command-key.ts); a random one when omitted. */
  readonly key?: Buffer;
  /** Identity on whose behalf a request runs; a key used by one caller is refused to another. Default `sessionCaller`. */
  readonly identifyCaller?: (request: Request) => string;
  readonly now?: () => Date;
  readonly limits?: Partial<CommandLimits>;
}

/**
 * Guarantees that a command retried with the same `Idempotency-Key` has its effect at most once.
 * The key, the caller, the operation, and a fingerprint of the validated input are recorded with
 * the response in the transaction that commits the effect, so either both exist or neither does:
 * a retry after the commit receives the stored response, and a command that failed before its
 * commit left nothing and runs again. A key is never accepted for another caller, operation, or
 * input. Concurrent requests with one key are refused while the first runs, so the effect cannot
 * race with itself.
 */
export function createCommands(options: CommandOptions): Commands {
  const { database } = options;
  const key = options.key ?? randomBytes(32);
  const identifyCaller = options.identifyCaller ?? sessionCaller;
  const now = options.now ?? (() => new Date());
  const limits = { ...defaultCommandLimits, ...options.limits };
  // Keys whose command is running in this process; one server owns the database (instance-lock.ts).
  const running = new Set<string>();

  const fingerprint = (operationId: string, input: unknown): string =>
    createHmac('sha256', key).update(canonicalJson({ operation: operationId, input })).digest('hex');

  return {
    add(router, operation) {
      const statuses = Object.keys(operation.responses).map(Number);
      const [status] = statuses;
      if (operation.idempotent !== true || status === undefined || statuses.length !== 1) {
        throw new Error(`Command "${operation.operationId}" must be declared idempotent with exactly one success response.`);
      }
      return {
        handle(handler) {
          routeOperation(router, operation).handle(async (input, request) => {
            const header = request.get(idempotencyKeyHeader);
            if (header === undefined) {
              return handler(input, (work) => database.write(work), request);
            }
            const idempotencyKey = parseInput(idempotencyKeySchema, header, `header.${idempotencyKeyHeader}`);
            const caller = identifyCaller(request);
            const print = fingerprint(operation.operationId, input);
            if (running.has(idempotencyKey)) {
              throw new ApiError(
                409,
                errorCodes.idempotencyKeyInUse,
                'A request with this idempotency key is still running; retry later.',
                undefined,
                { 'Retry-After': '1' },
              );
            }
            running.add(idempotencyKey);
            try {
              const started = now();
              const stored = await database.reader.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
              if (stored !== null && stored.expiresAt.getTime() > started.getTime()) {
                if (stored.caller !== caller || stored.operation !== operation.operationId || stored.fingerprint !== print) {
                  throw new ApiError(
                    422,
                    errorCodes.idempotencyKeyReused,
                    'This idempotency key was already used for another request; use a new key for a new command.',
                  );
                }
                request.res?.set(idempotentReplayedHeader, 'true');
                return { status: stored.status, body: JSON.parse(stored.response) } as OperationResult<typeof operation>;
              }
              // Checked before the handler runs, so a refusal leaves everything untouched, including work
              // a domain does before its commit (such as consuming a single-use provider flow). Only
              // unexpired records count: expired ones prove nothing and leave in batches. Commands
              // already past this check may exceed the bound by at most the requests running at once.
              const [{ records } = { records: 0 }] = await database.reader.$queryRaw<{ records: bigint | number }[]>`SELECT COUNT(*) AS "records" FROM "IdempotencyRecord" WHERE "expiresAt" > ${started}`;
              if (Number(records) >= limits.maxRecords) {
                throw new ApiError(
                  503,
                  errorCodes.idempotencyCapacityReached,
                  'Too many recent commands are recorded; retry later or send the command without a key.',
                  undefined,
                  { 'Retry-After': '60' },
                );
              }

              let committed: { readonly body: unknown } | undefined;
              let commits = 0;
              const commit: Commit = (work) => {
                commits += 1;
                if (commits > 1) {
                  return Promise.reject(new Error(`Command "${operation.operationId}" committed more than once.`));
                }
                return database.write(async (transaction) => {
                  const instant = now();
                  // Each keyed command drops a batch of expired records, and this key's own record if it
                  // expired, so expired records leave without a timer. Plain SQL: Prisma's findMany here
                  // costs milliseconds on a large table even when nothing has expired.
                  await transaction.$executeRaw`DELETE FROM "IdempotencyRecord" WHERE "key" IN (SELECT "key" FROM "IdempotencyRecord" WHERE "expiresAt" <= ${instant} AND "key" <> ${idempotencyKey} LIMIT ${limits.purgeBatch})`;
                  await transaction.idempotencyRecord.deleteMany({ where: { key: idempotencyKey, expiresAt: { lte: instant } } });
                  const body = await work(transaction);
                  const response = JSON.stringify(body);
                  if (Buffer.byteLength(response) > limits.maxResponseBytes) {
                    throw new Error(`The response of "${operation.operationId}" exceeds ${limits.maxResponseBytes} bytes and cannot be stored.`);
                  }
                  await transaction.idempotencyRecord.create({
                    data: {
                      key: idempotencyKey,
                      caller,
                      operation: operation.operationId,
                      fingerprint: print,
                      status,
                      response,
                      createdAt: instant,
                      expiresAt: new Date(instant.getTime() + limits.retentionMs),
                    },
                  });
                  committed = { body };
                  return body;
                });
              };

              const result = await handler(input, commit, request);
              if (committed !== undefined && (result.status !== status || result.body !== committed.body)) {
                throw new Error(`Command "${operation.operationId}" answered something other than its committed response.`);
              }
              return result;
            } finally {
              running.delete(idempotencyKey);
            }
          });
        },
      };
    },
  };
}

/** JSON with object keys sorted at every level, so equal inputs always have the same fingerprint. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

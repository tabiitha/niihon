import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const serveScript = fileURLToPath(new URL('../../../api/test/fixtures/accounts-serve.ts', import.meta.url));

export interface AccountsServer {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

/**
 * Starts the real API with the accounts module over a database in a temporary directory, in a child
 * process on a loopback port, with Google and GitHub played by a local fake (apps/api/test/fixtures/
 * accounts-serve.ts). Nothing leaves the machine. Needs the Prisma client: run `bun run test` of the API
 * (or `bun run db:generate`) once.
 */
export async function startAccountsServer(): Promise<AccountsServer> {
  const child: ChildProcess = spawn(process.execPath, [serveScript], { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  const lines = createInterface({ input: child.stdout! });
  const [line] = (await Promise.race([
    once(lines, 'line'),
    exited.then(([code]) => Promise.reject(new Error(`The accounts server exited with ${String(code)}.`))),
  ])) as [string];
  const { port } = JSON.parse(line) as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode === null) {
        child.stdin!.end();
        await exited;
      }
    },
  };
}

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const serveScript = fileURLToPath(new URL('../../../apps/api/test/fixtures/serve.ts', import.meta.url));

export interface FixtureServer {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

/** Starts the API conformance fixture (apps/api/test/fixtures/serve.ts) in a child process. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const child: ChildProcess = spawn(process.execPath, [serveScript], { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  const lines = createInterface({ input: child.stdout! });
  const [line] = (await Promise.race([
    once(lines, 'line'),
    exited.then(([code]) => Promise.reject(new Error(`The fixture server exited with ${String(code)}.`))),
  ])) as [string];
  const { port } = JSON.parse(line) as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      child.stdin!.end();
      await exited;
    },
  };
}

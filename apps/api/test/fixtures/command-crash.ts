import { startCommandApp } from './command-app.ts';

/**
 * Serves the fixture commands on `<data directory>` and stops forever at one point of the first
 * command, so the test can kill the process there: `node command-crash.ts <data directory> inside`
 * holds the transaction open after writing the effect, `after` holds once it has committed.
 * Prints `{"event":"fixture.listening","port":<port>}`, then `fixture.inside` or `fixture.committed`.
 */
const [dataDir, point] = process.argv.slice(2);
if (dataDir === undefined || (point !== 'inside' && point !== 'after')) {
  process.stderr.write('Usage: node command-crash.ts <data directory> inside|after\n');
  process.exit(2);
}

const hold = (event: string) => () => {
  process.stdout.write(`${JSON.stringify({ event })}\n`);
  return new Promise<void>(() => {});
};

const app = await startCommandApp({
  dataDir,
  hooks: point === 'inside' ? { insideCommit: hold('fixture.inside') } : { afterCommit: hold('fixture.committed') },
});
process.stdout.write(`${JSON.stringify({ event: 'fixture.listening', port: app.port })}\n`);

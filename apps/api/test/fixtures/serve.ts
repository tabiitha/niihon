import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app.ts';
import { silentLogger } from '../../src/log.ts';
import { exampleModule } from './example-module.ts';
import { unusedDatabase } from './unused-database.ts';

/**
 * Serves the conformance fixture for the generated-client tests (TypeScript and Swift):
 * the real HTTP adapter with only the example module, on a free loopback port and without
 * a data directory or database. Prints `{"event":"fixture.listening","port":<port>}`, then runs until
 * SIGTERM, SIGINT, or the end of standard input, so it never outlives the test process.
 */
const server = createServer(createApp({ version: '0.0.0-fixture', modules: [exampleModule], database: unusedDatabase, logger: silentLogger }));
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo;
  process.stdout.write(`${JSON.stringify({ event: 'fixture.listening', port })}\n`);
});

const stop = () => {
  server.close();
  server.closeAllConnections();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop).resume();

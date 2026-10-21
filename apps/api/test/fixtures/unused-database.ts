import type { Database } from '../../src/database/database.ts';

/** Stands in for the database in HTTP tests whose modules never touch it; any use fails the test. */
export const unusedDatabase: Database = new Proxy({} as Database, {
  get(_target, property) {
    throw new Error(`This test serves no database, but ${String(property)} was used.`);
  },
});

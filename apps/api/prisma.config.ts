import { defineConfig } from 'prisma/config';

// Configuration of the Prisma CLI, used only to generate the client and author migrations.
// The URL names a scratch file that `prisma migrate diff` may use as a shadow database; the CLI
// never opens the live database, which only the server migrates (docs/architecture/persistence.md).
export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: 'file:../../.local/prisma/authoring.db' },
});

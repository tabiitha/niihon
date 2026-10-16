// Development server: Bun bundles index.html on demand with hot reload, and relays /api/* to the API server,
// so the page keeps the single-origin layout of production. Production serves the `bun run build` output
// from the Express server instead; this file is never part of the build.
import { serve } from 'bun';

import index from './index.html';

const apiOrigin = new URL(process.env['NIHON_API_URL'] ?? 'http://127.0.0.1:4000');
const port = Number(process.env['NIHON_WEB_PORT'] ?? 3000);

async function relayToApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, apiOrigin);
  try {
    return await fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
      signal: request.signal,
    });
  } catch {
    return Response.json(
      { error: { code: 'api_unreachable', message: `The API server at ${apiOrigin.origin} is not running.`, requestId: 'dev' } },
      { status: 502 },
    );
  }
}

const server = serve({
  hostname: '127.0.0.1',
  port,
  routes: {
    '/api/*': relayToApi,
    '/*': index,
  },
  development: { hmr: true, console: true },
});

console.log(`Web development server on ${server.url.href}, relaying /api to ${apiOrigin.origin}`);

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import express, { type RequestHandler, type Response, type Router } from 'express';

import { ConfigError } from './config.ts';

/**
 * Serves the built Web interface (`apps/web/dist`). Files are streamed from disk; any other page address
 * receives the same `index.html`, so a direct load or reload of a client page works. `/api` stays JSON only.
 */
export function createWebHandler(webDir: string): Router {
  const router = express.Router();
  router.use(
    express.static(webDir, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
      setHeaders: (response, path) => setStaticHeaders(response, basename(path)),
    }),
  );
  router.use(serveShell(join(webDir, 'index.html')));
  return router;
}

/** Fails startup when the configured directory does not contain a Web build. */
export function assertWebDir(webDir: string): void {
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new ConfigError(`NIHON_WEB_DIR "${webDir}" contains no index.html; build the Web interface first.`);
  }
}

/**
 * Same-origin only: the interface loads no remote script, style, font, or image, and calls only this server.
 * Theme colors are applied through the CSSOM, which `style-src 'self'` allows.
 */
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Bun names bundled files `<name>-<8-character hash>.<ext>`; their content never changes under that name. */
const hashedFileName = /-[a-z0-9]{8}\.[a-z0-9]+$/;

function setStaticHeaders(response: Response, fileName: string): void {
  response.set('X-Content-Type-Options', 'nosniff');
  response.set(
    'Cache-Control',
    fileName !== 'index.html' && hashedFileName.test(fileName) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
}

/**
 * Answers page addresses with `index.html`: GET or HEAD outside `/api`, from a client that accepts HTML, on a
 * path whose last segment has no file extension. A missing file such as `/chunk-x.js` stays a 404.
 */
function serveShell(indexFile: string): RequestHandler {
  return (request, response, next) => {
    const lastSegment = request.path.slice(request.path.lastIndexOf('/') + 1);
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      request.path === '/api' ||
      request.path.startsWith('/api/') ||
      lastSegment.includes('.') ||
      request.accepts('html') !== 'html'
    ) {
      next();
      return;
    }
    response.set({
      'Content-Security-Policy': contentSecurityPolicy,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.sendFile(indexFile, (error) => {
      // After the headers, the only failure left is the client going away mid-response.
      if (error !== undefined && !response.headersSent) {
        next(error);
      }
    });
  };
}

/**
 * Client routes. Every page is the same static `index.html`; the server returns it for any page path, so a
 * direct load or reload of any address works. Resources created after the build, such as media, are never
 * path segments: they are addressed by a query identifier on a fixed page (`/reader?media=<id>`).
 */
export const routes = {
  home: '/',
  learning: '/learn',
  kanji: '/kanji',
  library: '/library',
  reader: '/reader',
  profile: '/profile',
  admin: '/admin',
} as const;

export type RouteId = keyof typeof routes;

const routeByPath = new Map<string, RouteId>(Object.entries(routes).map(([id, path]) => [path, id as RouteId]));

/** The route of a path, ignoring a trailing slash, or `undefined` when no page has this address. */
export function matchRoute(pathname: string): RouteId | undefined {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return routeByPath.get(normalized === '' ? '/' : normalized);
}

export function readerHref(mediaId: string): string {
  return `${routes.reader}?${new URLSearchParams({ media: mediaId }).toString()}`;
}

/** The media identifier of a reader address, or `undefined` when the query names none. */
export function readMediaId(search: string): string | undefined {
  const mediaId = new URLSearchParams(search).get('media')?.trim();
  return mediaId === undefined || mediaId === '' ? undefined : mediaId;
}

# Web Client

The Web client is a React/TypeScript interface built with Bun and served by the Express server on the API's own origin. It contains no business rule, no SQLite access, and no server-side rendering: it displays what the [REST contract](api-contract.md) returns. This page describes the foundation delivered by [issue #5](https://github.com/tabiitha/niihon/issues/5). Installation commands live in the [root README](../../README.md).

## Toolchain and Serving Topology

The client was created with Bun's React template (`bun init --react`). Bun alone provides the development server and the production build; there is no separate bundler.

| Mode | Server | Address |
| --- | --- | --- |
| Production | The Express API serves `apps/web/dist` (`NIHON_WEB_DIR`) next to `/api` | `http://127.0.0.1:4000` |
| Development | `bun run dev:web`: Bun bundles `src/index.html` on demand with hot reload and relays `/api/*` to the API (`NIHON_API_URL`, default `http://127.0.0.1:4000`) | `http://127.0.0.1:3000` (`NIHON_WEB_PORT`) |

Both modes keep a single origin, so the client calls relative `/api` paths and needs no CORS. The Docker image builds the client in a dedicated stage and copies only `dist/` into the runtime image; React and the API client are bundled into the files, not installed.

| Request outside `/api` | Response |
| --- | --- |
| A file of `dist/` | The file, streamed from disk. Hashed bundle names (`chunk-<hash>.js`) are `Cache-Control: public, max-age=31536000, immutable`; other files `no-cache` |
| A page address: GET or HEAD, accepting HTML, last path segment without a file extension | `index.html`, `no-cache`, with the security headers below |
| Anything else, including a missing file such as `/chunk-x.js` | The JSON `404 not_found` of the API |

Every page receives `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. The browser therefore refuses any remote script, style, font, image, or request: displaying the interface needs no Internet access. Fonts are the system fonts of each platform.

When `NIHON_WEB_DIR` is unset (development, tests), the API serves only `/api`. When it is set to a directory without `index.html`, the server stops with exit code 2 (`config.invalid`).

## Source Structure

| Path | Responsibility |
| --- | --- |
| `apps/web/src/index.html`, `frontend.tsx`, `App.tsx` | Entry page, React root, providers, and the page table |
| `apps/web/src/router/` | Routes and a History API router; links stay real URLs |
| `apps/web/src/api/` | The single API client, failure classification, and the `useResource` hook |
| `apps/web/src/shell/` | Header, navigation, page frame, and the loading and failure states |
| `apps/web/src/modules/<space>/` | One folder per space: its pages and `locales/` |
| `apps/web/src/i18n/` | Language selection and text lookup |
| `apps/web/src/theme/` | Theme registry, CSS variables, and contrast computation |
| `apps/web/src/dev.ts`, `apps/web/build.ts` | Development server and production build |
| `resources/themes/<style>/tokens.json` | Theme tokens shared with the future SwiftUI client |

## Routes

| Space | Address |
| --- | --- |
| Home | `/` |
| Learning | `/learn` |
| Kanji | `/kanji` |
| Library | `/library` |
| Reader (library) | `/reader?media=<id>` |
| Profile | `/profile` |
| Administration | `/admin` |

Every address is the same static page; the server returns `index.html` for each, so a direct load, a reload, or a shared link opens the right page. Resources created after the build, such as media, are never path segments: they are addressed by a query identifier on a fixed page, such as `/reader?media=<id>`. An unknown address shows a "Page not found" page. A page change moves focus to the main content and updates the document title.

The administration entry is visible to everyone until accounts and roles exist ([#7](https://github.com/tabiitha/niihon/issues/7), [#77](https://github.com/tabiitha/niihon/issues/77)); the server alone will decide who may use an administration feature.

## API Access and States

Pages never call `fetch`: they use the client from `src/api/client.ts`, generated from the contract (`@nihon/api-client`), which declares the API major version on every request. `request` turns each call into an outcome; a failure is one of:

| Failure | Cause | Displayed state |
| --- | --- | --- |
| `unavailable` | No HTTP answer (stopped or unreachable service), 503 while stopping, or 502/504 from a relay | Service unavailable, with Retry |
| `incompatible` | The health check reports another API major version, or the server answers `unsupported_api_version` | Incompatible client, with Retry; shows both versions when known |
| `error` | Any other error answer | Error, with Retry and the request identifier for the server log |

Before showing a page, the shell checks `GET /api/health` and the API major version; the navigation stays usable meanwhile. `useResource(key, load)` cancels the previous load with an `AbortSignal` when the page unmounts, when its key changes (a new route or identifier), or on retry, and ignores late answers. Data lives in component state only: leaving a page releases it, and a reload rebuilds it from the API. Nothing is persisted in the browser.

## Interface Languages

The interface is offered in English, French, and Japanese. Each module keeps one JSON file per language next to its code, `locales/en.json`, `fr.json`, and `ja.json`, read through `defineTexts` in its `texts.ts`. English defines the keys; the type checker requires them in the other languages, and `src/i18n/locales.test.ts` fails when any `locales` folder lacks a language, has a missing or extra key, an empty text, or different `{placeholders}`. Adding a module adds its three files; adding a language adds one file per module and one entry in `src/i18n/languages.ts`.

The initial language is the signed-in profile's language when one exists, otherwise the first browser language that Nihon offers (`fr-CA` counts as `fr`), otherwise English. The document `lang` attribute follows the selection, so browsers choose Japanese glyphs. Until the profile preferences exist, the Profile page offers a language selector that applies to the open page only.

## Themes

A theme is one folder, `resources/themes/<style>/tokens.json`, holding its color roles for the light and dark modes and the contrast pairs to verify:

| Role | Use |
| --- | --- |
| `background`, `backgroundAccent` | Page background gradient (equal values give a flat background) |
| `surface`, `onSurface` | Raised elements such as fields and badges, and their text |
| `text`, `textMuted` | Body text and secondary text |
| `accent`, `onAccent` | Primary action and active navigation, and their text |
| `accentText` | Links and accent icons on the background |
| `border` | Decorative separators |
| `focus` | Keyboard focus ring |

`ThemeProvider` applies the selected style and mode as CSS variables (`--color-<role>`) on the document; layout, components, typography, and behavior are shared by every theme. The mode is Light, Dark, or System, which follows the operating system and its changes. The Sakura style provides Sakura Milk (light) and Neon Sorbet (dark). The Profile page offers style and mode selectors for the open page; storing them in the profile and adding the Landscape style belong to [#81](https://github.com/tabiitha/niihon/issues/81).

`src/theme/themes.test.ts` checks that each folder is registered in `src/theme/themes.ts`, that every role exists in both modes, and that every declared pair reaches its WCAG 2.2 contrast minimum in both modes: 4.5:1 for text pairs and 3:1 for the focus ring. Animations stop when the system requests reduced motion.

## Tests

| Command | Checks |
| --- | --- |
| `bun run --cwd apps/web test` | Language selection, text completeness, routes, theme tokens and contrast, and the health check against the real API adapter and simulated failures |
| `bun run --cwd apps/api test` | Static serving: page fallback, cache headers, security headers, 404s, `/api` isolation, Web directory validation |
| `bun run test:production` | After `bun run build`: the compiled API serves the Web build; every space opens directly; the shell references only same-origin files |
| `bun run test:container` | The image serves the interface, including a reload of `/reader?media=…`, also without network access |

Component rendering and keyboard navigation are verified manually in a browser; an automated browser test tool is not selected yet.

## Limits

| Resource | Bound |
| --- | --- |
| Bundle | One JavaScript file (about 235 KiB minified) and one style sheet; no runtime download |
| Static files | Streamed by Express; nothing is held in memory per request |
| Pending reads | One per mounted page; cancelled on page change |

These bounds are a starting point; tune them after measurement.

## Toolchain Versions

| Tool | Version | Role |
| --- | --- | --- |
| Bun | 1.4.3 | Development server, production build, dependencies |
| React, React DOM | 19.3.1 | Interface |
| TypeScript | 7.0.2 | Type checking (strict) |
| openapi-fetch | 0.17.0 | API client runtime, through `@nihon/api-client` |

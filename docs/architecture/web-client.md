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
| `resources/themes/<style>/tokens.json` | Theme tokens shared with the [macOS client](macos-client.md) |

## Routes

| Space | Address |
| --- | --- |
| Home | `/` |
| Learning | `/learn` |
| Kanji | `/kanji` |
| Library | `/library` |
| Reader (library) | `/reader?media=<id>` |
| Profile | `/profile` |
| Account registration, and the return address of a provider | `/register` |
| Administration | `/admin` |

Every address is the same static page; the server returns `index.html` for each, so a direct load, a reload, or a shared link opens the right page. Resources created after the build, such as media, are never path segments: they are addressed by a query identifier on a fixed page, such as `/reader?media=<id>`. An unknown address shows a "Page not found" page. A page change moves focus to the main content and updates the document title.

Registration is not an entry of the navigation: the Profile page links to it, and the Profile entry stays highlighted while it is open.

The administration entry is visible to everyone until accounts and roles exist ([#7](https://github.com/tabiitha/niihon/issues/7), [#77](https://github.com/tabiitha/niihon/issues/77)); the server alone will decide who may use an administration feature.

## API Access and States

Pages never call `fetch`: they use the client from `src/api/client.ts`, generated from the contract (`@nihon/api-client`), which declares the API major version on every request. `request` turns each call into an outcome; a failure is one of:

| Failure | Cause | Displayed state |
| --- | --- | --- |
| `unavailable` | No HTTP answer (stopped or unreachable service), 503 while stopping, or 502/504 from a relay | Service unavailable, with Retry |
| `incompatible` | The health check reports another API major version, or the server answers `unsupported_api_version` | Incompatible client, with Retry; shows both versions when known |
| `error` | Any other error answer | Error, with Retry and the request identifier for the server log |

Before showing a page, the shell checks `GET /api/health` and the API major version; the navigation stays usable meanwhile. `useResource(key, load)` cancels the previous load with an `AbortSignal` when the page unmounts, when its key changes (a new route or identifier), or on retry, and ignores late answers. Data lives in component state only: leaving a page releases it, and a reload rebuilds it from the API. Nothing is persisted in the browser.

## Account Registration

`/register` is delivered by [issue #234](https://github.com/tabiitha/niihon/issues/234) on the contract of [#233](https://github.com/tabiitha/niihon/issues/233) (see [accounts](accounts.md)). Its code is `src/modules/accounts/`: `RegisterPage.tsx` (the screen), `registration.ts` (the four operations, the pending provider registration, and the reading of the provider's answer), `errors.ts` (the message of each failure), and `locales/`. Like every page, it contains no business rule: the server alone decides which usernames and passwords are valid, whether a name is taken, and which providers exist. The screen only checks what the server cannot see, that something was typed and that the confirmation equals the password.

| Behavior | How |
| --- | --- |
| Local registration | Username, password, and confirmation (each password field has a show/hide button) are sent to `registerLocalAccount`. Success shows the created username and a link home; no session is opened, because sign-in is a separate screen ([#76](https://github.com/tabiitha/niihon/issues/76)) |
| Providers | `listOAuthProviders` decides which buttons appear. Without credentials, or when the list cannot be read, only the local form is shown and registration still works offline |
| Provider username | The username field is shared: a provider button needs it filled first, because the provider's own name or email is never used. `startOAuthRegistration` also reports a taken name before the provider page opens |
| Provider return | The provider returns to `/register?code=…&state=…` on this origin (a loopback address, as the server requires). The screen compares `state` with the one the server issued to this tab, removes `code` and `state` from the address and the history at once, and only then calls `completeOAuthRegistration`. A `state` that is missing or different sends nothing. A refusal by the provider (`error=…`) creates nothing |
| Errors | Each stable code of the registration operations has a message in en, fr, and ja (`errors.ts`); `validation_failed` is told apart by the invalid field (`body.username`, `body.password`). The server's English text is never displayed; the request identifier is shown for the service log. A test fails when the contract names a code the screen cannot explain |
| Typed data | The username is always kept. After a refusal the passwords are cleared and typed again; after a lost answer (service unreachable, unexplained server error) everything is kept so that Retry is one action |
| Double submission | A synchronous guard rejects a second submit before the busy state is rendered; the buttons are disabled meanwhile |
| Stale answers | Every request has an `AbortController`. Leaving the page cancels it and the page ignores a late answer, as with `useResource` |
| Lost answers | The commands that create a profile carry an `Idempotency-Key`. A retry with the same key (inputs unchanged) returns the profile that was created instead of "username taken", so a lost answer never leaves a second profile. Editing a field starts a new command |
| Keyboard and assistive technology | Real labels, hints and errors linked with `aria-describedby`, `aria-invalid` on the faulty field, focus moved to that field after a failure, `role="alert"` for failures and `role="status"` for success, show/hide buttons named for their action |

**What the browser keeps.** The password and the confirmation live only in component state: they are cleared after a definite answer and are never put in the address, `localStorage`, `sessionStorage`, a cookie, or a log. The only storage used is the tab's `sessionStorage` entry `nihon.registration.pending` while the provider's page is open: `{ state, provider, idempotencyKey }`. `state` is the single-use reference of the flow (the server stores only its hash, and it authorizes nothing without the provider's one-time code), and the key only lets a retry return the same profile. Neither the authorization code nor a token is stored; the entry is removed as soon as the registration ends, and kept only while a lost answer leaves open whether the profile exists. A browser that blocks storage cannot continue a provider registration and says so; the local form still works.

**Trying it by hand.** After `bun run build`, `NIHON_WEB_DIR=apps/web/dist node apps/api/test/fixtures/accounts-serve.ts` serves the interface and the real accounts module on a temporary database, with Google and GitHub played by a local fake whose authorization pages approve at once (GitHub user 42, Google subject `g-42`). The printed port is the one to open at `/register`. Nothing leaves the machine.

**Appearances.** The card, fields, buttons, and messages use only the theme variables (`--color-*`), so they follow Sakura Milk and Neon Sorbet today and any style registered later; a test rejects a color literal in the account styles. Fields and buttons use `textMuted` for their outline (at least 3:1 against the background in both modes) instead of the decorative `border`. The Landscape style (Bloom Hour, Petal Afterglow) is not a registered theme yet ([#81](https://github.com/tabiitha/niihon/issues/81)), so it is not selectable. The mockups' "Sign in" links are absent until the sign-in screen exists.

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
| `bun run --cwd apps/web test` | Language selection, text completeness, routes, theme tokens and contrast, and the health check against the real API adapter and simulated failures; the registration operations against the real API and a fake Google and GitHub on loopback (`apps/api/test/fixtures/accounts-serve.ts`, which needs the Prisma client generated by an API build or test), including duplicates, refused passwords, lost answers, replays, and a stopped service |
| `bun run --cwd apps/api test` | Static serving: page fallback, cache headers, security headers, 404s, `/api` isolation, Web directory validation |
| `bun run test:production` | After `bun run build`: the compiled API serves the Web build; every space opens directly; the shell references only same-origin files; a local account is registered offline through the compiled API |
| `bun run test:container` | The image serves the interface, including a reload of `/reader?media=…`, also without network access |

Component rendering and keyboard navigation are verified manually in a browser; an automated browser test tool is not selected yet.

## Limits

| Resource | Bound |
| --- | --- |
| Bundle | One JavaScript file (about 258 KiB minified) and one style sheet; no runtime download |
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

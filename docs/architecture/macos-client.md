# macOS Client

The macOS client is a native SwiftUI application for Apple silicon Macs running macOS 26 or later. Like the Web client, it contains no business rule and no database: it displays what the local service returns through the [REST contract](api-contract.md). This page describes the connected shell delivered by [issue #73](https://github.com/tabiitha/niihon/issues/73) and the account registration screen of [issue #235](https://github.com/tabiitha/niihon/issues/235); controlling the service from the Mac belongs to [#74](https://github.com/tabiitha/niihon/issues/74). Intel Macs and other systems use the [Web client](web-client.md).

## Package Structure

`apps/macos` is a Swift package (Swift 6 language mode, tools 6.2):

| Path | Responsibility |
| --- | --- |
| `Sources/NihonMacCore/Connection/` | Service address, health check through the generated client, and the per-window connection state |
| `Sources/NihonMacCore/Localization/` | Interface language selection and text lookup |
| `Sources/NihonMacCore/Theme/` | Theme tokens, WCAG contrast, and light, dark, or system mode |
| `Sources/NihonMacCore/Navigation/` | The spaces of the shell, their two groups, and their Go menu shortcuts |
| `Sources/NihonMacCore/Accounts/` | Account registration: the operations through the generated client, the message of each failure, the form state, and the loopback receiver of the provider's answer |
| `Sources/NihonMacCore/Accounts/locales/` | Texts that only the native registration needs |
| `Sources/NihonMacCore/Shell/locales/` | Texts that only the native shell needs |
| `Sources/NihonMacCore/Generated/` | Swift sources generated from the shared texts and theme tokens; never edited |
| `Sources/Nihon/` | The SwiftUI application: window, navigation bar, pages, status views, the registration screen and its web authentication window, menu commands, measurement mode |
| `Tests/NihonMacCoreTests/` | Tests of the core, including against the real HTTP adapter |
| `Bundle/` | `Info.plist` and the App Sandbox entitlements of the app bundle |
| `scripts/build-app.sh`, `scripts/measure.sh` | Build and sign `build/Nihon.app`; measure startup and memory |
| `tools/generate-shared.mjs` | Generates `Sources/NihonMacCore/Generated/` |

`NihonMacCore` depends on the generated Swift client of `contracts/swift` (`NihonAPIClient`) and holds everything testable without a window. The `Nihon` executable holds only views.

## Connecting to the Service

The service runs separately, normally with Docker Compose as described in the [README](../../README.md). The client never starts, stops, or installs it, opens no database, and stores no business data: closing the app leaves the service running, and a client without a service shows that the service is unavailable.

The client connects to `http://127.0.0.1:4000` by default. Docker Desktop forwards the published port to the Mac's loopback interface, so the client never uses the Mac's LAN address or a `.local` name, which would require the Local Network permission. The user default `NihonServiceURL` changes the address, for example with the launch argument `-NihonServiceURL http://127.0.0.1:4100`. Only `http` or `https` URLs of a loopback IP address (`127.0.0.0/8`, `[::1]`) without path, query, or credentials are accepted; any other value shows a "service address is not allowed" page and sends no request.

Each window checks `GET /api/health` and the API major version before showing a page; the navigation bar stays usable meanwhile. Failures use the same classification as the Web client:

| State | Cause | Displayed |
| --- | --- | --- |
| Checking | The check is in progress | A progress indicator (a static symbol when Reduce Motion is on) |
| Unavailable | No HTTP answer, 503 while stopping, or 502/504 from a relay | Service not responding, the service address, Try again |
| Incompatible | The service implements another API major version, or answers `unsupported_api_version` | Update needed, both versions when known, Try again |
| Error | Any other answer, including a program that does not speak the contract | Error, the request identifier when available, Try again |

A check runs once when a window opens and once per retry; nothing polls. The retry cancels the pending check, a closed window cancels its own, and a late answer to a cancelled check is ignored. Requests use an ephemeral `URLSession` without cache, so nothing is written to disk, and time out after 10 seconds.

The bundle declares `NSAllowsLocalNetworking` in `Info.plist`, required for plain HTTP to an IP address, and is signed with the App Sandbox and two network entitlements: `com.apple.security.network.client`, for the requests to the service, and `com.apple.security.network.server`, only to receive a provider's answer on a loopback port during an account registration (see [Receiving the Provider's Answer](#receiving-the-providers-answer)).

## Navigation and Keyboard

The window shows a navigation bar at the top, laid out like the Web client's header: the Nihon brand on the left, the learning spaces (Home, Learn, Kanji, Library) in the middle, and the account spaces (Profile, Administration) on the right. Each space is a pill with an icon and its shared label; the current space is filled with the accent color, a space under the pointer gets a faint accent tint, and the brand or space with the keyboard focus gets a ring in the theme's focus color, drawn outside the pill with a small gap so that it contrasts with the page whether or not the pill is filled. The brand opens Home. The icons are SF Symbols; the Web client's own line icons are not reproduced, but its logo is drawn natively from the same shapes.

The window keeps the standard macOS title bar, which shows the current space (or the registration screen) followed by Nihon, and the navigation bar is the first thing of the window's content, on the same background gradient as the page. The title bar keeps the window buttons, the drag area, and full screen (where the title bar hides and the bar stays at the top) exactly as in any Mac app; the bar is not drawn by `NavigationSplitView` or a toolbar, which would give macOS' own sidebar or glass toolbar instead of the Web client's pills.

| Window width | Layout |
| --- | --- |
| Wide enough for the three parts side by side (a new window opens at 1200 by 720 points, enough in the three languages) | One row, as the Web header (the bar stops growing at 1280 points and is centered) |
| Narrower | Two rows, as the Web header below its 52 rem breakpoint: the brand and the account spaces, then the learning spaces |
| Narrowest | The brand, then each of the two groups on its own lines that wrap, so that none is clipped or hidden |

SwiftUI chooses the layout from the real text widths, so each language switches at its own width. Measured with the shipped fonts, in steps of 20 points of window width, the bar shows one row from 1000 points in English, 1080 in French, and 980 in Japanese, and two rows down to 520, 580, and 500 points; below that it wraps. Sizes are fixed points, so the layout does not react to a larger text size setting. A window size saved by macOS from an earlier launch takes precedence over the default 1200 by 720, so a person with a smaller saved window sees two rows even where a new window would show one.

The smallest window is 480 by 512 points: the content is at least 480 by 480 under the 32 point title bar. At that size the bar takes up to about 210 points (French, four lines), and the page below scrolls, so nothing is clipped: the status views (checking, service not responding, update needed, error, address not allowed) and the registration screen are scrollable, and at the smallest size the update needed view and the registration screen need scrolling to reach their last controls (Try again also answers Return and Command-R).

The pages present each space with the shared texts until the features exist; Home keeps the approved hierarchy of a pink **Start review** primary action and a separate **Discover new kana** action.

| Key | Action |
| --- | --- |
| Tab, Shift-Tab | Move between the brand, the spaces of the bar, and the controls of the page. The bar is reached whatever the Full Keyboard Access setting is; the page's own buttons follow that system setting |
| Left, Right arrow on the bar | Move to the previous or next space, in the bar's markup order (brand, learning spaces, account spaces) |
| Space, Return on a focused space | Open it |
| Command-1 to Command-6 | Open a space (Go menu), numbered from left to right in the one-row bar |
| Command-R, or Return on a failure | Retry the connection |
| Command-N | Open another window, with its own connection state |

A new window gives its first focusable view the focus; the bar clears it right after, so that no ring shows until a key asks for one. A click opens a space without leaving a ring.

Tab, the eye, and assistive technology read the bar in the same order in every layout: the brand, then the groups in the order the layout shows them. That is the learning spaces then the account spaces in one row and in the narrowest layout, and the account spaces then the learning spaces in two rows (as the Web header looks, although its markup keeps the learning spaces first). The arrow keys always follow the markup order, so Right on Library goes to Profile.

Headings carry the header trait, and a failure is announced to VoiceOver when it replaces the page. The two groups of spaces are labelled with the Web client's texts (main navigation, account) in every layout, each space is a button named by its label, and the current one is exposed as selected; the brand is a button named Nihon. The text and icon of a space use the theme's text color, or the color shown on the accent for the current space, and the tests check the pairs the themes declare, the text on the hover tint, and the focus ring against the whole background gradient and the accent. VoiceOver itself has not been run on the bar; only the accessibility tree was read.

## Shared Texts and Themes

The interface is offered in English, French, and Japanese. The language is the first system language that Nihon offers, which includes the per-app language chosen in System Settings > General > Language & Region; otherwise English. The profile language will take precedence once profiles exist ([#80](https://github.com/tabiitha/niihon/issues/80)). The window's locale follows the language, so Japanese text uses Japanese glyphs.

The client reads the same JSON texts and theme tokens as the Web client; they remain the single source. `bun run macos:generate` turns them into `Sources/NihonMacCore/Generated/ModuleTexts.swift` and `Themes.swift`:

| Source | Swift |
| --- | --- |
| `apps/web/src/shell/locales/*.json` | `ShellText` (navigation, states, retry) |
| `apps/macos/Sources/NihonMacCore/Shell/locales/*.json` | `MacShellText` (native wording, Go menu, address errors) |
| `apps/web/src/modules/<space>/locales/*.json` | `HomeText`, `LearningText`, `KanjiText`, `LibraryText`, `ProfileText`, `AdminText` |
| `apps/web/src/modules/accounts/locales/*.json` | `AccountsText` (the registration screen, shared with the Web client) |
| `apps/macos/Sources/NihonMacCore/Accounts/locales/*.json` | `MacAccountsText` (native wording of the registration: provider window, return page, menu) |
| `resources/themes/<style>/tokens.json` | `ColorRole` and `ThemeCatalog.themes` |

Each key becomes an enumeration case, so a text used by the client cannot be missing at compile time. The generator stops (exit code 2) when a `locales` folder lacks a language, has a missing or extra key, an empty text, or different `{placeholders}`, or when a theme misses a color role in either mode. `bun run macos:check` fails (exit code 1) when the committed Swift sources differ from the JSON files, so a change of the shared texts or tokens must be regenerated and committed with it. To give the client a new module's texts, add its `locales` folder to `textModules` in `tools/generate-shared.mjs`.

Views only use the color roles of the selected theme, described in the [Web client](web-client.md#themes): the background gradient, text, accent, and focus colors. The Sakura style applies Sakura Milk or Neon Sorbet and follows the system appearance, including changes while the app runs. Selecting the style and mode and storing them in the profile belong to [#81](https://github.com/tabiitha/niihon/issues/81). The core tests check every declared contrast pair in both modes, as the Web tests do.

## Build, Run, and Test

Requirements: macOS 26 or later on Apple silicon, Xcode 26 or later (Swift 6.2 or newer), and, for the tests, Node.js 24 with `bun install` done at the repository root.

| Command | Effect |
| --- | --- |
| `apps/macos/scripts/build-app.sh` | Build `apps/macos/build/Nihon.app` in release mode, signed ad hoc with the sandbox entitlements; `NIHON_CODESIGN_IDENTITY` selects another identity |
| `open apps/macos/build/Nihon.app` | Run the app; add `--args -NihonServiceURL http://127.0.0.1:4100` for another port |
| `swift test --package-path apps/macos` | Test the core: language selection, text completeness, theme contrast, address validation, failure classification with a fake contract client, connection states, a check against the real HTTP adapter (`apps/api/test/fixtures/serve.ts`) before and after it stops, and the registration (messages for every code of the contract, the form state, the loopback receiver, and local and provider registrations against the real service with fake providers, `apps/api/test/fixtures/accounts-serve.ts`) |
| `bun run macos:generate`, `bun run macos:check` | Regenerate, or check, the Swift texts and themes |
| `apps/macos/scripts/measure.sh [runs]` | Measure startup and memory, see below |

Xcode opens `apps/macos/Package.swift` directly. Views are verified manually, including the registration screen; an automated interface test tool is not selected yet. Distribution signing, notarization, and installation belong to the packaging work.

## Account Registration

The Profile space offers **Create an account**, and the Go menu offers **Create an Account** (Shift-Command-A) while the window is connected. Both open the registration screen of [issue #235](https://github.com/tabiitha/niihon/issues/235), on the contract of [#233](https://github.com/tabiitha/niihon/issues/233) (see [accounts](accounts.md)); the Web counterpart is described in the [Web client](web-client.md#account-registration). Like every part of the client, it contains no business rule: the service alone decides which usernames and passwords are valid, whether a name is taken, and which providers exist. The screen only checks what the service cannot see, that something was typed and that the confirmation equals the password.

| Part | Responsibility |
| --- | --- |
| `Accounts/AccountRegistering.swift` | The four operations (`registerLocalAccount`, `listOAuthProviders`, `startOAuthRegistration`, `completeOAuthRegistration`) through the generated client, with an ephemeral `URLSession` that is invalidated when the client is released, and a 30 s timeout (hashing a password and exchanging a code take longer than a health check) |
| `Accounts/RegistrationProblem.swift` | The failure classification (the same as the Web client's) and the message of each stable error code, with how a retry goes |
| `Accounts/RegistrationModel.swift` | The state of the form, apart from SwiftUI so that its rules are tested |
| `Accounts/ProviderReturn.swift`, `LoopbackProviderReturn.swift` | The return address of a provider registration and its receiver |
| `Nihon/RegistrationView.swift` | The screen: card, fields, errors, provider buttons |
| `Nihon/WebAuthenticationPresenter.swift` | The system web authentication window that shows the provider's page |

| Behavior | How |
| --- | --- |
| Local registration | Username, password, and confirmation (secure fields, each with a show/hide button) are sent to `registerLocalAccount`. Success shows the created username and a way back home; no session is opened, because sign-in is a separate screen ([#76](https://github.com/tabiitha/niihon/issues/76)) |
| Field help | The screen shows no standing instructions: no subtitle, no note under the provider buttons, and no help under an untouched field. After the service refuses a field, the matching help (`usernameHint` for an invalid name, `passwordHint` for a refused password) appears under that field; `RegistrationProblem.help(for:)` decides, with the same rule as the Web client's `hintFor`, and a taken name, a missing value, a missing name before a provider, or two passwords that differ get none. A test checks it against every code of the contract, and another that the generated texts have exactly the keys of the shared Web files |
| Providers | `listOAuthProviders` decides which buttons appear. Without credentials, or when the list cannot be read, only the local form is shown and registration still works offline |
| Provider username | The username field is shared: a provider button needs it filled first, because the provider's own name or email is never used. `startOAuthRegistration` also reports a taken name before the provider's page opens |
| Provider window | The provider's page opens in an `ASWebAuthenticationSession` that prefers an ephemeral session: it shares no cookie with Safari and opens without the system prompt that asks to share information between the app and the website. The window only displays; Nihon never sees what is typed in it. The screen shows that it is waiting, with **Cancel**. Closing the window, cancelling, and a listener that breaks end the attempt with three different messages (en, fr, ja) and create nothing |
| Provider return | See below. The receiver only takes an answer that carries the `state` the service issued, and the model compares it again before anything is sent; a missing or different `state` sends nothing. A refusal by the provider creates nothing |
| Errors | Each stable code of the registration operations has a message in en, fr, and ja; `validation_failed` is told apart by the invalid field. A `502` or `503` that carries a code the registration explains (`accounts_oauth_provider_failed`, `accounts_oauth_flow_consumed`, `accounts_busy`, `idempotency_capacity_reached`) is the service answering, not a stopped service; without such a code those statuses (and `stopping`) still mean a stopped service or a failing relay. The service's English text is never displayed; the request identifier is shown for the service log. A test reads every code and its real HTTP status from `contracts/openapi.json` and fails when one has no message |
| Typed data and retries | The username is always kept. After a definite refusal the passwords are cleared and the next attempt is a new command; after a lost answer, an unexplained or `internal_error` failure, `accounts_busy`, `database_busy`, or `idempotency_key_in_use` everything is kept and the same command is repeated with the same `Idempotency-Key`, so a profile that was created is returned instead of reported as taken; after `idempotency_capacity_reached` the next attempt is sent without a key. A provider completion that is not decided offers **Try again** with the same code and key. Editing a field starts a new command |
| Double submission | The model drops a second submit synchronously while one is running; the buttons are disabled meanwhile |
| Stale answers | Leaving the screen (another space, the connection lost, the window closed) cancels the request, stops the receiver, closes the provider's window, and ignores any late answer |
| Accessibility | Headers carry the header trait, each field has a label and, only after a refusal of that field, an accessibility hint made of the problem and then the help (nothing is read at rest, and the help is never announced on its own, so nothing is announced twice), focus moves to the faulty field after a failure, a failure and a success are announced to VoiceOver, fields and buttons are at least 44 points high, and the progress indicator is a static symbol when Reduce Motion is on |

### Receiving the Provider's Answer

The service accepts an `http` loopback address as `redirectUri`. The app therefore opens a listener on `127.0.0.1` (`NWListener`, an ephemeral port), gives `http://127.0.0.1:<port>/oauth/callback` to `startOAuthRegistration`, and waits for the provider's browser to come back to it. The listener:

- accepts connections from the loopback interface only, at most 8 at a time, reads at most 8 KiB and for at most 5 s per connection, and answers only `GET /oauth/callback`; any other path, an incomplete answer, or an answer whose `state` is not the one issued for this attempt (the service gives it before the provider's page opens) gets a 404 or 400 and the wait goes on;
- takes the first answer that carries the issued `state` and a `code` of at most 2,048 characters (or `error=…`), then closes. A provider that reports an error without returning the `state` is therefore not heard: the wait goes on until the person cancels or closes the window, or the flow expires; it keeps nothing, logs nothing, and answers with a small page that echoes none of the parameters (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, a restrictive `Content-Security-Policy`) asking to return to Nihon;
- stops when the provider's window is closed, when the person cancels, when the listener fails, when the screen is left, or at the flow's `expiresAt`. Its port is opened once, with its final handlers, and released at the end.

The authorization code and the `state` live in memory only for the duration of the attempt: nothing is written to the logs, user defaults, or files. A request to the loopback port that does not carry the `state` cannot end or change the attempt, because it is refused; it can still reach the port while the attempt lasts. Only the service and this attempt know the `state` until the provider's page uses it, and the service still verifies the code with the provider, so a program that did learn it could at most supply a wrong code and make the attempt fail.

**Sandbox.** Listening needs the `com.apple.security.network.server` entitlement, which `Bundle/Nihon.entitlements` now declares next to `com.apple.security.network.client`. The app can therefore accept connections from any local program on its loopback port during an attempt; the limits above bound what such a program can cost, and the `state` check means it cannot complete the attempt. This is a security setting of the bundle and is flagged for the owner's review. Without it the sandboxed app cannot listen, shows "Nihon could not prepare to receive the provider's answer on this Mac", and local registration still works.

**Provider configuration.** The provider must accept a loopback return address with a variable port, which the installation's own credentials have to allow ([accounts](accounts.md)); this has not been checked against Google's or GitHub's current rules, because no real provider round trip was made. A Mac whose installation lists no provider shows only the local form.


## Measurement

`measure.sh` launches the bundle's executable with `--probe`, once per run. The app records the time from process start to the first connected window, then twenty times opens a window, waits for its connection, visits the six spaces, and closes it, recording the physical memory footprint after each cycle. It prints one JSON line and quits. `-NihonProbeCycles <count>` changes the number of cycles. A service must already answer at the client's address.

## Limits

| Resource | Bound |
| --- | --- |
| Pending requests | One health check per window; the previous one is cancelled on retry or window close |
| Request time | 10 seconds |
| Data kept | The connection state and service versions of each window, released with the window; nothing on disk |
| Registration requests | One at a time per screen (a second submit is dropped); 30 seconds each; the provider's attempt lasts until the service's `expiresAt` (10 minutes) |
| Loopback receiver | One per attempt, on `127.0.0.1` only; 8 connections, 8 KiB and 5 s per connection; closed after the first valid answer |

These bounds are a starting point; tune them after measurement.

## Toolchain Versions

| Tool | Version | Role |
| --- | --- | --- |
| Swift tools | 6.2 (verified with Swift 6.4 and Xcode 27.0) | Package and language mode 6 |
| macOS deployment target | 26.0, arm64 | Minimum system |
| `NihonAPIClient` | from `contracts/swift` | Generated client, see the [REST contract](api-contract.md) |

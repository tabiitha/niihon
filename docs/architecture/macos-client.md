# macOS Client

The macOS client is a native SwiftUI application for Apple silicon Macs running macOS 26 or later. Like the Web client, it contains no business rule and no database: it displays what the local service returns through the [REST contract](api-contract.md). This page describes the connected shell delivered by [issue #73](https://github.com/tabiitha/niihon/issues/73); controlling the service from the Mac belongs to [#74](https://github.com/tabiitha/niihon/issues/74). Intel Macs and other systems use the [Web client](web-client.md).

## Package Structure

`apps/macos` is a Swift package (Swift 6 language mode, tools 6.2):

| Path | Responsibility |
| --- | --- |
| `Sources/NihonMacCore/Connection/` | Service address, health check through the generated client, and the per-window connection state |
| `Sources/NihonMacCore/Localization/` | Interface language selection and text lookup |
| `Sources/NihonMacCore/Theme/` | Theme tokens, WCAG contrast, and light, dark, or system mode |
| `Sources/NihonMacCore/Navigation/` | The spaces of the shell |
| `Sources/NihonMacCore/Shell/locales/` | Texts that only the native shell needs |
| `Sources/NihonMacCore/Generated/` | Swift sources generated from the shared texts and theme tokens; never edited |
| `Sources/Nihon/` | The SwiftUI application: window, sidebar, pages, status views, menu commands, measurement mode |
| `Tests/NihonMacCoreTests/` | Tests of the core, including against the real HTTP adapter |
| `Bundle/` | `Info.plist` and the App Sandbox entitlements of the app bundle |
| `scripts/build-app.sh`, `scripts/measure.sh` | Build and sign `build/Nihon.app`; measure startup and memory |
| `tools/generate-shared.mjs` | Generates `Sources/NihonMacCore/Generated/` |

`NihonMacCore` depends on the generated Swift client of `contracts/swift` (`NihonAPIClient`) and holds everything testable without a window. The `Nihon` executable holds only views.

## Connecting to the Service

The service runs separately, normally with Docker Compose as described in the [README](../../README.md). The client never starts, stops, or installs it, opens no database, and stores no business data: closing the app leaves the service running, and a client without a service shows that the service is unavailable.

The client connects to `http://127.0.0.1:4000` by default. Docker Desktop forwards the published port to the Mac's loopback interface, so the client never uses the Mac's LAN address or a `.local` name, which would require the Local Network permission. The user default `NihonServiceURL` changes the address, for example with the launch argument `-NihonServiceURL http://127.0.0.1:4100`. Only `http` or `https` URLs of a loopback IP address (`127.0.0.0/8`, `[::1]`) without path, query, or credentials are accepted; any other value shows a "service address is not allowed" page and sends no request.

Each window checks `GET /api/health` and the API major version before showing a page; the sidebar stays usable meanwhile. Failures use the same classification as the Web client:

| State | Cause | Displayed |
| --- | --- | --- |
| Checking | The check is in progress | A progress indicator (a static symbol when Reduce Motion is on) |
| Unavailable | No HTTP answer, 503 while stopping, or 502/504 from a relay | Service not responding, the service address, Try again |
| Incompatible | The service implements another API major version, or answers `unsupported_api_version` | Update needed, both versions when known, Try again |
| Error | Any other answer, including a program that does not speak the contract | Error, the request identifier when available, Try again |

A check runs once when a window opens and once per retry; nothing polls. The retry cancels the pending check, a closed window cancels its own, and a late answer to a cancelled check is ignored. Requests use an ephemeral `URLSession` without cache, so nothing is written to disk, and time out after 10 seconds.

The bundle declares `NSAllowsLocalNetworking` in `Info.plist`, required for plain HTTP to an IP address, and is signed with the App Sandbox and only the `com.apple.security.network.client` entitlement.

## Navigation and Keyboard

The window shows a sidebar with the learning spaces (Home, Learn, Kanji, Library) and the account spaces (Profile, Administration), as in the Web client. The pages present each space with the shared texts until the features exist; Home keeps the approved hierarchy of a pink **Start review** primary action and a separate **Discover new kana** action.

| Key | Action |
| --- | --- |
| Up and Down arrows in the sidebar | Change space |
| Tab, Shift-Tab | Move between the sidebar and the page (controls of the page with Full Keyboard Access) |
| Command-1 to Command-6 | Open a space (Go menu) |
| Command-R, or Return on a failure | Retry the connection |
| Command-N | Open another window, with its own connection state |

Headings carry the header trait, and a failure is announced to VoiceOver when it replaces the page.

## Shared Texts and Themes

The interface is offered in English, French, and Japanese. The language is the first system language that Nihon offers, which includes the per-app language chosen in System Settings > General > Language & Region; otherwise English. The profile language will take precedence once profiles exist ([#80](https://github.com/tabiitha/niihon/issues/80)). The window's locale follows the language, so Japanese text uses Japanese glyphs.

The client reads the same JSON texts and theme tokens as the Web client; they remain the single source. `bun run macos:generate` turns them into `Sources/NihonMacCore/Generated/ModuleTexts.swift` and `Themes.swift`:

| Source | Swift |
| --- | --- |
| `apps/web/src/shell/locales/*.json` | `ShellText` (navigation, states, retry) |
| `apps/macos/Sources/NihonMacCore/Shell/locales/*.json` | `MacShellText` (native wording, Go menu, address errors) |
| `apps/web/src/modules/<space>/locales/*.json` | `HomeText`, `LearningText`, `KanjiText`, `LibraryText`, `ProfileText`, `AdminText` |
| `resources/themes/<style>/tokens.json` | `ColorRole` and `ThemeCatalog.themes` |

Each key becomes an enumeration case, so a text used by the client cannot be missing at compile time. The generator stops (exit code 2) when a `locales` folder lacks a language, has a missing or extra key, an empty text, or different `{placeholders}`, or when a theme misses a color role in either mode. `bun run macos:check` fails (exit code 1) when the committed Swift sources differ from the JSON files, so a change of the shared texts or tokens must be regenerated and committed with it. To give the client a new module's texts, add its `locales` folder to `textModules` in `tools/generate-shared.mjs`.

Views only use the color roles of the selected theme, described in the [Web client](web-client.md#themes): the background gradient, text, accent, and focus colors. The Sakura style applies Sakura Milk or Neon Sorbet and follows the system appearance, including changes while the app runs. Selecting the style and mode and storing them in the profile belong to [#81](https://github.com/tabiitha/niihon/issues/81). The core tests check every declared contrast pair in both modes, as the Web tests do.

## Build, Run, and Test

Requirements: macOS 26 or later on Apple silicon, Xcode 26 or later (Swift 6.2 or newer), and, for the tests, Node.js 24 with `bun install` done at the repository root.

| Command | Effect |
| --- | --- |
| `apps/macos/scripts/build-app.sh` | Build `apps/macos/build/Nihon.app` in release mode, signed ad hoc with the sandbox entitlements; `NIHON_CODESIGN_IDENTITY` selects another identity |
| `open apps/macos/build/Nihon.app` | Run the app; add `--args -NihonServiceURL http://127.0.0.1:4100` for another port |
| `swift test --package-path apps/macos` | Test the core: language selection, text completeness, theme contrast, address validation, failure classification with a fake contract client, connection states, and a check against the real HTTP adapter (`apps/api/test/fixtures/serve.ts`) before and after it stops |
| `bun run macos:generate`, `bun run macos:check` | Regenerate, or check, the Swift texts and themes |
| `apps/macos/scripts/measure.sh [runs]` | Measure startup and memory, see below |

Xcode opens `apps/macos/Package.swift` directly. Views are verified manually; an automated interface test tool is not selected yet. Distribution signing, notarization, and installation belong to the packaging work.

## Measurement

`measure.sh` launches the bundle's executable with `--probe`, once per run. The app records the time from process start to the first connected window, then twenty times opens a window, waits for its connection, visits the six spaces, and closes it, recording the physical memory footprint after each cycle. It prints one JSON line and quits. `-NihonProbeCycles <count>` changes the number of cycles. A service must already answer at the client's address.

## Limits

| Resource | Bound |
| --- | --- |
| Pending requests | One health check per window; the previous one is cancelled on retry or window close |
| Request time | 10 seconds |
| Data kept | The connection state and service versions of each window, released with the window; nothing on disk |

These bounds are a starting point; tune them after measurement.

## Toolchain Versions

| Tool | Version | Role |
| --- | --- | --- |
| Swift tools | 6.2 (verified with Swift 6.4 and Xcode 27.0) | Package and language mode 6 |
| macOS deployment target | 26.0, arm64 | Minimum system |
| `NihonAPIClient` | from `contracts/swift` | Generated client, see the [REST contract](api-contract.md) |

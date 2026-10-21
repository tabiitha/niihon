# Account Registration

The `accounts` module registers one local Nihon profile, either from a username and password or from a verified Google or GitHub identity. It is delivered by [issue #233](https://github.com/tabiitha/niihon/issues/233), the backend part of [#75](https://github.com/tabiitha/niihon/issues/75). Sign-in and sessions ([#76](https://github.com/tabiitha/niihon/issues/76), which reuses the provider adapters described here), the screens ([#234](https://github.com/tabiitha/niihon/issues/234), [#235](https://github.com/tabiitha/niihon/issues/235)), adding a local password to a provider profile ([#79](https://github.com/tabiitha/niihon/issues/79)), and the avatar ([#78](https://github.com/tabiitha/niihon/issues/78)) are separate. Registration opens no session. The module follows the [API server](api-server.md#modules) and [REST contract](api-contract.md) conventions.

## Rules

| Rule | Behavior |
| --- | --- |
| Username | After Unicode NFKC normalization and trimming: 3 to 32 characters, letters of any script, digits, marks, `_`, `-`, `.`, starting with a letter or digit. The display form keeps its case. Uniqueness is judged on the lowercase of the normalized form, so `Sakura`, `sakura` and `ｓａｋｕｒａ` are one name. Look-alike characters from different scripts are not unified |
| Password | After NFKC normalization: 8 to 128 characters (code points), not blank, no control characters, different from the username. No composition rules and no list of common passwords |
| Role | Every new profile is `user`. The request bodies are strict objects: a `role` field, or any other unexpected field, is refused with `validation_failed` and creates nothing |
| Atomicity | One write transaction checks uniqueness and inserts the profile with its credential or provider link. A refusal or failure rolls everything back, so there is never a partial account. Writes are serialized by the [database layer](persistence.md#concurrency-and-durability), so concurrent registrations are decided one after the other and exactly one of two racing for a username succeeds |
| Provider identity | Identified by provider, issuer, and subject, unique in the database. Email address and display name are neither required, read, nor stored; profiles are never merged by email |

## Operations

All paths are under `/api/accounts`. Errors use the standard body; `accounts_*` codes below are stable.

| Operation | Request | Success | Errors |
| --- | --- | --- | --- |
| `registerLocalAccount` `POST /local-registrations` | `{ username, password }` | `201` profile | `400 validation_failed`, `409 accounts_username_taken`, `503 accounts_busy` |
| `listOAuthProviders` `GET /oauth-providers` | | `200 { items: [{ id }] }`, the configured providers | |
| `startOAuthRegistration` `POST /oauth-registrations` | `{ provider, username, redirectUri }` | `201 { authorizationUrl, state, expiresAt }` | `400 validation_failed`, `400 accounts_oauth_redirect_uri_invalid`, `409 accounts_username_taken`, `422 accounts_oauth_provider_unavailable`, `503 accounts_busy` |
| `completeOAuthRegistration` `POST /oauth-registrations/completion` | `{ state, code }` | `201` profile | `400 accounts_oauth_state_invalid`, `400 accounts_oauth_state_expired`, `400 accounts_oauth_code_rejected`, `400 accounts_oauth_identity_unverified`, `409 accounts_username_taken`, `409 accounts_identity_already_registered`, `502 accounts_oauth_provider_failed`, `503 accounts_busy` |

The profile is `{ id, username, role, registeredWith, createdAt }`; `registeredWith` is `local` or the provider identifier. Every `503 accounts_busy` carries `Retry-After: 1`. Every response is `Cache-Control: no-store`. Local registration works without network, email, or an external account. Provider identifiers are plain strings (`google`, `github`), as the [authentication extension points](api-contract.md#authentication-extension-points) require.

## Provider Flow

The browser redirect to and from a provider is not a JSON operation; the two JSON operations around it are.

```text
client                    Nihon API                           provider
  │ startOAuthRegistration   │                                     │
  ├─────────────────────────►│ store flow (state hash, PKCE        │
  │◄─ authorizationUrl,state │ verifier, nonce, username) 10 min   │
  │ open authorizationUrl in the browser ─────────────────────────►│
  │◄── browser returns to redirectUri?code=…&state=… ──────────────┤
  │ compare state; completeOAuthRegistration(state, code)          │
  ├─────────────────────────►│ consume flow (delete)               │
  │                          ├── exchange code + PKCE verifier ───►│
  │                          │◄── ID token / GitHub user ──────────┤
  │                          │ verify; create profile + link       │
  │◄──────── 201 profile ────┤                                     │
```

- **Single use.** The flow is deleted in the first transaction of `completeOAuthRegistration`, before any network call. A replayed or concurrent completion finds nothing and fails with `accounts_oauth_state_invalid` without calling the provider; a refused code needs a new flow. Only the SHA-256 of `state` is stored. Flows expire after 10 minutes; expired ones are deleted when a new flow starts, and at most 500 are pending (`503 accounts_busy` beyond).
- **Return address.** `redirectUri` must be an `http` loopback address (`127.0.0.1`, `localhost`, `[::1]`, any port and path), which is what the Web client served by the server and a native client's local listener use, or an exact address in `NIHON_OAUTH_REDIRECT_URIS`. The provider enforces its own registered list as well. The same address is used for the code exchange.
- **Username.** Chosen at the start, checked then (for early feedback) and again in the transaction that creates the profile (`409 accounts_username_taken` if it was taken meanwhile; nothing is created).
- **Google.** OpenID Connect authorization code flow with PKCE (`S256`), scope `openid` only. The ID token must be RS256-signed by a key from Google's published key set (cached one hour, refreshed on an unknown key at most once a minute), with accepted `iss` (`https://accounts.google.com` or `accounts.google.com`, recorded as the first), `aud` equal to the client identifier (and `azp` when several), unexpired `exp` and not-future `iat` within 60 s of clock difference, and the flow's `nonce`. Other algorithms, including `none`, are refused. The subject is `sub`.
- **GitHub.** OAuth app authorization code flow with PKCE, no scope. The access token is used once to read `GET https://api.github.com/user`; the subject is the numeric `id`, never the renamable `login`. The issuer recorded is `https://github.com`. The token is not stored, returned, or logged.
- **Network.** Provider calls have a 10 s deadline, do not follow redirects, and read at most 1 MiB. Unreachable, slow, oversized, or malformed answers are `502 accounts_oauth_provider_failed`; a refused code is `accounts_oauth_code_rejected`; a token that fails verification is `accounts_oauth_identity_unverified`. At most four exchanges run at once and sixteen wait (`503 accounts_busy`). No network call happens inside a database transaction.

Provider tokens, codes, `state`, nonces, client secrets, passwords, and hashes are never logged or returned. The log events of the module are `account.registered` (profile identifier and method) and `account.oauth_failed` (provider and failure kind).

## Provider Configuration

Provider sign-up is optional: without credentials `listOAuthProviders` is empty, `startOAuthRegistration` answers `422`, and everything else works offline. The Nihon application must be registered with each provider (Google Cloud Console OAuth client; GitHub OAuth app) with the return addresses its clients use. The installation supplies the credentials as environment variables, set in the shell or an untracked `.env` file read by `docker compose`:

| Variable | Meaning |
| --- | --- |
| `NIHON_OAUTH_GOOGLE_CLIENT_ID`, `NIHON_OAUTH_GOOGLE_CLIENT_SECRET` | Google client; both or neither |
| `NIHON_OAUTH_GITHUB_CLIENT_ID`, `NIHON_OAUTH_GITHUB_CLIENT_SECRET` | GitHub client; both or neither |
| `NIHON_OAUTH_REDIRECT_URIS` | Extra `https` return addresses, comma-separated |

The secrets stay in the server process: they are never in the source, a Web or native bundle, a Docker image, a response, a log, or the database. Environment variables of a container are visible to whoever can run `docker inspect`; the server is a local single-user installation, so this matches its trust boundary. No central broker is used. Providers other than Google and GitHub are not supported.

## Data

Prisma models in `apps/api/prisma/schema/accounts.prisma`, migration `20261021040214_accounts`:

| Model | Content |
| --- | --- |
| `Profile` | `id`, display `username`, unique `usernameKey` (normalized), `role`, `createdAt` |
| `LocalCredential` | `profileId`, Argon2id `passwordHash`; absent for provider profiles |
| `ExternalIdentity` | `profileId`, `provider`, `issuer`, `subject`, unique on the three together |
| `OAuthFlow` | Pending provider flows: `stateHash` (unique), `provider`, PKCE verifier, `nonce`, `redirectUri`, requested `username`, `expiresAt` |

## Password Hashing

Argon2id through `node:crypto` (`crypto.argon2`, Node.js 24.7 or newer), so no dependency was added. Parameters: 64 MiB, 3 passes, 1 lane, 16-byte random salt, 32-byte tag, above the OWASP minimum (19 MiB, 2 passes, 1 lane). The hash is a PHC string (`$argon2id$v=19$m=65536,t=3,p=1$<salt>$<tag>`) that carries its own parameters, so raising them later does not invalidate existing passwords; `verifyPassword` (for #76) reads them from the string and refuses hashes asking for more than 256 MiB or 10 passes. Hashing runs on the libuv thread pool, not the event loop. At most 2 hashes run at once and 16 wait (`503 accounts_busy` beyond), bounding hashing memory to 128 MiB. The password is normalized with NFKC before hashing.

## Performance

Measured with `bun run --cwd apps/api bench:accounts` against the real HTTP adapter and database, with the providers replaced by a local fake that answers immediately, so provider latency is excluded: 10 warm-up and 100 timed sequential registrations, 20 rounds of 10 concurrent registrations while `GET /api/health` is read in a loop, and 60 provider flows. Apple M4 Pro, 48 GB, macOS (arm64), Node.js 26.7.0.

| Measure | Samples | p50 | p95 | Max |
| --- | --- | --- | --- | --- |
| Hash one password | 30 | 85.5 ms | 92.2 ms | 135.0 ms |
| Register one account, sequential, warm | 100 | 87.9 ms | 89.7 ms | 90.9 ms |
| Register one account, 10 at once | 200 | 269.7 ms | 450.0 ms | 454.8 ms |
| Status read during 10 concurrent registrations | 113,508 | 0.1 ms | 0.1 ms | 4.9 ms |
| Start a provider flow | 60 | 0.7 ms | 1.2 ms | 9.3 ms |
| Complete a provider flow | 60 | 1.6 ms | 3.0 ms | 7.7 ms |

The issue's budgets are registration p95 ≤ 1 s and status reads p95 ≤ 100 ms during ten bounded concurrent requests. The benchmark process (server, database, client, and fake together) peaked at 431 MiB RSS. On macOS, SQLite's `fsync` does not force a drive cache flush, so write timings there understate Linux. The real Google and GitHub round trips are not measured.

## Limits

| Resource | Bound |
| --- | --- |
| Request body | 8 KiB |
| Username / password input | 256 / 512 characters before the finer rules |
| `code` / `state` / `redirectUri` | 2,048 / 128 / 512 characters |
| Concurrent hashes, queued hashes | 2, 16 |
| Concurrent code exchanges, queued exchanges | 4, 16 |
| Pending provider flows, lifetime | 500, 10 minutes |
| Provider call, answer size | 10 s, 1 MiB |

These bounds are a starting point; tune them after measurement.

# Sign-In and Sessions

A registered profile ([accounts](accounts.md)) signs in with its local password or with the Google or GitHub identity linked to it, which opens a Nihon session; signing out revokes it. Delivered by [issue #269](https://github.com/tabiitha/niihon/issues/269), the backend part of [#76](https://github.com/tabiitha/niihon/issues/76). The screens ([#270](https://github.com/tabiitha/niihon/issues/270), [#271](https://github.com/tabiitha/niihon/issues/271)), access isolation between profiles ([#77](https://github.com/tabiitha/niihon/issues/77)), and passwords, linked accounts, and revoking other sessions ([#79](https://github.com/tabiitha/niihon/issues/79)) are separate.

## Sessions

| Rule | Behavior |
| --- | --- |
| Token | 32 random bytes in base64url (43 characters), meaningless and opaque. Only its SHA-256 is stored. A provider token never becomes a Nihon session and never authorizes a Nihon route |
| Delivery | The client says how it keeps its session (`client`). `web`: the token is set in the `nihon_session` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Max-Age` equal to the remaining lifetime, `Secure` when the request reached the server itself over HTTPS; Express's `trust proxy` is not set, so behind a reverse proxy that terminates HTTPS the cookies lack `Secure`, a known limitation) and never appears in a body, so page scripts cannot read it. `native`: the token is returned once in the body; the client keeps it in secure storage (Keychain) and sends `Authorization: Bearer <token>` |
| Lifetime | Fixed 30 days from sign-in. Using a session does not extend it. After expiry it authorizes nothing and the client signs in again |
| Restart | Sessions are rows of the database: a restart, an update, or a crash keeps them, and keeps revoked ones revoked |
| Sign-out | Deletes the session row, so its token stops authorizing anything at once, on any client. Always `204`, also when the session was already gone, so a retry is safe. The Web cookie is cleared. Provider accounts are not disconnected |
| Replacement | A sign-in from a request that already presents a valid session revokes that session in the same transaction. Switching profiles on one client therefore leaves no session behind |
| Room | A profile keeps its 20 newest sessions and the installation its 10,000 newest: a sign-in beyond either bound drops the oldest session of the profile, then of the installation, and is never refused for lack of room. Registration is anonymous, so a flood of registrations and sign-ins could otherwise lock everyone out for 30 days; at worst it signs the oldest sessions out, and their clients sign in again |
| Several clients | Every sign-in opens its own session. The Web client and the macOS app may be signed in to the same profile or to different ones; signing one out leaves the others |
| Authorization | The server resolves the presented token (bearer header first, otherwise cookie) before any route runs. An operation declaring `session: 'required'` refuses a request without a valid session with `401 authentication_required` and `WWW-Authenticate: Bearer` before reading its input; every expiry, revocation, and unknown token gives this same answer. Other routes ignore a missing or stale token, so an expired cookie never blocks signing in or registering. A profile identifier sent by a client is never an authorization. The contract lists the session's security schemes on every operation that reads it: required on `getCurrentSession`, optional on `signIn`, `completeOAuthSignIn` (replacement), and `signOut`, so a generated client knows to send its token |
| Idempotent commands | The caller recorded with a [command](command-idempotency.md) is `profile:<id>` when signed in, otherwise `anonymous`; a key used by one profile is refused to another |

Cross-site requests: the cookies are `SameSite=Strict`, every operation with a body accepts only `application/json` (which an HTML form cannot send), and the server sends no CORS headers, so another site can neither sign a browser in nor act with its session.

## Operations

All paths are under `/api/accounts`. Errors use the standard body; every response is `Cache-Control: no-store`.

| Operation | Request | Success | Errors |
| --- | --- | --- | --- |
| `signIn` `POST /sessions` | `{ username, password, client }`, session optional | `201 { session, token? }` | `400 validation_failed`, `401 accounts_credentials_invalid`, `503 accounts_busy` (password checks queued to their limit) |
| `startOAuthSignIn` `POST /oauth-sign-ins` | `{ provider, redirectUri, client }` | `201 { authorizationUrl, state, expiresAt, clientBinding? }` | `400 validation_failed`, `400 accounts_oauth_redirect_uri_invalid`, `422 accounts_oauth_provider_unavailable`, `503 accounts_busy` |
| `completeOAuthSignIn` `POST /oauth-sign-ins/completion` | `{ state, code, clientBinding? }`, session optional | `201 { session, token? }` | `400 accounts_oauth_state_invalid`, `400 accounts_oauth_state_expired`, `400 accounts_oauth_client_mismatch`, `400 accounts_oauth_code_rejected`, `400 accounts_oauth_identity_unverified`, `401 accounts_identity_not_registered`, `422 accounts_oauth_provider_unavailable`, `502 accounts_oauth_provider_failed`, `503 accounts_busy`, `503 accounts_oauth_flow_consumed` |
| `getCurrentSession` `GET /sessions/current` | session required | `200` session | `401 authentication_required` |
| `signOut` `DELETE /sessions/current` | session optional; without one nothing is revoked | `204` | |

The session is `{ id, profile: { id, username, role }, client, signedInWith, createdAt, expiresAt }`; `signedInWith` is `local` or the provider identifier. `token` is present for a `native` client only. None of these operations is an idempotent command: their answer carries a secret the server never stores in clear, and retrying a sign-in simply opens another session.

An unknown username, a username that breaks the registration rules, a wrong password, and a profile without a local password all answer `401 accounts_credentials_invalid`. An unknown username is still checked against a comparison hash with the same Argon2id parameters, computed when the module starts (and again on first need if that failed), so its answer takes as long as a wrong password's from the first attempt on (84.4 ms against 84.2 ms p50, maximum 85.6 ms against 86.1 ms, see Performance) and does not reveal which usernames exist. The verified hash is compared again inside the transaction that opens the session, so a password changed meanwhile is refused.

## Provider Sign-In

The provider adapters, return-address rules, network bounds, and token verification are those of [registration](accounts.md#provider-flow): authorization code with PKCE `S256`; for Google an RS256 ID token checked for issuer, audience, `azp`, expiry, issue time, and the flow's nonce; for GitHub the numeric `id` read once from `GET /user`. The verified identity (provider, issuer, subject) must already be linked to a profile; the email address is neither required nor read, and sign-in never creates or merges a profile.

```text
client                       Nihon API                               provider
  │ startOAuthSignIn            │                                        │
  ├────────────────────────────►│ store flow: hashes of state and        │
  │◄─ authorizationUrl, state,  │ binding, PKCE verifier, nonce,         │
  │   binding (cookie or body)  │ redirectUri, client; 10 min            │
  │ open authorizationUrl in the browser ───────────────────────────────►│
  │◄──── browser returns to redirectUri?code=…&state=… ──────────────────┤
  │ compare state; completeOAuthSignIn(state, code, binding)             │
  ├────────────────────────────►│ binding matches? consume flow          │
  │                             ├── exchange code + PKCE verifier ──────►│
  │                             │◄── ID token / GitHub user ─────────────┤
  │                             │ verify; find linked profile;           │
  │◄── 201 session (cookie or   │ open session                           │
  │    token)                   │                                        │
```

- **Separate from registration.** Sign-in flows live in their own table: a registration `state` is unknown to sign-in completion and the reverse, so a flow cannot change intent.
- **Bound to the initiating client.** Each flow has a second secret, the client binding, of which only the SHA-256 is stored. A `web` client receives it as the `nihon_oauth_binding` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api/accounts/oauth-sign-ins`, 10 minutes) and never sees it; a `native` client receives `clientBinding` in the body and sends it back. The binding never goes through the browser's address bar, so someone who obtains `state` and `code` from the return address cannot complete the flow: the completion is refused with `accounts_oauth_client_mismatch` before anything is consumed, and the real client can still complete it.
- **Single use.** As for registration, an exchange slot is taken first (`503 accounts_busy` leaves the flow intact), then the flow is deleted in its first transaction, before any network call. Duplicate and concurrent callbacks find nothing and answer `accounts_oauth_state_invalid` without calling the provider; exactly one session is opened. After the flow is consumed, any failure means starting again, including `401 accounts_identity_not_registered` and `503 accounts_oauth_flow_consumed`.
- **Superseded attempts.** Starting again from the same browser presents the previous binding cookie: the previous flow is deleted, and its late return answers `accounts_oauth_state_invalid`. A native client keeps only the binding of its latest attempt, so the late return of an older attempt fails the binding check.
- **Expiry and return address.** Flows expire after 10 minutes (`accounts_oauth_state_expired`; the provider is not called). `redirectUri` follows the registration rule: an `http` loopback address or an exact address in `NIHON_OAUTH_REDIRECT_URIS`.
- **Restart.** The flow is a database row, so a flow started before a restart can be completed after it.

Tokens, codes, `state`, bindings, nonces, passwords, and hashes are never logged or returned beyond what the table above lists. The log events are `account.signed_in` (profile, session, method, client), `account.sign_in_failed` (method, and `identity_not_registered` when relevant; never the username), `account.signed_out` (profile, session), and the registration's `account.oauth_failed`.

## Data

| Model | File | Content |
| --- | --- | --- |
| `Session` | `apps/api/prisma/schema/sessions.prisma` | `id`, unique `tokenHash`, `profileId` (deleted with the profile), `client`, `signedInWith`, `createdAt`, `expiresAt` |
| `OAuthSignInFlow` | `apps/api/prisma/schema/accounts.prisma` | Pending provider sign-ins: unique `stateHash`, `bindingHash`, `provider`, PKCE verifier, `nonce`, `redirectUri`, `client`, `expiresAt` |

Migration `20261022231716_sign_in_sessions` adds both tables. Expired sessions are deleted in batches of 100 by later sign-ins, expired flows by later starts, so both tables stay bounded without a timer.

## Source Structure

| File | Responsibility |
| --- | --- |
| `apps/api/src/sessions/token.ts` | Secrets and their hashes, reading the bearer header or the cookie, cookie attributes |
| `apps/api/src/sessions/sessions.ts` | `createSessions`: resolves each request's session (`authenticate`, `currentSession`), opens sessions inside a transaction with their limits, revokes them |
| `apps/api/src/contract/operation.ts` | `session: 'required'` refuses requests without a session, `'optional'` only documents it; responses without a body (`204`) |
| `apps/api/src/modules/accounts/sign-in.ts` | Sign-in rules independent of HTTP: password check, provider flows bound to their client, opening the session |
| `apps/api/src/modules/accounts/sign-in-contract.ts` | The five operations and their schemas |
| `apps/api/src/modules/accounts/errors.ts` | Refusals shared with registration |
| `apps/api/src/modules/accounts/index.ts` | HTTP adapter: cookie or body delivery of the token and the binding, current session, sign-out |
| `apps/api/src/modules/accounts/sign-in.test.ts`, `apps/api/src/sessions/token.test.ts` | Behavior tests with the fake providers of `apps/api/test/fixtures/fake-providers.ts` |
| `apps/api/bench/sign-in.ts` | `bun run --cwd apps/api bench:sign-in` |

## Limits

| Resource | Bound |
| --- | --- |
| Session lifetime | 30 days, not extended by use |
| Sessions per profile | 20; signing in once more revokes the oldest |
| Unexpired sessions | 10,000; signing in once more drops the oldest of the installation |
| Password checks | Share registration's limit: 2 at once, 16 waiting, 64 MiB each |
| Code exchanges | Share registration's limit: 4 at once, 16 waiting |
| Pending sign-in flows, lifetime | 500, 10 minutes |
| Request body | 8 KiB |
| Expired sessions deleted per sign-in | 100 |

Failed password attempts are slowed only by the cost of Argon2id and the shared limit (about 23 checks per second on the reference Mac); there is no lockout. These bounds are a starting point; tune them after measurement.

## Performance

Measured with `bun run --cwd apps/api bench:sign-in` against the real HTTP adapter and database with real Argon2id verification (64 MiB, 3 passes, 1 lane), the providers replaced by a local fake that answers at once: 20 profiles, 10 warm-up and 100 timed sequential sign-ins, 30 refused sign-ins of each kind, 20 rounds of 10 concurrent sign-ins while `GET /api/health` and `GET /api/accounts/sessions/current` are read in a loop, 60 sign-outs, and 60 provider sign-ins. Apple M4 Pro, 48 GB, macOS (arm64), Node.js 26.7.0.

| Measure | Samples | p50 | p95 | Max |
| --- | --- | --- | --- | --- |
| Sign in with a password, sequential, warm | 100 | 85.7 ms | 88.0 ms | 89.4 ms |
| Refused sign-in, wrong password | 30 | 84.2 ms | 86.0 ms | 86.1 ms |
| Refused sign-in, unknown username | 30 | 84.4 ms | 85.3 ms | 85.6 ms |
| Sign in, 10 at once | 200 | 268.2 ms | 445.7 ms | 448.2 ms |
| Status read (`GET /api/health`) during 10 concurrent sign-ins | 32,022 | 0.1 ms | 0.1 ms | 4.5 ms |
| Session read (`GET /api/accounts/sessions/current`) during 10 concurrent sign-ins | 32,022 | 0.2 ms | 0.3 ms | 4.6 ms |
| Sign out | 60 | 0.7 ms | 1.1 ms | 2.1 ms |
| Start a provider sign-in | 60 | 0.5 ms | 1.2 ms | 2.4 ms |
| Complete a provider sign-in | 60 | 1.7 ms | 3.8 ms | 7.2 ms |

The budgets of #76 are sign-in p95 ≤ 1 s without weakening hashing, and lightweight status reads p95 ≤ 100 ms during ten bounded concurrent requests. The benchmark process (server, database, client, and fake together) peaked at 475 MiB RSS. The comparison hash is computed at start, outside the timed samples, so no unknown-username sample is slower than a wrong password. On macOS, SQLite's `fsync` does not force a drive cache flush, so write timings there understate Linux. The real Google and GitHub round trips are not measured.

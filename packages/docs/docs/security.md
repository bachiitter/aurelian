---
title: Security
description: Preserve replay protection and authorization boundaries
---

## Protect OAuth

Supply the client return URI with `createClient({ redirectURI })` or `authorize({ redirectURI })`. `createAuth` accepts only HTTP(S), then binds the exact URI into one-time provider state and the authorization code.

The PKCE token exchange must send that same URI. Aurelian also accepts only an S256 challenge with a 43-character base64url value.

By default, the browser client generates fresh state and a verifier, stores one transaction record under that state, and removes it before exchange. The server replaces client state with provider state, stores only its SHA-256 hash, and restores the client state after the callback.

Never reuse a custom state value. `createClient.authorize` rejects one that already has transaction data in its configured storage.

Do not confuse the client return URI with the upstream provider callback. Register `${issuer}/${providerKey}/callback` with the provider; Aurelian derives it from server configuration rather than client input.

---

## Consume once

`StorageAdapter.consume` must return and delete a value atomically. This operation protects OAuth state, authorization codes, refresh tokens, and one-time proofs from concurrent replay.

Consumption happens before later checks or external calls. One submitted six-digit value consumes its record even when it is wrong, just as a bad verifier burns its authorization code and a rejected refresh burns its refresh token.

Use [Custom storage](/custom-storage) to implement and test this contract. Choose strongly consistent transactional storage, such as a Cloudflare Durable Object or transactional database.

---

## Rotate sessions

Refresh tokens start with `rt_`, are random, and are stored by hash. A successful refresh keeps the session ID and fixed expiry while issuing a new access token and refresh token.

Return `null` from `refresh.resolve` when an account, membership, service, or workspace is no longer authorized. Keep access TTLs short because revocation removes only the active refresh token; an issued access token remains valid until `exp`.

---

## Recheck authority

Treat signed profiles as snapshots. Reload mutable roles during refresh, then check current application data again for destructive or financial operations when immediate revocation matters.

For workspace profiles, derive the scope from the verified profile and verify membership during every refresh. For account linking, enforce a unique `(provider, providerAccountId)` mapping in the same transaction that creates the link.

---

## Require fresh proof

Bind step-up, linking, TOTP, and passkey ceremonies to short-lived opaque transactions. Consume each transaction atomically and bind it to the intended user and ceremony.

Store the last accepted TOTP counter and update it only when the next counter is greater. Hash recovery codes, consume them once, and replace the full set after recovery.

Require discoverable credentials and user verification for passkey registration, then bind registration state to the authenticated session. Keep authentication state usable before login while still expiring and consuming it once.

Validate the expected challenge, origin, RP ID, and user verification. Store credential IDs uniquely, update non-zero counters with a conditional write, and recognize that always-zero authenticators cannot offer counter-based clone detection.

---

## Limit special access

Record both actor and target for impersonation, write the audit event before issuance, revoke the generated refresh token immediately, and block risky actions by profile type. This makes the access token traceable and non-renewable, but it remains valid until its access TTL ends.

Hash service credentials, scope permissions narrowly, set an audience, and check revocation in `refresh.resolve`. Rotate application credentials independently from Aurelian refresh tokens.

---

## Keep secrets private

Keep signing private keys, OAuth client secrets, TOTP secrets, refresh tokens, and service credentials out of logs and source control. Encrypt reversible factor secrets at rest and use protected native storage or an HTTP-only server session for refresh tokens.

Read [Sessions](/sessions), [Account linking](/account-linking), [TOTP](/totp), [Passkeys](/passkeys), and [Service access](/service-access) for implementation details.

---
title: HTTP routes
description: Call authentication flows without the optional browser client
---

## Choose an approach

Call the issuer directly when `createClient` does not fit your runtime. `createClient` remains optional convenience for PKCE storage, token requests, and JWKS verification.

Every path below sits beneath the configured issuer. For `https://auth.example.com/auth`, `/google/authorize` means `https://auth.example.com/auth/google/authorize`.

---

## Compare providers

Routes are created from each `providers` map key and always place that key before the operation. These examples assume the issuer is `https://auth.example.com/auth`.

| Provider | Map key | HTTP routes | Purpose |
| --- | --- | --- | --- |
| Google | `google` | `GET /google/authorize`<br />`GET /google/callback` | Start Google authorization and receive its upstream callback |
| GitHub | `github` | `GET /github/authorize`<br />`GET /github/callback` | Start GitHub authorization and receive its upstream callback |
| Discord | `discord` | `GET /discord/authorize`<br />`GET /discord/callback` | Start Discord authorization and receive its upstream callback |
| Twitch | `twitch` | `GET /twitch/authorize`<br />`GET /twitch/callback` | Start Twitch authorization and receive its upstream callback |
| Generic OAuth | `spotify` | `GET /spotify/authorize`<br />`GET /spotify/callback` | Start the configured OAuth flow and receive its upstream callback |
| Generic OIDC | `work` | `GET /work/authorize`<br />`GET /work/callback` | Start the discovered OIDC flow and receive its upstream callback |
| Credentials | `credentials` | `POST /credentials/authenticate` | Validate the configured schema and issue tokens |
| Code | `code` | `POST /code/request`<br />`POST /code/authenticate` | Deliver a code, then verify it and issue tokens |
| Passkey | `passkey` | `POST /passkey/registration/start`<br />`POST /passkey/registration/verify`<br />`GET /passkey/authentication/start`<br />`POST /passkey/authentication/verify` | Register a credential or authenticate with one |

Provider keys allow letters, numbers, `.`, `_`, `~`, and `-`. Nested endpoint keys may also contain `/`, which creates paths such as `/passkey/registration/start`.

---

## Choose keys

Factory names do not reserve route names. The key in `providers: { work: oidc(options) }` creates `GET /work/authorize` and `GET /work/callback`, not routes beneath `/oidc`.

Use that same key in manual URLs or `createClient` calls. Renaming the key changes the route and the upstream callback registration.

---

## Call shared routes

These routes sit directly beneath the issuer and do not belong to any provider.

| Method | Path | Input | Purpose | Success response |
| --- | --- | --- | --- | --- |
| `POST` | `/token` | JSON `{ code, codeVerifier, redirectURI }` | Exchange an Aurelian authorization code | `200 TokenResponse` |
| `POST` | `/token/refresh` | JSON `{ refreshToken }` | Rotate the token pair | `200 TokenResponse` |
| `POST` | `/token/revoke` | JSON `{ refreshToken }` | Consume the refresh token when present | `200 { revoked: true }` |
| `GET` | `/.well-known/jwks.json` | None | Publish access-token verification keys | `200 { keys: JWK[] }` |

```ts
type TokenResponse = {
  accessToken: string
  expiresIn: number
  refreshToken: string
  tokenType: 'Bearer'
}
```

Use HTTPS for deployed issuer, callback, and client return URLs. Loopback HTTP, such as `http://localhost:3000/auth/callback`, is suitable for local development.

---

## Start authorization

Generate state and PKCE values with browser APIs, save the verifier with the return URI, then navigate to the provider-first authorization URL. This example sends every required query field and an optional scope.

```ts
const issuer = 'https://auth.example.com/auth'
const providerKey = 'google'
const redirectURI = 'https://app.example.com/auth/callback'

function encodeBase64URL(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes)

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function createRandomValue(byteLength: number): string {
  return encodeBase64URL(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function startAuthorization(): Promise<void> {
  const state = createRandomValue(32)
  const codeVerifier = createRandomValue(64)
  const verifierBytes = new TextEncoder().encode(codeVerifier)
  const digest = await crypto.subtle.digest('SHA-256', verifierBytes)
  const codeChallenge = encodeBase64URL(new Uint8Array(digest))
  const transactionKey = `aurelian:manual:${state}`
  const authorizationURL = new URL(`${issuer}/${providerKey}/authorize`)

  sessionStorage.setItem(
    transactionKey,
    JSON.stringify({ codeVerifier, redirectURI })
  )

  authorizationURL.searchParams.set('redirect_uri', redirectURI)
  authorizationURL.searchParams.set('state', state)
  authorizationURL.searchParams.set('code_challenge', codeChallenge)
  authorizationURL.searchParams.set('code_challenge_method', 'S256')
  authorizationURL.searchParams.set(
    'scope',
    'https://www.googleapis.com/auth/calendar.readonly'
  )

  window.location.assign(authorizationURL)
}

void startAuthorization()
```

`redirect_uri` must be an HTTP(S) client-owned return URI, while `state` must contain 1–512 characters. The S256 challenge must be a 43-character base64url value, and `scope` is an optional space-delimited string up to 2,048 characters.

`createAuth` binds the exact return URI and challenge to one-time provider state. It later binds the same URI to the Aurelian authorization code.

Invalid query fields return `400`, while an unknown or non-OAuth provider returns `404 provider_not_found`.

---

## Finish authorization

Place this module on the `redirectURI` page. It validates returned state, removes the transaction, and sends the exact stored URI and verifier to `/token`.

```ts
type OAuthTransaction = {
  codeVerifier: string
  redirectURI: string
}

type TokenResponse = {
  accessToken: string
  expiresIn: number
  refreshToken: string
  tokenType: 'Bearer'
}

function isOAuthTransaction(value: unknown): value is OAuthTransaction {
  return (
    typeof value === 'object' &&
    value !== null &&
    'codeVerifier' in value &&
    typeof value.codeVerifier === 'string' &&
    'redirectURI' in value &&
    typeof value.redirectURI === 'string'
  )
}

function isTokenResponse(value: unknown): value is TokenResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    typeof value.accessToken === 'string' &&
    'expiresIn' in value &&
    typeof value.expiresIn === 'number' &&
    'refreshToken' in value &&
    typeof value.refreshToken === 'string' &&
    'tokenType' in value &&
    value.tokenType === 'Bearer'
  )
}

async function finishAuthorization(): Promise<TokenResponse> {
  const issuer = 'https://auth.example.com/auth'
  const callbackURL = new URL(window.location.href)
  const code = callbackURL.searchParams.get('code')
  const state = callbackURL.searchParams.get('state')

  if (!code || !state) {
    throw new Error('oauth_callback_invalid')
  }

  const transactionKey = `aurelian:manual:${state}`
  const storedTransaction = sessionStorage.getItem(transactionKey)

  sessionStorage.removeItem(transactionKey)

  if (!storedTransaction) {
    throw new Error('oauth_state_invalid')
  }

  const transaction: unknown = JSON.parse(storedTransaction)

  if (!isOAuthTransaction(transaction)) {
    throw new Error('oauth_state_invalid')
  }

  const response = await fetch(`${issuer}/token`, {
    body: JSON.stringify({
      code,
      codeVerifier: transaction.codeVerifier,
      redirectURI: transaction.redirectURI
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  const value: unknown = await response.json()

  if (!response.ok || !isTokenResponse(value)) {
    throw new Error('token_exchange_failed')
  }

  return value
}

export const tokens = await finishAuthorization()
```

`GET /:provider/callback` belongs to the upstream provider and must be registered as `${issuer}/${providerKey}/callback`, such as `https://auth.example.com/auth/google/callback`. Do not call it from your application.

Its upstream `code` may contain up to 4,096 characters, and its provider `state` must contain 1–512 characters. Missing or invalid values return `400 callback_invalid`.

After the upstream callback, Aurelian redirects to the client-owned `redirectURI` with its own `code` and the original client `state`. `/token` consumes that code and returns `400` if it is expired, replayed, paired with another URI, or checked with the wrong verifier.

The token request requires string `code`, `codeVerifier`, and `redirectURI` fields. Send the exact return URI stored when authorization began.

---

## Send a proof

Post a request provider's exact body to its provider-first authentication path. Credentials are provider-defined; this example receives `200 TokenResponse` or `401 authentication_failed`.

```ts
import type { TokenResponse } from 'aurelian'

const response = await fetch(
  'https://auth.example.com/auth/credentials/authenticate',
  {
    body: JSON.stringify({
      email: 'demo@example.com',
      password: 'correct-horse-battery-staple'
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }
)

if (!response.ok) {
  throw new Error('authentication_failed')
}

export const tokens: TokenResponse = await response.json()
```

Only request providers can use `/:provider/authenticate`. An unknown provider or an OAuth provider at this path returns `404 provider_not_found`.

---

## Verify a code

Request delivery from the code provider's named endpoint, then authenticate with the same identifier and the six-digit value. The request endpoint returns `204` by default, though a custom `send` callback may return another response.

```ts
import type { TokenResponse } from 'aurelian'

const issuer = 'https://auth.example.com/auth'
const identifier = 'demo@example.com'
const requestResponse = await fetch(`${issuer}/code/request`, {
  body: JSON.stringify({ identifier }),
  headers: { 'content-type': 'application/json' },
  method: 'POST'
})

if (!requestResponse.ok) {
  throw new Error('code_request_failed')
}

const verifyResponse = await fetch(`${issuer}/code/authenticate`, {
  body: JSON.stringify({ code: '042731', identifier }),
  headers: { 'content-type': 'application/json' },
  method: 'POST'
})

if (!verifyResponse.ok) {
  throw new Error('code_verification_failed')
}

export const tokens: TokenResponse = await verifyResponse.json()
```

`identifier` must contain 1–512 characters, and `code` must contain exactly six digits. A rejected or replayed proof returns `401 authentication_failed`.

---

## Run passkeys

Use these provider-owned nested paths with `@simplewebauthn/browser`. The [Passkeys guide](/passkeys) shows the complete browser ceremonies without `createClient`.

| Method | Path | Exact request | Success | Failure purpose |
| --- | --- | --- | --- | --- |
| `POST` | `/passkey/registration/start` | Authenticated request; no required JSON | `200 { options: PublicKeyCredentialCreationOptionsJSON, state: string }` | `401` when no registration user is available |
| `POST` | `/passkey/registration/verify` | JSON `{ response: RegistrationResponseJSON, state: string }` | `200 { verified: true }` | `400` for invalid, expired, or failed registration |
| `GET` | `/passkey/authentication/start` | None | `200 { options: PublicKeyCredentialRequestOptionsJSON, state: string }` | `500` for provider state creation failure |
| `POST` | `/passkey/authentication/verify` | JSON `{ response: AuthenticationResponseJSON, state: string }` | `200 TokenResponse` | `401 authentication_failed` for rejected assertions |

Pass the returned `options` to `startRegistration` or `startAuthentication`, then send its `response` with the unchanged `state`. Registration creates a credential but no token pair; authentication verification creates the token pair.

---

## Rotate tokens

Refresh consumes the active refresh token and returns a complete replacement pair. Revoke consumes a well-formed active refresh token and still returns `{ revoked: true }` when it is absent or already consumed.

```ts
import type { TokenResponse } from 'aurelian'

const issuer = 'https://auth.example.com/auth'

export async function refreshTokens(
  refreshToken: string
): Promise<TokenResponse> {
  const response = await fetch(`${issuer}/token/refresh`, {
    body: JSON.stringify({ refreshToken }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })

  if (!response.ok) {
    throw new Error('refresh_failed')
  }

  return response.json()
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const response = await fetch(`${issuer}/token/revoke`, {
    body: JSON.stringify({ refreshToken }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })

  if (!response.ok) {
    throw new Error('revoke_failed')
  }

  const result: { revoked: true } = await response.json()

  if (!result.revoked) {
    throw new Error('revoke_response_invalid')
  }
}
```

Missing or non-string fields return `400`; an invalid refresh token returns `401`. Replace both stored tokens together after refresh because the previous refresh token cannot be reused.

---

## Fetch keys

Download the JWKS to verify access-token signatures, issuer, audience, time claims, and application claims. The route is public and returns the configured signing key as `{ keys: JWK[] }`.

```ts
type JWKS = {
  keys: JsonWebKey[]
}

export async function fetchJWKS(): Promise<JWKS> {
  const response = await fetch(
    'https://auth.example.com/auth/.well-known/jwks.json'
  )

  if (!response.ok) {
    throw new Error('jwks_request_failed')
  }

  return response.json()
}
```

Use a JOSE implementation for production verification rather than comparing decoded JWT fields. Cache keys according to your verifier's policy and refresh them when an unfamiliar key ID appears.

---

## Handle errors

Handled failures return JSON with the response status repeated in `error.status`. The response also includes `x-request-id` for correlation.

```ts
type ErrorResponse = {
  error: {
    code: string
    message: string
    status: number
  }
  meta: {
    requestId: string
  }
}
```

Wrong methods return `405 method_not_allowed`, unknown named endpoints return `404 provider_endpoint_not_found`, and unknown paths return `404 route_not_found`. Read [Errors](/errors) for the complete code list.

---
title: Client
description: Start flows and manage token pairs safely
---

## Configure access

Import `createClient` from `aurelian/client`. The issuer must match the server, and the audience must match `access.audience` when one is configured.

```ts
import { createClient } from 'aurelian/client'

type UserProfile = {
  properties: {
    email: string
    id: string
  }
  type: 'user'
}

export const authClient = createClient<UserProfile>({
  audience: 'https://api.example.com',
  issuer: 'https://auth.example.com/auth',
  redirectURI: 'https://app.example.com/auth/callback'
})
```

`createClient` is optional convenience over Aurelian's HTTP routes. Use the [HTTP routes](/routes) guide to run the same flows with `fetch`, browser navigation, and Web Crypto.

`createClient({ redirectURI })` sets the default client return URI sent in each authorization request. Pass `authorize({ redirectURI })` to override it for one request.

Provide one of these values before starting authorization. Otherwise, `authorize` throws `oauth_redirect_uri_required`.

This URI is the frontend page that receives Aurelian's authorization code. It is not the upstream provider callback `${issuer}/${providerKey}/callback` registered with Google, GitHub, or another provider.

Supply `fetch` when requests need credentials, tracing, or a test transport.

---

## Send request credentials

Call `authenticate` with a request-provider name and its JSON-serializable body.

```ts
const tokens = await authClient.authenticate('credentials', {
  email: 'user@example.com',
  password: 'correct-horse-battery-staple'
})
```

The generic body is not validated by the client. The provider must parse it and return `null` for an expected rejection.

---

## Call named endpoints

Use `fetch` for provider-owned operations. The route shape is `/:provider/:endpoint` beneath the issuer path and supports nested endpoint keys.

```ts
const codeResponse = await fetch(
  'https://auth.example.com/auth/code/request',
  {
    body: JSON.stringify({ identifier: 'user@example.com' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }
)

const passkeyResponse = await fetch(
  'https://auth.example.com/auth/passkey/authentication/start'
)
```

Each endpoint declares `GET` or `POST`, and the server rejects the other method. Providers may expose any number of named endpoints.

Use `authenticate('code', { identifier, code })` after requesting delivery. Passkey instead submits `{ response, state }` to `POST /passkey/authentication/verify`, which issues tokens through that provider endpoint.

---

## Start OAuth

Create an authorization transaction, then navigate to its URL.

```ts
const authorization = await authClient.authorize({
  provider: 'google',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly']
})

window.location.assign(authorization.url)
```

The client generates 32-character state and an S256 PKCE verifier, then stores one JSON transaction record containing the verifier and redirect URI in `sessionStorage`. Google receives its required OIDC scopes plus this request-level scope.

`createAuth` validates the supplied URI as HTTP(S), binds it into one-time provider state and the authorization code, and requires the same URI during PKCE token exchange. `handleCallback()` uses the value saved when this transaction started.

---

## Handle the callback

Use the same client and storage on the configured return page.

```ts
import { authClient } from './auth-client.js'

const tokens = await authClient.handleCallback()
```

The client finds the transaction record by returned state and removes it before checking provider errors or exchanging the code. A failed exchange cannot reuse that browser transaction.

Pass a URL explicitly outside browser globals:

```ts
const tokens = await authClient.handleCallback({
  url: request.url
})
```

That runtime must receive the same `OAuthStorage` used by `authorize`. Server-rendered callbacks usually need an application-owned encrypted cookie or server transaction store instead of browser `sessionStorage`.

---

## Provide transaction storage

Inject a synchronous Web Storage-compatible object with `getItem`, `setItem`, and `removeItem`.

```ts
import type { OAuthStorage } from 'aurelian/client'

const values = new Map<string, string>()

const oauthStorage: OAuthStorage = {
  getItem(key) {
    return values.get(key) ?? null
  },
  removeItem(key) {
    values.delete(key)
  },
  setItem(key, value) {
    values.set(key, value)
  }
}
```

This map is suitable only for a same-process test. Production server storage must bind values to the browser session and prevent tampering.

---

## Rotate token pairs

Refresh with the active refresh token and replace both values as one logical operation.

```ts
const nextTokens = await authClient.refresh({
  refreshToken: tokens.refreshToken
})

await tokenStore.replace(nextTokens)
```

Import an application-owned `tokenStore` whose `replace(tokens: TokenResponse): Promise<void>` operation cannot leave a used refresh token paired with an old access token. A refresh request failure throws `token_request_failed`.

---

## End the session

Revoke the current refresh token, then clear application storage.

```ts
await authClient.revoke({
  refreshToken: nextTokens.refreshToken
})

await tokenStore.clear()
```

Revocation is idempotent for well-formed and malformed refresh strings at the server. It does not recall an access token already issued.

---

## Verify access

The client downloads and caches the issuer JWKS through `jose`, then verifies issuer, audience, signature, time claims, `typ`, `sid`, and profile presence.

```ts
const result = await authClient.verify(tokens.accessToken)

if (!result.valid) {
  return new Response('Unauthorized', { status: 401 })
}

const userId = result.profile.properties.id
```

Invalid tokens return `{ valid: false, reason: 'token_invalid' }`. The generic profile type is trusted after cryptographic verification, so keep client and server profile definitions synchronized.

---

## Store tokens safely

Prefer a backend-for-frontend with refresh tokens in an HTTP-only, `Secure`, appropriate `SameSite` cookie. Native apps should use Keychain, Keystore, or equivalent protected storage.

If browser JavaScript holds tokens, keep them in memory where possible and deploy a strict content security policy. Never put access or refresh tokens in URLs.

---

## Test transactions

Test success, denied provider access, missing state, unknown state, duplicate custom state, missing storage, malformed token responses, exchange failure, rotation, and revoke failure. Assert that the transaction record is removed before every callback outcome.

Continue with [Sessions](/sessions), [Security](/security), and the [client API](/api#create-a-client).

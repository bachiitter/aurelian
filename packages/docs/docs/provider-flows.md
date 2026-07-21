---
title: Providers
description: Verify identities before resolving application profiles
---

## Choose a flow

Use a `RequestProvider` when one request contains the proof. Use an `OAuthProvider` when the browser must visit an external authorization server.

Both return a `ProviderIdentity`; the application-owned resolver turns that identity into a profile. Aurelian ships Google only—passwords, passkeys, GitHub, and other integrations are application patterns.

---

## Know the contracts

Import every provider contract from the package root.

```ts
import type {
  OAuthProvider,
  Provider,
  ProviderIdentity,
  RequestProvider
} from 'aurelian'
```

`Provider` is the `OAuthProvider | RequestProvider` union. `ProviderIdentity` requires `id: string` and optionally carries `avatarUrl`, `email`, `emailVerified`, `name`, `raw`, and `username`.

Treat `raw` as `unknown` and validate it before use. Resolve accounts by `(provider, id)`, not by an unverified email address.

`RequestProvider.authenticate({ request })` may be synchronous or asynchronous and returns an identity or `null`. Aurelian passes the original standard Web `Request`.

`OAuthProvider.authorizationUrl` receives `{ callbackURL, request, scopes, state }` and returns a `URL`. Its `callback` receives `{ callbackURL, code, request, state }` and returns an identity; both methods may return promises.

The provider owns upstream URL construction, credential exchange, response validation, and identity normalization. Aurelian owns route validation, provider state, PKCE, callback derivation, one-time records, profile resolution, and response normalization.

---

## Implement request authentication

Parse the request as untrusted data and return `null` for an expected rejection. This example defines its application-owned verifier explicitly.

```ts
import type { ProviderIdentity, RequestProvider } from 'aurelian'

type Credentials = {
  email: string
  password: string
}

declare function verifyPassword(
  credentials: Credentials
): Promise<ProviderIdentity | null>

async function readCredentials(request: Request): Promise<Credentials | null> {
  const value: unknown = await request.json().catch(() => null)

  if (typeof value !== 'object' || value === null) {
    return null
  }

  if (
    !('email' in value) ||
    typeof value.email !== 'string' ||
    value.email.length > 320 ||
    !('password' in value) ||
    typeof value.password !== 'string' ||
    value.password.length < 1 ||
    value.password.length > 1024
  ) {
    return null
  }

  return { email: value.email, password: value.password }
}

export const passwordProvider: RequestProvider = {
  async authenticate({ request }) {
    if (request.headers.get('content-type') !== 'application/json') {
      return null
    }

    const credentials = await readCredentials(request)

    if (!credentials) {
      return null
    }

    return verifyPassword(credentials)
  },
  type: 'request'
}
```

POST this provider at `${issuer}/authenticate/password` after registering it as `providers.password`. A `null` result becomes `401 authentication_failed`; a thrown error reaches `onError` and becomes `500 internal_server_error`.

---

## Configure Google

Import the shipped factory and its options from the dedicated export. `clientId` and `clientSecret` must be non-empty strings.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { google } from 'aurelian/providers/google'
import type { GoogleOptions } from 'aurelian/providers/google'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

declare const privateKey: string
declare const publicKey: string

const googleOptions: GoogleOptions = {
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly']
}

const profiles = defineProfiles({
  user: z.object({
    email: z.string().email().optional(),
    id: z.string().min(1)
  })
})

const auth = createAuth({
  issuer: 'https://auth.example.com/auth',
  profiles,
  providers: { google: google(googleOptions) },
  redirectURIs: ['https://app.example.com/signed-in'],
  resolve({ profile, response }) {
    if (response.provider !== 'google') {
      throw new Error('provider_unsupported')
    }

    return profile('user', {
      email: response.data.email,
      id: response.data.id
    })
  },
  signing: { algorithm: 'ES256', privateKey, publicKey },
  storage: memoryStorage()
})
```

`auth.handler` is a standard `(Request) => Promise<Response>` function, so mount it with the host runtime of your choice. Use shared atomic storage instead of memory in production.

---

## Separate redirect URLs

Register `https://auth.example.com/auth/callback/google` with Google. This **provider callback URL** is always derived as `${issuer}/callback/${providerKey}` and receives Google's code.

The **client return URL** is `https://app.example.com/signed-in` in this example. Aurelian validates it through `redirectURIs`, then sends its own one-time authorization code there after resolving the identity.

---

## Handle scopes

Google always requests `openid`, `email`, and `profile`. It appends `GoogleOptions.scopes`, then request scopes supplied to `/authorize/google?scope=...`, removing duplicates while preserving first occurrence.

Aurelian rejects a request scope string longer than 2,048 characters. The Google implementation otherwise forwards scope values; application code must restrict sensitive scopes before requests reach the handler.

---

## Read Google responses

The factory exchanges the callback code at Google's token endpoint and calls the OIDC UserInfo endpoint with the access token. It requires `sub`, maps it to `id`, and normalizes `email`, `email_verified`, `name`, and `picture`.

The full UserInfo object remains in `raw`. Aurelian does not store Google tokens or resolve application users—the factory verifies the upstream response shape, while your resolver owns account lookup and policy.

---

## Handle failures

Missing configuration throws `google_client_id_required` or `google_client_secret_required` immediately. Failed or malformed upstream responses throw `google_token_exchange_failed` or `google_identity_failed`.

Provider and resolver exceptions passing through `auth.handler` are reported to `onError` and normalized to `500 internal_server_error`. If the callback lacks a code or valid state, Aurelian returns `400 callback_invalid` rather than redirecting to the client return URL.

---

## Follow the routes

OAuth runs through `GET /authorize/:provider`, `GET /callback/:provider`, then `POST /token`. Aurelian validates the return URL and S256 PKCE challenge, creates upstream state, consumes it at callback, resolves the profile, and issues a one-time code.

Request authentication runs through `POST /authenticate/:provider`, resolves the returned identity, and returns tokens directly. Unknown or mismatched provider types return `404 provider_not_found`.

---

## Test failures

Stub a provider or `fetch`, then send standard `Request` objects through `auth.handler`. Assert exact callback derivation, merged scopes, normalized identity, malformed input, upstream failures, resolver failures, unknown providers, and request-provider rejection.

Run the complete OAuth sequence twice to prove state and authorization-code replay fail when storage is atomic. Continue with [Storage](/storage), [Profiles](/profiles), and [Errors](/errors).

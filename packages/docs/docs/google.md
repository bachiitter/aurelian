---
title: Google
description: Configure sign-in and normalize OpenID user data
---

## Create credentials

Create an OAuth web client in [Google Cloud](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred). Register `https://auth.example.com/auth/google/callback` as an authorized redirect URI and keep the secret on the server.

This upstream provider callback always follows `${issuer}/${providerKey}/callback`. Changing the provider map key changes the provider path segment.

It is not the client return URI. Supply that separate URI from the browser with `createClient({ redirectURI })` or `authorize({ redirectURI })`.

---

## Add the factory

Import the factory and option type from `aurelian/providers/google`. This complete server example reads credentials and signing keys from the environment.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { google } from 'aurelian/providers/google'
import type { GoogleOptions } from 'aurelian/providers/google'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const options: GoogleOptions = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly']
}
const profiles = defineProfiles({
  user: z.object({
    email: z.email().optional(),
    id: z.string().min(1)
  })
})

export const auth = createAuth({
  issuer: 'https://auth.example.com/auth',
  profiles,
  providers: {
    google: google(options)
  },
  resolve({ profile, response }) {
    return profile('user', {
      email: response.data.email,
      id: response.data.id
    })
  },
  signing: {
    algorithm: 'ES256',
    privateKey: process.env.AUTH_PRIVATE_KEY,
    publicKey: process.env.AUTH_PUBLIC_KEY
  },
  storage: memoryStorage()
})
```

`GoogleOptions` requires non-empty `clientId` and `clientSecret`; `fetch` and `scopes` are optional. Missing credentials throw `google_client_id_required` or `google_client_secret_required`.

Provide `fetch` to replace `globalThis.fetch` for both token exchange and UserInfo loading.

---

## HTTP routes

The `google` map key creates these provider-first paths beneath the issuer. `createClient` is optional; build the authorization URL directly when using browser navigation and `fetch`.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `GET` | `/google/authorize` | Start Google authorization | Query: `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `state`, optional space-delimited `scope` | `302` redirect to Google |
| `GET` | `/google/callback` | Receive Google's upstream callback | Upstream query: `code`, `state` | `302` redirect to the client `redirect_uri` with Aurelian `code` and client `state` |

Register the callback as an absolute HTTPS URL, such as `https://auth.example.com/auth/google/callback`. This route is upstream-only—do not call it from the application or use it as the client return URI.

Use HTTPS outside local development. A loopback client return URI such as `http://localhost:3000/auth/callback` may use HTTP during development.

---

## Request scopes

The factory always requests `openid`, `email`, and `profile`. It appends configured `scopes` and request-level scopes, removing duplicates in first-seen order.

Restrict request-level scopes before calling `auth.handler` when clients must not choose arbitrary Google permissions. Review Google's [scope guidance](https://developers.google.com/identity/protocols/oauth2/scopes) before adding access.

---

## Read the identity

The callback exchanges the code and requests Google's OpenID Connect UserInfo endpoint. It requires a non-empty string `sub` and returns these normalized fields:

```ts
type ProviderIdentity = {
  avatarUrl?: string
  email?: string
  emailVerified?: boolean
  id: string
  name?: string
  raw: unknown
}
```

Google `sub`, `picture`, `email`, `email_verified`, and `name` become `id`, `avatarUrl`, `email`, `emailVerified`, and `name`. `raw` retains the complete UserInfo response.

Resolve accounts by the stable `id`, not by email. Aurelian does not persist Google access tokens.

---

## Start authorization

Call the client with the same provider key used in the map.

```ts
import { createClient } from 'aurelian/client'

const authClient = createClient({
  issuer: 'https://auth.example.com/auth',
  redirectURI: 'https://app.example.com/auth/callback'
})
const authorization = await authClient.authorize({
  provider: 'google'
})

globalThis.location.assign(authorization.url)
```

Aurelian sends users through `/google/authorize`, receives Google at `/google/callback`, and returns its own one-time code to the client URI. `createAuth` binds that URI into provider state and the authorization code, so `authClient.handleCallback()` must use it during the PKCE-protected exchange.

---

## Handle failures

Malformed or failed token responses throw `google_token_exchange_failed`. Malformed or failed UserInfo responses throw `google_identity_failed`.

These exceptions reach `onError` and become `500 internal_server_error` through `auth.handler`. Replace `memoryStorage()` with shared atomic storage in production.

---
title: OAuth
description: Connect authorization servers with application-owned identity loading
---

## Choose endpoints

Use `oauth()` when a service implements an authorization code flow but needs provider-specific identity loading. Supply its authorization and token URLs directly.

The helper handles authorization URL construction and code exchange. It does **not** define an identity endpoint, response schema, or account identifier; your `identify` callback owns all three.

---

## Add the factory

This complete example uses Spotify's authorization server and validates its current-user response inline. Register the upstream provider callback `https://auth.example.com/auth/spotify/callback` in the provider console.

That callback follows `${issuer}/${providerKey}/callback` and is not the client return URI. Supply the latter with `createClient({ redirectURI })` or `authorize({ redirectURI })`.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { oauth } from 'aurelian/providers/oauth'
import type { OAuthOptions } from 'aurelian/providers/oauth'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const spotifyOptions: OAuthOptions = {
  authorizationParams: { show_dialog: 'true' },
  authorizationURL: 'https://accounts.spotify.com/authorize',
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  fetch: globalThis.fetch,
  async identify({ accessToken, fetch }) {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { authorization: `Bearer ${accessToken}` }
    })
    const user: unknown = await response.json().catch(() => null)

    if (
      !response.ok ||
      typeof user !== 'object' ||
      user === null ||
      !('id' in user) ||
      typeof user.id !== 'string' ||
      user.id.length === 0
    ) {
      throw new Error('spotify_identity_failed')
    }

    const images = 'images' in user && Array.isArray(user.images)
      ? user.images
      : []
    const firstImage: unknown = images[0]
    const avatarUrl =
      typeof firstImage === 'object' &&
      firstImage !== null &&
      'url' in firstImage &&
      typeof firstImage.url === 'string'
        ? firstImage.url
        : undefined

    return {
      avatarUrl,
      email:
        'email' in user && typeof user.email === 'string'
          ? user.email
          : undefined,
      id: user.id,
      name:
        'display_name' in user && typeof user.display_name === 'string'
          ? user.display_name
          : undefined,
      raw: user
    }
  },
  scopes: ['user-read-email'],
  tokenURL: 'https://accounts.spotify.com/api/token'
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
    spotify: oauth(spotifyOptions)
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

`authorizationURL`, `tokenURL`, `clientId`, `clientSecret`, and `identify` are required. Empty credentials throw `oauth_client_credentials_required`.

---

## HTTP routes

The `spotify` map key creates these provider-first paths beneath the issuer; the `oauth()` factory name does not create an `/oauth` segment. `createClient` is optional, so manual clients can build the authorization URL and exchange the returned Aurelian code with the shared `/token` route.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `GET` | `/spotify/authorize` | Start the configured OAuth flow | Query: `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `state`, optional space-delimited `scope` | `302` redirect to the configured authorization server |
| `GET` | `/spotify/callback` | Receive the authorization server's upstream callback | Upstream query: `code`, `state` | `302` redirect to the client `redirect_uri` with Aurelian `code` and client `state` |

Register an absolute HTTPS callback such as `https://auth.example.com/auth/spotify/callback`. This route is upstream-only—do not call it from the application or use it as the client return URI.

Use HTTPS outside local development. A loopback client return URI such as `http://localhost:3000/auth/callback` may use HTTP during development.

---

## Tune requests

`scopes` defaults to an empty list and is merged with request-level scopes. `authorizationParams` adds provider-specific query parameters before Aurelian sets `client_id`, `redirect_uri`, `response_type`, and `state`.

`tokenEndpointAuthMethod` supports `client_secret_basic` and `client_secret_post`; omission uses `client_secret_basic`. Basic authentication form-encodes the client ID and secret before joining them with `:` and Base64-encoding the result.

Set `tokenEndpointAuthMethod: 'client_secret_post'` explicitly when the provider requires credentials in the form body. The optional `fetch` handles token exchange and is passed to `identify`, while `request` provides the original callback request and `token` provides the unvalidated token response.

---

## Validate identity

Treat every identity response and `token` value as `unknown`. Return a `ProviderIdentity` with a stable string `id`, or throw when the upstream response cannot establish one.

The helper validates only a successful JSON token response with a non-empty string `access_token`. It does not validate a provider-specific user payload or persist tokens.

---

## Follow the flow

Aurelian sends users through `GET /spotify/authorize`, then receives the provider at `GET /spotify/callback`. `createAuth` validates the client return URI as HTTP(S) and binds its exact value into one-time provider state and the authorization code.

The callback sends the one-time code to that client URI. The PKCE token exchange must submit the same URI.

Review [OAuth 2.0 authorization requests](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.1) and [token requests](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.3) before connecting another server.

---
title: Twitch
description: Connect OAuth apps and normalize channel identities
---

## Create credentials

Register an application in the [Twitch developer console](https://dev.twitch.tv/console/apps) and add `https://auth.example.com/auth/twitch/callback` as an OAuth redirect URL. Keep the client secret on the server.

This upstream provider callback always follows `${issuer}/${providerKey}/callback`. Changing the provider map key changes the provider path segment.

It is not the client return URI. Supply that separate URI from the browser with `createClient({ redirectURI })` or `authorize({ redirectURI })`.

---

## Add the factory

Import the factory and option type from `aurelian/providers/twitch`. This example registers it in a complete provider map.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { twitch } from 'aurelian/providers/twitch'
import type { TwitchOptions } from 'aurelian/providers/twitch'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const options: TwitchOptions = {
  clientId: process.env.TWITCH_CLIENT_ID,
  clientSecret: process.env.TWITCH_CLIENT_SECRET
}
const profiles = defineProfiles({
  user: z.object({
    email: z.email().optional(),
    id: z.string().min(1),
    username: z.string().min(1)
  })
})

export const auth = createAuth({
  issuer: 'https://auth.example.com/auth',
  profiles,
  providers: {
    twitch: twitch(options)
  },
  resolve({ profile, response }) {
    if (!response.data.username) {
      throw new Error('twitch_username_required')
    }

    return profile('user', {
      email: response.data.email,
      id: response.data.id,
      username: response.data.username
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

`TwitchOptions` requires `clientId` and `clientSecret`; `fetch` and `scopes` are optional. Supply `fetch` for tracing, tests, or a runtime-specific transport.

The wrapper explicitly uses `client_secret_post`, placing both client credentials in the token request body.

`createAuth` accepts the supplied client return URI only when it uses HTTP(S). It binds the exact value into one-time provider state and the authorization code, then requires it during PKCE token exchange.

---

## HTTP routes

The `twitch` map key creates these provider-first paths beneath the issuer. `createClient` is optional; build the authorization URL directly when using browser navigation and `fetch`.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `GET` | `/twitch/authorize` | Start Twitch authorization | Query: `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `state`, optional space-delimited `scope` | `302` redirect to Twitch |
| `GET` | `/twitch/callback` | Receive Twitch's upstream callback | Upstream query: `code`, `state` | `302` redirect to the client `redirect_uri` with Aurelian `code` and client `state` |

Register the callback as an absolute HTTPS URL, such as `https://auth.example.com/auth/twitch/callback`. This route is upstream-only—do not call it from the application or use it as the client return URI.

Use HTTPS outside local development. A loopback client return URI such as `http://localhost:3000/auth/callback` may use HTTP during development.

---

## Request scopes

The factory requests `user:read:email` by default. It appends configured `scopes` and request-level scopes, removing duplicates in first-seen order.

Review Twitch's [authorization code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow) and [scope reference](https://dev.twitch.tv/docs/authentication/scopes/) before adding permissions.

---

## Read the identity

The callback requests the Helix users endpoint with the access token and client ID. It requires exactly one returned user and normalizes these fields:

```ts
type ProviderIdentity = {
  avatarUrl?: string
  email?: string
  id: string
  name?: string
  raw: unknown
  username: string
}
```

Twitch `id`, `login`, `display_name`, `email`, and `profile_image_url` become `id`, `username`, `name`, `email`, and `avatarUrl`. `raw` contains the single user object, not the surrounding Helix response.

The factory does not set `emailVerified`. Resolve accounts by `id`, even when an email is available.

---

## Handle failures

A failed token exchange throws `oauth_token_exchange_failed`. A failed, malformed, empty, or multi-user Helix response throws `twitch_identity_failed`.

Aurelian does not persist Twitch access tokens. Replace `memoryStorage()` with shared atomic storage in production.

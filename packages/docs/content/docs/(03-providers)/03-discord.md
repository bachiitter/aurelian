---
title: Discord
description: Connect OAuth apps and normalize member identities
---

## Create credentials

Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and add `https://auth.example.com/auth/discord/callback` as an OAuth redirect. Keep the client secret on the server.

This upstream provider callback always follows `${issuer}/${providerKey}/callback`. Changing the provider map key changes the provider path segment.

It is not the client return URI. Supply that separate URI from the browser with `createClient({ redirectURI })` or `authorize({ redirectURI })`.

---

## Add the factory

Import the factory and option type from `aurelian/providers/discord`. This example registers it in a complete provider map.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { discord } from 'aurelian/providers/discord'
import type { DiscordOptions } from 'aurelian/providers/discord'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const options: DiscordOptions = {
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET
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
    discord: discord(options)
  },
  resolve({ profile, response }) {
    if (!response.data.username) {
      throw new Error('discord_username_required')
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

`DiscordOptions` requires `clientId` and `clientSecret`; `fetch` and `scopes` are optional. Supply `fetch` for tracing, tests, or a runtime-specific transport.

`createAuth` accepts the supplied client return URI only when it uses HTTP(S). It binds the exact value into one-time provider state and the authorization code, then requires it during PKCE token exchange.

---

## HTTP routes

The `discord` map key creates these provider-first paths beneath the issuer. `createClient` is optional; build the authorization URL directly when using browser navigation and `fetch`.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `GET` | `/discord/authorize` | Start Discord authorization | Query: `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `state`, optional space-delimited `scope` | `302` redirect to Discord |
| `GET` | `/discord/callback` | Receive Discord's upstream callback | Upstream query: `code`, `state` | `302` redirect to the client `redirect_uri` with Aurelian `code` and client `state` |

Register the callback as an absolute HTTPS URL, such as `https://auth.example.com/auth/discord/callback`. This route is upstream-only—do not call it from the application or use it as the client return URI.

Use HTTPS outside local development. A loopback client return URI such as `http://localhost:3000/auth/callback` may use HTTP during development.

---

## Request scopes

The factory requests `identify` and `email` by default. It appends configured `scopes` and request-level scopes, removing duplicates in first-seen order.

Review Discord's [OAuth2 documentation](https://discord.com/developers/docs/topics/oauth2) before adding permissions.

---

## Read the identity

The callback requests `GET /api/v10/users/@me` and returns these normalized fields:

```ts
type ProviderIdentity = {
  avatarUrl?: string
  email?: string
  emailVerified?: boolean
  id: string
  name?: string
  raw: unknown
  username: string
}
```

Discord `id`, `username`, `global_name`, `email`, and `verified` become `id`, `username`, `name`, `email`, and `emailVerified`. A non-null avatar hash becomes its Discord CDN URL, and `raw` retains the complete user response.

Resolve accounts by `id`. Treat `raw` as untrusted `unknown` if the resolver needs another Discord-specific field.

---

## Handle failures

A failed token exchange throws `oauth_token_exchange_failed`. A failed or malformed user response throws `discord_identity_failed`.

Aurelian does not persist Discord access tokens. Replace `memoryStorage()` with shared atomic storage in production.

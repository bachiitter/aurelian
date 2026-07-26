---
title: GitHub
description: Connect OAuth apps and normalize account identities
---

## Create credentials

Create an [OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) and keep its client secret on the server. Register `https://auth.example.com/auth/github/callback` as its authorization callback URL.

This upstream provider callback always follows `${issuer}/${providerKey}/callback`. Changing the provider map key changes the provider path segment.

It is not the client return URI. Supply that separate URI from the browser with `createClient({ redirectURI })` or `authorize({ redirectURI })`.

---

## Add the factory

Import the factory and option type from `aurelian/providers/github`. This complete server example reads credentials and signing keys from the environment.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { github } from 'aurelian/providers/github'
import type { GitHubOptions } from 'aurelian/providers/github'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const options: GitHubOptions = {
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET
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
    github: github(options)
  },
  resolve({ profile, response }) {
    if (!response.data.username) {
      throw new Error('github_username_required')
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

`GitHubOptions` requires `clientId` and `clientSecret`; `fetch` and `scopes` are optional. Supply `fetch` for tracing, tests, or a runtime-specific transport.

The wrapper explicitly uses `client_secret_post`, placing both client credentials in the token request body.

`createAuth` accepts the supplied client return URI only when it uses HTTP(S). It binds the exact value into one-time provider state and the authorization code, then requires it during PKCE token exchange.

---

## HTTP routes

The `github` map key creates these provider-first paths beneath the issuer. `createClient` is optional; build the authorization URL directly when using browser navigation and `fetch`.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `GET` | `/github/authorize` | Start GitHub authorization | Query: `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `state`, optional space-delimited `scope` | `302` redirect to GitHub |
| `GET` | `/github/callback` | Receive GitHub's upstream callback | Upstream query: `code`, `state` | `302` redirect to the client `redirect_uri` with Aurelian `code` and client `state` |

Register the callback as an absolute HTTPS URL, such as `https://auth.example.com/auth/github/callback`. This route is upstream-only—do not call it from the application or use it as the client return URI.

Use HTTPS outside local development. A loopback client return URI such as `http://localhost:3000/auth/callback` may use HTTP during development.

---

## Request scopes

The factory requests `read:user` and `user:email` by default. It appends configured `scopes` and request-level scopes, removing duplicates in first-seen order.

Review GitHub's [OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [scope reference](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) before adding permissions.

---

## Read the identity

The callback loads `/user`, then attempts `/user/emails` to find a verified primary address. It returns these normalized fields to your profile resolver:

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

GitHub `id` becomes a string `id`; `login`, `name`, and `avatar_url` become `username`, `name`, and `avatarUrl`. `raw` contains the `/user` response, while the primary email response is not retained.

If the email request fails or has no valid primary entry, the public `email` from `/user` may still be returned without `emailVerified`. Resolve accounts by the stable `id`, not by email.

---

## Handle failures

A failed token exchange throws `oauth_token_exchange_failed`. A malformed `/user` response throws `github_identity_failed`; failure to load emails alone does not reject authentication.

Aurelian does not persist GitHub access tokens. Replace `memoryStorage()` with shared atomic storage before running more than one process.

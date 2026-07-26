---
title: Quickstart
description: Configure Google sign-in with standard Web APIs
---

## Install dependencies

Install Aurelian and any Standard Schema validator. This example uses Zod.

```bash
pnpm add aurelian zod
```

Aurelian is ESM and requires `Request`, `Response`, `URL`, `fetch`, Web Crypto, and `TextEncoder`.

---

## Register Google

Create an OAuth web client in Google Cloud. Set its authorized redirect URI to `http://localhost:3000/auth/google/callback`.

This **upstream provider callback** is derived from the issuer and provider key: `${issuer}/${providerKey}/callback`. It is different from the **client return URI** supplied by the browser client.

Set these environment values and keep credentials and private keys out of source control:

```dotenv
AUTH_ISSUER=http://localhost:3000/auth
AUTH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
AUTH_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Loopback HTTP is allowed for local development. Use exact HTTPS URLs in production.

---

## Configure the service

Create one profile and map Google's normalized identity to an application user. Replace the in-memory lookup and storage before production.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { google } from 'aurelian/providers/google'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const profiles = defineProfiles({
  user: z.object({
    email: z.email().optional(),
    id: z.string().min(1)
  })
})

export const auth = createAuth({
  issuer: process.env.AUTH_ISSUER,
  profiles,
  providers: {
    google: google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    })
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

The Google provider always requests `openid`, `email`, and `profile`. It exchanges the authorization code, calls the OIDC UserInfo endpoint, and maps `sub` to `id`.

---

## Forward requests

Forward the issuer path to the standard fetch handler. Keep the public origin and path intact.

```ts
import { auth } from './auth.js'

export async function fetch(request: Request): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
    return auth.handler(request)
  }

  return new Response('Not found', { status: 404 })
}
```

Connect this function to your runtime's standards-based request entry point.

---

## Start sign-in

Create a browser client with the same issuer and client return URL. `authorize` stores PKCE transaction data in `sessionStorage` by default.

```ts
import { createClient } from 'aurelian/client'

const authClient = createClient({
  issuer: 'http://localhost:3000/auth',
  redirectURI: 'http://localhost:5173/auth/callback'
})

const authorization = await authClient.authorize({
  provider: 'google'
})

globalThis.location.assign(authorization.url)
```

`createClient({ redirectURI })` adds the client return URI to the authorization request. You can instead pass `redirectURI` to `authorize()` when each request needs a different return page.

`createAuth` accepts only HTTP(S) return URIs, then binds the supplied value into one-time provider state and the authorization code. The PKCE token exchange must send the same URI.

---

## Finish sign-in

On the client return page, use the same client and transaction storage. Aurelian exchanges its single-use code only after verifying the S256 PKCE verifier.

```ts
const tokens = await authClient.handleCallback()

const result = await authClient.verify(tokens.accessToken)

if (!result.valid) {
  throw new Error('token_invalid')
}

const userId = result.claims.sub
```

Store refresh tokens in protected storage and replace the complete token pair after refresh. Continue with [Setup](/setup), [Providers](/provider-flows), [Client](/client), and [Security](/security).

For direct sign-in, continue with [Code](/code), [Password](/password), or low-level [Credentials](/credentials).

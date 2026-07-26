---
title: Setup
description: Configure a Web-compatible authentication service
---

## Get an overview

Aurelian separates identity proof from your user model. Configure profiles, providers, a resolver, signing keys, and storage once, then pass standard `Request` objects to the returned handler.

Use the [Quickstart](/quickstart) for a complete Google flow. This guide explains each configuration boundary.

---

## Meet prerequisites

Choose a JavaScript runtime with ESM, `Request`, `Response`, `URL`, `fetch`, `TextEncoder`, and Web Crypto. Install OpenSSL or use your secret manager to generate signing keys.

Aurelian accepts any [Standard Schema](https://standardschema.dev/) validator. This workspace uses TypeScript 7, and the examples below use Zod.

---

## Install Aurelian

Install the library and your validator. Aurelian uses Hono internally but does not require you to supply an HTTP framework or database client.

```bash
pnpm add aurelian zod
```

The package is ESM, so configure your application accordingly. Runtime dependencies include Hono, `jose`, `@standard-schema/spec`, and SimpleWebAuthn server support.

Built-in provider users do not need to interact with Hono. Install `hono` directly only when creating a custom provider router.

---

## Generate signing keys

Generate a P-256 key pair for `ES256`. Keep the private key server-side and distribute only the public key.

```bash
install -d -m 700 secrets
openssl genpkey \
  -algorithm EC \
  -pkeyopt ec_paramgen_curve:P-256 \
  -out secrets/auth-private.pem
openssl pkey \
  -in secrets/auth-private.pem \
  -pubout \
  -out secrets/auth-public.pem
chmod 600 secrets/auth-private.pem
```

Use your secret-management process for production keys. Preserve PEM line breaks and match the key type to `signing.algorithm`.

---

## Set the environment

Set the exact public URL where the handler will be mounted. HTTPS is required except for loopback development hosts.

```dotenv
AUTH_ISSUER=http://localhost:3000/auth
AUTH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
AUTH_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

For OAuth, the browser supplies its client return URI with `createClient({ redirectURI })` or `authorize({ redirectURI })`. It is not a `createAuth` option.

Register the separate upstream provider callback `${issuer}/${providerKey}/callback` with Google, GitHub, or another provider. For `providers.google`, that callback would be `http://localhost:3000/auth/google/callback`.

---

## Configure the service

Create `auth.ts` with one profile, direct provider, resolver, storage adapter, and signing configuration. This local example keeps accounts and delivered codes in memory while Aurelian owns hashing and transient flow state.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { password } from 'aurelian/providers/password'
import type { PasswordAccount } from 'aurelian/providers/password'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const accounts = new Map<string, PasswordAccount>()
const developmentOutbox = new Map<string, string>()
const storage = memoryStorage()
const passwordProvider = password({
  handle(event) {
    switch (event.type) {
      case 'account':
        return accounts.get(event.identifier) ?? null
      case 'send-code':
        if (
          event.purpose === 'password-reset' &&
          !accounts.has(event.identifier)
        ) {
          return
        }

        developmentOutbox.set(
          `${event.purpose}:${event.identifier}`,
          event.code
        )
        return
      case 'registration': {
        if (accounts.has(event.identifier)) {
          return null
        }

        const identity = {
          email: event.identifier,
          emailVerified: true,
          id: crypto.randomUUID()
        }

        accounts.set(event.identifier, {
          identity,
          passwordHash: event.passwordHash
        })
        return identity
      }
      case 'password-reset': {
        const account = accounts.get(event.identifier)

        if (!account) {
          return
        }

        accounts.set(event.identifier, {
          ...account,
          passwordHash: event.passwordHash
        })
        return
      }
    }
  },
  normalizeIdentifier(identifier) {
    return identifier.trim().toLowerCase()
  },
  storage,
  validatePassword(value) {
    return value.length >= 12
      ? null
      : 'Use at least 12 characters.'
  }
})

const profiles = defineProfiles({
  user: z.object({
    email: z.email(),
    id: z.string().min(1)
  })
})

export const auth = createAuth({
  issuer: process.env.AUTH_ISSUER,
  profiles,
  providers: { password: passwordProvider },
  resolve({ profile, response }) {
    if (!response.data.email) {
      throw new Error('email_required')
    }

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
  storage
})
```

The provider emits one of four events for application-owned lookup, delivery, registration, or hash replacement. Replace both maps with account storage and an email or messaging service before production.

`memoryStorage()` is suitable only for development and tests. Production storage must be shared by every instance and implement atomic `consume`; see [Storage](/storage) and [Custom storage](/custom-storage).

---

## Integrate the handler

`auth.handler` has a Web-compatible contract: one standard request in and one standard response out. Hono stays internal unless you author a custom provider.

```ts
import { auth } from './auth.js'

type AuthHandler = (request: Request) => Promise<Response>

const handler: AuthHandler = auth.handler
```

Route the issuer path and every child path to that handler. A standards-based fetch entry point can forward the original request directly.

```ts
import { auth } from './auth.js'

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
      return auth.handler(request)
    }

    return new Response('Not found', { status: 404 })
  }
}
```

Keep the public origin and `/auth` path intact when forwarding requests. Aurelian also accepts a stripped issuer path, but preserving the public URL avoids proxy ambiguity.

---

## Verify the service

Call the handler directly to confirm that the public key is available without depending on a runtime adapter.

```ts
import { auth } from './auth.js'

const response = await auth.handler(
  new Request('http://localhost:3000/auth/.well-known/jwks.json')
)

if (!response.ok) {
  throw new Error(`JWKS request failed with ${response.status}`)
}

const jwks: unknown = await response.json()
```

Start registration at `/auth/password/registration/start`, then verify its delivered code at `/auth/password/registration/verify`. Verification returns `accessToken`, `refreshToken`, `expiresIn`, and `tokenType: "Bearer"`.

Read [Password](/password) for every route and production security guidance. Use low-level [Credentials](/credentials) only for arbitrary Standard Schema proofs whose workflow the application fully owns.

---

## Choose next steps

Run the complete [Quickstart](/quickstart), then continue with [Architecture](/architecture), [Providers](/provider-flows), [Profiles](/profiles), [Storage](/storage), and [Security](/security).

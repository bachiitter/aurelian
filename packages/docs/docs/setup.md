---
title: Setup
description: Install and configure a framework-neutral authentication service
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

Install the library and your validator. Aurelian does not require an HTTP framework or database client.

```bash
pnpm add aurelian zod
```

The package is ESM, so configure your application accordingly. Runtime dependencies include `jose`, `@standard-schema/spec`, and SimpleWebAuthn server support.

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
DEMO_PASSWORD=change-this-local-password
```

For OAuth, the browser supplies its client return URI with `createClient({ redirectURI })` or `authorize({ redirectURI })`. It is not a `createAuth` option.

Register the separate upstream provider callback `${issuer}/${providerKey}/callback` with Google, GitHub, or another provider. For `providers.google`, that callback would be `http://localhost:3000/auth/google/callback`.

---

## Configure the service

Create `auth.ts` with one profile, request provider, resolver, storage adapter, and signing configuration. This complete local example keeps its user in memory; replace the lookup and password comparison with application database queries and a password hasher.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { credentials } from 'aurelian/providers/credentials'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

type User = {
  email: string
  emailVerified: boolean
  id: string
}

const demoUser: User = {
  email: 'demo@example.com',
  emailVerified: true,
  id: 'user_demo'
}

async function verifyUserPassword(
  email: string,
  password: string
): Promise<User | null> {
  if (
    email !== demoUser.email ||
    password !== process.env.DEMO_PASSWORD
  ) {
    return null
  }

  return demoUser
}

async function getUserById(id: string): Promise<User | null> {
  return id === demoUser.id ? demoUser : null
}

const credentialsProvider = credentials({
  schema: z.object({
    email: z.email(),
    password: z.string().min(1).max(1024)
  }),
  async verify({ credentials }) {
    const user = await verifyUserPassword(
      credentials.email,
      credentials.password
    )

    if (!user) {
      return null
    }

    return {
      email: user.email,
      emailVerified: user.emailVerified,
      id: user.id
    }
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
  providers: { credentials: credentialsProvider },
  async resolve({ profile, response }) {
    const user = await getUserById(response.data.id)

    if (!user) {
      throw new Error('user_not_found')
    }

    return profile('user', {
      email: user.email,
      id: user.id
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

The credentials provider runs Standard Schema validation before delegating application checks to `verify`. The resolver reloads canonical application data, selects a profile, and lets Aurelian validate that profile before signing.

`memoryStorage()` is suitable only for development and tests. Production storage must be shared by every instance and implement atomic `consume`; see [Storage](/storage) and [Custom storage](/custom-storage).

---

## Integrate the handler

`auth.handler` has a framework-neutral web contract: one standard request in and one standard response out.

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

Call the handler directly to confirm that the public key is available without depending on a framework adapter.

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

Then send a `POST` request to `/auth/credentials/authenticate` with the local credentials. Successful authentication returns `accessToken`, `refreshToken`, `expiresIn`, and `tokenType: "Bearer"`.

Read [Credentials](/credentials) for flexible input shapes and production password guidance.

---

## Choose next steps

Run the complete [Quickstart](/quickstart), then continue with [Architecture](/architecture), [Providers](/provider-flows), [Profiles](/profiles), [Storage](/storage), and [Security](/security).

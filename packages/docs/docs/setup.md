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

Aurelian accepts any [Standard Schema](https://standardschema.dev/) validator. The examples below use Zod.

---

## Install Aurelian

Install the library and your validator. Aurelian does not require an HTTP framework or database client.

```bash
pnpm add aurelian zod
```

The package is ESM, so configure your application accordingly. The runtime dependencies are `jose` and `@standard-schema/spec`.

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
AUTH_REDIRECT_URI=http://localhost:5173/auth/callback
AUTH_PRIVATE_KEY_FILE=./secrets/auth-private.pem
AUTH_PUBLIC_KEY_FILE=./secrets/auth-public.pem
DEMO_PASSWORD=change-this-local-password
```

`AUTH_REDIRECT_URI` is the client return URL, not an OAuth provider callback. A provider callback is derived from the issuer and provider key, such as `http://localhost:3000/auth/callback/google`.

---

## Configure the service

Create `auth.ts` with one profile, request provider, resolver, storage adapter, and signing configuration. This complete local example keeps its user in memory; replace the lookup and password comparison with application database queries and a password hasher.

```ts
import { readFile } from 'node:fs/promises'
import { createAuth, defineProfiles } from 'aurelian'
import type { RequestProvider } from 'aurelian'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

type Credentials = {
  email: string
  password: string
}

type User = {
  email: string
  emailVerified: boolean
  id: string
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }

  return value
}

const demoUser: User = {
  email: 'demo@example.com',
  emailVerified: true,
  id: 'user_demo'
}

async function readJSON(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

async function readCredentials(request: Request): Promise<Credentials | null> {
  const value = await readJSON(request)

  if (typeof value !== 'object' || value === null) {
    return null
  }

  if (
    !('email' in value) ||
    typeof value.email !== 'string' ||
    !('password' in value) ||
    typeof value.password !== 'string' ||
    value.email.length > 320 ||
    value.password.length > 1024
  ) {
    return null
  }

  return { email: value.email, password: value.password }
}

async function verifyUserPassword(
  email: string,
  password: string
): Promise<User | null> {
  const expectedPassword = getRequiredEnvironmentVariable('DEMO_PASSWORD')

  if (email !== demoUser.email || password !== expectedPassword) {
    return null
  }

  return demoUser
}

async function getUserById(id: string): Promise<User | null> {
  return id === demoUser.id ? demoUser : null
}

const passwordProvider: RequestProvider = {
  async authenticate({ request }) {
    const credentials = await readCredentials(request)

    if (!credentials) {
      return null
    }

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
  },
  type: 'request'
}

const profiles = defineProfiles({
  user: z.object({
    email: z.email(),
    id: z.string().min(1)
  })
})

const [privateKey, publicKey] = await Promise.all([
  readFile(getRequiredEnvironmentVariable('AUTH_PRIVATE_KEY_FILE'), 'utf8'),
  readFile(getRequiredEnvironmentVariable('AUTH_PUBLIC_KEY_FILE'), 'utf8')
])

export const auth = createAuth({
  issuer: getRequiredEnvironmentVariable('AUTH_ISSUER'),
  profiles,
  providers: { password: passwordProvider },
  redirectURIs: [getRequiredEnvironmentVariable('AUTH_REDIRECT_URI')],
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
    privateKey,
    publicKey
  },
  storage: memoryStorage()
})
```

The provider validates untrusted proof and returns a normalized identity. The resolver reloads canonical application data, selects a profile, and lets Aurelian validate that profile before signing.

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

Then send a `POST` request to `/auth/authenticate/password` with the local credentials. Successful authentication returns `accessToken`, `refreshToken`, `expiresIn`, and `tokenType: "Bearer"`.

---

## Choose next steps

Run the complete [Quickstart](/quickstart), then continue with [Architecture](/architecture), [Providers](/provider-flows), [Profiles](/profiles), [Storage](/storage), and [Security](/security).

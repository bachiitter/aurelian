---
title: Credentials
description: Validate flexible sign-in data before application verification
---

## Define the input

Import `credentials` and `CredentialsOptions` from `aurelian/providers/credentials`. Supply a Standard Schema validator for the JSON shape your application accepts.

This complete local example uses an email and password, but the schema may describe any shape. Replace the direct password comparison with a database lookup and password hasher in production.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { credentials } from 'aurelian/providers/credentials'
import type { CredentialsOptions } from 'aurelian/providers/credentials'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const demoUser = {
  email: 'demo@example.com',
  id: 'user_demo'
}
const credentialSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(1024)
})
const options: CredentialsOptions<typeof credentialSchema> = {
  verify({ credentials, request }) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return null
    }

    if (
      credentials.email !== demoUser.email ||
      credentials.password !== process.env.DEMO_PASSWORD
    ) {
      return null
    }

    return {
      email: demoUser.email,
      emailVerified: true,
      id: demoUser.id
    }
  },
  schema: credentialSchema
}
const profiles = defineProfiles({
  user: z.object({
    email: z.email(),
    id: z.string().min(1)
  })
})

export const auth = createAuth({
  issuer: process.env.AUTH_ISSUER,
  profiles,
  providers: {
    credentials: credentials(options)
  },
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
  storage: memoryStorage()
})
```

Aurelian parses the request body as unknown input and runs Standard Schema validation before `verify`. The callback receives the schema's validated output as `credentials` plus the original `request`.

---

## HTTP routes

The `credentials` map key creates this provider-first path beneath the issuer. Rename the key to rename the path.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `POST` | `/credentials/authenticate` | Validate the proof, resolve the identity, and issue tokens | JSON matching the configured schema, such as `{ email, password }` | `200 TokenResponse` |

`createClient` is optional. Manual clients can post the same JSON with `fetch` to `https://auth.example.com/auth/credentials/authenticate`.

---

## Submit the proof

Send the schema's JSON shape through `createClient()` or post it directly.

```ts
import { createClient } from 'aurelian/client'

const authClient = createClient({
  issuer: 'https://auth.example.com/auth'
})
const tokens = await authClient.authenticate('credentials', {
  email: 'demo@example.com',
  password: 'correct-horse-battery-staple'
})
```

This posts to `POST /credentials/authenticate`. Schema validation issues or a `null` result from `verify` become `401 authentication_failed`.

A returned identity passes through the profile resolver before tokens are issued. The factory returns a `RequestProvider` and exposes no named endpoints.

---

## Protect secrets

Use Argon2id, bcrypt, or another password hasher when the schema includes a password. Keep account lookup, lockout policy, hash migration, and audit logging in `verify`.

Return the same failure for unknown accounts and invalid proofs. Add request and account-level rate limits outside the provider.

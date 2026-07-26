---
title: Code
description: Deliver short-lived proofs through any stable identifier
---

## Configure delivery

Import `code`, `CodeOptions`, and `CodeProvider` from `aurelian/providers/code`. The provider accepts any stable string identifier, including an email address, phone number, or application username.

This complete example delivers the six-digit value by email. Replace the in-memory adapter with shared atomic storage in production.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { code } from 'aurelian/providers/code'
import type { CodeOptions, CodeProvider } from 'aurelian/providers/code'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const demoUser = {
  email: 'demo@example.com',
  id: 'user_demo'
}
const storage = memoryStorage()
const options: CodeOptions = {
  identify({ identifier }) {
    if (identifier !== demoUser.email) {
      return null
    }

    return {
      email: demoUser.email,
      emailVerified: true,
      id: demoUser.id
    }
  },
  async send({ code: verificationCode, identifier }) {
    const response = await fetch('https://api.resend.com/emails', {
      body: JSON.stringify({
        from: 'Aurelian <auth@example.com>',
        html: `<p>Your sign-in code is <strong>${verificationCode}</strong>.</p>`,
        subject: 'Your sign-in code',
        to: [identifier]
      }),
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json'
      },
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error('email_delivery_failed')
    }
  },
  storage,
  ttl: 5 * 60
}
const codeProvider: CodeProvider = code(options)
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
    code: codeProvider
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
  storage
})
```

`identify` and `send` also receive the original `request`. Return a `Response` from `send` to control the delivery route response, or return `void` for an empty `204` response.

---

## HTTP routes

The `code` map key creates both provider-first paths beneath the issuer. Rename the key to rename both paths.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `POST` | `/code/request` | Generate, store, and deliver a six-digit code | JSON `{ identifier }` | Empty `204` by default, or the `Response` returned by `send` |
| `POST` | `/code/authenticate` | Consume the code, resolve the identity, and issue tokens | JSON `{ identifier, code }` | `200 TokenResponse` |

`createClient` is optional. Manual clients can call both routes with `fetch`, including `https://auth.example.com/auth/code/request` and `https://auth.example.com/auth/code/authenticate`.

---

## Request delivery

Post `{ identifier }` to the provider-owned route. Use the same normalized string when you later authenticate.

```ts
const response = await fetch(
  'https://auth.example.com/auth/code/request',
  {
    body: JSON.stringify({ identifier: 'demo@example.com' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }
)

if (!response.ok) {
  throw new Error('code_request_failed')
}
```

The route is `POST /code/request` beneath the issuer path. An identifier must contain 1–512 characters.

The provider generates a zero-padded six-digit value and calls `send`. `ttl` defaults to 300 seconds and must be a positive safe integer.

---

## Submit the proof

Authenticate with the exact identifier and delivered value.

```ts
import { createClient } from 'aurelian/client'

const authClient = createClient({
  issuer: 'https://auth.example.com/auth'
})
const tokens = await authClient.authenticate('code', {
  code: '042731',
  identifier: 'demo@example.com'
})
```

This sends `{ identifier, code }` to `POST /code/authenticate`. A match calls `identify`, resolves its identity into a profile, and returns a `TokenResponse`.

Invalid input, an incorrect value, or a `null` identity returns `401 authentication_failed`.

---

## Consume one attempt

Storage keys use `aurelian:provider:<provider-key>:code:<identifier-hash>`, so the raw identifier is not part of the key. The stored six-digit value is also hashed.

Authentication consumes that stored hash before comparing the submitted value. One attempt consumes the record, so a wrong attempt invalidates it when storage consumption is atomic.

Normalize identifiers consistently before both requests. Rate-limit requests and avoid responses that reveal whether an account exists.

---
title: Passkey provider
description: Run WebAuthn with developer-owned state and persistence
---

## Configure callbacks

Provide state, user, credential, and counter callbacks. This Map-backed example is complete but suitable only for one-process development.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import type { ProviderIdentity } from 'aurelian'
import { passkey } from 'aurelian/providers/passkey'
import type {
  PasskeyCredential,
  PasskeyOptions,
  PasskeyState
} from 'aurelian/providers/passkey'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

type StoredState = {
  authorization: string | null
  expiresAt: number
  value: PasskeyState
}

type RegistrationUser = {
  identity: ProviderIdentity
  name: string
}

const credentials = new Map<string, PasskeyCredential>()
const registrationUsers = new Map<string, RegistrationUser>([
  [
    'Bearer development-session',
    {
      identity: {
        email: 'demo@example.com',
        emailVerified: true,
        id: 'user_demo'
      },
      name: 'demo@example.com'
    }
  ]
])
const states = new Map<string, StoredState>()

const options: PasskeyOptions = {
  consumeState({ request, state }) {
    const stored = states.get(state)

    states.delete(state)

    if (
      !stored ||
      stored.expiresAt <= Date.now()
    ) {
      return null
    }

    if (
      stored.value.type === 'registration' &&
      stored.authorization !== request.headers.get('authorization')
    ) {
      return null
    }

    return stored.value
  },
  createState({ request, value }) {
    const state = crypto.randomUUID()

    states.set(state, {
      authorization:
        value.type === 'registration'
          ? request.headers.get('authorization')
          : null,
      expiresAt: Date.now() + 5 * 60 * 1000,
      value
    })
    return state
  },
  getCredential(id) {
    return credentials.get(id) ?? null
  },
  getRegistrationUser(request) {
    const authorization = request.headers.get('authorization')

    return authorization
      ? registrationUsers.get(authorization) ?? null
      : null
  },
  origin: 'https://app.example.com',
  rpID: 'app.example.com',
  rpName: 'Example',
  saveCredential({ credential, identity }) {
    credentials.set(credential.id, { ...credential, identity })
  },
  updateCounter({ credentialId, currentCounter, newCounter }) {
    const credential = credentials.get(credentialId)

    if (
      !credential ||
      credential.counter !== currentCounter ||
      newCounter < currentCounter
    ) {
      return false
    }

    credentials.set(credentialId, {
      ...credential,
      counter: newCounter
    })
    return true
  }
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
    passkey: passkey(options)
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

All callbacks shown above are required. `getRegistrationUser` must return the authenticated account or `null`; `saveCredential` receives the verified credential and that account's identity.

Registration options require a discoverable credential and user verification, and registration verification requires the user-verification result. Developer code owns state expiry, one-time consumption, session binding, credential uniqueness, and persistence.

Use shared storage and atomic writes in production.

---

## Know the state

`createState({ request, value })` stores either branch of the exact provider union and returns an opaque string. `consumeState({ request, state })` deletes that value and returns it once.

```ts
type PasskeyState =
  | {
      challenge: string
      identity: ProviderIdentity
      type: 'registration'
    }
  | {
      challenge: string
      type: 'authentication'
    }
```

Keep returned state strings between 1 and 512 characters and expire them promptly. Bind registration state to the authenticated session that started registration, then reject verification from a different session.

Authentication state must remain usable without an existing session because authentication starts before login. The [Cloudflare issuer example](https://github.com/bachiitter/aurelian/blob/main/examples/issuer/cloudflare/src/auth.ts) binds only registration state to its authorization header and leaves authentication state unbound to login.

---

## HTTP routes

The `passkey` map key creates four provider-first paths beneath the issuer. Rename the key to rename every path; `createClient` is optional because manual clients can call these routes with `fetch` and SimpleWebAuthn.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `POST` | `/passkey/registration/start` | Create registration options for the authenticated account | No JSON body; authenticated request context for `getRegistrationUser` | `200 { options: PublicKeyCredentialCreationOptionsJSON, state: string }` |
| `POST` | `/passkey/registration/verify` | Verify and save the new credential | JSON `{ response: RegistrationResponseJSON, state: string }` | `200 { verified: true }` |
| `GET` | `/passkey/authentication/start` | Create discoverable authentication options | None | `200 { options: PublicKeyCredentialRequestOptionsJSON, state: string }` |
| `POST` | `/passkey/authentication/verify` | Verify the assertion and issue tokens | JSON `{ response: AuthenticationResponseJSON, state: string }` | `200 TokenResponse` |

For example, registration starts at `https://auth.example.com/auth/passkey/registration/start`. Use HTTPS outside local development; loopback HTTP is allowed during local development.

Registration start calls `getRegistrationUser(request)` before creating options. Registration verify consumes state, verifies the response, then calls `saveCredential`.

Authentication verify is an authenticating provider endpoint. It resolves the stored credential identity through your profile resolver and returns Aurelian's token response.

---

## Update counters

`getCredential(id)` returns a SimpleWebAuthn credential plus its `ProviderIdentity`. Convert persisted public-key bytes to `Uint8Array` before returning it.

The provider requests user verification for authentication and verifies the challenge, origin, RP ID, signature, and user-verification flag. It calls `updateCounter({ credentialId, currentCounter, newCounter })` when either counter is non-zero.

Compare and update the same credential atomically. Always-zero authenticators skip this callback and cannot provide counter-based clone detection.

---

## Continue the flow

Use the [Passkeys guide](/passkeys) for browser registration and authentication calls. Review [Security](/security) before choosing state lifetime, session binding, recovery, and credential deletion policies.

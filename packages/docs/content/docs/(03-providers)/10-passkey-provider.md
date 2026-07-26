---
title: Passkey provider
description: Run WebAuthn with managed challenges and custom persistence
---

## Configure the handler

Provide one discriminated `handle(event)` callback plus relying-party values and a `StorageAdapter`. This Map-backed example is complete but suitable only for one-process development.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { passkey } from 'aurelian/providers/passkey'
import type {
  PasskeyCredential,
  PasskeyOptions,
  PasskeyRegistrationUser
} from 'aurelian/providers/passkey'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const credentials = new Map<string, PasskeyCredential>()
const registrationUsers = new Map<string, PasskeyRegistrationUser>([
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
const storage = memoryStorage()

const options: PasskeyOptions = {
  handle(event) {
    switch (event.type) {
      case 'registration-user': {
        const authorization = event.request.headers.get('authorization')

        return authorization
          ? registrationUsers.get(authorization) ?? null
          : null
      }
      case 'credential':
        return credentials.get(event.id) ?? null
      case 'credential-created':
        if (credentials.has(event.credential.id)) {
          throw new Error('credential_exists')
        }

        credentials.set(event.credential.id, {
          ...event.credential,
          identity: event.identity
        })
        return
      case 'counter-update': {
        const credential = credentials.get(event.credentialId)

        if (
          !credential ||
          credential.counter !== event.currentCounter ||
          event.newCounter <= event.currentCounter
        ) {
          return false
        }

        credentials.set(event.credentialId, {
          ...credential,
          counter: event.newCounter
        })
        return true
      }
    }
  },
  origin: 'https://app.example.com',
  rpID: 'app.example.com',
  rpName: 'Example',
  storage
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
  storage
})
```

Replace both maps with shared application storage and authenticated session lookup. Keep credential IDs unique and convert persisted public-key bytes back to `Uint8Array` before returning a credential.

---

## Handle each event

| Event | Application action | Result |
| --- | --- | --- |
| `registration-user` | Resolve the authenticated account from `request` | `PasskeyRegistrationUser` or `null` |
| `credential` | Load the credential and its `ProviderIdentity` by `id` | `PasskeyCredential` or `null` |
| `credential-created` | Persist the verified credential for `identity` | Ignored |
| `counter-update` | Atomically compare and update the stored counter | `true` only when committed |

Registration options require a discoverable credential and user verification. Credential persistence, uniqueness, account lookup, and counter writes remain application-owned.

---

## Manage challenges

Aurelian creates opaque registration and authentication state, stores it through `storage`, and consumes it once before verification. `stateTtl` is optional and defaults to 300 seconds.

Registration state includes the selected identity and binds to the exact `Authorization` header from the start request. Send the same header during verification; authentication state remains usable before login and is not session-bound.

Use shared storage with atomic `consume` in production. A failed ceremony burns its state, so the client must start again.

---

## Call the routes

The `passkey` map key creates four provider-first paths beneath the issuer. Rename the key to rename every path; manual clients can call them with `fetch` and SimpleWebAuthn.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `POST` | `/passkey/registration/start` | Create options for the authenticated account | No JSON body; `registration-user` resolves `request` | `{ options, state }` |
| `POST` | `/passkey/registration/verify` | Verify and persist a new credential | `{ response, state }` with the same authorization header | `{ verified: true }` |
| `GET` | `/passkey/authentication/start` | Create discoverable authentication options | None | `{ options, state }` |
| `POST` | `/passkey/authentication/verify` | Verify the assertion and issue tokens | `{ response, state }` | `TokenResponse` |

These are the only four routes; there is no `POST /passkey/authenticate` alias. Registration creates a credential without issuing tokens, while authentication verification resolves its identity and creates a token pair.

Use HTTPS outside loopback development.

---

## Update counters

The provider verifies the challenge, origin, RP ID, signature, and user-verification flag before emitting `counter-update`. It emits that event when either the persisted or returned counter is non-zero.

Compare the persisted value with `currentCounter` and write `newCounter` in one transaction. Return `false` on a conflict so authentication fails; always-zero authenticators skip this event and cannot offer counter-based clone detection.

---

## Continue the flow

Use the [Passkeys guide](/passkeys) for browser registration and authentication calls. Review [Security](/security) before choosing recovery, credential deletion, and session policies.

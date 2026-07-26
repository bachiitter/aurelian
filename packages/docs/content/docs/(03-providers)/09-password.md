---
title: Password
description: Run complete account flows with application-owned persistence
---

## Choose the workflow

Use `password` for account lookup, registration, sign-in, verification-code delivery, and reset routes. Use [Credentials](/credentials) instead when one arbitrary Standard Schema proof and an application-owned workflow are enough.

The application owns accounts, password-hash persistence, code delivery, audit records, and policy. Aurelian owns password hashing, six-digit code generation, and one-time transient state through `StorageAdapter`.

---

## Configure the handler

Import `password` and its types from `aurelian/providers/password`. Handle every operation through one discriminated `handle(event)` callback.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import {
  password,
  pbkdf2PasswordHasher
} from 'aurelian/providers/password'
import type {
  PasswordAccount,
  PasswordOptions
} from 'aurelian/providers/password'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const accounts = new Map<string, PasswordAccount>()
const developmentOutbox = new Map<string, string>()
const storage = memoryStorage()

const options: PasswordOptions = {
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
  hasher: pbkdf2PasswordHasher({ iterations: 750_000 }),
  normalizeIdentifier(identifier) {
    return identifier.trim().toLowerCase()
  },
  storage,
  validatePassword(value) {
    return value.length >= 12
      ? null
      : 'Use at least 12 characters.'
  }
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
    password: password(options)
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

The maps are suitable only for local development. Replace them with shared application storage, make registration an atomic unique insert, and send codes through an email or messaging service.

The `account` event must return `{ identity, passwordHash }` or `null`. Return the new identity from `registration`; persist the supplied hash during `registration` and `password-reset` rather than hashing plaintext in application code.

---

## Handle each event

| Event | When it runs | Application action | Result |
| --- | --- | --- | --- |
| `account` | Sign-in and registration start | Load the normalized account and stored hash | `PasswordAccount` or `null` |
| `send-code` | Registration or reset start | Deliver `code` according to `purpose` | Ignored |
| `registration` | After a valid registration code | Atomically create the account with `passwordHash` | New `ProviderIdentity` or `null` |
| `password-reset` | After valid reset state and password policy | Update the stored hash | Ignored |

Every event that can perform application I/O includes its needed values, and account-changing events receive the original `request`. Keep mail delivery, account writes, logging, and other side effects inside this application boundary.

---

## Customize hashing

The default `pbkdf2PasswordHasher()` uses PBKDF2-SHA-256 with a random 16-byte salt and 600,000 iterations. Its encoded hash stores the algorithm, iteration count, salt, and derived value so later verification uses the original work factor.

Pass `{ iterations }` to tune PBKDF2 after benchmarking your runtime, as shown above. Supply another `PasswordHasher` through `hasher` when you need Argon2id, a platform service, or hash migration behavior.

---

## Normalize and validate

`normalizeIdentifier` runs before account lookup, state creation, registration, and reset callbacks. Return one stable, non-empty canonical value and apply the same database uniqueness rule to it.

`validatePassword` runs during registration start and reset completion. Return a user-safe message to reject the value, or `null`/`void` to accept it; Aurelian always rejects empty values and values longer than 1,024 characters.

Authentication checks an existing hash and does not run `validatePassword`. This avoids applying current creation policy to an older valid secret.

---

## Call the routes

The `password` provider key places all six paths beneath `/password`. Rename the map key to rename that prefix.

| Method | Relative path | Input | Success | Issues tokens |
| --- | --- | --- | --- | --- |
| `POST` | `/authenticate` | `{ identifier, password }` | `TokenResponse` | Yes |
| `POST` | `/registration/start` | `{ identifier, password }` | `{ state }` | No |
| `POST` | `/registration/verify` | `{ code, state }` | `TokenResponse` | Yes |
| `POST` | `/password-reset/start` | `{ identifier }` | `{ state }` | No |
| `POST` | `/password-reset/verify` | `{ code, state }` | `{ state }` | No |
| `POST` | `/password-reset/complete` | `{ password, state }` | `{ reset: true }` | No |

Registration verification issues tokens only when `registration` returns a valid identity. Reset completion changes the stored hash but does not sign the account in.

---

## Consume each attempt

Registration and reset code states are consumed before code comparison, so one wrong code burns that state. Reset completion also consumes its state before validating the replacement value, so a rejected value requires a new reset flow.

`codeTtl` and `resetTtl` default to 600 seconds and must be positive safe integers. Use shared storage with atomic `consume` so concurrent attempts cannot both succeed.

---

## Limit abuse

Rate-limit sign-in, start, verification, and completion routes by network signals and normalized identifier. Six-digit codes have limited entropy, and one-attempt consumption does not replace throttling, delivery limits, or abuse monitoring.

Authentication returns the same failure for an unknown account and a wrong value. Reset start creates state and emits `send-code` for every well-formed identifier, so suppress delivery for unknown accounts without changing the public response or observable timing.

Unknown-account authentication skips hash verification, so response timing can still differ from a stored account. Rate-limit this route and assess timing behavior in the deployed runtime before claiming enumeration resistance.

Registration start returns `409 identifier_unavailable` for an existing account. Expose that route only where account discovery is acceptable, and apply stricter limits when identifier enumeration matters.

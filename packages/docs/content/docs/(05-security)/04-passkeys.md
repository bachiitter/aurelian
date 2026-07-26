---
title: Passkeys
description: Connect browser ceremonies to provider-owned WebAuthn routes
---

## Install helpers

Use SimpleWebAuthn in the browser. Aurelian's provider generates and verifies both registration and authentication options.

```bash
pnpm add @simplewebauthn/browser @simplewebauthn/server
```

Configure `handle`, `origin`, `rpID`, `rpName`, and `storage` in the [provider reference](/passkey-provider). `stateTtl` is optional; Aurelian owns transient challenges while application code owns credential persistence.

---

## Register a credential

Start registration with an authenticated request. The provider emits `registration-user` through `handle(event)` and returns `{ options, state }` for that account.

```ts
import { startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'

type RegistrationStart = {
  options: PublicKeyCredentialCreationOptionsJSON
  state: string
}

const startResponse = await fetch(
  'https://auth.example.com/auth/passkey/registration/start',
  {
    headers: { authorization: 'Bearer development-session' },
    method: 'POST'
  }
)

if (!startResponse.ok) {
  throw new Error('passkey_registration_start_failed')
}

const registration: RegistrationStart = await startResponse.json()
const response = await startRegistration({
  optionsJSON: registration.options
})
const verifyResponse = await fetch(
  'https://auth.example.com/auth/passkey/registration/verify',
  {
    body: JSON.stringify({ response, state: registration.state }),
    headers: {
      authorization: 'Bearer development-session',
      'content-type': 'application/json'
    },
    method: 'POST'
  }
)

if (!verifyResponse.ok) {
  throw new Error('passkey_registration_verify_failed')
}

const result: { verified: true } = await verifyResponse.json()
```

Replace the development authorization header with your normal session credentials and repeat its exact value during verification. Registration verify consumes the state, verifies the response, and emits `credential-created` with the identity selected at registration start.

The provider requires a discoverable credential and user verification during registration. Credential IDs must be unique, and registration returns `{ verified: true }` without issuing a new Aurelian session.

---

## Authenticate an account

Request fresh options from the authentication start route. Submit the browser response and matching state to the authentication verify route.

```ts
import { startAuthentication } from '@simplewebauthn/browser'
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import type { TokenResponse } from 'aurelian'

type AuthenticationStart = {
  options: PublicKeyCredentialRequestOptionsJSON
  state: string
}

const startResponse = await fetch(
  'https://auth.example.com/auth/passkey/authentication/start'
)

if (!startResponse.ok) {
  throw new Error('passkey_authentication_start_failed')
}

const authentication: AuthenticationStart = await startResponse.json()
const response = await startAuthentication({
  optionsJSON: authentication.options
})
const verifyResponse = await fetch(
  'https://auth.example.com/auth/passkey/authentication/verify',
  {
    body: JSON.stringify({ response, state: authentication.state }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }
)

if (!verifyResponse.ok) {
  throw new Error('passkey_authentication_verify_failed')
}

const tokens: TokenResponse = await verifyResponse.json()
```

The verify route consumes state, emits `credential` for `response.id`, verifies the assertion, and emits `counter-update` when either counter is non-zero. It then resolves the credential identity and issues Aurelian tokens through the authentication lifecycle.

---

## Persist safely

Aurelian stores each challenge through `PasskeyOptions.storage` and consumes it once. Registration state binds the selected identity to the exact `Authorization` header used at start, so verification must send the same value.

Authentication state remains unbound to a login because that ceremony starts before sign-in. Both branches require user verification and expire after `stateTtl`, which defaults to 300 seconds.

Store credentials in a shared repository used by the `credential`, `credential-created`, and `counter-update` events. Compare the persisted counter and write the new non-zero value atomically.

---

## Test failures

Test wrong challenge, origin, RP ID, user-verification flag, credential ID, expiry, replay, duplicate registration, counter regression, and concurrent assertions. Also test an always-zero authenticator and document its reduced clone detection.

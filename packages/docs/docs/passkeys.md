---
title: Passkeys
description: Connect browser ceremonies to provider-owned WebAuthn routes
---

## Install helpers

Use SimpleWebAuthn in the browser. Aurelian's provider generates and verifies both registration and authentication options.

```bash
pnpm add @simplewebauthn/browser @simplewebauthn/server
```

Configure every `PasskeyOptions` callback in the [provider reference](/passkey-provider). Developer code owns state and credential persistence, while the provider owns all four ceremony routes.

---

## Register a credential

Start registration with an authenticated request. The provider calls `getRegistrationUser(request)` and returns `{ options, state }` for that account.

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

Replace the development authorization header with your normal session credentials. Registration verify consumes the state, verifies the response, and calls `saveCredential` with the identity selected at registration start.

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

The verify endpoint consumes state, loads the credential by `response.id`, verifies the assertion, and updates a non-zero counter. It then resolves the credential identity and issues Aurelian tokens through the provider endpoint.

---

## Persist safely

Store the `PasskeyState` registration/authentication union in shared, expiring storage and consume each value once. Bind registration state to the authenticated session at both start and verify, as shown in the [Cloudflare issuer example](https://github.com/bachiitter/aurelian/blob/main/examples/issuer/cloudflare/src/auth.ts).

Do not require an existing login session when consuming authentication state because this ceremony runs before login. Authentication still requires user verification and one-time, promptly expiring state.

Store credentials in a shared repository used by `getCredential`, `saveCredential`, and `updateCounter`. Compare and update non-zero counters atomically.

---

## Test failures

Test wrong challenge, origin, RP ID, user-verification flag, credential ID, expiry, replay, duplicate registration, counter regression, and concurrent assertions. Also test an always-zero authenticator and document its reduced clone detection.

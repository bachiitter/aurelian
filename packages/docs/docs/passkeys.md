---
title: Passkeys
description: Connect WebAuthn ceremonies to Aurelian request providers
---

## Install helpers

Aurelian issues the session after WebAuthn verifies an identity. This guide uses SimpleWebAuthn 13 for browser ceremonies and server verification.

```bash
pnpm add @simplewebauthn/browser @simplewebauthn/server
```

Your application owns registration, credential storage, recovery, RP policy, and challenge transactions. Require HTTPS outside local development.

---

## Define stored data

Persist the fields returned in `registrationInfo.credential`.

```ts
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

type Passkey = {
  counter: number;
  credentialId: string;
  id: string;
  publicKey: Uint8Array;
  transports?: AuthenticatorTransportFuture[];
  userId: string;
};

type PasskeyChallenge = {
  challenge: string;
  ceremony: 'authentication' | 'registration';
  userId?: string;
};
```

Enforce a unique credential ID and store the public key as binary data. Keep registration and authentication challenges in an atomic, expiring application store.

---

## Start authentication

Create a discoverable-credential request without accepting a user ID from the browser.

```ts
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { challengeStore } from '~/security/passkeys.js';

async function createAuthenticationOptions(): Promise<Response> {
  const transactionId = crypto.randomUUID();
  const options = await generateAuthenticationOptions({
    rpID: 'example.com',
    userVerification: 'required'
  });

  await challengeStore.set(
    `passkey:authentication:${transactionId}`,
    {
      challenge: options.challenge,
      ceremony: 'authentication'
    } satisfies PasskeyChallenge,
    { ttl: 5 * 60 }
  );

  return Response.json({ options, transactionId });
}
```

`challengeStore` is application-owned `StorageAdapter`. Bind rate-limit context server-side instead of trusting account hints from the request.

---

## Verify in a provider

Parse the request, look up its credential, consume the challenge, verify the assertion, and update the counter.

```ts
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { RequestProvider } from 'aurelian';
import {
  challengeStore,
  getPasskeyByCredentialId,
  parseAuthenticationRequest,
  updatePasskeyCounterIfGreater
} from '~/security/passkeys.js';

export const passkeyProvider: RequestProvider = {
  async authenticate({ request }) {
    const body = await parseAuthenticationRequest(request);

    if (!body) {
      return null;
    }

    const passkey = await getPasskeyByCredentialId(body.assertion.id);

    if (!passkey) {
      return null;
    }

    const transactionKey = `passkey:authentication:${body.transactionId}`;
    const transaction = await challengeStore.consume<PasskeyChallenge>(
      transactionKey
    );

    if (!transaction || transaction.ceremony !== 'authentication') {
      return null;
    }

    const verification = await verifyAuthenticationResponse({
      credential: {
        counter: passkey.counter,
        id: passkey.credentialId,
        publicKey: passkey.publicKey,
        transports: passkey.transports
      },
      expectedChallenge: transaction.challenge,
      expectedOrigin: 'https://example.com',
      expectedRPID: 'example.com',
      requireUserVerification: true,
      response: body.assertion
    }).catch(() => null);

    if (!verification?.verified) {
      return null;
    }

    const nextCounter = verification.authenticationInfo.newCounter;
    const isCounterless = passkey.counter === 0 && nextCounter === 0;
    const isFresh =
      isCounterless ||
      (await updatePasskeyCounterIfGreater(passkey.id, nextCounter));

    return isFresh ? { id: passkey.userId } : null;
  },
  type: 'request'
};
```

`parseAuthenticationRequest` validates untrusted JSON and returns `{ assertion: AuthenticationResponseJSON; transactionId: string } | null`. The credential lookup returns `Passkey | null`, and the counter update performs one conditional `counter < nextCounter` write.

SimpleWebAuthn rejects a non-zero counter that does not increase before returning verification. The conditional write also prevents two server requests that read the same old counter from both succeeding; always-zero authenticators cannot provide this clone signal.

---

## Call from the browser

Fetch options, run the ceremony, then send the assertion to the Aurelian provider route.

```ts
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { authClient } from './auth-client.js';

type AuthenticationOptionsPayload = {
  options: PublicKeyCredentialRequestOptionsJSON;
  transactionId: string;
};

const optionsResponse = await fetch('/passkeys/authentication-options');

if (!optionsResponse.ok) {
  throw new Error('passkey_options_failed');
}

const payload: AuthenticationOptionsPayload = await optionsResponse.json();
const assertion = await startAuthentication({
  optionsJSON: payload.options
});
const tokens = await authClient.authenticate('passkey', {
  assertion,
  transactionId: payload.transactionId
});
```

Validate the options response at runtime in production instead of trusting the annotation. Browser cancellation is expected and should not be reported as a server failure.

---

## Start registration

Require recent authentication, exclude current credentials, and bind a fresh transaction to that user.

```ts
import { generateRegistrationOptions } from '@simplewebauthn/server';
import {
  challengeStore,
  requireRecentlyAuthenticatedUser
} from '~/security/passkeys.js';

async function createRegistrationOptions(request: Request): Promise<Response> {
  const user = await requireRecentlyAuthenticatedUser(request);
  const transactionId = crypto.randomUUID();
  const options = await generateRegistrationOptions({
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required'
    },
    excludeCredentials: user.passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports
    })),
    rpID: 'example.com',
    rpName: 'Example',
    userID: new TextEncoder().encode(user.id),
    userName: user.email
  });

  await challengeStore.set(
    `passkey:registration:${transactionId}`,
    {
      challenge: options.challenge,
      ceremony: 'registration',
      userId: user.id
    } satisfies PasskeyChallenge,
    { ttl: 5 * 60 }
  );

  return Response.json({ options, transactionId });
}
```

The application-owned guard returns `{ email: string; id: string; passkeys: Passkey[] }`. SimpleWebAuthn 13 requires `userID` as bytes rather than a string.

---

## Finish registration

Consume the transaction, verify origin and RP ID, then save the credential uniquely for the bound user.

```ts
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import {
  challengeStore,
  parseRegistrationRequest,
  savePasskeyUnique
} from '~/security/passkeys.js';

async function confirmRegistration(request: Request): Promise<Response> {
  const body = await parseRegistrationRequest(request);

  if (!body) {
    return new Response('Invalid response', { status: 400 });
  }

  const transaction = await challengeStore.consume<PasskeyChallenge>(
    `passkey:registration:${body.transactionId}`
  );

  if (
    !transaction ||
    transaction.ceremony !== 'registration' ||
    !transaction.userId
  ) {
    return new Response('Challenge expired', { status: 400 });
  }

  const verification = await verifyRegistrationResponse({
    expectedChallenge: transaction.challenge,
    expectedOrigin: 'https://example.com',
    expectedRPID: 'example.com',
    response: body.response
  }).catch(() => null);

  if (!verification?.verified) {
    return new Response('Verification failed', { status: 400 });
  }

  await savePasskeyUnique({
    ...verification.registrationInfo.credential,
    userId: transaction.userId
  });

  return new Response(null, { status: 204 });
}
```

`parseRegistrationRequest` returns `{ response: RegistrationResponseJSON; transactionId: string } | null`. `savePasskeyUnique` accepts `{ counter; id; publicKey; transports?; userId }` and rejects duplicate credential IDs in one database operation.

Do not issue a new session merely because registration succeeded. Return to the current session and require the new credential in a later authentication or step-up ceremony.

---

## Test ceremonies

Test wrong challenge, origin, RP ID, ceremony type, user-verification flag, credential ID, expired transaction, transaction replay, duplicate registration, counter regression, and concurrent assertions. Also test an always-zero authenticator and document the reduced clone detection.

Continue with [Step-up auth](/step-up-auth), [Security](/security), and [Testing](/testing).

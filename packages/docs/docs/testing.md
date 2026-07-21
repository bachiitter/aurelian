---
title: Testing
description: Exercise complete flows and replay boundaries
---

## Create real keys

Generate an extractable test key pair with `jose` instead of checking PEM fixtures into the repository.

```ts
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

async function createSigningKeys(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const keyPair = await generateKeyPair('ES256', { extractable: true });
  const [privateKey, publicKey] = await Promise.all([
    exportPKCS8(keyPair.privateKey),
    exportSPKI(keyPair.publicKey)
  ]);

  return { privateKey, publicKey };
}
```

Use `memoryStorage()` for a single-process integration test. Do not use it to prove distributed consistency.

---

## Test the host

Call `auth.handler` with a standard request. This exercises routing without a network port or host-specific test client.

```ts
import { describe, expect, it } from 'vitest';
import { auth } from '../src/auth.js';

describe('auth routes', () => {
  it('serves the signing key', async () => {
    const request = new Request(
      'https://auth.example.com/auth/.well-known/jwks.json',
      { headers: { 'x-request-id': 'auth-integration-test' } }
    );
    const response = await auth.handler(request);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(
      'auth-integration-test'
    );
    expect(body).toEqual({
      keys: [
        expect.objectContaining({
          alg: 'ES256',
          kty: 'EC',
          use: 'sig'
        })
      ]
    });
  });
});
```

Create `auth` with test keys before this assertion. A separate test should post valid and invalid credentials to `/auth/authenticate/password` and verify the resulting token with `auth.verify`.

---

## Test request providers

Send a real `Request` through `auth.handler`, then verify the returned access token.

```ts
const response = await auth.handler(
  new Request('https://auth.example.com/auth/authenticate/password', {
    body: JSON.stringify({
      email: 'user@example.com',
      password: 'correct-horse'
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
);

expect(response.status).toBe(200);

const tokens: unknown = await response.json();

if (!isTokenResponse(tokens)) {
  throw new Error('token_response_invalid');
}

expect((await auth.verify(tokens.accessToken)).valid).toBe(true);
```

Define `isTokenResponse` in the test as a type guard for the [token response](/api#read-token-data). Also assert that wrong credentials return `401 authentication_failed`.

---

## Test OAuth

Use a fake OAuth provider that records `callbackURL` and provider state. Run authorize, callback, and exchange requests through the handler rather than calling provider functions directly.

Assert that provider state differs from client state, the final redirect restores client state, the verifier succeeds once, and a second exchange fails. Add cases for a disallowed redirect and missing S256 challenge.

---

## Test rotation

Refresh once, verify the new access token, and assert that the old refresh token returns `null`. Revoke the replacement and assert that it no longer rotates.

When using `refresh.resolve`, test profile updates, disabled users, removed workspace memberships, and callback exceptions. Remember that a `null` result or exception occurs after the refresh token was consumed.

---

## Test adapters

Run concurrent consumes against one key and require exactly one stored result.

```ts
await storage.set('test:one-time', { id: 'value_1' }, { ttl: 60 });

const results = await Promise.all([
  storage.consume<{ id: string }>('test:one-time'),
  storage.consume<{ id: string }>('test:one-time')
]);

expect(results.filter((value) => value !== null)).toHaveLength(1);
```

Also test expiry, serialization, database errors, and TTL units. Run this suite against the real production backend, not only an in-memory substitute.

---

## Cover security cases

Test TOTP counter replay, recovery-code reuse, passkey challenge reuse, passkey counter regression, duplicate account linking, stale workspace membership, expired step-up proof, and impersonation refresh rejection. These are application tests because Aurelian does not implement those policies.

Use [Security](/security) as the checklist and [Errors](/errors) for expected route responses.

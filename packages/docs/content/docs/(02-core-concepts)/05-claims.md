---
title: Claims
description: Bind compact authorization data to access tokens
---

## Set an audience

Bind access tokens to the API that should accept them. Pass the same value to every verifier.

```ts
import { createAuth } from 'aurelian';
import { createClient } from 'aurelian/client';

const audience = 'https://api.example.com';

const auth = createAuth({
  access: { audience },
  issuer,
  profiles,
  providers,
  resolve,
  signing,
  storage
});

const verifier = createClient({
  audience,
  issuer: 'https://auth.example.com/auth'
});
```

Import `issuer`, `profiles`, `providers`, `resolve`, `signing`, and `storage` from the service built in [Setup](/setup). Verification fails when the configured audience does not match.

---

## Add token data

Use `access.claims` for compact values needed on every API request. The callback runs for initial issue and every refresh.

```ts
import { getMembershipByUserId } from '~/memberships.js';

access: {
  audience: 'https://api.example.com',
  async claims({ profile, session }) {
    if (profile.type !== 'workspace') {
      return { sessionCreatedAt: session.createdAt };
    }

    const membership = await getMembershipByUserId(
      profile.properties.id,
      profile.properties.workspaceId
    );

    if (!membership) {
      throw new Error('membership_not_found');
    }

    return {
      roles: membership.roles,
      sessionCreatedAt: session.createdAt,
      workspaceId: membership.workspaceId
    };
  },
  ttl: 10 * 60
}
```

This is an `access` field inside `createAuth` from [Setup](/setup). The application-owned function accepts `(userId: string, workspaceId: string)` and returns `{ roles: string[]; workspaceId: string } | null`.

---

## Avoid reserved names

Aurelian owns `aud`, `exp`, `iat`, `iss`, `jti`, `nbf`, `profile`, `sid`, `sub`, and `typ`. Returning one of these names throws `reserved_claim:<name>` and stops issuance.

Custom values are added before Aurelian sets standard claims. Keep them small because every access-token request sends the complete JWT.

---

## Read standard data

Successful verification returns the profile and all JWT claims. `sub` is the profile's `properties.id`, `sid` identifies the session, `jti` identifies one access token, and `typ` is `access`.

```ts
const result = await verifier.verify(accessToken);

if (!result.valid) {
  return new Response('Unauthorized', { status: 401 });
}

const subject = result.claims.sub;
const sessionId = result.claims.sid;
```

Define `accessToken` from the request's bearer header and reject a missing value before this block. Standard temporal claims are checked by `jose` during verification.

---

## Validate custom data

Custom claim values remain `unknown` at the API boundary. Narrow them before authorization.

```ts
function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return null;
  }

  return value;
}

const roles = readStringArray(result.claims.roles);

if (!roles) {
  return new Response('Invalid token claims', { status: 401 });
}
```

Do not trust a TypeScript cast for authorization data. Keep a canonical validator beside the API that consumes each claim.

---

## Test issuance

Test the configured audience, missing audience, reserved-name rejection, callback failure, refreshed values, and malformed custom values at the API boundary. Decode only in tests for inspection; production code should verify before reading claims.

Continue with [Sessions](/sessions), [Multiple workspaces](/multiple-workspaces), and the [token reference](/api#read-token-data).

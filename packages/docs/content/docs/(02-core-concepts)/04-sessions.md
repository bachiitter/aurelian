---
title: Sessions
description: Control rotation, absolute expiry, and revocation behavior
---

## Understand the record

Aurelian stores one refresh record with `createdAt`, `expiresAt`, `issuer`, `profile`, `provider`, and `sessionId`. The opaque token is returned once; only its SHA-256 hash appears in the storage key.

Access tokens default to 10 minutes, and refresh sessions default to 30 days. TTL values are positive integer seconds.

---

## Refresh profile data

Reload mutable account data before every rotation. This application-owned `getUserById(id: string)` returns `{ disabledAt: Date | null; id: string; plan: 'free' | 'pro' } | null`.

```ts
const auth = createAuth({
  access: { ttl: 5 * 60 },
  issuer,
  profiles,
  providers,
  refresh: {
    async resolve({ profile }) {
      if (profile.type !== 'user') {
        return profile;
      }

      const user = await getUserById(profile.properties.id);

      if (!user || user.disabledAt) {
        return null;
      }

      return {
        properties: {
          id: user.id,
          plan: user.plan
        },
        type: 'user'
      };
    },
    ttl: 14 * 24 * 60 * 60
  },
  resolve,
  signing,
  storage
});
```

The refresh callback also receives the original provider and optional request. Returning `null` ends the chain after the old token has already been consumed.

---

## Keep absolute expiry

Rotation preserves the original session ID, creation time, and expiry. A 14-day session still ends 14 days after initial issuance, regardless of refresh activity.

Near expiry, Aurelian shortens the access-token TTL to the remaining session time. It rejects creation when no session time remains.

---

## Replace atomically

Treat each response as one token pair.

```ts
const next = await authClient.refresh({
  refreshToken: current.refreshToken
});

await tokenStore.replace(next);
```

The application-owned store accepts `TokenResponse` and replaces both values together. A partial write can strand the client with a refresh token that was already consumed.

---

## Revoke refresh access

Revoke the active refresh token on sign-out or after a sensitive account change.

```ts
await auth.revoke({ refreshToken });
```

Malformed or missing records are ignored by the direct method. The HTTP revoke route returns `{ revoked: true }` for any string body value, which avoids revealing token existence.

---

## Handle concurrent refresh

Only one concurrent request should consume a refresh token. Other requests return `null` through the direct API or `401 refresh_token_invalid` through the route.

Coordinate refreshes in the client and use an atomic storage adapter. Do not retry with the old token after an uncertain response; require sign-in when the client cannot determine whether rotation completed.

---

## Test the lifecycle

Test initial verification, one successful rotation, old-token replay, profile refresh, disabled-account rejection, absolute expiry, explicit revocation, and concurrent refresh. Assert that `sid` remains stable while `jti` and refresh tokens change.

Continue with [Storage](/storage), [Claims](/claims), [Client](/client), and [Security](/security).

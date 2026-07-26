---
title: Architecture
description: Separate authentication mechanics from application identity ownership
---

## Start with ownership

Aurelian runs provider handshakes, validates profiles, signs access tokens, rotates refresh tokens, and exposes verification keys. Your application owns users, credentials, provider links, memberships, roles, factor enrollment, and policy.

| Aurelian owns | Your application owns |
| --- | --- |
| OAuth state, PKCE, and authorization codes | Provider credentials and SDK calls |
| Password hashing and transient registration/reset state | Accounts and password-hash persistence |
| Passkey challenge generation and consumption | Passkey credentials and counter persistence |
| Access-token signing and JWKS | User and provider-account tables |
| Refresh-token rotation and expiry | Registration and account-linking rules |
| Profile schema validation | Roles, workspaces, factors, and audit logs |

This boundary is deliberate: `resolve` is the only place where a normalized provider identity becomes an application profile.

---

## Follow a request

A direct provider route completes in one server request:

1. The client posts application credentials to a route such as `/:provider/authenticate`.
2. The provider calls `context.var.aurelian.authenticate` with `ProviderIdentity` or `null`.
3. `resolve` maps that identity to a profile from `defineProfiles`.
4. Aurelian validates the profile, stores a hashed refresh token, and returns a token pair.

OAuth adds two one-time records before the same profile and session steps:

1. The provider's `/authorize` route calls `context.var.aurelian.authorize(flow)`, which validates the return URI and binds it with the S256 challenge into provider state.
2. Its `/callback` route calls `context.var.aurelian.callback(flow)`, which consumes state, runs the flow hook, and binds the return URI into an authorization code.
3. `/token` consumes the authorization code, requires the same return URI, checks its verifier, then creates the session.

Read [Provider flows](/provider-flows) for complete implementations and [Security](/security) for the invariants behind these records.

---

## Model profiles

A profile is a signed snapshot used by APIs, not the canonical user record. Every profile has a string `id` in `properties`; Aurelian copies that value to the JWT `sub` claim.

```ts
type UserProfile = {
  properties: {
    id: string;
    roles: string[];
  };
  type: 'user';
};
```

Use profile types to make boundaries explicit, such as `user`, `workspace`, `service`, or `impersonation`. Reload mutable authorization data in `refresh.resolve`, and still enforce high-risk decisions against current application data.

---

## Understand sessions

An access token is a signed JWT and needs no storage lookup during `verify`. A refresh token is opaque, stored only by its SHA-256 hash, and consumed before a replacement is created.

Rotation keeps the original session ID, creation time, and absolute expiry. It does not extend the session window.

---

## Choose boundaries

Forward the exact public `issuer` path to one `auth.handler`. Aurelian uses Hono internally but preserves a standard `Request` and `Response` boundary.

APIs may verify locally with `auth.verify` or remotely with `createClient().verify`, which reads the issuer JWKS. Continue with the [Quickstart](/quickstart), [Setup](/setup), and runtime-neutral [Mounting](/mounting).

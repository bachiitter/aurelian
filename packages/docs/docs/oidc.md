---
title: OIDC
description: Discover endpoints and verify signed user identities
---

## Set the issuer

Use `oidc()` with the provider's exact issuer URL. Aurelian fetches `${issuer}/.well-known/openid-configuration` and requires matching issuer metadata plus authorization, token, and JWKS endpoints.

UserInfo is optional in the [discovery document](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig). A trailing slash is removed from the configured issuer before discovery.

---

## Add the factory

Register `${issuer}/${providerKey}/callback` with the upstream provider. For this map, the upstream callback is `https://auth.example.com/auth/work/callback`.

Here, `issuer` means the Aurelian `createAuth` issuer, not `OIDCOptions.issuer`.

This callback is not the client return URI. Supply that separate URI with `createClient({ redirectURI })` or `authorize({ redirectURI })`.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { oidc } from 'aurelian/providers/oidc'
import type { OIDCOptions } from 'aurelian/providers/oidc'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const profiles = defineProfiles({
  user: z.object({
    email: z.email().optional(),
    id: z.string().min(1),
    username: z.string().optional()
  })
})
const options: OIDCOptions = {
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  issuer: process.env.OIDC_ISSUER,
  scopes: ['groups'],
  tokenEndpointAuthMethod: 'client_secret_post'
}

export const auth = createAuth({
  issuer: 'https://auth.example.com/auth',
  profiles,
  providers: {
    work: oidc(options)
  },
  resolve({ profile, response }) {
    return profile('user', {
      email: response.data.email,
      id: response.data.id,
      username: response.data.username
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

`OIDCOptions` requires `clientId`, `clientSecret`, and `issuer`. Optional `scopes`, `fetch`, and `tokenEndpointAuthMethod` customize requests.

`createAuth` accepts the supplied client return URI only when it uses HTTP(S). It binds the exact value into one-time provider state and the authorization code, then requires it during PKCE token exchange.

---

## HTTP routes

The provider map key controls both paths. `providers: { work: oidc(options) }` creates `/work/authorize` and `/work/callback`; the `oidc()` factory name does not create an `/oidc` segment.

| Method | Relative path | Purpose | Input | Success response |
| --- | --- | --- | --- | --- |
| `GET` | `/work/authorize` | Start the discovered OIDC flow | Query: `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional `state`, optional space-delimited `scope` | `302` redirect to the discovered authorization endpoint |
| `GET` | `/work/callback` | Receive the OIDC provider's upstream callback | Upstream query: `code`, `state` | `302` redirect to the client `redirect_uri` with Aurelian `code` and client `state` |

Register the callback as `https://auth.example.com/auth/work/callback`. This route is upstream-only—do not call it from the application or use it as the client return URI.

`createClient` is optional; manual clients can navigate to the authorize URL and use `fetch` for the shared token exchange. Use HTTPS outside local development, while a loopback client return URI such as `http://localhost:3000/auth/callback` may use HTTP during development.

---

## Request claims

Authorization always includes `openid`, `email`, and `profile`. Configured and request-level scopes are appended and deduplicated in first-seen order.

Aurelian sends the provider state as both `state` and `nonce`. The callback must receive that state, and the signed ID token must contain the same nonce.

---

## Verify tokens

The callback verifies the ID token signature with the discovered JWKS. It requires `exp`, `iat`, a string `sub`, the exact `iss`, an `aud` containing the client ID, and a nonce matching provider state.

When `azp` is present, it must equal the client ID. An ID token with multiple audiences must include that same authorized party.

When discovery advertises UserInfo, Aurelian calls it and requires its `sub` to equal the verified ID token subject. Review the [ID token](https://openid.net/specs/openid-connect-core-1_0.html#IDToken) and [UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo) requirements for the upstream provider.

---

## Read the identity

The verified ID token `sub` always becomes `id`. Optional `picture`, `email`, `email_verified`, `name`, and `preferred_username` come from the UserInfo response when its endpoint is advertised, or from the verified ID token when it is absent.

These claims become `avatarUrl`, `email`, `emailVerified`, `name`, and `username`. `raw` retains the selected claim source.

Resolve accounts by `id`, not by email. Treat additional values in `raw` as untrusted `unknown`.

---

## Choose authentication

The token endpoint supports `client_secret_basic` and `client_secret_post`. Omission defaults to Basic; set `client_secret_post` explicitly only when the provider requires credentials in the form body.

Basic authentication form-encodes the client ID and secret before joining them with `:` and Base64-encoding the result. A custom `fetch` is used for discovery, token exchange, JWKS loading, and optional UserInfo.

Discovery failure throws `oidc_discovery_failed`; token and ID token failures throw `oidc_token_exchange_failed` or `oidc_id_token_invalid`. A UserInfo failure throws `oidc_userinfo_failed` only when that endpoint is advertised.

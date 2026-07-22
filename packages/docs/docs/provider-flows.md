---
title: Providers
description: Verify identities before resolving application profiles
---

## Choose a flow

Use an `OAuthProvider` when the browser must visit an authorization server. Use a `RequestProvider` when one request contains the proof.

Both return a `ProviderIdentity`, which your resolver turns into an application profile. Aurelian ships these factories:

- Social authorization: [Google](/google), [GitHub](/github), [Discord](/discord), and [Twitch](/twitch)
- Protocol helpers: [OAuth](/oauth) and [OIDC](/oidc)
- Direct proofs: [Code](/code), [Credentials](/credentials), and [Passkey provider](/passkey-provider)

---

## Know the contracts

Import shared contracts from the package root.

```ts
import type {
  OAuthProvider,
  Provider,
  ProviderEndpoint,
  ProviderIdentity,
  RequestProvider
} from 'aurelian'
```

`Provider` is the `OAuthProvider | RequestProvider` union. `ProviderIdentity` requires `id: string` and optionally carries `avatarUrl`, `email`, `emailVerified`, `name`, `raw`, and `username`.

```ts
type RequestProvider = {
  authenticate(input: {
    request: Request
  }): ProviderIdentity | null | Promise<ProviderIdentity | null>
  endpoints?: Record<string, ProviderEndpoint>
  type: 'request'
}

type OAuthProvider = {
  authorizationUrl(input: {
    callbackURL: string
    request: Request
    scopes?: string[]
    state: string
  }): URL | Promise<URL>
  callback(input: {
    callbackURL: string
    code: string
    request: Request
    state: string
  }): ProviderIdentity | Promise<ProviderIdentity>
  endpoints?: Record<string, ProviderEndpoint>
  type: 'oauth'
}
```

Treat `raw` as `unknown` and validate it before use. Resolve accounts by `(provider, id)`, not by an unverified email address.

---

## Compare built-ins

Upstream provider callbacks always use `${issuer}/${providerKey}/callback` and must be registered with the provider. They are separate from client return URIs supplied through `createClient({ redirectURI })` or `authorize({ redirectURI })`.

| Factory | Default scopes | Required identity | Optional normalized fields |
| --- | --- | --- | --- |
| Google | `openid email profile` | `sub` → `id` | `picture`, `email`, `email_verified`, `name` |
| GitHub | `read:user user:email` | `id`, `login` | Avatar, primary email verification, name |
| Discord | `identify email` | `id`, `username` | Avatar, email verification, global name |
| Twitch | `user:read:email` | One user with `id`, `login` | Avatar, email, display name |
| OIDC | `openid email profile` | Verified ID token `sub` | Picture, email verification, name, username |
| OAuth | None | Defined by `identify` | Defined by `identify` |

Configured scopes and request scopes are appended and deduplicated. Restrict client-selected scopes before requests reach `auth.handler` when the upstream permissions are sensitive.

---

## Understand ownership

The protocol and social factories own upstream URL construction, code exchange, response validation, and identity normalization. Aurelian owns route validation, provider state, PKCE, callback derivation, one-time authorization codes, profile resolution, and response normalization.

Generic OAuth is the exception for identity loading: its required `identify` callback fetches, validates, and normalizes the provider's user response. Generic OIDC verifies signed ID tokens and uses matching UserInfo claims only when discovery advertises that endpoint.

Request factories delegate application policy through callbacks. Code callbacks own delivery, credentials callbacks own verification, and passkey callbacks own state and credential persistence.

---

## Implement a request

Parse the standard `Request` as untrusted input and return `null` for an expected rejection. This complete provider checks a small in-memory API-key set.

```ts
import type { ProviderIdentity, RequestProvider } from 'aurelian'

const identitiesByKey = new Map<string, ProviderIdentity>([
  [
    'development-key',
    {
      id: 'service_local',
      name: 'Local service'
    }
  ]
])

export const apiKeyProvider: RequestProvider = {
  authenticate({ request }) {
    const authorization = request.headers.get('authorization')

    if (!authorization?.startsWith('Bearer ')) {
      return null
    }

    return identitiesByKey.get(authorization.slice(7)) ?? null
  },
  type: 'request'
}
```

Register it as `providers.apiKey`, then post to `${issuer}/apiKey/authenticate`. A `null` result becomes `401 authentication_failed`; a thrown error reaches `onError` and becomes `500 internal_server_error`.

---

## Expose operations

Either provider type may expose named endpoints.

```ts
type ProviderEndpoint =
  | {
      authenticate: true
      method: 'POST'
    }
  | {
      handler(request: Request): Response | Promise<Response>
      method: 'GET' | 'POST'
    }
```

An endpoint at `providers.magic.endpoints.request` is mounted at `/magic/request` beneath the issuer path. Slash-separated keys create nested routes, so `registration/start` mounts at `/magic/registration/start`.

A handler endpoint returns its own response. An `{ authenticate: true, method: 'POST' }` endpoint runs request authentication, profile resolution, and token issuance.

Aurelian returns `405 method_not_allowed` for the wrong method and `404 provider_endpoint_not_found` for an unknown provider or endpoint.

Code exposes `POST /<key>/request`. Passkey owns `POST registration/start`, `POST registration/verify`, `GET authentication/start`, and `POST authentication/verify` beneath `/<key>`.

Both start routes return `{ options, state }`, and both verify routes accept `{ response, state }`. Authentication verify issues Aurelian tokens through its provider endpoint.

---

## Follow the routes

Authorization runs through `GET /:provider/authorize`, `GET /:provider/callback`, then `POST /token`. `createAuth` validates the supplied client return URI as HTTP(S), binds it into one-time provider state and the authorization code, and requires the same URI during PKCE exchange.

Direct authentication runs through `POST /:provider/authenticate`, resolves the returned identity, and returns tokens. Unknown or mismatched provider types return `404 provider_not_found`.

---

## Test failures

Stub `fetch` for upstream providers, then send standard `Request` objects through `auth.handler`. Assert callback derivation, merged scopes, normalized identities, malformed input, upstream failures, resolver failures, unknown providers, and expected rejections.

Run complete authorization sequences twice to prove state and authorization-code replay fail with atomic storage. Continue with [Storage](/storage), [Profiles](/profiles), and [Errors](/errors).

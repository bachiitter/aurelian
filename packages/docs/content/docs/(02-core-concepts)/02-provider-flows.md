---
title: Providers
description: Verify identities before resolving application profiles
---

## Choose a flow

Use an OAuth router when the browser must visit an authorization server. Use a direct router when one request contains the proof.

Both pass a `ProviderIdentity` into Aurelian, which your resolver turns into an application profile. Aurelian ships these factories:

- Social authorization: [Google](/google), [GitHub](/github), [Discord](/discord), and [Twitch](/twitch)
- Protocol helpers: [OAuth](/oauth) and [OIDC](/oidc)
- Direct proofs: [Code](/code), [Credentials](/credentials), [Password](/password), and [Passkey provider](/passkey-provider)

---

## Know the contracts

Import shared contracts from the package root and `Hono` from `hono`.

```ts
import type { Hono } from 'hono'
import type {
  OAuthFlow,
  Provider,
  ProviderEnvironment,
  ProviderLifecycle
} from 'aurelian'
```

Every provider is one Hono router. `createAuth` supplies its lifecycle through `context.var.aurelian`.

```ts
type Provider = {
  router: Hono<ProviderEnvironment>
}

type ProviderLifecycle = {
  authenticate(
    identity: ProviderIdentity | null | Promise<ProviderIdentity | null>
  ): Promise<Response>
  authorize(flow: OAuthFlow): Promise<Response>
  callback(flow: OAuthFlow): Promise<Response>
  providerId: string
}

type ProviderEnvironment = {
  Variables: {
    aurelian: ProviderLifecycle
    requestId: string
  }
}

type OAuthFlow = {
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
}
```

Treat `raw` as `unknown` and validate it before use. Resolve accounts by `(provider, id)`, not by an unverified email address.

---

## Install Hono

Install Hono when you create a custom router.

```bash
pnpm add hono
```

Built-in provider users do not need to import, configure, or otherwise interact with Hono.

---

## Build a direct flow

Define the method and relative path explicitly, then give the identity to `authenticate`. This keeps profile resolution and token issuance inside Aurelian.

```ts
import { Hono } from 'hono'
import type {
  Provider,
  ProviderEnvironment,
  ProviderIdentity
} from 'aurelian'

const identitiesByKey = new Map<string, ProviderIdentity>([
  [
    'development-key',
    {
      id: 'service_local',
      name: 'Local service'
    }
  ]
])
const router = new Hono<ProviderEnvironment>()

router.post('/authenticate', (context) => {
  const authorization = context.req.raw.headers.get('authorization')
  const identity = authorization?.startsWith('Bearer ')
    ? identitiesByKey.get(authorization.slice(7)) ?? null
    : null

  return context.var.aurelian.authenticate(identity)
})

export const apiKeyProvider: Provider = { router }
```

Register it as `providers.apiKey`, then post to `${issuer}/apiKey/authenticate`. Passing `null` becomes `401 authentication_failed`; a thrown error reaches `onError` and becomes `500 internal_server_error`.

---

## Build an OAuth flow

Put upstream authorization and callback hooks in an `OAuthFlow`. Call the matching lifecycle helper from each explicit route.

```ts
import { Hono } from 'hono'
import type {
  OAuthFlow,
  Provider,
  ProviderEnvironment
} from 'aurelian'
import {
  exampleOAuthClientId,
  exchangeCodeForIdentity
} from '~/auth/example-oauth.js'

const flow: OAuthFlow = {
  authorizationUrl({ callbackURL, state }) {
    const url = new URL('https://identity.example.com/oauth/authorize')

    url.searchParams.set('client_id', exampleOAuthClientId)
    url.searchParams.set('redirect_uri', callbackURL)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)

    return url
  },
  callback({ callbackURL, code, request }) {
    return exchangeCodeForIdentity({ callbackURL, code, request })
  }
}
const router = new Hono<ProviderEnvironment>()

router.get('/authorize', (context) =>
  context.var.aurelian.authorize(flow)
)
router.get('/callback', (context) =>
  context.var.aurelian.callback(flow)
)

export const exampleOAuthProvider: Provider = { router }
```

The application-owned `exchangeCodeForIdentity` validates the token and identity responses before returning `ProviderIdentity`. Aurelian owns state, PKCE, profile resolution, authorization codes, and token issuance.

---

## Define routes

Add routes directly with `router.get`, `router.post`, or another Hono method. Paths stay relative to the router, so `/request` on `providers.magic` becomes `${issuer}/magic/request`.

`createAuth` mounts each `provider.router` under `/<provider map key>` with `app.route`. Missing providers, paths, or methods fall through to `404 route_not_found` unless the router handles them itself.

Use `context.var.aurelian.authenticate(identity)` for any route that should resolve a profile and issue tokens. Return a normal `Response` for operations that do not authenticate.

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

Credentials defines only `POST /authenticate`, while code also defines `POST /request`. Password defines sign-in, registration, and reset routes; passkey defines exactly four registration and authentication routes with no `POST /authenticate` alias.

| Direct factory | Built-in workflow | Application owns |
| --- | --- | --- |
| Code | Generate, store, and verify a six-digit proof | Delivery and identity lookup |
| Credentials | Validate one arbitrary Standard Schema proof | The complete proof workflow and verification |
| Password | Hash values and run sign-in, registration, code, and reset steps | Accounts, hash persistence, delivery, and policy |
| Passkey | Generate and verify WebAuthn ceremonies with transient state | Credential persistence, account lookup, and counters |

---

## Understand ownership

The protocol and social factories own upstream URL construction, code exchange, response validation, and identity normalization. Aurelian owns authorization request validation, provider state, PKCE, callback derivation, one-time authorization codes, profile resolution, and response normalization.

Generic OAuth is the exception for identity loading: its required `identify` callback fetches, validates, and normalizes the provider's user response. Generic OIDC verifies signed ID tokens and uses matching UserInfo claims only when discovery advertises that endpoint.

Direct factories delegate application policy through callbacks. Code owns proof state, password and passkey own transient flow state, and credentials intentionally leaves the whole workflow to the application.

Applications still own code delivery, password-account and hash persistence, and passkey credential persistence. Passkey counter updates must compare and write non-zero values atomically.

---

## Follow the routes

Authorization runs through `GET /:provider/authorize`, `GET /:provider/callback`, then `POST /token`. `createAuth` validates the supplied client return URI as HTTP(S), binds it into one-time provider state and the authorization code, and requires the same URI during PKCE exchange.

Direct authentication commonly runs through `POST /:provider/authenticate`, but the provider router owns that route. Password adds nested registration and reset routes, while passkey uses only nested registration and authentication routes.

A missing route returns `404 route_not_found`.

---

## Test failures

Stub `fetch` for upstream providers, then send standard `Request` objects through `auth.handler`. Assert callback derivation, merged scopes, normalized identities, malformed input, upstream failures, resolver failures, unknown providers, and expected rejections.

Run complete authorization sequences twice to prove state and authorization-code replay fail with atomic storage. Continue with [Storage](/storage), [Profiles](/profiles), and [Errors](/errors).

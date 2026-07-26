---
title: API reference
description: Review every public export, route, and contract
---

## Choose an export

| Export path | Runtime values |
| --- | --- |
| `aurelian` | `createAuth`, `defineProfiles` |
| `aurelian/client` | `createClient` |
| `aurelian/providers/code` | `code` |
| `aurelian/providers/credentials` | `credentials` |
| `aurelian/providers/discord` | `discord` |
| `aurelian/providers/github` | `github` |
| `aurelian/providers/google` | `google` |
| `aurelian/providers/oauth` | `oauth` |
| `aurelian/providers/oidc` | `oidc` |
| `aurelian/providers/passkey` | `passkey` |
| `aurelian/providers/password` | `password`, `pbkdf2PasswordHasher` |
| `aurelian/providers/twitch` | `twitch` |
| `aurelian/profiles` | `defineProfiles`, `validateProfile` |
| `aurelian/server` | `createAuth` |
| `aurelian/storage` | `cloudflareKVStorage` |
| `aurelian/storage/cloudflare-kv` | `cloudflareKVStorage` |
| `aurelian/storage/memory` | `memoryStorage` |

The package also exports `aurelian/package.json`. All JavaScript entry points are ESM.

The root exposes `createAuth` and `defineProfiles` as runtime values. Provider factories and helpers, including `password` and `pbkdf2PasswordHasher`, are available only from their provider subpaths.

---

## Create the server

`createAuth(options)` returns an `Auth<ProfilePayload<Profiles>>` object. Required options are shown without application values.

```ts
type CreateAuthOptions<
  Providers extends Record<string, Provider>,
  Profiles extends ProfileSchema
> = {
  access?: {
    audience?: string | string[]
    claims?(input: {
      profile: ProfilePayload<Profiles>
      session: Session<ProfilePayload<Profiles>>
    }): Record<string, unknown> | Promise<Record<string, unknown>>
    ttl?: number
  }
  issuer: string
  onError?(
    error: unknown,
    context: { request: Request; requestId: string }
  ): void | Promise<void>
  profiles: Profiles
  providers: Providers
  refresh?: {
    resolve?(input: {
      profile: ProfilePayload<Profiles>
      provider: string
      request?: Request
    }):
      | ProfilePayload<Profiles>
      | null
      | Promise<ProfilePayload<Profiles> | null>
    ttl?: number
  }
  resolve: ProfileResolver<Providers, Profiles>
  signing: {
    algorithm?: string
    keyId?: string
    privateKey: string
    publicKey: string
  }
  storage: StorageAdapter
}
```

`access.ttl` defaults to 600 seconds, `refresh.ttl` defaults to 2,592,000 seconds, and `signing.algorithm` defaults to `RS256`. Both TTLs must be positive safe integers.

`issuer` must be HTTPS except for loopback HTTP, and its query and fragment are discarded. Client return URIs are authorization-request values, not `CreateAuthOptions` configuration.

`createAuth` accepts a supplied return URI only when it uses HTTP(S). It binds the exact value into one-time provider state and the authorization code, then requires it again during PKCE token exchange.

---

## Call server methods

```ts
type Auth<Profile> = {
  handler(request: Request): Promise<Response>
  issue(input: {
    profile: Profile
    provider: string
  }): Promise<TokenResponse>
  jwks(): Promise<{ keys: JWK[] }>
  refresh(input: {
    refreshToken: string
    request?: Request
  }): Promise<TokenResponse | null>
  revoke(input: { refreshToken: string }): Promise<void>
  verify(accessToken: string): Promise<VerifyResult<Profile>>
}
```

`handler` catches internal errors and returns the standard JSON error shape. Direct methods reject on operational or validation errors; `refresh` returns `null` for malformed, missing, expired, consumed, wrong-issuer, or application-rejected tokens.

`issue` validates the profile and creates a normal refresh session. `jwks` returns one public signing JWK for the configured key.

---

## Define providers

```ts
import type { Hono } from 'hono'

type ProviderIdentity = {
  avatarUrl?: string
  email?: string
  emailVerified?: boolean
  id: string
  name?: string
  raw?: unknown
  username?: string
}

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

Provider map keys may contain letters, numbers, `.`, `_`, `~`, and `-`. Each router defines its own explicit relative paths and methods.

`createAuth` mounts each `provider.router` under its map key with `app.route`. The parent router supplies `providerId`, `authenticate`, `authorize`, and `callback` through `context.var.aurelian`.

Custom provider authors must install and import `hono`. Built-in provider users do not need to interact with Hono.

---

## Configure social sign-in

Each social factory returns a `Provider`. Import its value and option type from the matching subpath.

```ts
type GoogleOptions = {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  scopes?: string[]
}

type GitHubOptions = {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  scopes?: string[]
}

type DiscordOptions = {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  scopes?: string[]
}

type TwitchOptions = {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  scopes?: string[]
}
```

`google`, `github`, `discord`, and `twitch` are runtime exports. Their type exports are `GoogleOptions`, `GitHubOptions`, `DiscordOptions`, and `TwitchOptions`.

The callback is `${issuer}/<provider-key>/callback`. Default scopes are `openid email profile` for Google, `read:user user:email` for GitHub, `identify email` for Discord, and `user:read:email` for Twitch.

Configured and request-level scopes are appended and deduplicated. Google's optional `fetch` replaces `globalThis.fetch` for token exchange and UserInfo loading.

GitHub and Twitch explicitly use `client_secret_post` for token exchange. Read the [Google](/google), [GitHub](/github), [Discord](/discord), and [Twitch](/twitch) pages for exact identity mappings.

---

## Configure authorization

Import `oauth` and its two type exports from `aurelian/providers/oauth`.

```ts
type OAuthIdentityInput = {
  accessToken: string
  fetch: typeof fetch
  request: Request
  token: unknown
}

type OAuthOptions = {
  authorizationParams?: Record<string, string>
  authorizationURL: string
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  identify(input: OAuthIdentityInput):
    | ProviderIdentity
    | Promise<ProviderIdentity>
  scopes?: string[]
  tokenEndpointAuthMethod?:
    | 'client_secret_basic'
    | 'client_secret_post'
  tokenURL: string
}
```

`oauth(options)` returns a `Provider` and throws `oauth_client_credentials_required` for empty credentials. Omitted scopes default to none, and omitted token authentication defaults to `client_secret_basic`.

Basic authentication form-encodes the client ID and secret before joining them with `:` and Base64-encoding the result. Set `client_secret_post` explicitly to place both credentials in the form body.

The helper validates a JSON token response with a non-empty string `access_token`, then delegates identity loading and validation to `identify`. See [OAuth](/oauth) for a complete inline implementation.

---

## Configure discovery

Import `oidc` and `OIDCOptions` from `aurelian/providers/oidc`.

```ts
type OIDCOptions = {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  issuer: string
  scopes?: string[]
  tokenEndpointAuthMethod?:
    | 'client_secret_basic'
    | 'client_secret_post'
}
```

`oidc(options)` returns a `Provider`. It discovers required authorization, token, and JWKS endpoints plus an optional UserInfo endpoint from `${issuer}/.well-known/openid-configuration`.

Authorization always includes `openid`, `email`, and `profile`, and binds the nonce to provider state. Token authentication supports `client_secret_basic` and explicit `client_secret_post`, with Basic as the default.

Basic authentication form-encodes the client ID and secret before joining them with `:` and Base64-encoding the result. Post authentication places both credentials in the form body.

The verified ID token requires `exp`, `iat`, `sub`, the configured `iss`, an `aud` containing the client ID, and a nonce matching provider state. A present `azp` must equal the client ID, and multiple audiences require that same `azp`.

When UserInfo is advertised, its `sub` must match the verified ID token before its claims are normalized. Without UserInfo, normalized identity and `raw` come from the verified ID token.

See [OIDC](/oidc) for discovery and normalized identity behavior.

---

## Configure one-time proof

Import the factory and types from `aurelian/providers/code`.

```ts
type CodeOptions = {
  identify(input: {
    identifier: string
    request: Request
  }): ProviderIdentity | null | Promise<ProviderIdentity | null>
  send(input: {
    code: string
    identifier: string
    request: Request
  }): Response | void | Promise<Response | void>
  storage: StorageAdapter
  ttl?: number
}

type CodeProvider = Provider
```

`code(options)` returns `CodeProvider`. `identify`, `send`, and `storage` are required; `ttl` defaults to 300 seconds.

`POST /<key>/request` accepts `{ identifier }` and sends a generated six-digit value. `POST /<key>/authenticate` accepts `{ identifier, code }` and consumes the stored hash before comparison.

Storage keys hash the identifier, and one authentication attempt consumes the record. See [Code](/code) for delivery and security behavior.

---

## Configure input verification

Import the factory and option type from `aurelian/providers/credentials`.

```ts
type CredentialsOptions<Schema extends StandardSchemaV1> = {
  schema: Schema
  verify(input: {
    credentials: StandardSchemaV1.InferOutput<Schema>
    request: Request
  }): ProviderIdentity | null | Promise<ProviderIdentity | null>
}
```

`credentials(options)` returns a low-level `Provider`. Its router validates one arbitrary request body with the supplied Standard Schema before passing its output to `verify`.

It does not provide registration, reset, code delivery, or hashing. See [Credentials](/credentials) for a complete Zod example or [Password](/password) for the full account workflow.

---

## Configure account secrets

Import both runtime values and all types from `aurelian/providers/password`.

```ts
type PasswordHasher = {
  hash(password: string): string | Promise<string>
  verify(
    password: string,
    passwordHash: string
  ): boolean | Promise<boolean>
}

type PasswordAccount = {
  identity: ProviderIdentity
  passwordHash: string
}

type PasswordProviderEvent =
  | {
      identifier: string
      request: Request
      type: 'account'
    }
  | {
      code: string
      identifier: string
      purpose: 'password-reset' | 'registration'
      request: Request
      type: 'send-code'
    }
  | {
      identifier: string
      passwordHash: string
      request: Request
      type: 'registration'
    }
  | {
      identifier: string
      passwordHash: string
      request: Request
      type: 'password-reset'
    }

type PasswordProviderResult =
  | PasswordAccount
  | ProviderIdentity
  | boolean
  | null
  | void

type PasswordOptions = {
  codeTtl?: number
  handle(event: PasswordProviderEvent):
    | PasswordProviderResult
    | Promise<PasswordProviderResult>
  hasher?: PasswordHasher
  normalizeIdentifier?(identifier: string): string
  resetTtl?: number
  storage: StorageAdapter
  validatePassword?(password: string):
    | string
    | null
    | void
    | Promise<string | null | void>
}
```

`password(options)` returns a `Provider`. `account` returns a `PasswordAccount` or `null`, `registration` returns the new identity, and `send-code` plus `password-reset` perform application-owned side effects.

The default hasher is `pbkdf2PasswordHasher()` with 600,000 PBKDF2-SHA-256 iterations. Pass `{ iterations }` to tune it, or supply another `PasswordHasher` through `hasher`.

`codeTtl` and `resetTtl` default to 600 seconds. The provider stores and consumes transient registration and reset state through `storage`, while the application persists account records and hashes.

`POST /<key>/authenticate` and `POST /<key>/registration/verify` issue tokens. The four other registration and reset routes return state or completion JSON without creating a session.

---

## Configure WebAuthn

Import the factory and types from `aurelian/providers/passkey`.

```ts
type PasskeyCredential = WebAuthnCredential & {
  identity: ProviderIdentity
}

type PasskeyRegistrationUser = {
  displayName?: string
  excludeCredentials?: Array<{
    id: string
    transports?: AuthenticatorTransportFuture[]
  }>
  identity: ProviderIdentity
  name: string
}

type PasskeyProviderEvent =
  | {
      id: string
      type: 'credential'
    }
  | {
      credential: WebAuthnCredential
      identity: ProviderIdentity
      request: Request
      type: 'credential-created'
    }
  | {
      credentialId: string
      currentCounter: number
      newCounter: number
      type: 'counter-update'
    }
  | {
      request: Request
      type: 'registration-user'
    }

type PasskeyProviderResult =
  | PasskeyCredential
  | PasskeyRegistrationUser
  | boolean
  | null
  | void

type PasskeyOptions = {
  handle(event: PasskeyProviderEvent):
    | PasskeyProviderResult
    | Promise<PasskeyProviderResult>
  origin: string
  rpID: string
  rpName: string
  stateTtl?: number
  storage: StorageAdapter
}

type PasskeyProvider = Provider
```

`passkey(options)` returns `PasskeyProvider`. Registration start emits `registration-user` and returns `{ options, state }`; registration verification emits `credential-created` after a successful ceremony.

Registration requires a discoverable credential and user verification. Aurelian stores transient challenge state, binds registration state to the exact start-request `Authorization` header, and consumes it once.

Authentication start returns `{ options, state }` and must work before login. Authentication verification emits `credential`, verifies the assertion, emits `counter-update` for non-zero counters, and issues tokens through `POST /<key>/authentication/verify`.

Return `true` from `counter-update` only after an atomic compare-and-update succeeds. Always-zero authenticators skip that event.

These are the only four passkey routes; there is no `POST /<key>/authenticate` alias. The five fields other than `stateTtl` are required, and its default is 300 seconds.

Application code owns credential persistence. See [Passkey provider](/passkey-provider) for the complete setup.

---

## Define profiles

`defineProfiles` preserves a map of Standard Schema validators while inferring the profile union.

```ts
type ProfileSchema = Record<string, StandardSchemaV1>

type ProfilePayload<Schema extends ProfileSchema> = {
  [Type in keyof Schema & string]: {
    properties: StandardSchemaV1.InferOutput<Schema[Type]>
    type: Type
  }
}[keyof Schema & string]

function defineProfiles<Schema extends ProfileSchema>(
  profiles: Schema
): Schema
```

`ProfileFactory`, `ProfilePayload`, `ProfileResolver`, `ProfileSchema`, and `ProviderIdentity` are type exports from both `aurelian` and `aurelian/profiles`. `ProfileProperties` is exported only from `aurelian/profiles`.

The `aurelian/profiles` subpath also exposes `validateProfile(profile, profiles)`. It resolves to `{ profile, profileId }`, where `profile.properties` is the validator's output and `profileId` is that output's string `id`.

---

## Resolve identities

```ts
type ProfileResolver<
  Providers extends Record<string, unknown>,
  Profiles extends ProfileSchema
> = (input: {
  profile: ProfileFactory<Profiles>
  request: Request
  response: {
    data: ProviderIdentity
    provider: keyof Providers & string
  }
}) =>
  | ProfilePayload<Profiles>
  | Promise<ProfilePayload<Profiles>>
```

`ProfileFactory` accepts one configured profile key and that schema's inferred output. The result is validated immediately before token creation.

---

## Create a client

Use `createClient` as optional convenience over the HTTP contract. Follow [HTTP routes](/routes) when you need to manage browser navigation, PKCE, requests, and token verification directly.

```ts
type CreateClientOptions = {
  audience?: string | string[]
  fetch?: typeof fetch
  issuer: string
  redirectURI?: string
  storage?: OAuthStorage
}

const client = createClient<unknown>({
  issuer: 'https://auth.example.com/auth',
  redirectURI: 'https://app.example.com/auth/callback'
})
```

The returned object exposes these methods:

```ts
type ClientMethods<Profile> = {
  authenticate<Body>(provider: string, body: Body): Promise<TokenResponse>
  authorize(input: AuthorizeOptions): Promise<AuthorizeResult>
  exchange(input: {
    code: string
    codeVerifier?: string
    redirectURI: string
  }): Promise<TokenResponse>
  handleCallback(input?: { url?: string | URL }): Promise<TokenResponse>
  refresh(input: { refreshToken: string }): Promise<TokenResponse>
  revoke(input: { refreshToken: string }): Promise<void>
  verify(accessToken: string): Promise<VerifyResult<Profile>>
}
```

`authenticate`, `exchange`, `handleCallback`, and `refresh` resolve to `TokenResponse`; `authorize` resolves to `AuthorizeResult`; `revoke` resolves to `void`; `verify` resolves to `VerifyResult<Profile>`.

The `createClient` value is the default client return URI. Passing `authorize({ redirectURI })` overrides it for that authorization request.

One of those values must be present when `authorize` runs. Otherwise, the client throws `oauth_redirect_uri_required` before storing transaction data.

The low-level `exchange` type makes `codeVerifier` optional, but the server `/token` route requires a string and otherwise returns `400 code_verifier_required`.

---

## Configure OAuth helpers

```ts
type AuthorizeOptions = {
  provider: string
  redirectURI?: string
  scopes?: string[]
  state?: string
}

type OAuthStorage = {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

type AuthorizeResult = {
  state: string
  url: URL
}
```

`authorize` creates PKCE internally and returns only `state` and `url`. It uses configured storage or `globalThis.sessionStorage` and stores one JSON transaction record containing the verifier and redirect URI under `aurelian:<issuer>:oauth:<state>`.

The selected URI is sent as `redirect_uri` in the authorization request. The client rejects a state when that transaction key already exists.

`handleCallback` reads and removes the single record before checking provider errors, then sends its stored URI and verifier during exchange. This preserves the exact URI selected when authorization began.

---

## Use routes

Paths are beneath the normalized issuer path.

| Method | Path | Input | Success |
| --- | --- | --- | --- |
| Provider-defined | `/:provider/*` | Router-defined request | Router-defined response |
| `POST` | `/token` | `{ code, codeVerifier, redirectURI }` | `TokenResponse` |
| `POST` | `/token/refresh` | `{ refreshToken }` | `TokenResponse` |
| `POST` | `/token/revoke` | `{ refreshToken }` | `{ revoked: true }` |
| `GET` | `/.well-known/jwks.json` | None | `{ keys: JWK[] }` |

Authorization scope is one space-delimited string limited to 2,048 characters. Callback code is limited to 4,096 characters, and state must contain 1–512 characters.

Built-in OAuth routers define `GET /authorize` and `GET /callback`, while credentials, code, password, and passkey define the routes listed in [HTTP routes](/routes). Register `${issuer}/${providerKey}/callback` with an upstream provider; send the client return URI to `/:provider/authorize`.

State and authorization codes are consumed before later validation or provider work. Review [Security](/security) before implementing custom storage or low-level exchange.

---

## Read token data

```ts
type TokenResponse = {
  accessToken: string
  expiresIn: number
  refreshToken: string
  tokenType: 'Bearer'
}

type Session<Profile> = {
  createdAt: number
  expiresAt: number
  id: string
  profile: Profile
  provider: string
}
```

Session timestamps are whole Unix seconds. `expiresIn` is the shorter of the configured access TTL and remaining session lifetime.

```ts
type AccessTokenClaims<Profile> = JWTPayload & {
  profile: Profile
  sid: string
  typ: 'access'
}

type VerifyResult<Profile> =
  | {
      claims: AccessTokenClaims<Profile>
      profile: Profile
      valid: true
    }
  | {
      reason: 'token_invalid'
      valid: false
    }
```

`sub` is the validated profile ID; `iss`, `iat`, `nbf`, `exp`, and `jti` are set for every token. `aud` is present only when configured.

---

## Implement storage

```ts
type StorageAdapter = {
  consume(key: string): Promise<string | null>
  set(
    key: string,
    value: string,
    options: { ttl: number }
  ): Promise<void>
}
```

`consume` returns and deletes one string, or returns `null`. `StorageAdapter` is exported from `aurelian/storage`.

`memoryStorage()` from `aurelian/storage/memory` and `cloudflareKVStorage(namespace)` from `aurelian/storage/cloudflare-kv` both return `StorageAdapter`. The Cloudflare factory and `CloudflareKVNamespace` type are also exported from `aurelian/storage`.

The Cloudflare adapter throws a `RangeError` when `options.ttl` is below 60 seconds because Workers KV requires at least 60 seconds.

Workers KV cannot atomically read and delete, so its adapter does not provide strict replay protection. Use Durable Objects or other strongly consistent storage where replay protection matters.

---

## Handle error responses

Every handled route error has this shape:

```ts
type ErrorResponse = {
  error: {
    code: string
    message: string
    status: number
  }
  meta: {
    requestId: string
  }
}
```

The response also sets `x-request-id`. See [Errors](/errors) for codes and client-thrown errors.

---

## Import shared types

The root exports `AccessTokenClaims`, `Auth`, `CreateAuthOptions`, `IssueInput`, `OAuthFlow`, `Provider`, `ProviderEnvironment`, `ProviderLifecycle`, `Session`, `TokenResponse`, and `VerifyResult`. It also exports the profile types listed above.

`aurelian/client` exports `AuthorizeOptions`, `AuthorizeResult`, `CreateClientOptions`, `OAuthStorage`, `TokenResponse`, and `VerifyResult`. Use `import type` for every type-only import.

Provider subpaths export their factory-specific types: `CodeOptions` and `CodeProvider`; `CredentialsOptions`; `DiscordOptions`; `GitHubOptions`; `GoogleOptions`; `OAuthIdentityInput` and `OAuthOptions`; and `OIDCOptions`.

The password subpath exports `PasswordAccount`, `PasswordHasher`, `PasswordOptions`, `PasswordProviderEvent`, and `PasswordProviderResult`. The passkey subpath exports `PasskeyCredential`, `PasskeyOptions`, `PasskeyProvider`, `PasskeyProviderEvent`, `PasskeyProviderResult`, `PasskeyRegistrationUser`, and `PasskeyState`; the Twitch subpath exports `TwitchOptions`.

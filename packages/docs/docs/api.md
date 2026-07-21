---
title: API reference
description: Review every public export, route, and contract
---

## Choose an export

| Export path | Runtime values |
| --- | --- |
| `aurelian` | `createAuth`, `defineProfiles` |
| `aurelian/client` | `createClient`, `createPKCEChallenge` |
| `aurelian/providers/google` | `google` |
| `aurelian/profiles` | `defineProfiles`, `validateProfile` |
| `aurelian/server` | `createAuth` |
| `aurelian/storage` | `cloudflareKVStorage` |
| `aurelian/storage/cloudflare-kv` | `cloudflareKVStorage` |
| `aurelian/storage/memory` | `memoryStorage` |

The package also exports `aurelian/package.json`. All JavaScript entry points are ESM.

---

## Create the server

`createAuth(options)` returns an `Auth<ProfilePayload<Profiles>>` object. Required options are shown without application values.

```ts
type CreateAuthOptions<
  Providers extends Record<string, Provider>,
  Profiles extends ProfileSchema
> = {
  access?: {
    audience?: string | string[];
    claims?(input: {
      profile: ProfilePayload<Profiles>;
      session: Session<ProfilePayload<Profiles>>;
    }): Record<string, unknown> | Promise<Record<string, unknown>>;
    ttl?: number;
  };
  issuer: string;
  onError?(
    error: unknown,
    context: { request: Request; requestId: string }
  ): void | Promise<void>;
  profiles: Profiles;
  providers: Providers;
  redirectURIs?:
    | readonly string[]
    | ((
        redirectURI: string,
        request: Request
      ) => boolean | Promise<boolean>);
  refresh?: {
    resolve?(input: {
      profile: ProfilePayload<Profiles>;
      provider: string;
      request?: Request;
    }):
      | ProfilePayload<Profiles>
      | null
      | Promise<ProfilePayload<Profiles> | null>;
    ttl?: number;
  };
  resolve: ProfileResolver<Providers, Profiles>;
  signing: {
    algorithm?: string;
    keyId?: string;
    privateKey: string;
    publicKey: string;
  };
  storage: StorageAdapter;
};
```

`access.ttl` defaults to 600 seconds, `refresh.ttl` defaults to 2,592,000 seconds, and `signing.algorithm` defaults to `RS256`. Both TTLs must be positive safe integers.

`issuer` must be HTTPS except for loopback HTTP, and its query and fragment are discarded. `redirectURIs` is required for usable OAuth authorization because the default allows none.

---

## Call server methods

```ts
type Auth<Profile> = {
  handler(request: Request): Promise<Response>;
  issue(input: {
    profile: Profile;
    provider: string;
  }): Promise<TokenResponse>;
  jwks(): Promise<{ keys: JWK[] }>;
  refresh(input: {
    refreshToken: string;
    request?: Request;
  }): Promise<TokenResponse | null>;
  revoke(input: { refreshToken: string }): Promise<void>;
  verify(accessToken: string): Promise<VerifyResult<Profile>>;
};
```

`handler` catches internal errors and returns the standard JSON error shape. Direct methods reject on operational or validation errors; `refresh` returns `null` for malformed, missing, expired, consumed, wrong-issuer, or application-rejected tokens.

`issue` validates the profile and creates a normal refresh session. `jwks` returns one public signing JWK for the configured key.

---

## Define providers

```ts
type ProviderIdentity = {
  avatarUrl?: string;
  email?: string;
  emailVerified?: boolean;
  id: string;
  name?: string;
  raw?: unknown;
  username?: string;
};

type RequestProvider = {
  authenticate(input: {
    request: Request;
  }): ProviderIdentity | null | Promise<ProviderIdentity | null>;
  type: 'request';
};

type OAuthProvider = {
  authorizationUrl(input: {
    callbackURL: string;
    request: Request;
    scopes?: string[];
    state: string;
  }): URL | Promise<URL>;
  callback(input: {
    callbackURL: string;
    code: string;
    request: Request;
    state: string;
  }): ProviderIdentity | Promise<ProviderIdentity>;
  type: 'oauth';
};

type Provider = OAuthProvider | RequestProvider;
```

Provider map keys may contain letters, numbers, `.`, `_`, `~`, and `-`. A request provider returns `null` for expected authentication failure; an OAuth callback must return an identity or throw.

---

## Configure Google

Import the factory and its options from the dedicated provider entry point.

```ts
import { google } from 'aurelian/providers/google'
import type { GoogleOptions } from 'aurelian/providers/google'

type GoogleOptions = {
  clientId: string
  clientSecret: string
  scopes?: string[]
}

const options: GoogleOptions = {
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!
}

const provider = google(options)
```

`google(options)` returns an `OAuthProvider` and requires non-empty credentials. Register `${issuer}/callback/<provider-key>` with Google; for a `google` map key, use `${issuer}/callback/google`.

Authorization always includes the `openid`, `email`, and `profile` scopes. Configured `GoogleOptions.scopes` and request-level authorization scopes are merged with these defaults and deduplicated.

The callback exchanges the code and requests the OIDC UserInfo endpoint with the access token. A valid string `sub` becomes `ProviderIdentity.id`; optional `email`, `email_verified`, `name`, and `picture` map to `email`, `emailVerified`, `name`, and `avatarUrl`, while the full response is retained as `raw`.

---

## Define profiles

`defineProfiles` preserves a map of Standard Schema validators while inferring the profile union.

```ts
type ProfileSchema = Record<string, StandardSchemaV1>;

type ProfilePayload<Schema extends ProfileSchema> = {
  [Type in keyof Schema & string]: {
    properties: StandardSchemaV1.InferOutput<Schema[Type]>;
    type: Type;
  };
}[keyof Schema & string];

function defineProfiles<Schema extends ProfileSchema>(
  profiles: Schema
): Schema;
```

`ProfileFactory`, `ProfilePayload`, `ProfileResolver`, `ProfileSchema`, and `ProviderIdentity` are type exports from both `aurelian` and `aurelian/profiles`. `ProfileProperties` is exported only from `aurelian/profiles`.

The `aurelian/profiles` subpath also exposes `validateProfile(profile, profiles)`. It resolves to `{ profile, profileId }`, where `profileId` is the validated output's string `id`; the returned `profile` remains the original input object.

---

## Resolve identities

```ts
type ProfileResolver<
  Providers extends Record<string, unknown>,
  Profiles extends ProfileSchema
> = (input: {
  profile: ProfileFactory<Profiles>;
  request: Request;
  response: {
    data: ProviderIdentity;
    provider: keyof Providers & string;
  };
}) =>
  | ProfilePayload<Profiles>
  | Promise<ProfilePayload<Profiles>>;
```

`ProfileFactory` accepts one configured profile key and that schema's inferred output. The result is validated immediately before token creation.

---

## Create a client

```ts
type CreateClientOptions = {
  audience?: string | string[];
  fetch?: typeof fetch;
  issuer: string;
  redirectURI?: string;
  storage?: OAuthStorage;
};

const client = createClient<unknown>({
  issuer: 'https://auth.example.com/auth'
});
```

The returned object exposes these methods:

```ts
type ClientMethods<Profile> = {
  authenticate<Body>(provider: string, body: Body): Promise<TokenResponse>;
  authorize(input: AuthorizeOptions): Promise<AuthorizeResult>;
  exchange(input: {
    code: string;
    codeVerifier?: string;
    redirectURI: string;
  }): Promise<TokenResponse>;
  handleCallback(input?: { url?: string | URL }): Promise<TokenResponse>;
  refresh(input: { refreshToken: string }): Promise<TokenResponse>;
  revoke(input: { refreshToken: string }): Promise<void>;
  verify(accessToken: string): Promise<VerifyResult<Profile>>;
};
```

`authenticate`, `exchange`, `handleCallback`, and `refresh` resolve to `TokenResponse`; `authorize` resolves to `AuthorizeResult`; `revoke` resolves to `void`; `verify` resolves to `VerifyResult<Profile>`.

---

## Configure OAuth helpers

```ts
type AuthorizeOptions = {
  provider: string;
  redirectURI?: string;
  scopes?: string[];
  state?: string;
};

type OAuthStorage = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
};

type PKCEChallenge = {
  challenge: string;
  method: 'S256';
  verifier: string;
};

type AuthorizeResult = {
  challenge: PKCEChallenge;
  state: string;
  url: URL;
};
```

`createPKCEChallenge()` resolves to `PKCEChallenge`. `authorize` uses configured storage or `globalThis.sessionStorage`, stores verifier and redirect URI by state, and rejects a state whose transaction keys already exist.

---

## Use routes

Paths are beneath the normalized issuer path.

| Method | Path | Input | Success |
| --- | --- | --- | --- |
| `GET` | `/authorize/:provider` | `redirect_uri`, `state?`, `scope?`, `code_challenge`, `code_challenge_method=S256` | `302` to provider |
| `GET` | `/callback/:provider` | `code`, provider `state` | `302` to allowed client URI |
| `POST` | `/authenticate/:provider` | Provider-defined request | `TokenResponse` |
| `POST` | `/token` | `{ code, codeVerifier, redirectURI }` | `TokenResponse` |
| `POST` | `/token/refresh` | `{ refreshToken }` | `TokenResponse` |
| `POST` | `/token/revoke` | `{ refreshToken }` | `{ revoked: true }` |
| `GET` | `/.well-known/jwks.json` | None | `{ keys: JWK[] }` |

Authorization scope is one space-delimited string limited to 2,048 characters. Callback code is limited to 4,096 characters, and state must contain 1–512 characters.

State and authorization codes are consumed before later validation or provider work. Review [Security](/security) before implementing custom storage or low-level exchange.

---

## Read token data

```ts
type TokenResponse = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  tokenType: 'Bearer';
};

type Session<Profile> = {
  createdAt: number;
  expiresAt: number;
  id: string;
  profile: Profile;
  provider: string;
};
```

Session timestamps are whole Unix seconds. `expiresIn` is the shorter of the configured access TTL and remaining session lifetime.

```ts
type AccessTokenClaims<Profile> = JWTPayload & {
  profile: Profile;
  sid: string;
  typ: 'access';
};

type VerifyResult<Profile> =
  | {
      claims: AccessTokenClaims<Profile>;
      profile: Profile;
      valid: true;
    }
  | {
      reason: 'token_invalid';
      valid: false;
    };
```

`sub` is the validated profile ID; `iss`, `iat`, `nbf`, `exp`, and `jti` are set for every token. `aud` is present only when configured.

---

## Implement storage

```ts
type StorageAdapter = {
  consume<Value>(key: string): Promise<Value | null>;
  set<Value>(
    key: string,
    value: Value,
    options: { ttl: number }
  ): Promise<void>;
};
```

`consume` must atomically return and delete one value. `StorageAdapter` is exported from `aurelian/storage`.

```ts
type CloudflareKVNamespace = {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number }
  ): Promise<void>;
};

type CloudflareKVStorageOptions = {
  dangerouslyAllowNonAtomicConsume: true;
  namespace: CloudflareKVNamespace;
};
```

Both Cloudflare types are exported from `aurelian/storage` and `aurelian/storage/cloudflare-kv`. `memoryStorage` is available only from `aurelian/storage/memory`.

---

## Handle error responses

Every handled route error has this shape:

```ts
type ErrorResponse = {
  error: {
    code: string;
    message: string;
    status: number;
  };
  meta: {
    requestId: string;
  };
};
```

The response also sets `x-request-id`. See [Errors](/errors) for codes and client-thrown errors.

---

## Import shared types

The root exports `AccessTokenClaims`, `Auth`, `CreateAuthOptions`, `IssueInput`, `OAuthProvider`, `Provider`, `RequestProvider`, `Session`, `TokenResponse`, and `VerifyResult`. It also exports the profile types listed above.

`aurelian/client` exports `AuthorizeOptions`, `AuthorizeResult`, `CreateClientOptions`, `OAuthStorage`, `PKCEChallenge`, `TokenResponse`, and `VerifyResult`. Use `import type` for every type-only import.

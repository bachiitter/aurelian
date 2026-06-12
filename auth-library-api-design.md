# Auth Library API Design

A TypeScript auth library for Hono-based applications.

The library provides:

- Auth server via `createAuth`
- Client SDK via `createClient`
- Provider-based authentication
- App-owned user management
- JWT access tokens
- Refresh tokens backed by storage adapters
- KV-compatible session storage
- Hono integration

---

## Core Idea

The library does **not** manage users.

The application owns:

- users
- accounts
- teams
- organizations
- roles
- permissions
- billing state
- password hashes
- profile data
- account-linking rules

The auth library owns:

- provider flows
- auth codes
- sessions
- refresh tokens
- access tokens
- token verification
- token exchange
- token revocation

Flow:

```txt
provider -> identity -> profile -> session -> tokens
```

---

## Public Package Shape

```txt
@acme/auth
├─ createAuth()
├─ defineProfiles()
├─ createClient()
│
├─ providers
│  ├─ google()
│  ├─ github()
│  ├─ emailPassword()
│  ├─ magicLink()
│  └─ emailCode()
│
├─ storage
│  ├─ redisStorage()
│  ├─ upstashStorage()
│  ├─ cloudflareKVStorage()
│  └─ memoryStorage()
│
└─ hono
   └─ authMiddleware()
```

---

## Server API

```ts
import { createAuth } from "@acme/auth";
import {
  google,
  github,
  emailPassword,
  magicLink,
  emailCode,
} from "@acme/auth/providers";
import { redisStorage } from "@acme/auth/storage/redis";

export const auth = createAuth({
  profiles,

  storage: redisStorage({
    url: process.env.REDIS_URL!,
  }),

  providers: {
    google: google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    github: github({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),

    password: emailPassword({
      verify: async ({ email, password }) => {
        const user = await db.user.findByEmail(email);

        if (!user) return null;

        const valid = await verifyPassword(password, user.passwordHash);

        if (!valid) return null;

        return {
          id: user.email,
          email: user.email,
          emailVerified: user.emailVerified,
        };
      },
    }),

    magic: magicLink({
      send: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "Sign in",
          html: `<a href="${url}">Sign in</a>`,
        });
      },
    }),

    code: emailCode({
      send: async ({ email, code }) => {
        await sendEmail({
          to: email,
          subject: "Your login code",
          text: `Your code is ${code}`,
        });
      },
    }),
  },

  identify: async ({ provider, identity, profile }) => {
    const account = await db.account.findByProvider({
      provider,
      providerAccountId: identity.id,
    });

    if (account) {
      return profile("user", {
        id: account.userId,
      });
    }

    if (!identity.email || !identity.emailVerified) {
      throw new Error("email_required");
    }

    const user = await db.user.findByEmail(identity.email);

    if (!user) {
      throw new Error("user_not_found");
    }

    await db.account.create({
      userId: user.id,
      provider,
      providerAccountId: identity.id,
      email: identity.email,
    });

    return profile("user", {
      id: user.id,
    });
  },

  tokens: {
    access: {
      ttl: "10m",

      extend: async ({ profile }) => {
        if (profile.type !== "user") return {};

        return {
          roles: await db.roles.forUser(profile.properties.id),
        };
      },
    },

    refresh: {
      ttl: "30d",
      rotate: true,
      reuseDetection: true,
    },
  },
});
```

---

## Hono Integration

```ts
import { Hono } from "hono";
import { auth } from "./auth";

const app = new Hono();

app.route("/auth", auth.handler());

export default app;
```

This exposes routes such as:

```txt
GET  /auth/authorize/:provider
GET  /auth/callback/:provider

POST /auth/password/login

POST /auth/magic/send
GET  /auth/magic/verify

POST /auth/code/send
POST /auth/code/verify

POST /auth/token
POST /auth/token/refresh
POST /auth/token/revoke

GET  /auth/.well-known/jwks.json
```

---

## Profiles

Profiles describe the authenticated identity that the app returns after provider login.

```ts
import { defineProfiles } from "@acme/auth";
import { object, string, array, optional } from "valibot";

export const profiles = defineProfiles({
  user: object({
    id: string(),
  }),

  service: object({
    id: string(),
    name: string(),
  }),
});
```

The app maps provider identity to a profile:

```ts
identify: async ({ provider, identity, profile }) => {
  const user = await resolveUser(provider, identity);

  return profile("user", {
    id: user.id,
  });
};
```

The library does not know what a user is. It only receives a typed profile.

---

## Provider Identity

Providers return identity information only.

```ts
export interface ProviderIdentity {
  id: string;

  email?: string;
  emailVerified?: boolean;

  username?: string;
  name?: string;
  avatarUrl?: string;

  raw?: unknown;
}
```

Example Google identity:

```ts
{
  id: googleClaims.sub,
  email: googleClaims.email,
  emailVerified: googleClaims.email_verified,
  name: googleClaims.name,
  avatarUrl: googleClaims.picture,
  raw: googleClaims,
}
```

Example GitHub identity:

```ts
{
  id: String(githubUser.id),
  email: primaryEmail.email,
  emailVerified: primaryEmail.verified,
  username: githubUser.login,
  name: githubUser.name,
  avatarUrl: githubUser.avatar_url,
  raw: githubUser,
}
```

---

## Profile Object

```ts
export interface IdentityProfile<
  Type extends string = string,
  Properties extends Record<string, unknown> = Record<string, unknown>,
> {
  type: Type;
  properties: Properties;
}
```

Example:

```ts
profile("user", {
  id: "user_123",
});
```

Produces:

```ts
{
  type: "user",
  properties: {
    id: "user_123",
  },
}
```

---

## Token Design

The app should not manually return reserved JWT claims.

The library owns:

- `iss`
- `sub`
- `aud`
- `iat`
- `exp`
- `nbf`
- `jti`
- `sid`

The app may extend tokens with custom claims.

```ts
tokens: {
  access: {
    extend: async ({ profile, session }) => {
      return {
        roles: ["admin"],
      };
    },
  },
}
```

Example access token payload:

```json
{
  "iss": "https://auth.example.com",
  "sub": "user_123",
  "sid": "sess_123",
  "jti": "jwt_123",
  "typ": "access",
  "iat": 1710000000,
  "exp": 1710000600,
  "profile": {
    "type": "user",
    "properties": {
      "id": "user_123"
    }
  },
  "roles": ["admin"]
}
```

---

## Issuer URL

`issuer` is optional.

```ts
const auth = createAuth({
  storage,
  providers,
  identify,
});
```

By default, the library can infer the issuer from the incoming request origin.

```ts
const url = new URL(request.url);
const issuer = `${url.protocol}//${url.host}`;
```

Users may configure it manually when needed:

```ts
const auth = createAuth({
  issuer: "https://auth.example.com",
  storage,
  providers,
  identify,
});
```

Or dynamically:

```ts
const auth = createAuth({
  issuer: (request) => {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  },

  storage,
  providers,
  identify,
});
```

---

## Client API

```ts
import { createClient } from "@acme/auth/client";

export const authClient = createClient({
  issuer: "https://auth.example.com",
  audience: "https://api.example.com",
});
```

Verify an access token:

```ts
const result = await authClient.verify(accessToken);

if (!result.valid) {
  throw new Error(result.reason);
}

console.log(result.profile);
```

Exchange authorization code:

```ts
const result = await authClient.exchange({
  code,
  redirectURI: "https://app.example.com/callback",
  codeVerifier,
});
```

Refresh tokens:

```ts
const result = await authClient.refresh({
  refreshToken,
});
```

Revoke tokens:

```ts
await authClient.revoke({
  refreshToken,
});
```

---

## Hono Middleware

```ts
import { authMiddleware } from "@acme/auth/hono";

app.use(
  "/api/*",
  authMiddleware({
    client: authClient,
  }),
);
```

Then access the verified profile:

```ts
app.get("/api/me", (c) => {
  const auth = c.get("auth");

  return c.json({
    profile: auth.profile,
  });
});
```

Typed Hono usage:

```ts
type Env = {
  Variables: {
    auth: {
      profile: {
        type: "user";
        properties: {
          id: string;
        };
      };
      claims: {
        roles?: string[];
      };
    };
  };
};

const app = new Hono<Env>();
```

---

## Storage Adapter

The storage adapter should be small and KV-compatible.

```ts
export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;

  set<T>(
    key: string,
    value: T,
    options?: {
      ttl?: number;
    },
  ): Promise<void>;

  delete(key: string): Promise<void>;

  compareAndSet?<T>(
    key: string,
    expected: T | null,
    next: T,
    options?: {
      ttl?: number;
    },
  ): Promise<boolean>;
}
```

This supports:

- Redis
- Upstash Redis
- Cloudflare KV
- Memory
- Deno KV
- Bun SQLite-backed KV
- custom adapters

---

## Session Shape

```ts
export interface Session {
  id: string;

  profileType: string;
  profileId: string;

  provider: string;

  refreshTokenHash: string;

  userAgentHash?: string;
  ipHash?: string;

  createdAt: number;
  updatedAt: number;
  expiresAt: number;

  revokedAt?: number;
  rotatedAt?: number;

  metadata?: Record<string, unknown>;
}
```

---

## Storage Key Layout

```txt
auth:session:{sessionId}
auth:refresh:{refreshTokenHash}
auth:code:{authorizationCodeHash}
auth:magic:{magicTokenHash}
auth:email-code:{email}:{codeHash}
auth:state:{stateHash}
```

---

## Refresh Tokens

Refresh tokens should be opaque.

```txt
rt_01hz7v8em4j9tfsc4prv5x7vew_8UOrKcVnrZrXy...
```

Only the hash is stored.

```ts
const refreshTokenHash = await hashToken(refreshToken);
```

Refresh config:

```ts
tokens: {
  refresh: {
    ttl: "30d",
    rotate: true,
    reuseDetection: true,
  },
}
```

---

## Provider API

```ts
export interface Provider {
  id: string;
  type: "oauth" | "credentials" | "email";
}
```

OAuth provider:

```ts
export interface OAuthProvider extends Provider {
  type: "oauth";

  authorizationUrl(input: {
    state: string;
    codeChallenge?: string;
    redirectURI: string;
    scopes?: string[];
  }): Promise<URL>;

  callback(input: {
    code: string;
    state: string;
    redirectURI: string;
    request: Request;
  }): Promise<ProviderIdentity>;
}
```

Credentials provider:

```ts
export interface CredentialsProvider extends Provider {
  type: "credentials";

  verify(input: {
    email: string;
    password: string;
    request: Request;
  }): Promise<ProviderIdentity | null>;
}
```

Email provider:

```ts
export interface EmailProvider extends Provider {
  type: "email";

  send(input: {
    email: string;
    request: Request;
  }): Promise<void>;

  verify(input: {
    email: string;
    code?: string;
    token?: string;
    request: Request;
  }): Promise<ProviderIdentity | null>;
}
```

---

## Built-in Providers

### Google

```ts
google({
  clientId: string;
  clientSecret: string;
  scopes?: string[];
});
```

### GitHub

```ts
github({
  clientId: string;
  clientSecret: string;
  scopes?: string[];
});
```

### Email Password

```ts
emailPassword({
  verify: (input: {
    email: string;
    password: string;
    request: Request;
  }) => Promise<ProviderIdentity | null>;
});
```

### Magic Link

```ts
magicLink({
  ttl?: string;

  send: (input: {
    email: string;
    url: string;
    token: string;
    request: Request;
  }) => Promise<void>;
});
```

### Email Code

```ts
emailCode({
  ttl?: string;
  length?: number;

  send: (input: {
    email: string;
    code: string;
    request: Request;
  }) => Promise<void>;
});
```

---

## Full Example

```ts
import { Hono } from "hono";
import { createAuth, defineProfiles } from "@acme/auth";
import {
  google,
  github,
  emailPassword,
  magicLink,
  emailCode,
} from "@acme/auth/providers";
import { redisStorage } from "@acme/auth/storage/redis";
import { object, string } from "valibot";

const profiles = defineProfiles({
  user: object({
    id: string(),
  }),
});

const auth = createAuth({
  profiles,

  storage: redisStorage({
    url: process.env.REDIS_URL!,
  }),

  providers: {
    google: google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    github: github({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),

    password: emailPassword({
      verify: async ({ email, password }) => {
        const user = await db.user.findByEmail(email);

        if (!user) return null;

        const valid = await verifyPassword(password, user.passwordHash);

        if (!valid) return null;

        return {
          id: user.email,
          email: user.email,
          emailVerified: true,
        };
      },
    }),

    magic: magicLink({
      send: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "Sign in",
          html: `<a href="${url}">Sign in</a>`,
        });
      },
    }),

    code: emailCode({
      send: async ({ email, code }) => {
        await sendEmail({
          to: email,
          subject: "Your login code",
          text: code,
        });
      },
    }),
  },

  identify: async ({ provider, identity, profile }) => {
    const account = await db.account.findByProvider({
      provider,
      providerAccountId: identity.id,
    });

    if (account) {
      return profile("user", {
        id: account.userId,
      });
    }

    if (!identity.email || !identity.emailVerified) {
      throw new Error("email_required");
    }

    const user = await db.user.findByEmail(identity.email);

    if (!user) {
      throw new Error("user_not_found");
    }

    await db.account.create({
      userId: user.id,
      provider,
      providerAccountId: identity.id,
      email: identity.email,
    });

    return profile("user", {
      id: user.id,
    });
  },

  tokens: {
    access: {
      ttl: "10m",

      extend: async ({ profile }) => {
        if (profile.type !== "user") return {};

        return {
          roles: await db.roles.forUser(profile.properties.id),
        };
      },
    },

    refresh: {
      ttl: "30d",
      rotate: true,
      reuseDetection: true,
    },
  },
});

const app = new Hono();

app.route("/auth", auth.handler());

export default app;
```

---

## Recommended Public API

```ts
createAuth()
defineProfiles()
createClient()

google()
github()
emailPassword()
magicLink()
emailCode()

redisStorage()
upstashStorage()
cloudflareKVStorage()
memoryStorage()

auth.handler()
auth.issue()
auth.verify()
auth.refresh()
auth.revoke()
```

---

## Main Design Rule

The app owns users.

The library owns auth state.

```txt
Application:
  user/account database

Auth library:
  provider flows, sessions, tokens, refresh, verification
```

The only bridge between them is:

```ts
identify: async ({ provider, identity, profile }) => {
  return profile("user", {
    id: user.id,
  });
}
```

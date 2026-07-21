---
title: Providers
description: Implement request and OAuth identity verification flows
---

## Choose a flow

Use a request provider when one incoming request contains enough proof, such as a password, API credential, TOTP assertion, or passkey assertion. Use an OAuth provider when authentication redirects through an external authorization server.

Both return `ProviderIdentity`; neither returns an Aurelian profile. The shared `resolve` callback performs the application account lookup.

---

## Implement request authentication

Parse untrusted input, verify it with application code, and return `null` for an expected rejection.

```ts
import type { RequestProvider } from 'aurelian';
import { verifyUserPassword } from '~/users.js';

async function readCredentials(request: Request): Promise<{
  email: string;
  password: string;
} | null> {
  const value: unknown = await request.json().catch(() => null);

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  if (
    !('email' in value) ||
    typeof value.email !== 'string' ||
    !('password' in value) ||
    typeof value.password !== 'string'
  ) {
    return null;
  }

  return { email: value.email, password: value.password };
}

export const passwordProvider: RequestProvider = {
  async authenticate({ request }) {
    const credentials = await readCredentials(request);

    if (!credentials) {
      return null;
    }

    const user = await verifyUserPassword(
      credentials.email,
      credentials.password
    );

    if (!user) {
      return null;
    }

    return {
      email: user.email,
      emailVerified: user.emailVerified,
      id: user.id
    };
  },
  type: 'request'
};
```

The application-owned verifier returns `{ email: string; emailVerified: boolean; id: string } | null`. A `null` result becomes `401 authentication_failed`; an exception reaches `onError` and becomes `500 internal_server_error`.

---

## Implement OAuth

Build the upstream authorization URL and exchange its callback code for a normalized identity. This focused example uses GitHub's documented endpoints without hiding response validation.

```ts
import type { OAuthProvider } from 'aurelian';

type GitHubToken = {
  accessToken: string;
};

type GitHubUser = {
  avatarUrl?: string;
  id: number;
  login: string;
  name?: string;
};

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function parseGitHubToken(value: unknown): GitHubToken | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('access_token' in value) ||
    typeof value.access_token !== 'string'
  ) {
    return null;
  }

  return { accessToken: value.access_token };
}

function parseGitHubUser(value: unknown): GitHubUser | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'number' ||
    !('login' in value) ||
    typeof value.login !== 'string'
  ) {
    return null;
  }

  return {
    avatarUrl:
      'avatar_url' in value && typeof value.avatar_url === 'string'
        ? value.avatar_url
        : undefined,
    id: value.id,
    login: value.login,
    name:
      'name' in value && typeof value.name === 'string'
        ? value.name
        : undefined
  };
}

export const githubProvider: OAuthProvider = {
  authorizationUrl({ callbackURL, scopes, state }) {
    const url = new URL('https://github.com/login/oauth/authorize');

    url.searchParams.set(
      'client_id',
      getRequiredEnvironmentVariable('GITHUB_CLIENT_ID')
    );
    url.searchParams.set('redirect_uri', callbackURL);
    url.searchParams.set('scope', scopes?.join(' ') ?? 'read:user');
    url.searchParams.set('state', state);

    return url;
  },
  async callback({ callbackURL, code }) {
    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        body: new URLSearchParams({
          client_id: getRequiredEnvironmentVariable('GITHUB_CLIENT_ID'),
          client_secret: getRequiredEnvironmentVariable('GITHUB_CLIENT_SECRET'),
          code,
          redirect_uri: callbackURL
        }),
        headers: { accept: 'application/json' },
        method: 'POST'
      }
    );
    const token = parseGitHubToken(await tokenResponse.json());

    if (!tokenResponse.ok || !token) {
      throw new Error('github_token_exchange_failed');
    }

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token.accessToken}`
      }
    });
    const user = parseGitHubUser(await userResponse.json());

    if (!userResponse.ok || !user) {
      throw new Error('github_identity_failed');
    }

    return {
      avatarUrl: user.avatarUrl,
      id: String(user.id),
      name: user.name,
      raw: user,
      username: user.login
    };
  },
  type: 'oauth'
};
```

Register `${issuer}/callback/github` with GitHub. The client return URL is different and is validated by Aurelian before this provider runs.

---

## Configure Google

Create OAuth web credentials in Google Cloud. `clientId` and `clientSecret` are required non-empty strings, and the optional `scopes` array adds scopes to every authorization request.

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { createClient } from 'aurelian/client'
import { google } from 'aurelian/providers/google'
import type { GoogleOptions } from 'aurelian/providers/google'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

declare const privateKey: string
declare const publicKey: string

const googleOptions: GoogleOptions = {
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly']
}

const profiles = defineProfiles({
  user: z.object({
    email: z.email().optional(),
    id: z.string().min(1)
  })
})

const auth = createAuth({
  issuer: 'https://auth.example.com/auth',
  profiles,
  providers: { google: google(googleOptions) },
  redirectURIs: ['https://app.example.com/auth/callback'],
  resolve({ profile, response }) {
    return profile('user', {
      email: response.data.email,
      id: response.data.id
    })
  },
  signing: {
    algorithm: 'ES256',
    privateKey,
    publicKey
  },
  storage: memoryStorage()
})

const client = createClient({
  issuer: 'https://auth.example.com/auth',
  redirectURI: 'https://app.example.com/auth/callback'
})

const authorization = await client.authorize({
  provider: 'google',
  scopes: ['https://www.googleapis.com/auth/drive.file']
})

globalThis.location.assign(authorization.url)
```

Register `https://auth.example.com/auth/callback/google` as an authorized redirect URI in Google Cloud. It is `${issuer}/callback/google`, not the client return URL in `redirectURIs`.

The provider always requests `openid`, `email`, and `profile`. It merges defaults first, then `GoogleOptions.scopes`, then scopes passed to `createClient.authorize`, removing duplicates while preserving first occurrence.

Google redirects to Aurelian with an authorization code. The provider exchanges it at Google's token endpoint with `grant_type=authorization_code` and the same callback URI, then calls the OIDC UserInfo endpoint with the returned bearer access token.

UserInfo `sub` is required and becomes `id`. Optional `email`, `email_verified`, `name`, and `picture` become `email`, `emailVerified`, `name`, and `avatarUrl`; the complete response remains in `raw`.

Missing credentials throw `google_client_id_required` or `google_client_secret_required` during configuration. Failed or malformed upstream responses throw `google_token_exchange_failed` or `google_identity_failed`; through `auth.handler`, these become a correlated `500 internal_server_error`.

If Google returns no authorization code, Aurelian responds at its provider callback with `400 callback_invalid`. It does not redirect that upstream denial to the client return URL.

---

## Allow client redirects

Prefer an exact allowlist for known clients.

```ts
const auth = createAuth({
  issuer: 'https://auth.example.com/auth',
  profiles,
  providers: { google: google(googleOptions) },
  redirectURIs: ['https://app.example.com/auth/callback'],
  resolve,
  signing,
  storage
});
```

For dynamic tenants, pass `(redirectURI: string, request: Request) => boolean | Promise<boolean>` and parse the URL before checking an application-owned registration table. Do not accept suffix matches, reflected origins, or arbitrary localhost URLs in production.

---

## Complete OAuth

Use `createClient.authorize` and `handleCallback` so state and PKCE stay paired in browser transaction storage. For the `google` key, the sequence is `/authorize/google` → `/callback/google` → client return URL → `/token`.

State lasts 10 minutes and authorization codes last 5 minutes. Both are single-use only when the adapter's `consume` is atomic.

---

## Test both paths

For request providers, test malformed JSON, invalid credentials, success, resolver rejection, and verifier exceptions. For OAuth, test exact callback URLs, scope forwarding, upstream failures, state replay, wrong provider state, redirect mismatch, wrong verifier, and code replay.

Continue with [Client](/client), [Security](/security), [Profiles](/profiles), and [Errors](/errors).

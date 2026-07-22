---
title: Runtime
description: Deploy on standards-based JavaScript server environments
---

## Meet requirements

Aurelian is an ESM package that uses `Request`, `Response`, `URL`, `fetch`, Web Crypto, and `TextEncoder`. Its runtime dependencies are `jose`, `@standard-schema/spec`, and `@simplewebauthn/server`.

Choose a runtime that implements those web APIs. The library does not depend on Node HTTP objects, cookies, a database client, or a framework.

---

## Configure production

Set `issuer` to the exact public HTTPS mount URL, including a path such as `/auth`. Only loopback hosts may use HTTP.

Load PEM signing keys from a secret manager and use an algorithm that matches the keys. Set `access.audience`, use a strongly consistent shared adapter, and require OAuth clients to supply HTTP(S) return URIs.

---

## Mount once

Forward the original request to `auth.handler` for the issuer path. Keeping the public origin and path intact avoids proxy ambiguity.

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
      return auth.handler(request)
    }

    return new Response('Not found', { status: 404 })
  }
}
```

Read [Mounting](/mounting) for CORS and request-ID handling.

---

## Scale storage

All instances must share refresh, OAuth state, authorization-code, and one-time proof storage. Passkey state and application credential data must also be shared through the callbacks configured on those providers.

Process-local memory fails after restart and cannot coordinate multiple instances.

Use a strongly consistent backend with atomic consume semantics. On Cloudflare, route records to a Durable Object and consume them in a storage transaction rather than using eventually consistent Workers KV.

---

## Rotate signing keys

One `createAuth` instance publishes one public JWK. Replacing its key immediately removes the old key from JWKS, so access tokens signed by the previous key can no longer be verified remotely.

Plan rotation around the access TTL or place a JWKS layer that serves overlapping keys. Aurelian does not manage multi-key rotation for you.

---

## Check deployment

Probe `GET /.well-known/jwks.json` beneath the issuer and confirm the returned key has the configured `alg`, `kid`, and `use: 'sig'`. Run one request-provider flow, one OAuth flow, refresh rotation, revocation, and adapter concurrency against the deployed environment.

Log unexpected errors through `onError` with request IDs, but never log tokens or credentials. Review [Security](/security) and [Storage](/storage) before launch.

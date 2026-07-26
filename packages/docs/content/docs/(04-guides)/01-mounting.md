---
title: Mounting
description: Forward standard requests at the public issuer
---

## Use the handler

`auth.handler` accepts a standard `Request` and resolves to a standard `Response`. Connect it to a standards-based runtime entry point.

---

## Match the issuer

Set `issuer` to the exact public URL where auth routes are reachable. For `https://auth.example.com/auth`, forward `/auth/*` and keep `/auth` in the public URL.

Aurelian recognizes the issuer origin and path, then routes the remaining suffix internally. A proxy that changes the host or protocol must restore the public URL before the request reaches the handler.

---

## Forward requests

Pass the original request through a standards-based fetch entry point. Import the configured `auth` instance created with the same issuer.

```ts
import { auth } from './auth.js';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
      return auth.handler(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
```

Do not reconstruct the request unless the host requires it. Forwarding preserves provider headers, request IDs, origins, bodies, and the public path.

---

## Add cross-origin access

Handle CORS in the host when a browser client uses another origin. Allow only the application origin, required methods, and provider headers.

```ts
import { auth } from './auth.js';

const APP_ORIGIN = 'https://app.example.com';

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set('access-control-allow-origin', APP_ORIGIN);
  headers.set('vary', 'origin');

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');

  if (origin && origin !== APP_ORIGIN) {
    return new Response('Forbidden', { status: 403 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-origin': APP_ORIGIN,
        vary: 'origin'
      },
      status: 204
    });
  }

  return addCorsHeaders(await auth.handler(request));
}
```

Apply CORS only to the auth path and reject unexpected origins. CORS does not replace HTTP(S) return URI validation, one-time provider state, or S256 PKCE.

---

## Preserve replay protection

All instances must share storage for OAuth state, authorization codes, and refresh records. The adapter's `consume` operation must atomically return and delete one value.

Process-local memory is suitable only for development and tests. Review [Storage](/storage) before adding replicas or deploying to an eventually consistent backend.

---

## Trace failures

Every handler response includes `x-request-id`. A supplied value of at most 128 characters is preserved; longer or missing values are replaced.

Configure `onError` when creating `auth` to report unexpected provider, resolver, storage, and signing errors. Follow the concrete reporting contract in [Errors](/errors#report-internal-failures), and never log credentials, codes, or tokens.

---

## Verify routing

Probe `GET /auth/.well-known/jwks.json`, one provider route, and an unknown auth route through the deployed public URL. Confirm issuer claims, callback URLs, CORS preflights, and request-ID propagation through every proxy.

Continue with [Runtime](/runtime), [Client](/client), and the [API reference](/api#use-routes).

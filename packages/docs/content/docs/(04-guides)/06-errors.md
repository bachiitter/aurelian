---
title: Errors
description: Handle failures without exposing internal details
---

## Read route errors

Handled route failures return JSON with a stable shape and include the same request ID in `x-request-id`.

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

A supplied `x-request-id` is preserved when it is at most 128 characters. Otherwise, Aurelian generates one.

---

## Map expected failures

| Status | Codes |
| --- | --- |
| `400` | `redirect_uri_invalid`, `state_invalid`, `code_challenge_invalid`, `scope_invalid`, `callback_invalid`, `token_request_invalid`, `authorization_code_invalid`, `code_verifier_required`, `code_verifier_invalid`, `refresh_request_invalid`, `revoke_request_invalid` |
| `401` | `authentication_failed`, `refresh_token_invalid` |
| `404` | `route_not_found` |
| `500` | `internal_server_error` |

Provider exceptions, resolver failures, invalid profile output, storage errors, and signing errors become `internal_server_error` when they pass through `handler`. Direct methods such as `issue` and `refresh` reject instead because they do not use the route wrapper.

Unknown provider keys, paths, and methods fall through to `route_not_found`. Custom provider routers may return their own error responses for routes they handle.

The Google factory throws `google_client_id_required` or `google_client_secret_required` during configuration. Its callback throws `google_token_exchange_failed` or `google_identity_failed`; handler routes report either callback failure as `500 internal_server_error` and pass the original error to `onError`.

An upstream OAuth denial that returns no code reaches `/:provider/callback` as `400 callback_invalid`. The current handler does not forward that denial to the client return URL.

---

## Report internal failures

Use `onError` for structured server-side reporting. A failure inside this callback is ignored so reporting cannot replace the auth response.

```ts
import { createAuth } from 'aurelian';
import { reportAuthError } from '~/observability/auth-errors.js';

const auth = createAuth({
  async onError(error, { request, requestId }) {
    await reportAuthError({
      error,
      method: request.method,
      requestId,
      url: request.url
    });
  },
  issuer,
  profiles,
  providers,
  resolve,
  signing,
  storage
});
```

`reportAuthError` is application-owned and should accept `{ error: unknown; method: string; requestId: string; url: string }`. Do not include request bodies, credentials, tokens, or provider secrets.

---

## Handle client failures

Client token methods intentionally expose coarse errors: `token_request_failed`, `token_response_invalid`, and `token_revoke_failed`. OAuth helpers may also throw `oauth_redirect_uri_required`, `oauth_storage_required`, `oauth_state_in_use`, `oauth_callback_invalid`, `oauth_state_invalid`, or `oauth_provider_error`.

Use route responses directly when the UI needs a specific server code. Otherwise, show a generic sign-in failure and correlate logs with the response request ID.

---

## Test failure paths

Test an unknown provider, malformed body, rejected credentials, disallowed redirect, missing PKCE, replayed state, wrong verifier, reused refresh token, resolver exception, and storage exception. Assert status, error code, and request-ID propagation.

Use [API](/api) for route contracts and [Security](/security) for failure-boundary guidance.

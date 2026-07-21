# Aurelian Hono Example

Runnable example with a Hono auth server and a browser client that imports `aurelian/client`.

## Run

```sh
pnpm --filter aurelian build
pnpm --filter aurelian-examples dev
```

The auth server listens on `http://localhost:3000`, mounts Aurelian at `/auth`, and serves the browser client from `http://localhost:5173`.

Use `pnpm --filter aurelian-examples start` to run only the auth server without watch mode.

## Sign in

Use the local request provider credentials:

```text
Email: demo@example.com
Password: password
```

## Client Flows

- Password authentication uses `authClient.authenticate('password', body)` and posts to `/auth/authenticate/password`.
- Token verification uses `authClient.verify(accessToken)` in the browser.

The example generates an ephemeral ES256 key pair and uses process-local storage on startup. The docs quick start loads stable PEM files and explains the production storage requirements.

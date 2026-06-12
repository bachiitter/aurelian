# Aurelian Client + Hono Example

Runnable example with a Hono auth server and a browser client that imports `aurelian/client`.

## Run

```sh
pnpm --filter aurelian build
pnpm --filter aurelian-examples dev
```

The auth server listens on `http://localhost:3000`.
The browser client runs on `http://localhost:5173`.

Use `pnpm --filter aurelian-examples start` to run only the auth server without watch mode.

## Environment

Google OAuth is optional. Set these before using the Google button:

```sh
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Client Flows

- Google uses `authClient.authorize({ pkce: true })`, stores the verifier in `localStorage`, then exchanges the callback code with `authClient.exchange(...)`.
- Password submits directly from the browser to `POST /auth/password/callback`.
- Email code submits directly from the browser to `POST /auth/code/authorize`, then verifies with `POST /auth/code/callback`.
- Token verification uses `authClient.verify(accessToken)` in the browser.

Password and code UIs live on the client. Providers only send/verify credentials through provider endpoints.

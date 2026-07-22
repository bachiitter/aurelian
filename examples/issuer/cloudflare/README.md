# Cloudflare Issuer

Cloudflare Worker using Aurelian with Durable Object storage.

```sh
pnpm dev
```

The first run generates ignored local signing keys. Use these demo credentials:

```text
Email: demo@example.com
Password: password
```

To enable Google, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.dev.vars`, then register `http://localhost:8787/auth/google/callback` as the provider callback.

The code provider returns its six-digit value only for local development. Passkeys require `localhost` or HTTPS.

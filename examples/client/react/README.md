# React Client

React SPA using `aurelian/client`.

```sh
pnpm dev
```

The app expects the Cloudflare issuer at `http://localhost:8787/auth`. It demonstrates credentials, code, optional Google OAuth, passkey, verify, refresh, and revoke flows.

Set `VITE_GOOGLE_ENABLED=true` when the issuer has Google credentials configured.

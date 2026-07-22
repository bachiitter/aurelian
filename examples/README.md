# Examples

Examples are split into clients and issuers. Any client can use any issuer.

```text
examples/
├── client/
│   └── react/
└── issuer/
    └── cloudflare/
```

From the repository root:

```sh
pnpm install
pnpm --filter aurelian build
pnpm dev:examples
```

Open `http://localhost:5173`. The Cloudflare issuer runs at `http://localhost:8787`.

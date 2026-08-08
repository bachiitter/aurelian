# Aurelian

Just another auth library. Server-side auth primitives with first-class providers for OAuth, OIDC, passkeys, passwords, and one-time codes.

> **Experimental.** `0.1.0` ships under the `experimental` npm dist-tag. The API is not stable yet.

## Install

```sh
pnpm add aurelian
```

## Quick start

```ts
import { createAuth, defineProfiles } from 'aurelian'
import { github } from 'aurelian/providers/github'
import { memoryStorage } from 'aurelian/storage/memory'
import { z } from 'zod'

const profiles = defineProfiles({
  user: z.object({
    id: z.string().min(1),
    username: z.string().min(1)
  })
})

const auth = createAuth({
  issuer: 'https://auth.example.com/auth',
  profiles,
  providers: {
    github: github({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET
    })
  },
  resolve({ profile, response }) {
    return profile('user', { id: response.data.id, username: response.data.username })
  },
  signing: {
    privateKey: process.env.AUTH_PRIVATE_KEY,
    publicKey: process.env.AUTH_PUBLIC_KEY
  },
  storage: memoryStorage()
})

export default { fetch: auth.handler }
```

Exchanges tokens with `createClient` from `aurelian/client` or by calling the issuer routes directly.

## Providers

| Export path | Provider |
| --- | --- |
| `aurelian/providers/github` | `github` |
| `aurelian/providers/google` | `google` |
| `aurelian/providers/discord` | `discord` |
| `aurelian/providers/twitch` | `twitch` |
| `aurelian/providers/oauth` | `oauth` |
| `aurelian/providers/oidc` | `oidc` |
| `aurelian/providers/passkey` | `passkey` |
| `aurelian/providers/password` | `password`, `pbkdf2PasswordHasher` |
| `aurelian/providers/code` | `code` |

## Storage

`StorageAdapter` is a key-value consume-and-delete contract with TTLs. Three adapters ship with the package:

| Export path | Adapter | Notes |
| --- | --- | --- |
| `aurelian/storage/memory` | `memoryStorage()` | Process-local, development only |
| `aurelian/storage/cloudflare-kv` | `cloudflareKVStorage(namespace)` | No atomic consume; not strict replay-safe |
| `aurelian/storage/sqlite` | `sqliteStorage({ db })` | Single-node, prepare-compatible SQLite clients |

In production, use strongly consistent storage with atomic `consume` semantics so OAuth state, codes, and refresh tokens cannot be replayed.

## Documentation

See [https://aurelian.dev](https://aurelian.dev) for the full docs: architecture, security model, provider flows, and API reference.

## License

[MIT](LICENSE)
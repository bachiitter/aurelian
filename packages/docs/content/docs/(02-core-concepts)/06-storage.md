---
title: Storage
description: Persist short-lived strings with clear replay guarantees
---

## Follow the contract

Import `StorageAdapter` from `aurelian/storage`. Values are always strings, and TTLs are relative seconds.

```ts
import type { StorageAdapter } from 'aurelian/storage'

type StorageAdapter = {
  consume(key: string): Promise<string | null>
  set(
    key: string,
    value: string,
    options: { ttl: number }
  ): Promise<void>
}
```

`consume` returns and deletes one unexpired string, or returns `null` when it is missing or expired. Implement it atomically when the backend supports atomic read-and-delete.

---

## Know stored records

Aurelian serializes its own records before calling the adapter. Core keys start with `aurelian:state:`, `aurelian:code:`, or `aurelian:refresh:`.

One-time proof keys use `aurelian:provider:<provider-key>:code:<identifier-hash>`, and their values contain only the hash of the six-digit value. Password and passkey state use `aurelian:provider:<provider-key>:password:<state-hash>` and `aurelian:provider:<provider-key>:passkey:<state-hash>`.

Password records hold registration or reset state, while passkey records hold WebAuthn challenges and registration identity. The adapter owns persistence, expiry, availability, consistency, and consumption behavior for every Aurelian-managed record.

---

## Use memory locally

Import the process-local adapter from its dedicated entry point.

```ts
import { memoryStorage } from 'aurelian/storage/memory'
import type { StorageAdapter } from 'aurelian/storage'

const storage: StorageAdapter = memoryStorage()
```

`memoryStorage()` returns `StorageAdapter` and consumes synchronously within one JavaScript process. Values disappear on restart and are not shared across processes or isolates.

Use it for local development and single-process tests, not distributed deployments.

---

## Use Workers KV

Import the Workers KV adapter and namespace type from the Cloudflare KV entry point.

```ts
import { cloudflareKVStorage } from 'aurelian/storage/cloudflare-kv'
import type {
  CloudflareKVNamespace,
  StorageAdapter
} from 'aurelian/storage'

export function createStorage(
  namespace: CloudflareKVNamespace
): StorageAdapter {
  return cloudflareKVStorage(namespace)
}
```

`cloudflareKVStorage(namespace)` returns the same `StorageAdapter` type and maps TTLs to Workers KV expiration. `cloudflareKVStorage` and `CloudflareKVNamespace` are also exported from `aurelian/storage`.

The adapter throws a `RangeError` when `options.ttl` is below 60 seconds because Workers KV requires at least 60 seconds.

Workers KV cannot atomically read and delete, so this adapter does not provide strict replay protection. Use a Durable Object or other strongly consistent storage where replay protection matters.

---

## Choose strong consistency

OAuth state, authorization codes, refresh tokens, one-time proofs, password registration/reset state, and passkey challenges are single-use `StorageAdapter` records. Password and passkey providers create and consume their transient records internally.

Use transactional SQL, a suitable atomic key-value operation, or Cloudflare Durable Object storage when concurrent replay must have one winner. Application-owned account hashes and passkey credentials belong in your normal database, not this transient adapter.

Return `null` only for missing or expired records. Let backend failures reject so `auth.handler` can report a correlated `500 internal_server_error`.

---

## Test behavior

Test overwrite, expiry, one successful consume, a second `null`, TTL units, and backend failures. Run concurrent consumes against the deployed topology before claiming strict replay protection.

Continue with [Custom storage](/custom-storage) and [Security](/security).

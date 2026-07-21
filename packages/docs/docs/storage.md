---
title: Storage
description: Persist short-lived records with clear replay guarantees
---

## Understand the contract

Import `StorageAdapter` from `aurelian/storage`. It exposes only `set` and `consume`.

```ts
import type { StorageAdapter } from 'aurelian/storage'

declare const storage: StorageAdapter

await storage.set('key', { value: 1 }, { ttl: 300 })
const value = await storage.consume<{ value: number }>('key')
```

`ttl` is a relative lifetime in seconds. `consume<Value>` must atomically return and delete an unexpired value, or return `null` when it is missing or expired.

---

## Know what is stored

Aurelian writes OAuth state for 10 minutes, authorization codes for 5 minutes, and refresh records for the remaining refresh-session lifetime. Keys use a SHA-256 hash of each secret and start with `aurelian:state:`, `aurelian:code:`, or `aurelian:refresh:`.

Aurelian chooses keys, values, and TTLs. The adapter owns persistence, expiry enforcement, serialization, availability, consistency, and atomic consumption.

---

## Use memory locally

`memoryStorage` is a shipped, process-local implementation with a dedicated import.

```ts
import { memoryStorage } from 'aurelian/storage/memory'

const storage = memoryStorage()
```

It stores values without serialization, deletes expired entries during writes, and returns expired entries as `null` during consume. A consume reads and deletes synchronously before its promise resolves, so concurrent calls in one JavaScript process have one winner.

Values disappear on restart and are not shared across processes or isolates. Use this adapter for local development and single-process tests, not production or distributed replay protection.

---

## Opt into Workers KV

`cloudflareKVStorage`, `CloudflareKVNamespace`, and `CloudflareKVStorageOptions` are shipped from `aurelian/storage/cloudflare-kv`. The function and both types are also re-exported from `aurelian/storage`.

```ts
import { cloudflareKVStorage } from 'aurelian/storage/cloudflare-kv'
import type {
  CloudflareKVNamespace,
  CloudflareKVStorageOptions
} from 'aurelian/storage/cloudflare-kv'

declare const AUTH_KV: CloudflareKVNamespace

const options: CloudflareKVStorageOptions = {
  dangerouslyAllowNonAtomicConsume: true,
  namespace: AUTH_KV
}

const storage = cloudflareKVStorage(options)
```

The unsafe flag is a required TypeScript opt-in; the implementation does not inspect it at runtime. The namespace needs compatible `get`, `put`, and `delete` methods, so a Workers KV binding can be passed directly.

---

## Accept weaker guarantees

The KV adapter performs `get` and then `delete`. That sequence is **not atomic**, and Workers KV is eventually consistent, so concurrent requests or different locations can consume the same state, code, or refresh record more than once.

Use it only where that replay risk is explicitly acceptable. Choose a strongly consistent transactional service, Durable Object, or atomic key-value command when strict single use matters.

---

## Respect KV limits

Writes use `JSON.stringify` and reads use `JSON.parse`. Values therefore lose non-JSON types and must not contain unsupported values or cycles; top-level values that stringify to `undefined` are rejected.

The adapter rejects TTLs below 60 seconds because Workers KV requires `expirationTtl >= 60`. Parse failures and namespace errors reject rather than becoming `null`.

---

## Propagate failures

Return `null` only for missing or expired records. Let serialization and backend failures reject so `auth.handler` can call `onError` and return a correlated `500 internal_server_error`.

Direct `auth.refresh`, `auth.revoke`, and `auth.issue` calls are not wrapped by the handler and reject with the storage error. See [Custom storage](/custom-storage) for a production adapter.

---

## Test behavior

Test set and consume, a second consume returning `null`, TTL units, expiry boundaries, serialization, and backend failures. Run simultaneous consumes against the real deployment topology and require exactly one winner for any adapter claiming atomic behavior.

Also run OAuth state replay, authorization-code replay, and refresh rotation against that adapter. Continue with [Security](/security) and [Runtime](/runtime).

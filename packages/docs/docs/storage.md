---
title: Storage
description: Persist rotating credentials and one-time transaction state
---

## Understand the contract

A storage adapter has only `set` and `consume`. TTLs are positive seconds, and `consume` must return and delete one value atomically.

```ts
import type { StorageAdapter } from 'aurelian/storage';

type StorageContract = StorageAdapter;
```

Aurelian stores OAuth state for 10 minutes, authorization codes for 5 minutes, and refresh records for the configured session TTL. Keys contain a SHA-256 hash of the secret rather than the secret itself.

---

## Use memory locally

Import the process-local adapter from its dedicated export.

```ts
import { memoryStorage } from 'aurelian/storage/memory';

const storage = memoryStorage();
```

Values disappear on restart, and separate processes do not share the map. Use it for tests and local development only.

---

## Choose production storage

Use a strongly consistent backend with a native read-and-delete operation or a transaction that locks one key. Redis `GETDEL`, a database `DELETE` with `RETURNING`, or an equivalent conditional transaction can satisfy the contract.

Do not build `consume` as an unprotected `get` followed by `delete`. Two requests can read the same value before either deletion finishes.

---

## Opt into Workers KV

The bundled adapter makes its weaker behavior explicit.

```ts
import { cloudflareKVStorage } from 'aurelian/storage/cloudflare-kv';

const storage = cloudflareKVStorage({
  dangerouslyAllowNonAtomicConsume: true,
  namespace: env.AUTH_KV
});
```

Define `env.AUTH_KV` as a binding with `get`, `put`, and `delete` methods matching `CloudflareKVNamespace`. Workers KV is eventually consistent and the adapter uses `get` followed by `delete`, so concurrent requests can consume one record more than once.

KV `expirationTtl` has a 60-second minimum, and the adapter rejects shorter values. Stored values must serialize to JSON.

---

## Handle failures

Let storage errors reject so `auth.handler` can call `onError` and return a correlated `500`. Do not convert a backend outage into `null`, because that makes an operational failure look like an invalid token.

Expired values must behave like missing values. Validate TTLs and serialization before writing when the backend does not do it reliably.

---

## Test guarantees

Test one successful consume, a second `null`, concurrent consumption, expiry, serialization failure, backend failure, and large refresh TTLs. Run those tests against the actual production service and topology.

Continue with [Custom storage](/custom-storage), [Sessions](/sessions), [Security](/security), and [Runtime](/runtime).

---
title: Custom storage
description: Build atomic persistence for production auth records
---

## Define operations

Keep vendor details behind an application-owned interface. Its consume operation must delete and return one unexpired row in one database statement or transaction.

```ts
type AtomicDatabase = {
  deleteUnexpiredReturning(key: string): Promise<string | null>
  setWithExpiry(input: {
    expiresAt: Date
    key: string
    value: string
  }): Promise<void>
}

declare const database: AtomicDatabase
```

This interface is illustrative, not shipped by Aurelian. Implement it with parameterized queries and a unique constraint on `key`.

---

## Use one statement

A transactional SQL backend can make deletion the only consumption read path.

```sql
DELETE FROM auth_records
WHERE key = $1
  AND expires_at > CURRENT_TIMESTAMP
RETURNING value;
```

Do not implement consume as a separate `SELECT` followed by `DELETE`. Two transactions can otherwise return the same value.

---

## Implement the adapter

Serialize at the boundary and preserve backend errors. The generic assertion is unavoidable because the public contract lets the caller select `Value` without providing a runtime schema.

```ts
import type { StorageAdapter } from 'aurelian/storage'

function deserialize<Value>(serialized: string): Value {
  const value: unknown = JSON.parse(serialized)
  return value as Value
}

export const storage: StorageAdapter = {
  async consume<Value>(key: string): Promise<Value | null> {
    const serialized = await database.deleteUnexpiredReturning(key)

    if (serialized === null) {
      return null
    }

    return deserialize<Value>(serialized)
  },
  async set(key, value, { ttl }) {
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
      throw new RangeError('storage_ttl_invalid')
    }

    const serialized = JSON.stringify(value)

    if (serialized === undefined) {
      throw new TypeError('storage_value_not_serializable')
    }

    await database.setWithExpiry({
      expiresAt: new Date(Date.now() + ttl * 1000),
      key,
      value: serialized
    })
  }
}
```

Use the database clock for both write and consume when clock skew matters. Expired rows may remain for later cleanup, but consume must return `null` for them.

---

## Preserve semantics

Treat TTLs as seconds from the write and do not silently shorten them. Aurelian may pass large refresh-session TTLs, while OAuth state and code TTLs are 600 and 300 seconds.

Reject invalid values and operational failures. Returning `null` during an outage incorrectly turns a backend failure into an invalid or expired credential.

---

## Prove concurrency

Run this check against the actual backend and across separate application instances.

```ts
await storage.set('test:single-use', { id: 'value_1' }, { ttl: 300 })

const results = await Promise.all(
  Array.from({ length: 20 }, () =>
    storage.consume<{ id: string }>('test:single-use')
  )
)

if (results.filter((value) => value !== null).length !== 1) {
  throw new Error('consume_is_not_atomic')
}
```

Also test consume after expiry, overwrite behavior, malformed stored JSON, connection failures, and TTL boundaries. Then run complete OAuth and refresh flows to prove state, code, and refresh-token replay fail.

---

## Avoid weak substitutes

Redis `GETDEL`, a conditional transaction, or `DELETE ... RETURNING` can satisfy the contract when deployed with strong consistency. Confirm actual service semantics rather than relying on a command name alone.

The shipped Cloudflare KV adapter cannot meet the atomic contract and requires an unsafe opt-in. Review [Storage](/storage) and [Security](/security) before deployment.

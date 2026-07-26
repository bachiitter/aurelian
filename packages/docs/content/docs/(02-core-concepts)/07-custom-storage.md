---
title: Custom storage
description: Build atomic persistence for production auth records
---

## Define operations

Keep vendor details behind an application-owned interface. Its consume operation must delete and return one unexpired string in one statement or transaction.

```ts
type AtomicDatabase = {
  deleteUnexpiredReturning(key: string): Promise<string | null>
  setWithExpiry(input: {
    expiresAt: Date
    key: string
    value: string
  }): Promise<void>
}
```

Implement this illustrative interface with parameterized queries and a unique constraint on `key`.

---

## Use one statement

A transactional SQL backend can make deletion the only consumption path.

```sql
DELETE FROM auth_records
WHERE key = $1
  AND expires_at > CURRENT_TIMESTAMP
RETURNING value;
```

Avoid a separate `SELECT` followed by `DELETE`. Two transactions could otherwise return the same value.

---

## Implement the adapter

Pass strings through unchanged and preserve backend errors.

```ts
import type { StorageAdapter } from 'aurelian/storage'

type AtomicDatabase = {
  deleteUnexpiredReturning(key: string): Promise<string | null>
  setWithExpiry(input: {
    expiresAt: Date
    key: string
    value: string
  }): Promise<void>
}

export function createStorage(database: AtomicDatabase): StorageAdapter {
  return {
    consume(key) {
      return database.deleteUnexpiredReturning(key)
    },
    async set(key, value, { ttl }) {
      if (!Number.isSafeInteger(ttl) || ttl <= 0) {
        throw new RangeError('storage_ttl_invalid')
      }

      await database.setWithExpiry({
        expiresAt: new Date(Date.now() + ttl * 1000),
        key,
        value
      })
    }
  }
}
```

Use the database clock for writes and consumption when clock skew matters. Expired rows may remain for cleanup, but `consume` must return `null` for them.

---

## Preserve semantics

Treat TTLs as seconds from the write and do not silently shorten them. Aurelian may pass long refresh-session TTLs alongside short OAuth and provider records.

Reject operational failures instead of returning `null`. Otherwise an outage looks like an invalid or expired credential.

---

## Prove concurrency

Run this check against the actual backend from separate application instances.

```ts
import type { StorageAdapter } from 'aurelian/storage'

export async function testAtomicConsume(
  storage: StorageAdapter
): Promise<void> {
  await storage.set('test:single-use', 'value_1', { ttl: 300 })

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      storage.consume('test:single-use')
    )
  )

  if (results.filter((value) => value !== null).length !== 1) {
    throw new Error('consume_is_not_atomic')
  }
}
```

Also test expiry, overwrite behavior, connection failures, and TTL boundaries. Then run complete OAuth and refresh flows to verify replay fails.

---

## Avoid weak substitutes

Redis `GETDEL`, a conditional transaction, or `DELETE ... RETURNING` can satisfy the contract when deployed with strong consistency. Confirm the service's real consistency guarantees.

Workers KV cannot atomically read and delete. Prefer a Durable Object or another strongly consistent backend where replay protection matters.

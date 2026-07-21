---
title: Custom storage
description: Implement atomic persistence for production auth state
---

## Define database operations

Keep the Aurelian adapter small and put vendor calls behind an application-owned interface.

```ts
type AtomicKeyValueDatabase = {
  deleteReturning(key: string): Promise<string | null>;
  setWithExpiry(
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<void>;
};
```

`deleteReturning` must delete and return one row in a single statement or locked transaction. `setWithExpiry` must make expired values unavailable even when background cleanup is delayed.

---

## Implement the adapter

Validate JSON at the boundary and preserve the generic return contract.

```ts
import type { StorageAdapter } from 'aurelian/storage';
import { database } from '~/database/atomic-key-values.js';

function parseStoredValue<Value>(serialized: string): Value {
  const value: unknown = JSON.parse(serialized);

  return value as Value;
}

export const storage: StorageAdapter = {
  async consume<Value>(key: string): Promise<Value | null> {
    const serialized = await database.deleteReturning(key);

    if (serialized === null) {
      return null;
    }

    return parseStoredValue<Value>(serialized);
  },
  async set(key, value, { ttl }) {
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
      throw new RangeError('ttl_invalid');
    }

    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new TypeError('storage_value_not_serializable');
    }

    await database.setWithExpiry(key, serialized, ttl);
  }
};
```

`database` implements the interface above. The generic cast is the adapter's deserialization boundary; callers choose `Value`, so runtime schema validation is impossible without changing the public storage contract.

---

## Use SQL atomically

A relational implementation can store `key`, serialized `value`, and `expires_at`, then delete and return only unexpired rows.

```sql
DELETE FROM auth_state
WHERE key = $1
  AND expires_at > CURRENT_TIMESTAMP
RETURNING value;
```

Use a unique or primary-key constraint on `key`. Parameterize the query and make the delete statement the only read path for consumption.

---

## Honor expiry

Interpret every TTL as seconds from the write. Do not round a refresh TTL down to zero or silently cap it below the configured session lifetime.

Expired rows may remain for cleanup, but `consume` must return `null` for them. Add an index or scheduled cleanup if stale rows could grow without bound.

---

## Test concurrency

Run multiple consumers at once and require one winner.

```ts
await storage.set('code', { id: 'code_123' }, { ttl: 300 });

const results = await Promise.all([
  storage.consume<{ id: string }>('code'),
  storage.consume<{ id: string }>('code'),
  storage.consume<{ id: string }>('code')
]);

expect(results.filter((value) => value !== null)).toHaveLength(1);
```

Repeat under the production database's normal isolation level and across separate application instances. Also test expiry at the database clock boundary and failures during set or consume.

---

## Avoid weak backends

The bundled Workers KV adapter cannot make read-and-delete atomic and may return stale values across locations. Use it only after accepting weaker replay protection through `dangerouslyAllowNonAtomicConsume: true`.

Prefer a Durable Object, transactional database, or Redis-compatible atomic command when OAuth and refresh replay must be prevented. Review [Security](/security) and [Testing](/testing) before deployment.

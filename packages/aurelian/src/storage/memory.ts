import type { StorageAdapter } from './types.js';

type StoredValue = {
  expiresAt: number;
  value: unknown;
};

export function memoryStorage(): StorageAdapter {
  const values = new Map<string, StoredValue>();

  return {
    async consume<Value>(key: string) {
      const stored = values.get(key);

      values.delete(key);

      if (!stored || stored.expiresAt <= Date.now()) {
        return null;
      }

      return stored.value as Value;
    },
    async set(key, value, options) {
      const now = Date.now();

      for (const [storedKey, stored] of values) {
        if (stored.expiresAt <= now) {
          values.delete(storedKey);
        }
      }

      values.set(key, {
        expiresAt: now + options.ttl * 1000,
        value,
      });
    },
  };
}

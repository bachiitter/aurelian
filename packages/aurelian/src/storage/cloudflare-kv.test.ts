import { describe, expect, it } from 'vitest';
import { cloudflareKVStorage } from './cloudflare-kv.js';

describe('cloudflareKVStorage', () => {
  it('serializes values and consumes them once in one location', async () => {
    const values = new Map<string, string>();
    const storage = cloudflareKVStorage({
      dangerouslyAllowNonAtomicConsume: true,
      namespace: {
        async delete(key) {
          values.delete(key);
        },
        async get(key) {
          return values.get(key) ?? null;
        },
        async put(key, value) {
          values.set(key, value);
        },
      },
    });

    await storage.set('session', { id: 'user_123' }, { ttl: 60 });

    expect(await storage.consume('session')).toEqual({ id: 'user_123' });
    expect(await storage.consume('session')).toBeNull();
  });
});

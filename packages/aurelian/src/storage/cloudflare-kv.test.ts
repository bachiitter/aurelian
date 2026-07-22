import { describe, expect, it } from 'vitest';
import { cloudflareKVStorage } from './cloudflare-kv.js';

describe('cloudflareKVStorage', () => {
  it('stores and consumes JSON values', async () => {
    const values = new Map<string, string>();
    const storage = cloudflareKVStorage({
      async delete(key) {
        values.delete(key);
      },
      async get(key) {
        return values.get(key) ?? null;
      },
      async put(key, value) {
        values.set(key, value);
      },
    });

    await storage.set('key', 'value', { ttl: 60 });

    await expect(storage.consume('key')).resolves.toBe('value');
    await expect(storage.consume('key')).resolves.toBeNull();
  });
});

import type { StorageAdapter } from './types.js';

export type CloudflareKVNamespace = {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
};

/** Workers KV cannot atomically consume values. Use consistent storage for replay protection. */
export function cloudflareKVStorage(
  namespace: CloudflareKVNamespace,
): StorageAdapter {
  return {
    async consume(key) {
      const value = await namespace.get(key);

      if (value === null) {
        return null;
      }

      await namespace.delete(key);
      return value;
    },
    async set(key, value, options) {
      if (options.ttl < 60) {
        throw new RangeError('Cloudflare KV requires a TTL of at least 60 seconds.');
      }

      await namespace.put(key, value, {
        expirationTtl: options.ttl,
      });
    },
  };
}

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

export type CloudflareKVStorageOptions = {
  dangerouslyAllowNonAtomicConsume: true;
  namespace: CloudflareKVNamespace;
};

/**
 * Workers KV cannot atomically read and delete a value. This adapter requires
 * an explicit opt-in because concurrent auth requests may consume a value more
 * than once. Use strongly consistent storage for strict replay protection.
 */
export function cloudflareKVStorage(
  options: CloudflareKVStorageOptions,
): StorageAdapter {
  return {
    async consume<Value>(key: string) {
      const value = await options.namespace.get(key);

      if (value === null) {
        return null;
      }

      await options.namespace.delete(key);

      return JSON.parse(value);
    },
    async set(key, value, storageOptions) {
      if (storageOptions.ttl < 60) {
        throw new RangeError('Cloudflare KV requires a TTL of at least 60 seconds.');
      }

      const serialized = JSON.stringify(value);

      if (serialized === undefined) {
        throw new TypeError('Cloudflare KV values must be JSON-serializable.');
      }

      await options.namespace.put(key, serialized, {
        expirationTtl: storageOptions.ttl,
      });
    },
  };
}

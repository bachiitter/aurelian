import { DurableObject } from 'cloudflare:workers';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { StorageAdapter } from 'aurelian/storage';

type StoredCredential = {
  counter: number;
  email: string;
  id: string;
  publicKey: number[];
  transports?: AuthenticatorTransportFuture[];
  userId: string;
};

type StoredValue<Value = unknown> = {
  expiresAt: number;
  value: Value;
};

export class AuthStorage extends DurableObject {
  async set(key: string, value: unknown, ttl: number): Promise<void> {
    await this.ctx.storage.put(key, {
      expiresAt: Date.now() + ttl * 1000,
      value,
    } satisfies StoredValue);
  }

  async getCredential(key: string): Promise<StoredCredential | null> {
    const stored = await this.ctx.storage.get<StoredValue<StoredCredential>>(key);

    if (!stored || stored.expiresAt <= Date.now()) {
      await this.ctx.storage.delete(key);
      return null;
    }

    return stored.value;
  }

  async consume(key: string): Promise<string | null> {
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get<StoredValue<string>>(key);

      if (!stored) {
        return null;
      }

      await transaction.delete(key);
      return stored.expiresAt > Date.now() ? stored.value : null;
    });
  }

  async updateCounter(
    key: string,
    credentialId: string,
    expected: number,
    next: number,
  ): Promise<boolean> {
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get<StoredValue<StoredCredential>>(key);

      if (
        !stored ||
        stored.expiresAt <= Date.now() ||
        stored.value.id !== credentialId ||
        stored.value.counter !== expected ||
        next < expected
      ) {
        return false;
      }

      await transaction.put(key, {
        ...stored,
        value: { ...stored.value, counter: next },
      } satisfies StoredValue);
      return true;
    });
  }
}

export function durableObjectStorage(
  namespace: DurableObjectNamespace<AuthStorage>,
): StorageAdapter {
  const storage = namespace.getByName('aurelian-auth');

  return {
    async consume(key) {
      return storage.consume(key);
    },
    async set(key, value, options) {
      await storage.set(key, value, options.ttl);
    },
  };
}

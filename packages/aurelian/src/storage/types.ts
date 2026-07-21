export type StorageAdapter = {
  /** Atomically returns and deletes a value. */
  consume<Value>(key: string): Promise<Value | null>;
  set<Value>(
    key: string,
    value: Value,
    options: { ttl: number },
  ): Promise<void>;
};

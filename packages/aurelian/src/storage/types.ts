export type StorageAdapter = {
  /** Returns and deletes a value. Use atomic storage for replay protection. */
  consume(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: { ttl: number },
  ): Promise<void>;
};

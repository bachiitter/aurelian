import type { StorageAdapter } from './types.js';

export type SQLiteDatabase = {
  exec?(sql: string): unknown;
  prepare(sql: string): SQLiteStatement;
};

export type SQLiteStatement = {
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): unknown;
};

export type SQLiteStorageOptions = {
  db: SQLiteDatabase;
  tableName?: string;
};

type StoredRow = {
  expires_at: number;
  value: string;
};

export function sqliteStorage(options: SQLiteStorageOptions): StorageAdapter {
  const tableName = options.tableName ?? 'aurelian_storage';

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error('sqlite_table_name_invalid');
  }

  options.db.exec?.(
    `CREATE TABLE IF NOT EXISTS ${tableName} (` +
      'key TEXT PRIMARY KEY, ' +
      'value TEXT NOT NULL, ' +
      'expires_at INTEGER NOT NULL' +
      ')',
  );

  const deleteExpired = options.db.prepare(`DELETE FROM ${tableName} WHERE expires_at <= ?`);
  const deleteKey = options.db.prepare(`DELETE FROM ${tableName} WHERE key = ?`);
  const get = options.db.prepare(`SELECT value, expires_at FROM ${tableName} WHERE key = ?`);
  const set = options.db.prepare(
    `INSERT INTO ${tableName} (key, value, expires_at) VALUES (?, ?, ?) ` +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
  );

  return {
    async consume(key) {
      const now = Date.now();
      const row = get.get(key);

      deleteKey.run(key);

      if (!isStoredRow(row) || row.expires_at <= now) {
        return null;
      }

      return row.value;
    },
    async set(key, value, setOptions) {
      const now = Date.now();

      deleteExpired.run(now);
      set.run(key, value, now + setOptions.ttl * 1000);
    },
  };
}

function isStoredRow(value: unknown): value is StoredRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'expires_at' in value &&
    typeof value.expires_at === 'number' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

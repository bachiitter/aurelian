import { describe, expect, it } from 'vitest';
import { sqliteStorage } from './sqlite.js';
import type { SQLiteDatabase, SQLiteStatement } from './sqlite.js';

type Row = {
  expires_at: number;
  value: string;
};

describe('sqliteStorage', () => {
  it('stores and atomically consumes values', async () => {
    const db = createTestDatabase();
    const storage = sqliteStorage({ db });

    await storage.set('key', 'value', { ttl: 60 });

    await expect(storage.consume('key')).resolves.toBe('value');
    await expect(storage.consume('key')).resolves.toBeNull();
  });

  it('rejects invalid table names', () => {
    expect(() => sqliteStorage({ db: createTestDatabase(), tableName: 'bad-name' })).toThrow(
      'sqlite_table_name_invalid',
    );
  });
});

function createTestDatabase(): SQLiteDatabase {
  const rows = new Map<string, Row>();

  return {
    exec() {},
    prepare(sql): SQLiteStatement {
      return {
        get(key) {
          if (!sql.startsWith('SELECT')) {
            return undefined;
          }

          return rows.get(String(key));
        },
        run(...values) {
          if (sql.startsWith('DELETE') && sql.includes('expires_at')) {
            const now = Number(values[0]);

            for (const [key, row] of rows) {
              if (row.expires_at <= now) {
                rows.delete(key);
              }
            }

            return;
          }

          if (sql.startsWith('DELETE')) {
            rows.delete(String(values[0]));
            return;
          }

          rows.set(String(values[0]), {
            expires_at: Number(values[2]),
            value: String(values[1]),
          });
        },
      };
    },
  };
}

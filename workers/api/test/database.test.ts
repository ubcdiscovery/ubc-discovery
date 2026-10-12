import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { ApiEnv } from '../src/env';

const clients = vi.hoisted(() => [] as {
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
}[]);

vi.mock('pg', () => ({
  Client: class {
    connect = vi.fn(async () => {});
    end = vi.fn(async () => {});
    query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    constructor() { clients.push(this); }
  },
}));

import { databaseConnectionString, withDatabase, withTransaction } from '../src/db';

const env = (settings: Partial<ApiEnv>): ApiEnv => settings as ApiEnv;

describe('request-scoped database connections', () => {
  it('prefers Hyperdrive for ordinary requests and the direct origin for publication', () => {
    const settings = env({
      DATABASE_URL: 'postgresql://localhost/app',
      DIRECT_DATABASE_URL: 'postgresql://localhost/direct',
      HYPERDRIVE: { connectionString: 'postgresql://localhost/hyperdrive' } as Hyperdrive,
    });
    expect(databaseConnectionString(settings)).toBe('postgresql://localhost/hyperdrive');
    expect(databaseConnectionString(settings, { direct: true })).toBe('postgresql://localhost/direct');
  });

  it('cannot silently route advisory-lock transactions through Hyperdrive', () => {
    const settings = env({
      DATABASE_URL: 'postgresql://localhost/fallback',
      HYPERDRIVE: { connectionString: 'postgresql://localhost/hyperdrive' } as Hyperdrive,
    });
    expect(() => databaseConnectionString(settings, { direct: true })).toThrow('Direct database connection is not configured');
    expect(databaseConnectionString(env({ DATABASE_URL: 'postgresql+asyncpg://localhost/app' }))).toBe('postgresql://localhost/app');
  });

  it('opens a new client for each request and closes it after success and failure', async () => {
    const settings = env({ DATABASE_URL: 'postgresql://localhost/app' });
    await expect(withDatabase(settings, async db => {
      await db.execute(sql`SELECT 1`);
      return 42;
    })).resolves.toBe(42);
    const first = clients.at(-1)!;
    const failure = new Error('request failed');
    await expect(withDatabase(settings, async () => { throw failure; })).rejects.toBe(failure);
    const second = clients.at(-1)!;
    expect(second).not.toBe(first);
    for (const client of [first, second]) {
      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.end).toHaveBeenCalledOnce();
    }
  });

  it('commits a successful transaction and rolls back a failed transaction before closing', async () => {
    const settings = env({ DATABASE_URL: 'postgresql://localhost/app' });
    await withDatabase(settings, db => withTransaction(db, async tx => { await tx.execute(sql`SELECT 1`); }));
    const committed = clients.at(-1)!;
    const queries = (client: typeof committed) => client.query.mock.calls.map(([query]) => typeof query === 'string' ? query : query.text);
    expect(queries(committed)).toEqual(['begin', 'SELECT 1', 'commit']);

    const failure = new Error('publication failed');
    await expect(withDatabase(settings, db => withTransaction(db, async () => { throw failure; }))).rejects.toBe(failure);
    const rolledBack = clients.at(-1)!;
    expect(queries(rolledBack)).toEqual(['begin', 'rollback']);
    expect(rolledBack.end).toHaveBeenCalledOnce();
  });
});

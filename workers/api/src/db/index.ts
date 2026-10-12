import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import type { ApiEnv } from '../env';
import * as schema from './schema';

export { schema };
export type Db = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export function databaseConnectionString(env: ApiEnv, options: { direct?: boolean } = {}): string {
  const url = options.direct
    ? env.DIRECT_DATABASE_URL ?? (env.HYPERDRIVE ? undefined : env.DATABASE_URL)
    : env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(options.direct ? 'Direct database connection is not configured' : 'Database connection is not configured');
  }
  // Existing Python deployments use this SQLAlchemy dialect URL spelling.
  return url.replace(/^postgresql\+asyncpg:/, 'postgresql:');
}

/** Clients cannot cross Workers request contexts; Hyperdrive supplies the shared pool. */
export async function withDatabase<T>(
  env: ApiEnv,
  callback: (db: Db) => Promise<T>,
  options: { direct?: boolean } = {},
): Promise<T> {
  const client = new Client({
    connectionString: databaseConnectionString(env, options),
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    return await callback(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

/** The callback must finish before leaving withDatabase, including on rollback. */
export async function withTransaction<T>(db: Db, callback: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(callback);
}

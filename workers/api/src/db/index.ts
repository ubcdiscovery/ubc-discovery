import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { ApiEnv } from "../env";
import * as schema from "./schema";

export { schema };
export type Db = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function databaseConnectionString(env: ApiEnv, options: { direct?: boolean } = {}): string {
  const url = options.direct
    ? (env.DIRECT_DATABASE_URL ?? (env.HYPERDRIVE ? undefined : env.DATABASE_URL))
    : (env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
  if (!url) {
    throw new Error(
      options.direct
        ? "Direct database connection is not configured"
        : "Database connection is not configured",
    );
  }
  // Existing Python deployments use this SQLAlchemy dialect URL spelling.
  return url.replace(/^postgresql\+asyncpg:/, "postgresql:");
}

function databaseSsl(env: ApiEnv, connectionString: string, options: { direct?: boolean }) {
  const url = new URL(connectionString);
  // pg parses these URL options itself, replacing any supplied SSL object.
  // Preserve explicit URL choices, including custom certificates and disabling TLS.
  if (
    ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"].some((key) =>
      url.searchParams.has(key),
    ) ||
    url.searchParams.get("sslnegotiation") === "direct"
  )
    return undefined;

  // Hyperdrive manages origin TLS. DATABASE_SSL applies only to direct origins,
  // including publication transactions that bypass Hyperdrive.
  if (env.HYPERDRIVE && !options.direct) return false;

  const setting = env.DATABASE_SSL?.trim().toLowerCase();
  if (setting && setting !== "true" && setting !== "false")
    throw new Error("Invalid DATABASE_SSL setting");
  const host = url.searchParams.get("host") ?? url.hostname;
  const local = ["", "localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  const enabled = setting ? setting === "true" : !local;
  return enabled ? { rejectUnauthorized: true } : false;
}

/** Clients cannot cross Workers request contexts; Hyperdrive supplies the shared pool. */
export async function withDatabase<T>(
  env: ApiEnv,
  callback: (db: Db) => Promise<T>,
  options: { direct?: boolean } = {},
): Promise<T> {
  const connectionString = databaseConnectionString(env, options);
  const client = new Client({
    connectionString,
    ssl: databaseSsl(env, connectionString, options),
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
export async function withTransaction<T>(
  db: Db,
  callback: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(callback);
}

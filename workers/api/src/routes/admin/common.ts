import type { ApiEnv } from "../../env";
import { withDatabase, type DbTransaction } from "../../db";
import { requireAdmin, type AuditActor } from "../../http/auth";
import { createServices, type ServicesFactory, type RequestServices } from "../../services";
export async function adminTransaction<T>(
  env: ApiEnv,
  request: Request,
  factory: ServicesFactory,
  callback: (tx: DbTransaction, actor: AuditActor, services: RequestServices) => Promise<T>,
  direct = false,
): Promise<T> {
  const services = factory();
  return withDatabase(
    env,
    (db) =>
      db.transaction(async (tx) => {
        const actor = await requireAdmin(tx, request, services.firebase);
        return callback(tx, actor, services);
      }),
    { direct },
  );
}
export function defaultServices(env: ApiEnv): ServicesFactory {
  return () => createServices(env);
}

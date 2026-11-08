import type { ApiEnv } from "../env";
import { createAuth, type Auth } from "../auth";
import type { Db, DbTransaction } from "../db";
import { createStorage, type ObjectStorage } from "./storage";
import { sendOtpEmail } from "./email";
import { generateEventEmbedding, type EmbeddingEvent } from "./embeddings";

export interface RequestServices {
  /** Better Auth bound to this request's database client. */
  auth(db: Db | DbTransaction): Auth;
  storage: ObjectStorage;
  sendOtpEmail(toEmail: string, code: string): Promise<void>;
  embedEvent(event: EmbeddingEvent): Promise<number[] | null>;
  now(): Date;
}

export type ServicesFactory = () => RequestServices;

/** Create within each request: provider access tokens must not outlive a request. */
export function createServices(env: ApiEnv): RequestServices {
  const services: RequestServices = {
    // A transaction exposes the same query builder; Better Auth only issues queries.
    auth: (db) => createAuth(env, db as Db, services),
    storage: createStorage(env),
    sendOtpEmail: (email, code) => sendOtpEmail(env, email, code),
    embedEvent: (event) => generateEventEmbedding(env, event),
    now: () => new Date(),
  };
  return services;
}

import type { ApiEnv } from "../env";
import { createFirebase, type FirebaseService } from "./firebase";
import { createStorage, type ObjectStorage } from "./storage";
import { sendOtpEmail } from "./email";
import { generateEventEmbedding, type EmbeddingEvent } from "./embeddings";

export interface RequestServices {
  firebase: FirebaseService;
  storage: ObjectStorage;
  sendOtpEmail(toEmail: string, code: string): Promise<void>;
  embedEvent(event: EmbeddingEvent): Promise<number[] | null>;
  now(): Date;
}

export type ServicesFactory = () => RequestServices;

/** Create within each request: provider access tokens must not outlive a request. */
export function createServices(env: ApiEnv): RequestServices {
  return {
    firebase: createFirebase(env),
    storage: createStorage(env),
    sendOtpEmail: (email, code) => sendOtpEmail(env, email, code),
    embedEvent: (event) => generateEventEmbedding(env, event),
    now: () => new Date(),
  };
}

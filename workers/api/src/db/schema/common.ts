import { timestamp, uuid } from "drizzle-orm/pg-core";

export type SourceLabel = "ubc_official" | "ams_club" | "campus_community";
export type EventVibe =
  | "social"
  | "career"
  | "academic"
  | "arts"
  | "culture"
  | "outdoors"
  | "sports"
  | "food"
  | "wellness"
  | "volunteering";
export type CandidateStatus = "pending" | "approved" | "rejected";
export type CredentialScope = "candidates:ingest" | "candidates:extract";
export type AuditActorType = "member" | "api_key";

export const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const uuidId = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
export const createdAt = () => instant("created_at").notNull().defaultNow();
export const updatedAt = () =>
  instant("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

/** Same length and URL-safe alphabet as the Python nanoid identifiers. */
export function createShortId(): string {
  const alphabet = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (value) => alphabet[value & 63],
  ).join("");
}

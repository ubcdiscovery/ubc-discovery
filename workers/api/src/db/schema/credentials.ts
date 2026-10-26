import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { instant, uuidId, createdAt, type CredentialScope, type AuditActorType } from "./common";
import { users } from "./members";

export const apiCredentials = pgTable(
  "api_credentials",
  {
    id: uuidId(),
    label: varchar("label", { length: 80 }).notNull(),
    scopes: jsonb("scopes")
      .$type<CredentialScope[]>()
      .notNull()
      .default(sql`'["candidates:ingest"]'::jsonb`),
    secretHash: varchar("secret_hash", { length: 255 }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: createdAt(),
    expiresAt: instant("expires_at"),
    revokedAt: instant("revoked_at"),
    lastUsedAt: instant("last_used_at"),
  },
  (table) => [
    foreignKey({
      name: "api_credentials_created_by_user_id_fkey",
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    index("ix_api_credentials_created_by_user_id").on(table.createdByUserId),
    index("ix_api_credentials_created_at").on(table.createdAt),
    check(
      "ck_api_credential_scopes",
      sql`jsonb_typeof(${table.scopes}) = 'array' AND jsonb_array_length(${table.scopes}) > 0 AND ${table.scopes} <@ '["candidates:ingest","candidates:extract"]'::jsonb`,
    ),
  ],
);

export const apiCredentialAuditLogs = pgTable(
  "api_credential_audit_logs",
  {
    id: uuidId(),
    credentialId: uuid("credential_id").notNull(),
    actorType: varchar("actor_type", { length: 50 }).$type<AuditActorType>().notNull(),
    actorId: uuid("actor_id").notNull(),
    action: varchar("action", { length: 50 }).$type<"create" | "replace" | "revoke">().notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "api_credential_audit_logs_credential_id_fkey",
      columns: [table.credentialId],
      foreignColumns: [apiCredentials.id],
    }).onDelete("restrict"),
    index("ix_api_credential_audit_logs_credential_id").on(table.credentialId),
    index("ix_api_credential_audit_logs_created_at").on(table.createdAt),
    check("ck_api_credential_audit_actor_type", sql`${table.actorType} IN ('member', 'api_key')`),
    check(
      "ck_api_credential_audit_action",
      sql`${table.action} IN ('create', 'replace', 'revoke')`,
    ),
  ],
);

export type ApiCredential = typeof apiCredentials.$inferSelect;

import {
  bigint,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, instant, updatedAt, uuidId } from "./common";
import { users } from "./members";

export const sessions = pgTable(
  "sessions",
  {
    id: uuidId(),
    token: varchar("token", { length: 255 }).notNull(),
    userId: uuid("user_id").notNull(),
    expiresAt: instant("expires_at").notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "sessions_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    uniqueIndex("ix_sessions_token").on(table.token),
    index("ix_sessions_user_id").on(table.userId),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuidId(),
    userId: uuid("user_id").notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "accounts_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    uniqueIndex("ix_accounts_provider_account").on(table.providerId, table.accountId),
    index("ix_accounts_user_id").on(table.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuidId(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("ix_verifications_identifier").on(table.identifier)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    id: uuidId(),
    key: varchar("key", { length: 512 }).notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("ix_rate_limits_key").on(table.key)],
);

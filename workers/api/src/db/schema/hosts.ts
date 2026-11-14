import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./common";
import { events } from "./events";
import { eventListingCandidates } from "./candidates";

/** Instagram usernames: 1–30 of a-z, 0-9, period and underscore, stored lowercase. */
export const HOST_HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

/**
 * A Host is the account that runs an Event Listing, keyed by its lowercase Instagram
 * handle. Foreign keys cascade handle updates so an Instagram rename is one UPDATE.
 */
export const hosts = pgTable(
  "hosts",
  {
    handle: varchar("handle", { length: 30 }).primaryKey(),
    /** Admin-chosen name; wins over profile_name when set. */
    displayName: varchar("display_name", { length: 255 }),
    /** Name from the source profile, refreshed by ingestion. */
    profileName: varchar("profile_name", { length: 255 }),
    instagramUserId: varchar("instagram_user_id", { length: 32 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check("ck_host_handle", sql`${table.handle} ~ '^[a-z0-9._]{1,30}$'`)],
);

export const eventHosts = pgTable(
  "event_hosts",
  {
    eventId: varchar("event_id", { length: 8 }).notNull(),
    hostHandle: varchar("host_handle", { length: 30 }).notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ name: "event_hosts_pkey", columns: [table.eventId, table.hostHandle] }),
    foreignKey({
      name: "event_hosts_event_id_fkey",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "event_hosts_host_handle_fkey",
      columns: [table.hostHandle],
      foreignColumns: [hosts.handle],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("ix_event_hosts_host_handle").on(table.hostHandle),
  ],
);

export const candidateHosts = pgTable(
  "candidate_hosts",
  {
    candidateId: varchar("candidate_id", { length: 8 }).notNull(),
    hostHandle: varchar("host_handle", { length: 30 }).notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({
      name: "candidate_hosts_pkey",
      columns: [table.candidateId, table.hostHandle],
    }),
    foreignKey({
      name: "candidate_hosts_candidate_id_fkey",
      columns: [table.candidateId],
      foreignColumns: [eventListingCandidates.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "candidate_hosts_host_handle_fkey",
      columns: [table.hostHandle],
      foreignColumns: [hosts.handle],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("ix_candidate_hosts_host_handle").on(table.hostHandle),
  ],
);

export type Host = typeof hosts.$inferSelect;

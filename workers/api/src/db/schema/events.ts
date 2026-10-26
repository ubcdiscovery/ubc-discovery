import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import {
  instant,
  uuidId,
  createdAt,
  createShortId,
  type SourceLabel,
  type EventVibe,
  type AuditActorType,
} from "./common";
import { users } from "./members";

export const events = pgTable(
  "events",
  {
    id: varchar("id", { length: 8 }).primaryKey().$defaultFn(createShortId),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description")
      .notNull()
      .$defaultFn(() => ""),
    source: varchar("source", { length: 50 }).notNull(),
    sourceLabel: varchar("source_label", { length: 50 })
      .$type<SourceLabel>()
      .notNull()
      .$defaultFn(() => "campus_community"),
    sourceUrl: varchar("source_url", { length: 1024 }),
    clubName: varchar("club_name", { length: 255 }),
    vibes: json("vibes")
      .$type<EventVibe[]>()
      .notNull()
      .$defaultFn(() => []),
    locationName: varchar("location_name", { length: 255 }).notNull(),
    eventDate: instant("event_date").notNull(),
    eventEndDate: instant("event_end_date"),
    createdAt: createdAt(),
    isArchived: boolean("is_archived").notNull().default(false),
    archivedAt: instant("archived_at"),
    archivedBy: uuid("archived_by"),
    embeddingVector: vector("embedding_vector", { dimensions: 1024 }),
  },
  (table) => [
    check(
      "ck_event_source_label",
      sql`${table.sourceLabel} IN ('ubc_official', 'ams_club', 'campus_community')`,
    ),
    index("ix_events_search_trgm").using(
      "gin",
      sql`(coalesce(${table.title}, '') || ' ' || coalesce(${table.clubName}, '') || ' ' || coalesce(${table.locationName}, '')) gin_trgm_ops`,
    ),
    index("ix_events_embedding_vector_hnsw")
      .using("hnsw", table.embeddingVector.op("vector_cosine_ops"))
      .where(sql`${table.embeddingVector} IS NOT NULL`),
  ],
);

export const eventRatings = pgTable(
  "event_ratings",
  {
    id: uuidId(),
    userId: uuid("user_id").notNull(),
    eventId: varchar("event_id", { length: 8 }).notNull(),
    stars: doublePrecision("stars").notNull(),
    strongVibes: json("strong_vibes")
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "event_ratings_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "event_ratings_event_id_fkey",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("cascade"),
    unique("uq_user_event_rating").on(table.userId, table.eventId),
    index("ix_event_ratings_user_id").on(table.userId),
    index("ix_event_ratings_event_id").on(table.eventId),
  ],
);

export const savedEvents = pgTable(
  "saved_events",
  {
    userId: uuid("user_id").notNull(),
    eventId: varchar("event_id", { length: 8 }).notNull(),
    savedAt: instant("saved_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "saved_events_pkey", columns: [table.userId, table.eventId] }),
    foreignKey({
      name: "saved_events_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "saved_events_event_id_fkey",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("cascade"),
    index("ix_saved_events_user_id").on(table.userId),
    index("ix_saved_events_event_id").on(table.eventId),
  ],
);

export const eventAuditLogs = pgTable(
  "event_audit_logs",
  {
    id: uuidId(),
    eventId: varchar("event_id", { length: 8 }).notNull(),
    actorType: varchar("actor_type", { length: 50 }).$type<AuditActorType | "system">().notNull(),
    actorId: uuid("actor_id").notNull(),
    action: varchar("action", { length: 50 })
      .$type<"create" | "update" | "image_upload" | "archive" | "restore">()
      .notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "event_audit_logs_event_id_fkey",
      columns: [table.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    index("ix_event_audit_logs_event_id").on(table.eventId),
    index("ix_event_audit_logs_created_at").on(table.createdAt),
    check("ck_event_audit_actor_type", sql`${table.actorType} IN ('member', 'api_key', 'system')`),
    check(
      "ck_event_audit_action",
      sql`${table.action} IN ('create', 'update', 'image_upload', 'archive', 'restore')`,
    ),
  ],
);

export type Event = typeof events.$inferSelect;

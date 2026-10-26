import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { instant, uuidId, createdAt, updatedAt } from "./common";

export const users = pgTable(
  "users",
  {
    id: uuidId(),
    firebaseUid: varchar("firebase_uid", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    preferredName: varchar("preferred_name", { length: 255 }).notNull(),
    major: varchar("major", { length: 255 }),
    academicLevel: varchar("academic_level", { length: 32 }),
    facultyId: varchar("faculty_id", { length: 64 }),
    interests: jsonb("interests").$type<string[]>(),
    bio: text("bio"),
    profilePictureKey: varchar("profile_picture_key", { length: 512 }),
    lastActiveAt: instant("last_active_at"),
    isAdmin: boolean("is_admin")
      .notNull()
      .$defaultFn(() => false),
    ubcVerified: boolean("ubc_verified")
      .notNull()
      .$defaultFn(() => false),
    onboardingCompleted: boolean("onboarding_completed")
      .notNull()
      .$defaultFn(() => false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("ix_users_firebase_uid").on(table.firebaseUid),
    uniqueIndex("ix_users_email").on(table.email),
    check(
      "ck_users_faculty_id",
      sql`${table.facultyId} IN ('applied-science', 'architecture-landscape-architecture', 'arts', 'sauder', 'dentistry', 'education', 'forestry-environmental-stewardship', 'kinesiology', 'land-food-systems', 'law', 'medicine', 'music', 'nursing', 'pharmaceutical-sciences', 'science', 'social-work', 'vantage-college', 'vancouver-school-economics', 'other')`,
    ),
    check(
      "ck_users_academic_level",
      sql`${table.academicLevel} IN ('year_1', 'year_2', 'year_3', 'year_4', 'year_5_plus', 'graduate', 'postdoc', 'other')`,
    ),
    check(
      "ck_users_major_normalized",
      sql`${table.major} IS NULL OR (${table.major} = btrim(${table.major}) AND ${table.major} <> '')`,
    ),
  ],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuidId(),
    email: varchar("email", { length: 255 }).notNull(),
    code: varchar("code", { length: 6 }).notNull(),
    attempts: integer("attempts")
      .notNull()
      .$defaultFn(() => 0),
    used: boolean("used")
      .notNull()
      .$defaultFn(() => false),
    expiresAt: instant("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("ix_otp_codes_email").on(table.email)],
);

export type User = typeof users.$inferSelect;

import { sql } from 'drizzle-orm';
import {
  boolean, check, doublePrecision, index, integer, json, jsonb, pgTable,
  primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar, vector,
} from 'drizzle-orm/pg-core';

export type SourceLabel = 'ubc_official' | 'ams_club' | 'campus_community';
export type EventVibe = 'social' | 'career' | 'academic' | 'arts' | 'culture' | 'outdoors' | 'sports' | 'food' | 'wellness' | 'volunteering';
export type CandidateStatus = 'pending' | 'approved' | 'rejected';
export type CredentialScope = 'candidates:ingest' | 'candidates:extract';
export type AuditActorType = 'member' | 'api_key';

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const uuidId = () => uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => instant('created_at').notNull().defaultNow();
const updatedAt = () => instant('updated_at').notNull().defaultNow().$onUpdateFn(() => new Date());

/** Same length and URL-safe alphabet as the Python nanoid identifiers. */
export function createShortId(): string {
  const alphabet = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), value => alphabet[value & 63]).join('');
}

// This is a mapping of the existing Alembic schema, not a new migration baseline.
// $defaultFn/$onUpdateFn preserve SQLAlchemy application defaults without changing SQL defaults.
export const users = pgTable('users', {
  id: uuidId(),
  firebaseUid: varchar('firebase_uid', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  preferredName: varchar('preferred_name', { length: 255 }).notNull(),
  major: varchar('major', { length: 255 }),
  academicLevel: varchar('academic_level', { length: 32 }),
  facultyId: varchar('faculty_id', { length: 64 }),
  interests: jsonb('interests').$type<string[]>(),
  bio: text('bio'),
  profilePictureKey: varchar('profile_picture_key', { length: 512 }),
  lastActiveAt: instant('last_active_at'),
  isAdmin: boolean('is_admin').notNull().$defaultFn(() => false),
  ubcVerified: boolean('ubc_verified').notNull().$defaultFn(() => false),
  onboardingCompleted: boolean('onboarding_completed').notNull().$defaultFn(() => false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  uniqueIndex('ix_users_firebase_uid').on(table.firebaseUid),
  uniqueIndex('ix_users_email').on(table.email),
  check('ck_users_faculty_id', sql`${table.facultyId} IS NULL OR ${table.facultyId} IN ('applied-science', 'architecture-landscape-architecture', 'arts', 'sauder', 'dentistry', 'education', 'forestry-environmental-stewardship', 'kinesiology', 'land-food-systems', 'law', 'medicine', 'music', 'nursing', 'pharmaceutical-sciences', 'science', 'social-work', 'vantage-college', 'vancouver-school-economics', 'other')`),
  check('ck_users_academic_level', sql`${table.academicLevel} IS NULL OR ${table.academicLevel} IN ('year_1', 'year_2', 'year_3', 'year_4', 'year_5_plus', 'graduate', 'postdoc', 'other')`),
  check('ck_users_major_normalized', sql`${table.major} IS NULL OR (${table.major} = btrim(${table.major}) AND ${table.major} <> '')`),
]);

export const events = pgTable('events', {
  id: varchar('id', { length: 8 }).primaryKey().$defaultFn(createShortId),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description').notNull().$defaultFn(() => ''),
  source: varchar('source', { length: 50 }).notNull(),
  sourceLabel: varchar('source_label', { length: 50 }).$type<SourceLabel>().notNull().$defaultFn(() => 'campus_community'),
  sourceUrl: varchar('source_url', { length: 1024 }),
  clubName: varchar('club_name', { length: 255 }),
  vibes: json('vibes').$type<EventVibe[]>().notNull().$defaultFn(() => []),
  locationName: varchar('location_name', { length: 255 }).notNull(),
  eventDate: instant('event_date').notNull(),
  eventEndDate: instant('event_end_date'),
  createdAt: createdAt(),
  isArchived: boolean('is_archived').notNull().default(false),
  archivedAt: instant('archived_at'),
  archivedBy: uuid('archived_by'),
  embeddingVector: vector('embedding_vector', { dimensions: 1024 }),
}, table => [
  check('ck_event_source_label', sql`${table.sourceLabel} IN ('ubc_official', 'ams_club', 'campus_community')`),
  index('ix_events_search_trgm').using('gin', sql`(coalesce(${table.title}, '') || ' ' || coalesce(${table.clubName}, '') || ' ' || coalesce(${table.locationName}, '')) gin_trgm_ops`),
]);

export const eventRatings = pgTable('event_ratings', {
  id: uuidId(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: varchar('event_id', { length: 8 }).notNull().references(() => events.id, { onDelete: 'cascade' }),
  stars: doublePrecision('stars').notNull(),
  strongVibes: json('strong_vibes').$type<string[]>().notNull().$defaultFn(() => []),
  note: text('note'),
  createdAt: createdAt(),
}, table => [
  unique('uq_user_event_rating').on(table.userId, table.eventId),
  index('ix_event_ratings_user_id').on(table.userId),
  index('ix_event_ratings_event_id').on(table.eventId),
]);

export const savedEvents = pgTable('saved_events', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: varchar('event_id', { length: 8 }).notNull().references(() => events.id, { onDelete: 'cascade' }),
  savedAt: instant('saved_at').notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.eventId] }),
  index('ix_saved_events_user_id').on(table.userId),
  index('ix_saved_events_event_id').on(table.eventId),
]);

export const otpCodes = pgTable('otp_codes', {
  id: uuidId(),
  email: varchar('email', { length: 255 }).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  attempts: integer('attempts').notNull().$defaultFn(() => 0),
  used: boolean('used').notNull().$defaultFn(() => false),
  expiresAt: instant('expires_at').notNull(),
  createdAt: createdAt(),
}, table => [index('ix_otp_codes_email').on(table.email)]);

export const apiCredentials = pgTable('api_credentials', {
  id: uuidId(),
  label: varchar('label', { length: 80 }).notNull(),
  scopes: jsonb('scopes').$type<CredentialScope[]>().notNull().default(sql`'["candidates:ingest"]'::jsonb`),
  secretHash: varchar('secret_hash', { length: 255 }).notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
  expiresAt: instant('expires_at'),
  revokedAt: instant('revoked_at'),
  lastUsedAt: instant('last_used_at'),
}, table => [
  index('ix_api_credentials_created_by_user_id').on(table.createdByUserId),
  index('ix_api_credentials_created_at').on(table.createdAt),
  check('ck_api_credential_scopes', sql`jsonb_typeof(${table.scopes}) = 'array' AND jsonb_array_length(${table.scopes}) > 0 AND ${table.scopes} <@ '["candidates:ingest","candidates:extract"]'::jsonb`),
]);

export const apiCredentialAuditLogs = pgTable('api_credential_audit_logs', {
  id: uuidId(),
  credentialId: uuid('credential_id').notNull().references(() => apiCredentials.id, { onDelete: 'restrict' }),
  actorType: varchar('actor_type', { length: 50 }).$type<AuditActorType>().notNull(),
  actorId: uuid('actor_id').notNull(),
  action: varchar('action', { length: 50 }).$type<'create' | 'replace' | 'revoke'>().notNull(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, table => [
  index('ix_api_credential_audit_logs_credential_id').on(table.credentialId),
  index('ix_api_credential_audit_logs_created_at').on(table.createdAt),
  check('ck_api_credential_audit_actor_type', sql`${table.actorType} IN ('member', 'api_key')`),
  check('ck_api_credential_audit_action', sql`${table.action} IN ('create', 'replace', 'revoke')`),
]);

export const eventAuditLogs = pgTable('event_audit_logs', {
  id: uuidId(),
  eventId: varchar('event_id', { length: 8 }).notNull().references(() => events.id, { onDelete: 'restrict' }),
  actorType: varchar('actor_type', { length: 50 }).$type<AuditActorType | 'system'>().notNull(),
  actorId: uuid('actor_id').notNull(),
  action: varchar('action', { length: 50 }).$type<'create' | 'update' | 'image_upload' | 'archive' | 'restore'>().notNull(),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, table => [
  index('ix_event_audit_logs_event_id').on(table.eventId),
  index('ix_event_audit_logs_created_at').on(table.createdAt),
  check('ck_event_audit_actor_type', sql`${table.actorType} IN ('member', 'api_key', 'system')`),
  check('ck_event_audit_action', sql`${table.action} IN ('create', 'update', 'image_upload', 'archive', 'restore')`),
]);

export const eventListingCandidates = pgTable('event_listing_candidates', {
  id: varchar('id', { length: 8 }).primaryKey().$defaultFn(createShortId),
  description: text('description').notNull().$defaultFn(() => ''),
  sourceAccount: varchar('source_account', { length: 255 }).notNull(),
  sourceUrl: varchar('source_url', { length: 1024 }),
  sourceType: varchar('source_type', { length: 50 }).notNull(),
  externalSourceId: varchar('external_source_id', { length: 512 }).notNull(),
  imageKeys: json('image_keys').$type<string[]>().notNull().default(sql`'[]'::json`),
  postedAt: instant('posted_at'),
  isEvent: boolean('is_event'),
  title: varchar('title', { length: 500 }),
  locationName: varchar('location_name', { length: 255 }),
  eventDate: instant('event_date'),
  eventEndDate: instant('event_end_date'),
  clubName: varchar('club_name', { length: 255 }),
  vibes: json('vibes').$type<EventVibe[]>().notNull().default(sql`'[]'::json`),
  sourceLabel: varchar('source_label', { length: 50 }).$type<SourceLabel>(),
  extractedOriginal: json('extracted_original').$type<Record<string, unknown> | unknown[]>(),
  extractionModel: varchar('extraction_model', { length: 100 }),
  extractedAt: instant('extracted_at'),
  captureReadyAt: instant('capture_ready_at'),
  processingDispatchedAt: instant('processing_dispatched_at'),
  processingCompletedAt: instant('processing_completed_at'),
  processingError: text('processing_error'),
  processingGeneration: integer('processing_generation').notNull().default(1),
  status: varchar('status', { length: 32 }).$type<CandidateStatus>().notNull().default('pending'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  unique('uq_candidate_source_identity').on(table.sourceType, table.externalSourceId),
  check('ck_event_listing_candidate_status', sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  check('ck_event_listing_candidate_source_label', sql`${table.sourceLabel} IS NULL OR ${table.sourceLabel} IN ('ubc_official', 'ams_club', 'campus_community')`),
  index('ix_event_listing_candidates_source_type').on(table.sourceType),
  index('ix_event_listing_candidates_status').on(table.status),
  index('ix_event_listing_candidates_created_at').on(table.createdAt),
]);

export const eventListingCandidateIngestionAudits = pgTable('event_listing_candidate_ingestion_audits', {
  id: uuidId(),
  candidateId: varchar('candidate_id', { length: 8 }).notNull().references(() => eventListingCandidates.id, { onDelete: 'restrict' }),
  sourceType: varchar('source_type', { length: 50 }).notNull(),
  externalSourceId: varchar('external_source_id', { length: 512 }).notNull(),
  outcome: varchar('outcome', { length: 32 }).$type<'created' | 'existing'>().notNull(),
  actorType: varchar('actor_type', { length: 50 }).$type<AuditActorType>().notNull(),
  actorId: uuid('actor_id').notNull(),
  credentialLabel: varchar('credential_label', { length: 80 }).notNull(),
  receivedAt: instant('received_at').notNull().defaultNow(),
}, table => [
  index('ix_event_listing_candidate_ingestion_audits_candidate_id').on(table.candidateId),
  index('ix_event_listing_candidate_ingestion_audits_received_at').on(table.receivedAt),
  check('ck_candidate_ingestion_audit_actor_type', sql`${table.actorType} IN ('member', 'api_key')`),
  check('ck_candidate_ingestion_audit_outcome', sql`${table.outcome} IN ('created', 'existing')`),
]);

/** Retained solely for rollback compatibility; Cloudflare Queues owns dispatch. */
export const candidateExtractionJobs = pgTable('candidate_extraction_jobs', {
  id: uuidId(),
  candidateId: varchar('candidate_id', { length: 8 }).notNull().references(() => eventListingCandidates.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).$type<'pending' | 'claimed' | 'succeeded' | 'failed'>().notNull().default('pending'),
  availableAt: instant('available_at').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  claimedAt: instant('claimed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [
  unique('uq_candidate_extraction_job_candidate_id').on(table.candidateId),
  check('ck_candidate_extraction_job_status', sql`${table.status} IN ('pending', 'claimed', 'succeeded', 'failed')`),
  index('ix_candidate_extraction_jobs_status_available_at').on(table.status, table.availableAt),
]);

export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type EventListingCandidate = typeof eventListingCandidates.$inferSelect;
export type ApiCredential = typeof apiCredentials.$inferSelect;

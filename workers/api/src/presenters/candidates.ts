import { eq, desc } from 'drizzle-orm';
import { eventListingCandidateIngestionAudits as audits, type EventListingCandidate } from '../db/schema';
import type { Database } from '../services/event-administration';
import type { ObjectStorage } from '../services/storage';
import { sameClubSameDay } from '../services/candidate-publication';
export function presentCandidate(candidate: EventListingCandidate) {
 return { id: candidate.id, description: candidate.description, source_account: candidate.sourceAccount, source_url: candidate.sourceUrl,
  source_type: candidate.sourceType, external_source_id: candidate.externalSourceId, status: candidate.status,
  created_at: candidate.createdAt.toISOString(), updated_at: candidate.updatedAt.toISOString() };
}
export async function presentAdminCandidate(candidate: EventListingCandidate, storage: ObjectStorage) {
 return { ...presentCandidate(candidate), image_urls: await Promise.all((candidate.imageKeys ?? []).map(key => storage.generatePresignedDownloadUrl(key))),
 posted_at: candidate.postedAt?.toISOString() ?? null, is_event: candidate.isEvent, title: candidate.title, location_name: candidate.locationName,
 event_date: candidate.eventDate?.toISOString() ?? null, event_end_date: candidate.eventEndDate?.toISOString() ?? null,
 club_name: candidate.clubName, vibes: candidate.vibes ?? [], source_label: candidate.sourceLabel, extracted_original: candidate.extractedOriginal,
 extraction_model: candidate.extractionModel, extracted_at: candidate.extractedAt?.toISOString() ?? null,
 capture_ready_at: candidate.captureReadyAt?.toISOString() ?? null, processing_dispatched_at: candidate.processingDispatchedAt?.toISOString() ?? null,
 processing_completed_at: candidate.processingCompletedAt?.toISOString() ?? null, processing_error: candidate.processingError };
}
export async function presentCandidateDetail(candidate: EventListingCandidate, db: Database, storage: ObjectStorage) {
 const entries = await db.select().from(audits).where(eq(audits.candidateId, candidate.id)).orderBy(desc(audits.receivedAt));
 const matches = await sameClubSameDay(candidate, db);
 const all = [
  ...matches.candidates.filter(item => item.eventDate).map(item => ({ kind: 'candidate', id: item.id, title: item.title || item.description, event_date: item.eventDate!.toISOString() })),
  ...matches.events.map(item => ({ kind: 'event', id: item.id, title: item.title, event_date: item.eventDate.toISOString() })),
 ].sort((left, right) => left.event_date.localeCompare(right.event_date) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id) || left.title.localeCompare(right.title));
 return { ...await presentAdminCandidate(candidate, storage), ingestion_audits: entries.map(item => ({ id: item.id, source_type: item.sourceType,
  external_source_id: item.externalSourceId, outcome: item.outcome, actor_type: item.actorType, actor_id: item.actorId,
  credential_label: item.credentialLabel, received_at: item.receivedAt.toISOString() })), same_club_same_day_matches: all };
}

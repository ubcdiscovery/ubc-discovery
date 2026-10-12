import { and, eq } from 'drizzle-orm';
import { presentUpload } from '../presenters/storage';
import { eventListingCandidates as candidates, eventListingCandidateIngestionAudits as audits, type EventListingCandidate } from '../db/schema';
import type { DbTransaction } from '../db';
import type { CandidateIngestionInput } from '../schemas/candidates';
import { parseDate } from '../schemas/events';
import { ApiError } from '../http/errors';
import type { IngestionCredential } from '../http/auth';
import { allocateEventId, postgresErrorCode } from './event-administration';
import type { RequestServices } from './index';
import { presentCandidate } from '../presenters/candidates';
import type { ApiEnv } from '../env';
import { integerSetting } from '../env';
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export function candidateImageKey(id: string, index: number, type: keyof typeof extensions): string {
 if (index < 0 || index >= 10 || !Number.isInteger(index)) throw new ApiError(422, 'image index is out of range');
 return `candidates/${id}/${String(index).padStart(2, '0')}.${extensions[type]}`;
}
export async function ingestCandidate(tx: DbTransaction, body: CandidateIngestionInput, credential: IngestionCredential, services: RequestServices, env: ApiEnv, fileSizes?: number[]) {
 const values = { description: (body.description ?? '').trim(), sourceType: body.source_type.trim(), externalSourceId: body.external_source_id.trim(),
  sourceAccount: body.source_account.trim(), sourceUrl: body.source_url?.trim() ?? null, postedAt: parseDate(body.posted_at) };
 if (!values.sourceType || !values.externalSourceId || !values.sourceAccount) throw new ApiError(422, 'field must contain text');
 let candidate: EventListingCandidate | undefined;
 let outcome: 'created' | 'existing' | undefined;
 for (let attempt = 0; attempt < 20; attempt++) {
  const id = await allocateEventId(tx);
  try {
   const result = await tx.transaction(async savepoint => {
    const [created] = await savepoint.insert(candidates).values({ id, ...values, createdAt: services.now(), updatedAt: services.now() })
     .onConflictDoNothing({ target: [candidates.sourceType, candidates.externalSourceId] }).returning();
    if (created) return { candidate: created, outcome: 'created' as const };
    const [existing] = await savepoint.select().from(candidates).where(and(eq(candidates.sourceType, values.sourceType), eq(candidates.externalSourceId, values.externalSourceId))).for('update');
    return { candidate: existing, outcome: 'existing' as const };
   });
   candidate = result.candidate;
   outcome = result.outcome;
  } catch (error) {
   if (postgresErrorCode(error) !== '23505') throw error;
  }
  if (candidate && outcome) break;
 }
 if (!candidate || !outcome) throw new ApiError(409, 'Could not allocate a unique Candidate id');
 if (outcome === 'existing') {
  const actual = (candidate.imageKeys ?? []).map(key => key.slice(key.lastIndexOf('/') + 1).toLowerCase()).filter(key => key.includes('.')).map(key => key.slice(key.lastIndexOf('.') + 1));
  const expected = body.image_content_types.map(type => extensions[type]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new ApiError(409, 'Candidate image content types conflict with existing capture');
 } else {
  const imageKeys = body.image_content_types.map((type, index) => candidateImageKey(candidate!.id, index, type));
  [candidate] = await tx.update(candidates).set({ imageKeys }).where(eq(candidates.id, candidate.id)).returning();
 }
 const maxFileSizeBytes = integerSetting(env.CANDIDATE_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
 const uploads = candidate!.extractedAt ? [] : await Promise.all((candidate!.imageKeys ?? []).map(async (key, index) => {
  const upload = await services.storage.generatePresignedUpload({ fileKey: key, contentType: body.image_content_types[index]!, maxFileSizeBytes, fileSizeBytes: fileSizes?.[index] });
  return presentUpload(upload, maxFileSizeBytes);
 }));
 const [audit] = await tx.insert(audits).values({ candidateId: candidate!.id, sourceType: values.sourceType, externalSourceId: values.externalSourceId,
  outcome, actorType: 'api_key', actorId: credential.actorId, credentialLabel: credential.name, receivedAt: services.now() }).returning();
 return { outcome, receipt_id: audit!.id, candidate: presentCandidate(candidate!), uploads };
}

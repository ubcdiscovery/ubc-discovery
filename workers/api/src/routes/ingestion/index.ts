import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { and, eq, isNull } from 'drizzle-orm';
import { withDatabase } from '../../db';
import { eventListingCandidates as candidates } from '../../db/schema';
import type { ApiEnv } from '../../env';
import { requireApiCredential } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { candidateIngestionSchema } from '../../schemas/candidates';
import { createServices, type ServicesFactory } from '../../services';
import { ingestCandidate } from '../../services/candidate-ingestion';
import { captureTimedOut, dispatchCandidates } from '../../services/extraction-queue';

export function createIngestionRoutes(env: ApiEnv, servicesFactory: ServicesFactory = () => createServices(env)) {
 return new Elysia({ name: 'candidate-ingestion', adapter: CloudflareAdapter, prefix: '/ingestion/event-candidates' })
 .post('', async ({ request, body, set }) => {
  const services = servicesFactory();
  return withDatabase(env, async db => {
   const result = await db.transaction(async tx => {
    const credential = await requireApiCredential(tx, request, 'candidates:ingest', services.now());
    return ingestCandidate(tx, body, credential, services, env);
   });
   set.status = result.outcome === 'created' ? 201 : 200;
   return result;
  }, { direct: true });
 }, { body: candidateIngestionSchema, detail: { tags: ['Candidate Ingestion'] } })
 .post('/:candidate_id/capture-ready', async ({ request, params }) => {
  const services = servicesFactory();
  return withDatabase(env, async db => {
   const state = await db.transaction(async tx => {
    await requireApiCredential(tx, request, 'candidates:ingest', services.now());
    const [candidate] = await tx.select().from(candidates).where(eq(candidates.id, params.candidate_id)).for('update');
    if (!candidate) throw new ApiError(404, 'Candidate not found');
    if (candidate.processingCompletedAt || candidate.status !== 'pending') return { completed: true as const, candidate };
    const exists = await Promise.all((candidate.imageKeys ?? []).map(key => services.storage.objectExists(key)));
    if (exists.some(value => !value) && !captureTimedOut(candidate, services.now(), env)) throw new ApiError(409, 'Candidate image uploads are incomplete');
    await tx.update(candidates).set({ captureReadyAt: candidate.captureReadyAt ?? services.now() }).where(eq(candidates.id, candidate.id));
    return { completed: false as const, candidate };
   });
   if (state.completed) return { candidate_id: params.candidate_id, status: 'completed', dispatched: false };
   let dispatched = false;
   if (!state.candidate.processingError && !state.candidate.processingDispatchedAt) {
    try { dispatched = await dispatchCandidates(env, [{ candidate_id: state.candidate.id, generation: state.candidate.processingGeneration }]); }
    catch { console.warn(JSON.stringify({ event: 'queue_dispatch_failed', candidate_id: state.candidate.id })); }
    if (dispatched) await db.update(candidates).set({ processingDispatchedAt: services.now() }).where(and(
     eq(candidates.id, state.candidate.id), eq(candidates.processingGeneration, state.candidate.processingGeneration),
     isNull(candidates.processingDispatchedAt), isNull(candidates.processingError), isNull(candidates.processingCompletedAt),
    ));
   }
   return { candidate_id: params.candidate_id, status: 'ready', dispatched };
  }, { direct: true });
 }, { detail: { tags: ['Candidate Ingestion'] } });
}

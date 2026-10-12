import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { withDatabase } from '../src/db';
import { events, eventAuditLogs, eventListingCandidateIngestionAudits, candidateExtractionJobs } from '../src/db/schema';
import { localDayBounds, vancouverDay } from '../src/services/candidate-publication';
import { extractionFixture, testUrl } from './extraction-fixture';
const fixture = extractionFixture();
const extraction = (id: string, club = 'Fixture Club') => ({ candidate_id: id, is_event: true, title: `Event ${id}`, event_date: '2030-02-01T20:00:00-08:00', event_end_date: null, location_name: 'Nest', club_name: club, vibes: ['social'] });
async function json(response: Response): Promise<Record<string, unknown>> { return response.json(); }

describe('Vancouver publication calendar', () => {
 it('uses Vancouver dates and computes both daylight-saving boundaries', () => {
  expect(vancouverDay(new Date('2030-01-02T02:00:00Z'))).toBe('2030-01-01');
  const [springStart, springEnd] = localDayBounds(new Date('2026-03-08T20:00:00Z'));
  expect(springStart.toISOString()).toBe('2026-03-08T08:00:00.000Z');
  expect(springEnd.toISOString()).toBe('2026-03-09T07:00:00.000Z');
  const [fallStart, fallEnd] = localDayBounds(new Date('2025-11-02T20:00:00Z'));
  expect(fallEnd.getTime() - fallStart.getTime()).toBe(25 * 3600_000);
  const [permanentStart, permanentEnd] = localDayBounds(new Date('2026-11-01T20:00:00Z'));
  expect(permanentEnd.getTime() - permanentStart.getTime()).toBe(24 * 3600_000);
 });
});

describe.skipIf(!testUrl)('queue extraction and ingestion PostgreSQL parity', () => {
 beforeAll(fixture.setup); afterAll(fixture.teardown);
 it('restricts ingestion and extraction to their own scopes and denies member tokens', async () => {
  expect((await fixture.request('/extraction/recovery', 'GET', undefined, 'ingest')).status).toBe(403);
  expect((await fixture.request('/extraction/recovery', 'GET', undefined, 'member')).status).toBe(403);
  expect((await fixture.request('/extraction/recovery', 'GET', undefined, 'none')).status).toBe(401);
  expect((await fixture.request('/admin/candidates', 'GET', undefined, 'member')).status).toBe(403);
 });
 it('deduplicates concurrent source ingestion, preserves receipts, and never creates PG extraction jobs', async () => {
  const body = { source_type: ' instagram ', external_source_id: ' duplicate-source ', source_account: ' club ', description: ' caption ', image_content_types: ['image/jpeg'] };
  const responses = await Promise.all(Array.from({ length: 4 }, () => fixture.request('/ingestion/event-candidates', 'POST', body, 'ingest')));
  expect(responses.map(response => response.status).sort()).toEqual([200, 200, 200, 201]);
  const bodies = await Promise.all(responses.map(json));
  const ids = bodies.map(body => (body.candidate as { id: string }).id);
  expect(new Set(ids).size).toBe(1);
  await withDatabase(fixture.env, async db => {
   const audits = await db.select().from(eventListingCandidateIngestionAudits);
   expect(audits.length).toBe(4); expect(audits.filter(item => item.outcome === 'created')).toHaveLength(1);
   expect(await db.select().from(candidateExtractionJobs)).toHaveLength(0);
  });
  const conflict = await fixture.request('/ingestion/event-candidates', 'POST', { ...body, image_content_types: ['image/png'] }, 'ingest');
  expect(conflict.status).toBe(409);
  expect(await json(conflict)).toEqual({ detail: 'Candidate image content types conflict with existing capture' });
 });
 it('returns explicit capture waiting until images exist or the capture times out', async () => {
  await fixture.seedCandidate('wait0001', { createdAt: fixture.services.now(), imageKeys: ['candidates/wait0001/00.jpg'] });
  vi.mocked(fixture.storage.objectExists).mockResolvedValueOnce(false);
  expect((await fixture.request('/ingestion/event-candidates/wait0001/capture-ready', 'POST', undefined, 'ingest')).status).toBe(409);
  const evidence = await json(await fixture.request('/extraction/evidence', 'POST', { candidates: [{ candidate_id: 'wait0001', generation: 1 }] }));
  expect(evidence.items).toEqual([expect.objectContaining({ state: 'waiting', generation: 1 })]);
  const ready = await json(await fixture.request('/ingestion/event-candidates/wait0001/capture-ready', 'POST', undefined, 'ingest'));
  expect(ready).toEqual({ candidate_id: 'wait0001', status: 'ready', dispatched: false });
 });
 it('rejects duplicate generations, mismatched extraction IDs, and naive timestamps before changing rows', async () => {
  expect((await fixture.request('/extraction/evidence', 'POST', { candidates: [{ candidate_id: 'wait0001', generation: 1 }, { candidate_id: 'wait0001', generation: 1 }] })).status).toBe(422);
  expect((await fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [{ candidate_id: 'wait0001', generation: 1, extraction: extraction('otherid1') }] })).status).toBe(422);
  expect((await fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [{ candidate_id: 'wait0001', generation: 1, extraction: { ...extraction('wait0001'), event_date: '2030-02-01T20:00:00' } }] })).status).toBe(422);
  expect((await fixture.candidate('wait0001')).extractedAt).toBeNull();
 });
 it('persists and publishes oldest first so same-club/day duplicates remain in human review', async () => {
  await fixture.seedCandidate('batch001', { createdAt: new Date('2029-12-30Z'), captureReadyAt: fixture.services.now() });
  await fixture.seedCandidate('batch002', { createdAt: new Date('2029-12-31Z'), captureReadyAt: fixture.services.now() });
  const response = await fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [
   { candidate_id: 'batch002', generation: 1, extraction: extraction('batch002', ' Batch Club ') },
   { candidate_id: 'batch001', generation: 1, extraction: extraction('batch001', 'batch club') },
  ] });
  expect(response.status).toBe(200);
  expect(await json(response)).toEqual({ results: [{ candidate_id: 'batch001', status: 'completed' }, { candidate_id: 'batch002', status: 'completed' }] });
  expect((await fixture.candidate('batch001')).status).toBe('approved');
  expect((await fixture.candidate('batch002')).status).toBe('pending');
  const repeat = await fixture.request('/extraction/results', 'POST', { model: 'other-model', results: [{ candidate_id: 'batch001', generation: 1, extraction: extraction('batch001') }] });
  expect(await json(repeat)).toEqual({ results: [{ candidate_id: 'batch001', status: 'completed' }] });
  expect((await fixture.candidate('batch001')).extractionModel).toBe('test-model');
 });
 it('serializes concurrent same-club publication and never publishes two matching drafts', async () => {
  await fixture.seedCandidate('race0001', { captureReadyAt: fixture.services.now() });
  await fixture.seedCandidate('race0002', { captureReadyAt: fixture.services.now() });
  const responses = await Promise.all(['race0001', 'race0002'].map(id => fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [{ candidate_id: id, generation: 1, extraction: extraction(id, 'Race Club') }] })));
  expect(responses.every(response => response.status === 200)).toBe(true);
  const published = await withDatabase(fixture.env, db => db.select().from(events).where(eq(events.clubName, 'Race Club')));
  expect(published.length).toBeLessThanOrEqual(1);
  expect((await fixture.candidate('race0001')).processingCompletedAt).not.toBeNull();
  expect((await fixture.candidate('race0002')).processingCompletedAt).not.toBeNull();
 });
 it('rolls back failed publication while retaining extraction for retry without another AI result', async () => {
  await fixture.seedCandidate('retry001', { captureReadyAt: fixture.services.now(), imageKeys: ['candidates/retry001/00.jpg'] });
  vi.mocked(fixture.storage.copyObject).mockRejectedValueOnce(new Error('storage outage'));
  const response = await fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [{ candidate_id: 'retry001', generation: 1, extraction: extraction('retry001', 'Retry Club') }] });
  expect(await json(response)).toEqual({ results: [{ candidate_id: 'retry001', status: 'retry' }] });
  const candidate = await fixture.candidate('retry001');
  expect(candidate.extractedAt).not.toBeNull(); expect(candidate.processingCompletedAt).toBeNull(); expect(candidate.status).toBe('pending');
  await withDatabase(fixture.env, async db => {
   expect(await db.select().from(events).where(eq(events.id, 'retry001'))).toHaveLength(0);
   expect(await db.select().from(eventAuditLogs).where(eq(eventAuditLogs.eventId, 'retry001'))).toHaveLength(0);
  });
  const retry = await fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [{ candidate_id: 'retry001', generation: 1 }] });
  expect(await json(retry)).toEqual({ results: [{ candidate_id: 'retry001', status: 'completed' }] });
  expect((await fixture.candidate('retry001')).status).toBe('approved');
 });
 it('withholds invalid event publication at a savepoint but completes processing', async () => {
  await fixture.seedCandidate('invalid1', { captureReadyAt: fixture.services.now() });
  const response = await fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [{ candidate_id: 'invalid1', generation: 1, extraction: { ...extraction('invalid1', 'Invalid Club'), location_name: '   ' } }] });
  expect(await json(response)).toEqual({ results: [{ candidate_id: 'invalid1', status: 'completed' }] });
  expect((await fixture.candidate('invalid1')).status).toBe('pending');
 });
 it('marks overdue delivery terminal after25h and fences every old-generation operation after explicit replay', async () => {
  await fixture.seedCandidate('replay01', { captureReadyAt: fixture.services.now(), processingDispatchedAt: new Date(fixture.services.now().getTime() - 26 * 3600_000) });
  await fixture.request('/extraction/recovery');
  expect((await fixture.candidate('replay01')).processingError).toBe('Queue delivery exceeded completion window; explicit replay required');
  expect(await json(await fixture.request('/extraction/replay', 'POST', { candidate_ids: ['replay01'] }))).toEqual({ candidates: [{ candidate_id: 'replay01', generation: 2 }] });
  expect(await json(await fixture.request('/extraction/terminal', 'POST', { candidate_id: 'replay01', generation: 1, error: 'late DLQ' }))).toEqual({ candidate_id: 'replay01', status: 'stale' });
  expect(await json(await fixture.request('/extraction/results', 'POST', { model: 'test-model', results: [{ candidate_id: 'replay01', generation: 1, extraction: extraction('replay01') }] }))).toEqual({ results: [{ candidate_id: 'replay01', status: 'stale' }] });
  await fixture.request('/extraction/dispatched', 'POST', { candidates: [{ candidate_id: 'replay01', generation: 1 }] });
  const evidence = await json(await fixture.request('/extraction/evidence', 'POST', { candidates: [{ candidate_id: 'replay01', generation: 1 }] }));
  expect(evidence.items).toEqual([expect.objectContaining({ state: 'stale' })]);
  const candidate = await fixture.candidate('replay01');
  expect(candidate.processingError).toBeNull(); expect(candidate.extractedAt).toBeNull(); expect(candidate.processingDispatchedAt).toBeNull();
 });
 it('ignores extraction extras without echoing them and accepts unknown recovery query parameters', async () => {
  const evidence = await json(await fixture.request('/extraction/evidence', 'POST', { extra: 'ignored', candidates: [{ candidate_id: 'missing1', generation: 1, extra: 'ignored' }] }));
  expect(evidence.items).toEqual([{ candidate_id: 'missing1', generation: 1, state: 'missing' }]);
  const dispatched = await json(await fixture.request('/extraction/dispatched', 'POST', { candidates: [{ candidate_id: 'missing1', generation: 1, extra: 'ignored' }], extra: 'ignored' }));
  expect(dispatched).toEqual({ candidates: [{ candidate_id: 'missing1', generation: 1 }] });
  expect((await fixture.request('/extraction/recovery?extra=ignored')).status).toBe(200);
  await fixture.seedCandidate('extras01');
  const result = await fixture.request('/extraction/results', 'POST', { model: 'test-model', extra: 'ignored', results: [{ candidate_id: 'extras01', generation: 1, extra: 'ignored', extraction: { candidate_id: 'extras01', is_event: false, extra: 'ignored' } }] });
  expect(result.status).toBe(200);
  expect((await fixture.candidate('extras01')).extractedOriginal).not.toHaveProperty('extra');
 });

});

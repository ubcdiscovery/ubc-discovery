import { Elysia, t } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { desc, eq } from 'drizzle-orm';
import { apiCredentials as credentials, apiCredentialAuditLogs as audits, users, type ApiCredential, type User } from '../../db/schema';
import type { ApiEnv } from '../../env';
import { hashSecret } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { parseDate, nullableDate } from '../../schemas/events';
import type { ServicesFactory } from '../../services';
import { adminTransaction } from './common';
function presentCredential(credential: ApiCredential, creator: User, now: Date) {
 return { id: credential.id, label: credential.label, scopes: credential.scopes, created_by_user_id: credential.createdByUserId,
 created_by_name: creator.preferredName, created_by_email: creator.email, created_at: credential.createdAt.toISOString(),
 expires_at: credential.expiresAt?.toISOString() ?? null, revoked_at: credential.revokedAt?.toISOString() ?? null,
 last_used_at: credential.lastUsedAt?.toISOString() ?? null, status: credential.revokedAt ? 'revoked' : credential.expiresAt && credential.expiresAt <= now ? 'expired' : 'active' };
}
const uuidParams = t.Object({ credential_id: t.String({ format: 'uuid' }) });
export function createApiKeyRoutes(env: ApiEnv, servicesFactory: ServicesFactory) {
 return new Elysia({ name: 'admin-api-keys', adapter: CloudflareAdapter, prefix: '/admin/api-keys' })
 .get('', ({ request }) => adminTransaction(env, request, servicesFactory, async (tx, _actor, services) => {
  const rows = await tx.select({ credential: credentials, creator: users }).from(credentials).innerJoin(users, eq(users.id, credentials.createdByUserId)).orderBy(desc(credentials.createdAt), desc(credentials.id));
  return { credentials: rows.map(row => presentCredential(row.credential, row.creator, services.now())) };
 }), { detail: { tags: ['Admin API Credentials'] } })
 .post('', ({ request, body, set }) => adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
  const expiresAt = parseDate(body.expires_at, true);
  if (expiresAt && expiresAt <= services.now()) throw new ApiError(422, 'expires_at must be in the future');
  const label = body.label.trim();
  if (!label) throw new ApiError(422, 'label must contain text');
  const secret = btoa(Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const scopes = [...new Set(body.scopes ?? ['candidates:ingest' as const])];
  const [credential] = await tx.insert(credentials).values({ label, scopes, secretHash: await hashSecret(secret), createdByUserId: actor.actorId, expiresAt, createdAt: services.now() }).returning();
  await tx.insert(audits).values({ credentialId: credential!.id, actorType: 'member', actorId: actor.actorId, action: 'create', details: { label, scopes }, createdAt: services.now() });
  const [creator] = await tx.select().from(users).where(eq(users.id, actor.actorId));
  set.status = 201;
  return { ...presentCredential(credential!, creator!, services.now()), raw_token: `ubc_live_${credential!.id}.${secret}` };
 }), { body: t.Object({ label: t.String({ minLength: 1, maxLength: 80 }), expires_at: t.Optional(nullableDate),
  scopes: t.Optional(t.Array(t.Union([t.Literal('candidates:ingest'), t.Literal('candidates:extract')]), { minItems: 1 })) }, { additionalProperties: true }), detail: { tags: ['Admin API Credentials'] } })
 .post('/:credential_id/revoke', ({ request, params }) => adminTransaction(env, request, servicesFactory, async (tx, actor, services) => {
  const [row] = await tx.select({ credential: credentials, creator: users }).from(credentials).innerJoin(users, eq(users.id, credentials.createdByUserId)).where(eq(credentials.id, params.credential_id)).for('update');
  if (!row) throw new ApiError(404, 'API credential not found');
  if (!row.credential.revokedAt) {
   const [updated] = await tx.update(credentials).set({ revokedAt: services.now() }).where(eq(credentials.id, row.credential.id)).returning();
   row.credential = updated!;
   await tx.insert(audits).values({ credentialId: row.credential.id, actorType: 'member', actorId: actor.actorId, action: 'revoke', createdAt: services.now() });
  }
  return presentCredential(row.credential, row.creator, services.now());
 }), { parse: 'none', params: uuidParams, detail: { tags: ['Admin API Credentials'] } })
 .get('/:credential_id/audit', ({ request, params }) => adminTransaction(env, request, servicesFactory, async tx => {
  const [credential] = await tx.select({ id: credentials.id }).from(credentials).where(eq(credentials.id, params.credential_id));
  if (!credential) throw new ApiError(404, 'API credential not found');
  const rows = await tx.select().from(audits).where(eq(audits.credentialId, params.credential_id)).orderBy(audits.createdAt, audits.id);
  return { entries: rows.map(item => ({ id: item.id, credential_id: item.credentialId, actor_type: item.actorType, actor_id: item.actorId, action: item.action, details: item.details, created_at: item.createdAt.toISOString() })) };
 }), { params: uuidParams, detail: { tags: ['Admin API Credentials'] } });
}

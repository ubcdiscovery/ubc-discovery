import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { withDatabase } from '../db';
import { users } from '../db/schema';
import { integerSetting, type ApiEnv } from '../env';
import { requireIdentity, requireMember } from '../http/auth';
import { ApiError } from '../http/errors';
import { presentUser } from '../presenters/users';
import { presentUpload } from '../presenters/storage';
import { isUbcEmail, normalizeMemberInput, onboardingSchema, updateProfileSchema } from '../schemas/member';
import { createServices, type ServicesFactory } from '../services';
import { createAuthRoutes } from './auth';
import { createSavedEventRoutes } from './saved-events';
import { createRatingRoutes } from './ratings';

export function createUserRoutes(env: ApiEnv, servicesFactory: ServicesFactory = () => createServices(env)) {
  return new Elysia({ name: 'member-profile', adapter: CloudflareAdapter, normalize: false })
    .onTransform(({ body }) => normalizeMemberInput(body))
    .get('/users/me', async ({ request }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => presentUser(await requireMember(db, request, services.firebase), services.storage));
    }, { detail: { tags: ['Users'] } })
    .post('/users/onboarding', async ({ request, body }) => {
      const services = servicesFactory();
      const identity = await requireIdentity(request, services.firebase);
      return withDatabase(env, async db => {
        const [user] = await db.insert(users).values({
          firebaseUid: identity.uid, email: identity.email,
          preferredName: body.preferred_name,
          major: body.major ?? null, academicLevel: body.academic_level ?? null, facultyId: body.faculty_id ?? null,
          interests: body.interests ?? null, bio: body.bio ?? null,
          ubcVerified: isUbcEmail(identity.email), onboardingCompleted: true,
        }).onConflictDoNothing({ target: users.firebaseUid }).returning();
        if (!user) throw new ApiError(409, 'User already exists');
        return presentUser(user);
      });
    }, { body: onboardingSchema, detail: { tags: ['Users'] } })
    .put('/users/me', async ({ request, body }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const member = await requireMember(db, request, services.firebase);
        if (body.preferred_name === null) throw new ApiError(422, 'Preferred name cannot be null');
        const changes: Partial<typeof users.$inferInsert> = {};
        if ('preferred_name' in body) changes.preferredName = body.preferred_name;
        if ('major' in body) changes.major = body.major;
        if ('academic_level' in body) changes.academicLevel = body.academic_level;
        if ('faculty_id' in body) changes.facultyId = body.faculty_id;
        if ('interests' in body) changes.interests = body.interests;
        if ('bio' in body) changes.bio = body.bio;
        if (!Object.keys(changes).length) return presentUser(member, services.storage);
        const [updated] = await db.update(users).set(changes).where(eq(users.id, member.id)).returning();
        return presentUser(updated!, services.storage);
      });
    }, { body: updateProfileSchema, detail: { tags: ['Users'] } })
    .get('/users/me/presigned-upload', async ({ request }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const member = await requireMember(db, request, services.firebase);
        const maxBytes = integerSetting(env.PROFILE_PHOTO_MAX_BYTES, 512 * 1024);
        if (member.profilePictureKey) await services.storage.deleteObject(member.profilePictureKey);
        const upload = await services.storage.generatePresignedUpload({
          contentType: 'image/webp', fileKey: `profile-pictures/${crypto.randomUUID()}`, maxFileSizeBytes: maxBytes,
        });
        await db.update(users).set({ profilePictureKey: upload.file_key }).where(eq(users.id, member.id));
        return presentUpload(upload, maxBytes);
      });
    }, { detail: { tags: ['Users'] } })
    .get('/users/me/stats', async ({ request }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const member = await requireMember(db, request, services.firebase);
        return { member_since: member.createdAt.toISOString() };
      });
    }, { detail: { tags: ['Users'] } });
}

export function createMemberRoutes(env: ApiEnv, servicesFactory: ServicesFactory = () => createServices(env)) {
  return new Elysia({ name: 'member-api', adapter: CloudflareAdapter, normalize: false })
    .use(createAuthRoutes(env, servicesFactory))
    .use(createUserRoutes(env, servicesFactory))
    .use(createSavedEventRoutes(env, servicesFactory))
    .use(createRatingRoutes(env, servicesFactory));
}

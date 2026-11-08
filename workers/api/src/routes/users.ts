import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { withDatabase } from "../db";
import { users } from "../db/schema";
import { integerSetting, type ApiEnv } from "../env";
import { requireMember, requireSignedIn } from "../http/auth";
import { ApiError } from "../http/errors";
import { presentUser } from "../presenters/users";
import { presentUpload } from "../presenters/storage";
import {
  isUbcEmail,
  normalizeMemberInput,
  onboardingSchema,
  updateProfileSchema,
} from "../schemas/member";
import { uploadFileSize } from "../schemas/upload-size";
import { createServices, type ServicesFactory } from "../services";
import { createBetterAuthRoutes } from "./auth";
import { createSavedEventRoutes } from "./saved-events";
import { createRatingRoutes } from "./ratings";

export function createUserRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "member-profile", adapter: CloudflareAdapter, normalize: false })
    .onTransform(({ body }) => normalizeMemberInput(body))
    .get(
      "/users/me",
      async ({ request }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) =>
          presentUser(await requireMember(db, request, services), services.storage),
        );
      },
      { detail: { tags: ["Users"] } },
    )
    .post(
      "/users/onboarding",
      async ({ request, body }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const account = await requireSignedIn(db, request, services);
          const [user] = await db
            .update(users)
            .set({
              preferredName: body.preferred_name,
              major: body.major ?? null,
              academicLevel: body.academic_level ?? null,
              facultyId: body.faculty_id ?? null,
              interests: body.interests ?? null,
              bio: body.bio ?? null,
              ubcVerified: isUbcEmail(account.email),
              onboardingCompleted: true,
            })
            .where(and(eq(users.id, account.id), eq(users.onboardingCompleted, false)))
            .returning();
          if (!user) throw new ApiError(409, "User already exists");
          return presentUser(user);
        });
      },
      { body: onboardingSchema, detail: { tags: ["Users"] } },
    )
    .put(
      "/users/me",
      async ({ request, body }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services);
          if (body.preferred_name === null)
            throw new ApiError(422, "Preferred name cannot be null");
          const changes: Partial<typeof users.$inferInsert> = {};
          if ("preferred_name" in body) changes.preferredName = body.preferred_name;
          if ("major" in body) changes.major = body.major;
          if ("academic_level" in body) changes.academicLevel = body.academic_level;
          if ("faculty_id" in body) changes.facultyId = body.faculty_id;
          if ("interests" in body) changes.interests = body.interests;
          if ("bio" in body) changes.bio = body.bio;
          if (!Object.keys(changes).length) return presentUser(member, services.storage);
          const [updated] = await db
            .update(users)
            .set(changes)
            .where(eq(users.id, member.id))
            .returning();
          return presentUser(updated!, services.storage);
        });
      },
      { body: updateProfileSchema, detail: { tags: ["Users"] } },
    )
    .get(
      "/users/me/presigned-upload",
      async ({ request }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services);
          const maxBytes = integerSetting(env.PROFILE_PHOTO_MAX_BYTES, 512 * 1024);
          const fileSizeBytes = uploadFileSize(request, maxBytes, env.STORAGE_PROVIDER === "r2");
          const upload = await services.storage.generatePresignedUpload({
            contentType: "image/webp",
            fileKey: `profile-pictures/${crypto.randomUUID()}`,
            maxFileSizeBytes: maxBytes,
            fileSizeBytes,
          });
          if (member.profilePictureKey)
            await services.storage.deleteObject(member.profilePictureKey);
          await db
            .update(users)
            .set({ profilePictureKey: upload.file_key })
            .where(eq(users.id, member.id));
          return presentUpload(upload, maxBytes);
        });
      },
      { detail: { tags: ["Users"] } },
    )
    .get(
      "/users/me/stats",
      async ({ request }) => {
        const services = servicesFactory();
        return withDatabase(env, async (db) => {
          const member = await requireMember(db, request, services);
          return { member_since: member.createdAt.toISOString() };
        });
      },
      { detail: { tags: ["Users"] } },
    );
}

export function createMemberRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "member-api", adapter: CloudflareAdapter, normalize: false })
    .use(createBetterAuthRoutes(env, servicesFactory))
    .use(createUserRoutes(env, servicesFactory))
    .use(createSavedEventRoutes(env, servicesFactory))
    .use(createRatingRoutes(env, servicesFactory));
}

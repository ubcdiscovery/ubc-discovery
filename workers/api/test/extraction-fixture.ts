import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { eq, sql } from "drizzle-orm";
import { vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { apiCredentials, eventListingCandidates, users } from "../src/db/schema";
import type { ApiEnv } from "../src/env";
import { ApiError, errorResponse } from "../src/http/errors";
import { hashSecret } from "../src/http/auth";
import { createAdminRoutes } from "../src/routes/admin";
import { createIngestionRoutes } from "../src/routes/ingestion";
import { createExtractionRoutes } from "../src/routes/extraction";
import type { RequestServices } from "../src/services";
import type { ObjectStorage } from "../src/services/storage";
export const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(testUrl).hostname))
  throw new Error("Disposable localhost database required");
export function extractionFixture() {
  const schemaName = `extraction_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(testUrl ?? "postgres://localhost/unused");
  url.searchParams.set("options", `-c search_path=${schemaName},public`);
  const env = {
    DATABASE_URL: url.toString(),
    DIRECT_DATABASE_URL: url.toString(),
    EXTRACTION_DELIVERY_TIMEOUT_SECONDS: "90000",
  } as ApiEnv;
  const storage: ObjectStorage = {
    publicUrl: (key) => `https://images.test/${key}`,
    objectExists: vi.fn(async () => true),
    getObjectBytes: vi.fn(async () => new Uint8Array(1)),
    deleteObject: vi.fn(async () => {}),
    copyObject: vi.fn(async () => {}),
    generatePresignedDownloadUrl: vi.fn(async (key) => `https://private.test/${key}?signed=1`),
    generatePresignedUpload: vi.fn(async (options) => ({
      url: "https://upload.test/",
      fields: { key: options.fileKey },
      file_key: options.fileKey,
    })),
  };
  const services: RequestServices = {
    firebase: {
      verifyIdToken: vi.fn(async (token: string) => ({
        uid: token,
        email: `${token}@example.test`,
        email_verified: true,
        name: "",
      })),
      createCustomToken: vi.fn(async () => "unused"),
      getOrCreateUser: vi.fn(async () => "unused"),
    },
    storage,
    sendOtpEmail: vi.fn(async () => {}),
    embedEvent: vi.fn(async () => [1, ...Array<number>(1023).fill(0)]),
    now: () => new Date("2030-01-01T12:00:00Z"),
  };
  const app = new Elysia({ adapter: CloudflareAdapter, normalize: false })
    .onError(({ code, error }) => {
      if (code === "VALIDATION" || code === "PARSE")
        return errorResponse(new ApiError(422, "Invalid request"));
      return errorResponse(error);
    })
    .use(createAdminRoutes(env, () => services))
    .use(createIngestionRoutes(env, () => services))
    .use(createExtractionRoutes(env, () => services))
    .compile();
  let ingestToken = "";
  let extractToken = "";
  const setup = async () => {
    await withDatabase({ DATABASE_URL: testUrl } as ApiEnv, async (db) => {
      await db.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`);
      for (const table of [
        "users",
        "events",
        "api_credentials",
        "api_credential_audit_logs",
        "event_audit_logs",
        "event_listing_candidates",
        "event_listing_candidate_ingestion_audits",
        "candidate_extraction_jobs",
      ]) {
        await db.execute(
          sql`CREATE TABLE ${sql.identifier(schemaName)}.${sql.identifier(table)} (LIKE public.${sql.identifier(table)} INCLUDING ALL)`,
        );
      }
    });
    await withDatabase(env, async (db) => {
      const [admin] = await db
        .insert(users)
        .values({
          firebaseUid: "admin",
          email: "admin@example.test",
          preferredName: "Admin",
          isAdmin: true,
        })
        .returning();
      await db
        .insert(users)
        .values({ firebaseUid: "member", email: "member@example.test", preferredName: "Member" });
      const [ingest] = await db
        .insert(apiCredentials)
        .values({
          label: "fixture ingester",
          scopes: ["candidates:ingest"],
          secretHash: await hashSecret("fixture-secret"),
          createdByUserId: admin!.id,
        })
        .returning();
      const [extract] = await db
        .insert(apiCredentials)
        .values({
          label: "fixture extractor",
          scopes: ["candidates:extract"],
          secretHash: await hashSecret("fixture-secret"),
          createdByUserId: admin!.id,
        })
        .returning();
      ingestToken = `ubc_live_${ingest!.id}.fixture-secret`;
      extractToken = `ubc_live_${extract!.id}.fixture-secret`;
    });
  };
  const teardown = () =>
    withDatabase({ DATABASE_URL: testUrl } as ApiEnv, (db) =>
      db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`),
    );
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    auth: "admin" | "member" | "ingest" | "extract" | "none" = "extract",
    jsonHeader = false,
  ) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(body === undefined && !jsonHeader ? {} : { "Content-Type": "application/json" }),
          ...(auth === "none"
            ? {}
            : {
                Authorization:
                  auth === "admin" || auth === "member"
                    ? `Bearer ${auth}`
                    : `Api-Key ${auth === "ingest" ? ingestToken : extractToken}`,
              }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const seedCandidate = async (
    id: string,
    values: Partial<typeof eventListingCandidates.$inferInsert> = {},
  ) =>
    withDatabase(env, async (db) => {
      const [candidate] = await db
        .insert(eventListingCandidates)
        .values({
          id,
          sourceType: "test",
          externalSourceId: id,
          sourceAccount: "fixture",
          createdAt: new Date("2029-12-31T00:00:00Z"),
          ...values,
        })
        .returning();
      return candidate!;
    });
  const candidate = async (id: string) =>
    withDatabase(
      env,
      async (db) =>
        (
          await db.select().from(eventListingCandidates).where(eq(eventListingCandidates.id, id))
        )[0]!,
    );
  return { env, services, storage, request, setup, teardown, seedCandidate, candidate };
}

export async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json();
}

/** A valid extraction result for a seeded candidate. */
export const extraction = (id: string, club = "Fixture Club") => ({
  candidate_id: id,
  is_event: true,
  title: `Event ${id}`,
  event_date: "2030-02-01T20:00:00-08:00",
  event_end_date: null,
  location_name: "Nest",
  club_name: club,
  vibes: ["social"],
});

import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { withDatabase } from "../src/db";
import {
  eventAuditLogs,
  eventListingCandidates,
  eventListingCandidateIngestionAudits,
  events,
  users,
} from "../src/db/schema";
import { ApiError, errorResponse } from "../src/http/errors";
import { createAdminRoutes } from "../src/routes/admin";
import { createIngestionRoutes } from "../src/routes/ingestion";
import { createUserRoutes } from "../src/routes/users";
import { candidateImageFileSizes, uploadFileSize } from "../src/schemas/upload-size";
import { extractionFixture, testUrl } from "./extraction-fixture";

describe("exact upload size validation", () => {
  it("allows omitted legacy sizes and rejects invalid supplied query sizes", () => {
    expect(uploadFileSize(new Request("http://localhost/upload"), 10, false)).toBeUndefined();
    expect(
      uploadFileSize(new Request("http://localhost/upload?file_size_bytes=10"), 10, true),
    ).toBe(10);
    for (const size of ["", "0", "-1", "1.5", "11", "1e1", "9007199254740993"]) {
      expect(() =>
        uploadFileSize(new Request(`http://localhost/upload?file_size_bytes=${size}`), 10, false),
      ).toThrow(ApiError);
    }
    expect(() => uploadFileSize(new Request("http://localhost/upload"), 10, true)).toThrow(
      ApiError,
    );
  });

  it("requires ordered sizes only when R2 has images, and validates every supplied header", () => {
    const request = (header?: string) =>
      new Request("http://localhost/upload", {
        headers: header === undefined ? {} : { "X-Image-File-Sizes": header },
      });
    expect(candidateImageFileSizes(request(), 0, 10, true)).toBeUndefined();
    expect(candidateImageFileSizes(request("[]"), 0, 10, true)).toEqual([]);
    expect(candidateImageFileSizes(request(), 2, 10, false)).toBeUndefined();
    expect(candidateImageFileSizes(request("[2,10]"), 2, 10, true)).toEqual([2, 10]);
    for (const header of [
      "null",
      "{}",
      "bad",
      "[2]",
      "[2,10,1]",
      "[2,11]",
      "[2,0]",
      "[2,-1]",
      "[2,1.1]",
      '[2,"10"]',
      "[2,9007199254740993]",
    ]) {
      expect(() => candidateImageFileSizes(request(header), 2, 10, false)).toThrow(ApiError);
    }
    expect(() => candidateImageFileSizes(request(), 2, 10, true)).toThrow(ApiError);
  });
});

describe.skipIf(!testUrl)(
  "R2 upload authorization validates sizes before database or storage changes",
  () => {
    const fixture = extractionFixture();
    fixture.env.STORAGE_PROVIDER = "r2";
    const app = new Elysia({ adapter: CloudflareAdapter, normalize: false })
      .onError(({ code, error }) =>
        errorResponse(
          code === "PARSE" || code === "VALIDATION" ? new ApiError(422, "Invalid request") : error,
        ),
      )
      .use(createUserRoutes(fixture.env, () => fixture.services))
      .use(createAdminRoutes(fixture.env, () => fixture.services))
      .use(createIngestionRoutes(fixture.env, () => fixture.services))
      .compile();
    let ingestionToken = "";
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      auth = "Bearer member",
      sizes?: string,
    ) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            authorization: auth,
            "Content-Type": "application/json",
            ...(sizes === undefined ? {} : { "X-Image-File-Sizes": sizes }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );

    beforeAll(async () => {
      await fixture.setup();
      const response = await fixture.request(
        "/admin/api-keys",
        "POST",
        { label: "size contract", scopes: ["candidates:ingest"] },
        "admin",
      );
      const credential = (await response.json()) as { raw_token: string };
      ingestionToken = credential.raw_token;
      await withDatabase(fixture.env, async (db) => {
        await db
          .update(users)
          .set({ profilePictureKey: "profile-pictures/original" })
          .where(eq(users.firebaseUid, "member"));
        await db.insert(events).values({
          id: "sizing01",
          title: "Size fixture",
          source: "manual",
          locationName: "Nest",
          eventDate: new Date("2030-03-01T00:00:00Z"),
        });
      });
    });
    afterAll(fixture.teardown);
    beforeEach(() => vi.clearAllMocks());

    it("keeps the previous profile key and object intact for missing or invalid size", async () => {
      for (const query of [
        "",
        "?file_size_bytes=0",
        "?file_size_bytes=524289",
        "?file_size_bytes=1.5",
      ]) {
        expect((await request(`/users/me/presigned-upload${query}`)).status).toBe(422);
      }
      expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
      expect(fixture.storage.generatePresignedUpload).not.toHaveBeenCalled();
      const [member] = await withDatabase(fixture.env, (db) =>
        db.select().from(users).where(eq(users.firebaseUid, "member")),
      );
      expect(member!.profilePictureKey).toBe("profile-pictures/original");
    });

    it("passes the encoded profile size and retains bodyless admin POST support", async () => {
      expect((await request("/users/me/presigned-upload?file_size_bytes=123")).status).toBe(200);
      expect(fixture.storage.generatePresignedUpload).toHaveBeenCalledWith(
        expect.objectContaining({ fileSizeBytes: 123, maxFileSizeBytes: 512 * 1024 }),
      );
      expect(
        (
          await request(
            "/admin/events/sizing01/presigned-upload?file_size_bytes=456",
            "POST",
            undefined,
            "Bearer admin",
          )
        ).status,
      ).toBe(200);
      expect(fixture.storage.generatePresignedUpload).toHaveBeenCalledWith(
        expect.objectContaining({ fileSizeBytes: 456, fileKey: "event-pictures/sizing01.webp" }),
      );
    });

    it("does not create event upload audits for missing or oversized sizes", async () => {
      const before = await withDatabase(fixture.env, (db) =>
        db.select().from(eventAuditLogs).where(eq(eventAuditLogs.eventId, "sizing01")),
      );
      for (const query of ["", "?file_size_bytes=3145729", "?file_size_bytes=-1"]) {
        expect(
          (
            await request(
              `/admin/events/sizing01/presigned-upload${query}`,
              "POST",
              undefined,
              "Bearer admin",
            )
          ).status,
        ).toBe(422);
      }
      expect(fixture.storage.generatePresignedUpload).not.toHaveBeenCalled();
      const after = await withDatabase(fixture.env, (db) =>
        db.select().from(eventAuditLogs).where(eq(eventAuditLogs.eventId, "sizing01")),
      );
      expect(after).toEqual(before);
    });

    it("preserves the previous profile when upload signing is unavailable", async () => {
      const [before] = await withDatabase(fixture.env, (db) =>
        db.select().from(users).where(eq(users.firebaseUid, "member")),
      );
      vi.mocked(fixture.storage.generatePresignedUpload).mockRejectedValueOnce(
        new ApiError(503, "R2 upload credentials are not configured"),
      );
      expect((await request("/users/me/presigned-upload?file_size_bytes=123")).status).toBe(503);
      expect(fixture.storage.deleteObject).not.toHaveBeenCalled();
      const [after] = await withDatabase(fixture.env, (db) =>
        db.select().from(users).where(eq(users.firebaseUid, "member")),
      );
      expect(after!.profilePictureKey).toBe(before!.profilePictureKey);
    });

    it("rejects missing, oversized, invalid or mismatched candidate sizes before creating candidates or receipts", async () => {
      const body = {
        source_type: "instagram",
        external_source_id: "invalid-size",
        source_account: "fixture",
        image_content_types: ["image/png"],
      };
      for (const header of [undefined, "[5242881]", "[0]", "[1.1]", "[]", "[1,2]", "malformed"]) {
        expect(
          (
            await request(
              "/ingestion/event-candidates",
              "POST",
              body,
              `Api-Key ${ingestionToken}`,
              header,
            )
          ).status,
        ).toBe(422);
      }
      expect(fixture.storage.generatePresignedUpload).not.toHaveBeenCalled();
      await withDatabase(fixture.env, async (db) => {
        expect(await db.select().from(eventListingCandidates)).toHaveLength(0);
        expect(await db.select().from(eventListingCandidateIngestionAudits)).toHaveLength(0);
      });
    });

    it("preserves the strict legacy JSON body and passes ordered candidate sizes independently", async () => {
      const body = {
        source_type: "instagram",
        external_source_id: "ordered-sizes",
        source_account: "fixture",
        image_content_types: ["image/png", "image/jpeg"],
      };
      expect(
        (
          await request(
            "/ingestion/event-candidates",
            "POST",
            { ...body, file_sizes: [123, 456] },
            `Api-Key ${ingestionToken}`,
            "[123,456]",
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await request(
            "/ingestion/event-candidates",
            "POST",
            body,
            `Api-Key ${ingestionToken}`,
            "[123,456]",
          )
        ).status,
      ).toBe(201);
      expect(fixture.storage.generatePresignedUpload).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ contentType: "image/png", fileSizeBytes: 123 }),
      );
      expect(fixture.storage.generatePresignedUpload).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ contentType: "image/jpeg", fileSizeBytes: 456 }),
      );
      expect(
        (
          await request(
            "/ingestion/event-candidates",
            "POST",
            { ...body, external_source_id: "no-images", image_content_types: [] },
            `Api-Key ${ingestionToken}`,
          )
        ).status,
      ).toBe(201);
    });
  },
);

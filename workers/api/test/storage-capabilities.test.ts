import { describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { AwsV4Signer } from "aws4fetch";
import type { ApiEnv } from "../src/env";
import { errorResponse } from "../src/http/errors";
import { createStorageRoutes } from "../src/routes/storage";
import { R2Storage } from "../src/services/storage";
import {
  signStorageCapability,
  verifyStorageCapability,
} from "../src/services/storage-capabilities";

const fixedDate = new Date("2026-10-11T12:00:00Z");
const env = {
  API_PUBLIC_BASE_URL: "https://api.example.test",
  UPLOAD_SIGNING_SECRET: "local-test-only-32-byte-secret-key",
  STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_BUCKET_NAME: "private-test-images",
  R2_ACCESS_KEY_ID: "test-access-id",
  R2_SECRET_ACCESS_KEY: "synthetic-secret",
} as ApiEnv;

describe("storage capability trust boundary", () => {
  it("binds private downloads to object, issuer, signing key and expiry", async () => {
    const token = await signStorageCapability(
      env,
      { operation: "download", key: "candidates/one.webp" },
      300,
      fixedDate,
    );
    expect(await verifyStorageCapability(env, token, "download", fixedDate)).toEqual({
      operation: "download",
      key: "candidates/one.webp",
    });
    await expect(
      verifyStorageCapability(env, token, "download", new Date(fixedDate.getTime() + 300_000)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyStorageCapability(env, token, "download", new Date(fixedDate.getTime() - 1000)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyStorageCapability(
        { ...env, API_PUBLIC_BASE_URL: "https://another.example.test" },
        token,
        "download",
        fixedDate,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      verifyStorageCapability(
        { ...env, UPLOAD_SIGNING_SECRET: "a-different-local-32-byte-secret-key" },
        token,
        "download",
        fixedDate,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const parts = token.split(".");
    parts[1] = btoa(JSON.stringify({ operation: "download", key: "other.webp" })).replace(
      /=+$/,
      "",
    );
    await expect(
      verifyStorageCapability(env, parts.join("."), "download", fixedDate),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("requires a strong configured key and HTTPS outside localhost", async () => {
    await expect(
      signStorageCapability(
        { ...env, UPLOAD_SIGNING_SECRET: "weak" },
        { operation: "download", key: "x" },
        60,
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      signStorageCapability(
        { ...env, API_PUBLIC_BASE_URL: "http://api.example.test" },
        { operation: "download", key: "x" },
        60,
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      signStorageCapability(env, { operation: "download", key: "x" }, 3601),
    ).rejects.toMatchObject({ status: 400 });
  });
});

async function signatureFor(url: URL, length: number, contentType = "image/webp") {
  const unsigned = new URL(url);
  unsigned.searchParams.delete("X-Amz-Signature");
  return new AwsV4Signer({
    url: unsigned.toString(),
    method: "PUT",
    service: "s3",
    region: "auto",
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    signQuery: true,
    allHeaders: true,
    datetime: url.searchParams.get("X-Amz-Date")!,
    headers: { "content-type": contentType, "content-length": String(length) },
  }).signature();
}

describe("direct R2 upload signature", () => {
  it("signs the exact byte count and MIME for one object without a Worker upload hop", async () => {
    const storage = new R2Storage(env);
    const upload = await storage.generatePresignedUpload({
      fileKey: "candidates/hello world.webp",
      contentType: "image/webp",
      maxFileSizeBytes: 512,
      fileSizeBytes: 3,
    });
    const url = new URL(upload.url);
    expect(url.origin).toBe(`https://${"a".repeat(32)}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe("/private-test-images/candidates/hello%20world.webp");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(upload).toMatchObject({
      fields: {},
      method: "PUT",
      headers: { "content-type": "image/webp" },
    });
    expect(url.searchParams.get("X-Amz-Signature")).toBe(await signatureFor(url, 3));
    expect(url.searchParams.get("X-Amz-Signature")).not.toBe(await signatureFor(url, 2));
    expect(url.searchParams.get("X-Amz-Signature")).not.toBe(await signatureFor(url, 4));
    expect(url.searchParams.get("X-Amz-Signature")).not.toBe(
      await signatureFor(url, 3, "image/png"),
    );
    expect(upload.url).not.toContain(env.R2_SECRET_ACCESS_KEY);
  });
  it.each([undefined, 0, -1, 1.5, 513, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unbounded file sizes: %s",
    async (fileSizeBytes) => {
      await expect(
        new R2Storage(env).generatePresignedUpload({
          fileKey: "image.webp",
          contentType: "image/webp",
          maxFileSizeBytes: 512,
          fileSizeBytes,
        }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it("requires dedicated R2 credentials and safe account/bucket configuration", async () => {
    for (const configuration of [
      { R2_ACCESS_KEY_ID: "" },
      { R2_SECRET_ACCESS_KEY: "" },
      { R2_ACCOUNT_ID: "bad" },
      { R2_BUCKET_NAME: "../bad" },
    ]) {
      await expect(
        new R2Storage({ ...env, ...configuration }).generatePresignedUpload({
          fileKey: "image.webp",
          contentType: "image/webp",
          maxFileSizeBytes: 512,
          fileSizeBytes: 3,
        }),
      ).rejects.toMatchObject({ status: 503 });
    }
  });
});

function fixture() {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; metadata?: R2HTTPMetadata }>();
  const get = vi.fn(async (key: string) => {
    const object = objects.get(key);
    if (!object) return null;
    return {
      key,
      size: object.bytes.length,
      body: new Response(object.bytes).body!,
      httpMetadata: object.metadata,
      httpEtag: '"test-etag"',
    } as R2ObjectBody;
  });
  const unused = () => {
    throw new Error("Unexpected R2 operation");
  };
  const bucket: R2Bucket = {
    put: unused,
    get: get as R2Bucket["get"],
    head: unused,
    createMultipartUpload: unused,
    resumeMultipartUpload: unused,
    delete: unused,
    list: unused,
  };
  const configured = { ...env, R2_BUCKET: bucket };
  const app = new Elysia({ adapter: CloudflareAdapter })
    .onError(({ error, code }) =>
      code === "NOT_FOUND" ? new Response(null, { status: 404 }) : errorResponse(error),
    )
    .use(createStorageRoutes(configured))
    .compile();
  return { objects, get, app, storage: new R2Storage(configured) };
}

describe("private R2 bucket read HTTP contract", () => {
  it("keeps evidence private and exposes only public image prefixes", async () => {
    const { app, storage, objects, get } = fixture();
    objects.set("candidates/private.webp", {
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { contentType: "image/webp" },
    });
    const download = await app.handle(
      new Request(await storage.generatePresignedDownloadUrl("candidates/private.webp")),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const reads = get.mock.calls.length;
    expect(
      (
        await app.handle(
          new Request("https://api.example.test/media/public/candidates/private.webp"),
        )
      ).status,
    ).toBe(404);
    expect(get.mock.calls.length).toBe(reads);
    objects.set("event-pictures/hello world.webp", {
      bytes: new Uint8Array([4]),
      metadata: { contentType: "image/webp" },
    });
    const publicDownload = await app.handle(
      new Request(storage.publicUrl("event-pictures/hello world.webp")),
    );
    expect(publicDownload.status).toBe(200);
    expect(publicDownload.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("removes the upload endpoint and rejects invalid download capabilities before reading R2", async () => {
    const { app, get } = fixture();
    expect(
      (
        await app.handle(
          new Request("https://api.example.test/media/upload?token=bad", {
            method: "PUT",
            body: "bad",
          }),
        )
      ).status,
    ).toBe(404);
    expect((await app.handle(new Request("https://api.example.test/media/private"))).status).toBe(
      403,
    );
    expect(get).not.toHaveBeenCalled();
  });
  it("keeps media routes disabled while S3 is selected", async () => {
    const app = new Elysia({ adapter: CloudflareAdapter })
      .onError(({ error, code }) =>
        code === "NOT_FOUND" ? new Response(null, { status: 404 }) : errorResponse(error),
      )
      .use(createStorageRoutes({ ...env, STORAGE_PROVIDER: "s3" }))
      .compile();
    expect(
      (await app.handle(new Request("https://api.example.test/media/private?token=x"))).status,
    ).toBe(404);
  });
});

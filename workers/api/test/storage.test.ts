import { describe, expect, it, vi } from "vitest";
import type { ApiEnv } from "../src/env";
import { createStorage, R2Storage, S3Storage } from "../src/services/storage";

const env = {
  AWS_ACCESS_KEY_ID: "example",
  AWS_SECRET_ACCESS_KEY: "example",
  AWS_SESSION_TOKEN: "sample-token",
  AWS_REGION: "us-west-2",
  S3_BUCKET_NAME: "example-bucket",
  S3_PUBLIC_BASE_URL: "https://images.example.com/",
} as ApiEnv;

describe("S3 rollback storage", () => {
  it("preserves restricted, five-minute POST policies including temporary credentials", async () => {
    const result = await new S3Storage(env).presignedUploadAt(
      {
        contentType: "image/jpeg",
        fileKey: "candidates/hello world/é.jpg",
        maxFileSizeBytes: 1024,
      },
      new Date("2026-10-11T12:00:00Z"),
    );
    expect(result.url).toBe("https://example-bucket.s3.us-west-2.amazonaws.com/");
    const policy = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(result.fields.policy!), (character) => character.charCodeAt(0)),
      ),
    );
    expect(policy.expiration).toBe("2026-10-11T12:05:00.000Z");
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 1024]);
    expect(policy.conditions).toContainEqual({ "Content-Type": "image/jpeg" });
    expect(policy.conditions).toContainEqual({ key: "candidates/hello world/é.jpg" });
    expect(policy.conditions).toContainEqual({ "x-amz-security-token": "sample-token" });
    expect(result.fields["x-amz-signature"]).toMatch(/^[0-9a-f]{64}$/);
  });
  it("encodes keys while preserving path separators and rejects URL traversal", () => {
    const storage = createStorage(env);
    expect(storage.publicUrl("events/hello world/é.jpg")).toBe(
      "https://images.example.com/events/hello%20world/%C3%A9.jpg",
    );
    expect(() => storage.publicUrl("events/../private.jpg")).toThrow("Invalid storage key");
    expect(() => storage.publicUrl("/private.jpg")).toThrow("Invalid storage key");
  });
  it("returns false only for missing objects, preserving permission and provider failures", async () => {
    expect(
      await new S3Storage(
        env,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
      ).objectExists("image.jpg"),
    ).toBe(false);
    await expect(
      new S3Storage(
        env,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
      ).objectExists("image.jpg"),
    ).rejects.toMatchObject({ status: 502 });
  });
  it("detects embedded copy errors even when S3 reports HTTP 200", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<Error><Code>InternalError</Code></Error>"));
    await expect(
      new S3Storage(env, fetcher).copyObject("source.jpg", "destination.jpg"),
    ).rejects.toMatchObject({ status: 502 });
    const request = fetcher.mock.calls[0]![0] as Request;
    expect(request.headers.get("x-amz-copy-source")).toBe("/example-bucket/source.jpg");
    expect(request.headers.get("authorization")).toContain("x-amz-copy-source");
  });
  it("creates a private GET URL signed with session credentials", async () => {
    const url = new URL(
      await new S3Storage(env).generatePresignedDownloadUrl("candidates/image.jpg", 300),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("sample-token");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("R2 bounded image reads and publication copies", () => {
  function setup(bytes: Uint8Array<ArrayBuffer>, reportedSize = bytes.length) {
    const put = vi.fn<R2Bucket["put"]>().mockResolvedValue({ key: "image.jpg" } as R2Object);
    const response = new Response(bytes);
    const body = response.body!;
    const cancel = vi.spyOn(body, "cancel");
    const object: R2ObjectBody = {
      key: "image.png",
      version: "fixture",
      size: reportedSize,
      etag: "fixture",
      httpEtag: '"fixture"',
      uploaded: new Date(),
      storageClass: "Standard",
      checksums: { toJSON: () => ({}) },
      body,
      get bodyUsed() {
        return response.bodyUsed;
      },
      arrayBuffer: () => response.arrayBuffer(),
      bytes: () => response.bytes(),
      text: () => response.text(),
      json: <T>() => response.json() as Promise<T>,
      blob: () => response.blob(),
      writeHttpMetadata: (headers) => headers.set("content-type", "image/png"),
      httpMetadata: { contentType: "image/png", cacheControl: "max-age=60" },
      customMetadata: { provenance: "fixture" },
    };
    const get = vi.fn<R2Bucket["get"]>().mockResolvedValue(object);
    const unused = () => {
      throw new Error("Unexpected R2 operation");
    };
    const bucket: R2Bucket = {
      put,
      head: unused,
      get,
      delete: unused,
      list: unused,
      createMultipartUpload: unused,
      resumeMultipartUpload: unused,
    };
    return { storage: new R2Storage({ ...env, R2_BUCKET: bucket }), put, get, cancel, body };
  }
  it("bounds actual downloaded bytes even when storage metadata understates size", async () => {
    const { storage } = setup(new Uint8Array(10), 1);
    await expect(storage.getObjectBytes("image.jpg", 5)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects oversized publication copies before writing and releases the source stream", async () => {
    const { storage, put, cancel } = setup(new Uint8Array([1]), 5 * 1024 * 1024 + 1);
    await expect(
      storage.copyObject("candidates/one.png", "event-pictures/one.png"),
    ).rejects.toMatchObject({ status: 413 });
    expect(put).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("preserves HTTP and custom metadata when publishing private evidence", async () => {
    const { storage, put, body } = setup(new Uint8Array([1, 2, 3]));
    await storage.copyObject("candidates/one.png", "event-pictures/one.png");
    expect(put).toHaveBeenCalledWith("event-pictures/one.png", body, {
      httpMetadata: { contentType: "image/png", cacheControl: "max-age=60" },
      customMetadata: { provenance: "fixture" },
    });
  });
});

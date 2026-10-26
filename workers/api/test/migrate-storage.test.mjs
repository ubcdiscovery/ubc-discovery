import { afterEach, describe, expect, it } from "vite-plus/test";
import { readFile, writeFile } from "node:fs/promises";
import { migrateStorage } from "../scripts/migrate-storage.mjs";
import {
  account,
  bytes,
  key,
  modified,
  removeTemporaryDirectories,
  fixture,
} from "./migrate-storage-fixture.mjs";

afterEach(removeTemporaryDirectories);

describe("storage migration cutover verification", () => {
  it("checks account, hashes, full HTTP metadata, literal key slashes, and skips folder markers without writes", async () => {
    const f = await fixture();
    const report = await migrateStorage(f.options, f.deps);
    expect(report).toMatchObject({
      cfAccount: account,
      sourceStable: true,
      allVerified: true,
      imageCount: 1,
      sourceCount: 2,
      verificationVersion: 3,
      mode: "verify",
    });
    expect(report.verifiedAt).toMatch(/^202[0-9]-/);
    expect(report.objects[key]).toMatchObject({
      verified: true,
      httpMetadataVerified: true,
      lastModified: modified,
      httpMetadata: {
        "content-type": "image/webp",
        "content-encoding": null,
        expires: "Sun, 01 Nov 2026 00:00:00 GMT",
      },
    });
    expect(f.execute.mock.calls.filter(([program]) => program !== "aws")).toHaveLength(1);
    expect(JSON.stringify(report) + JSON.stringify(f.log.mock.calls)).not.toContain(
      "mock-secret-token",
    );
  });
  it("signs direct R2 PUT with separate scoped credentials and preserves stored HTTP metadata", async () => {
    const f = await fixture();
    const report = await migrateStorage({ ...f.options, mode: "copy" }, f.deps);
    expect(report.verifiedAt).toBeNull();
    const [request] = f.fetcher.mock.calls.find(
      ([input]) => input instanceof Request && input.method === "PUT",
    );
    expect(request.headers.get("content-type")).toBe("image/webp");
    expect(request.headers.get("cache-control")).toBe("public, max-age=60");
    expect(request.headers.get("expires")).toBe("Sun, 01 Nov 2026 00:00:00 GMT");
    expect(Buffer.from(await request.arrayBuffer())).toEqual(bytes);
    expect(f.execute.mock.calls.filter(([program]) => program !== "aws")).toHaveLength(1);
  });
  it("never uses management GET download wrappers as stored metadata", async () => {
    const f = await fixture({
      metadata: { CacheControl: undefined, ContentDisposition: undefined },
      headers: { "cache-control": undefined, "content-disposition": undefined },
    });
    // Explicitly remove absent HTTP fields instead of serializing "undefined".
    f.fetcher.mockImplementation(async (input) => {
      if (input instanceof Request)
        return new Response(bytes, {
          headers: {
            "content-type": "image/webp",
            "content-language": "en",
            expires: "Sun, 01 Nov 2026 00:00:00 GMT",
          },
        });
      if (input.endsWith(`/accounts/${account}`))
        return Response.json({ success: true, result: { id: account } });
      if (input.endsWith("/buckets/target-bucket"))
        return Response.json({ success: true, result: { name: "target-bucket" } });
      throw new Error(
        "Management GET would inject cache-control:no-store and attachment disposition",
      );
    });
    expect((await migrateStorage(f.options, f.deps)).allVerified).toBe(true);
  });
  it.each([
    "content-type",
    "cache-control",
    "content-disposition",
    "content-language",
    "expires",
    "content-encoding",
  ])("rejects target %s changes even with identical bytes", async (header) => {
    const f = await fixture({
      headers: { [header]: header === "expires" ? "Mon, 02 Nov 2026 00:00:00 GMT" : "wrong" },
    });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow("HTTP metadata mismatch");
    expect(JSON.parse(await readFile(f.manifest, "utf8")).allVerified).toBe(false);
  });
  it("rejects byte corruption", async () => {
    const f = await fixture({ bytes: Buffer.from([1, 2, 4]) });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow("content mismatch");
  });
  it("rejects encoded S3 images before writing to R2", async () => {
    const f = await fixture({ metadata: { ContentEncoding: "gzip" } });
    await expect(migrateStorage({ ...f.options, mode: "copy" }, f.deps)).rejects.toThrow(
      "Encoded source images",
    );
    expect(
      f.fetcher.mock.calls.some(([input]) => input instanceof Request && input.method === "PUT"),
    ).toBe(false);
  });
  it("requires an explicit account before authentication or copying", async () => {
    const f = await fixture();
    await expect(migrateStorage({ ...f.options, "cf-account": undefined }, f.deps)).rejects.toThrow(
      "--cf-account",
    );
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("fails account identity mismatch before source or destination writes", async () => {
    const f = await fixture({ accountId: "b".repeat(32) });
    await expect(migrateStorage({ ...f.options, mode: "copy" }, f.deps)).rejects.toThrow(
      "identity mismatch",
    );
    expect(f.execute.mock.calls.some(([program]) => program === "aws")).toBe(false);
  });
  it("rejects manifests pinned to another account", async () => {
    const f = await fixture();
    await writeFile(
      f.manifest,
      JSON.stringify({
        source: "source-bucket",
        target: "target-bucket",
        awsAccount: "123456789012",
        cfAccount: "b".repeat(32),
      }),
    );
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow("different account");
  });
  it("detects metadata-only source modifications in final inventory", async () => {
    const f = await fixture({ finalItem: { LastModified: "2026-10-12T00:01:00+00:00" } });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow("Source changed");
    expect(JSON.parse(await readFile(f.manifest, "utf8")).allVerified).toBe(false);
  });
  it("re-copies metadata-only updates instead of resuming on matching ETag/size", async () => {
    const f = await fixture();
    await writeFile(
      f.manifest,
      JSON.stringify({
        source: "source-bucket",
        target: "target-bucket",
        awsAccount: "123456789012",
        cfAccount: account,
        objects: {
          [key]: {
            verified: true,
            httpMetadataVerified: true,
            etag: f.item.ETag,
            size: bytes.length,
            lastModified: "2026-10-11T00:00:00+00:00",
          },
        },
      }),
    );
    await migrateStorage({ ...f.options, mode: "copy" }, f.deps);
    expect(
      f.fetcher.mock.calls.some(([input]) => input instanceof Request && input.method === "PUT"),
    ).toBe(true);
  });
  it("always re-reads targets on final verify even with a verified copy checkpoint", async () => {
    const f = await fixture();
    await migrateStorage({ ...f.options, mode: "copy" }, f.deps);
    f.fetcher.mockClear();
    await migrateStorage(f.options, f.deps);
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  });
  it.each(["declared", "streamed"])("bounds %s object bodies to five MiB", async (kind) => {
    const f = await fixture({
      response: () =>
        new Response(kind === "streamed" ? Buffer.alloc(5 * 1024 * 1024 + 1) : bytes, {
          headers: {
            "content-type": "image/webp",
            "cache-control": "public, max-age=60",
            "content-disposition": "inline",
            "content-language": "en",
            expires: "Sun, 01 Nov 2026 00:00:00 GMT",
            ...(kind === "declared" ? { "content-length": String(5 * 1024 * 1024 + 1) } : {}),
          },
        }),
    });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow("exceeds supported size");
  });
  it("does not expose subprocess credentials on authentication failures", async () => {
    const f = await fixture();
    await writeFile(
      f.manifest,
      JSON.stringify({
        source: "source-bucket",
        target: "target-bucket",
        awsAccount: "123456789012",
        cfAccount: account,
        allVerified: true,
      }),
    );
    f.execute.mockImplementation(() => {
      throw new Error("captured mock-secret-token");
    });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow(
      "Cannot retrieve Wrangler bearer token",
    );
    expect(JSON.parse(await readFile(f.manifest, "utf8")).allVerified).toBe(false);
  });
  it("requires dedicated R2 credentials instead of falling back to AWS or management credentials", async () => {
    const f = await fixture();
    delete f.deps.environment.R2_SECRET_ACCESS_KEY;
    await expect(migrateStorage({ ...f.options, mode: "copy" }, f.deps)).rejects.toThrow(
      "scoped S3 credentials",
    );
    expect(f.fetcher.mock.calls.some(([input]) => input instanceof Request)).toBe(false);
  });
  it("rejects extra target custom metadata rather than claiming an exact preservation", async () => {
    const f = await fixture({ headers: { "x-amz-meta-private": "unexpected" } });
    await expect(migrateStorage(f.options, f.deps)).rejects.toThrow("HTTP metadata mismatch");
  });
  it("rechecks corruption on resumed version-three copies and repairs it", async () => {
    const f = await fixture();
    await migrateStorage({ ...f.options, mode: "copy" }, f.deps);
    const report = JSON.parse(await readFile(f.manifest, "utf8"));
    expect(report.verificationVersion).toBe(3);
    let gets = 0;
    const original = f.fetcher;
    f.deps.fetcher = async (input, options) => {
      if (input instanceof Request && input.method === "GET" && gets++ === 0)
        return new Response(Buffer.from([9, 8, 7]), {
          headers: {
            "content-type": "image/webp",
            "cache-control": "public, max-age=60",
            "content-disposition": "inline",
            "content-language": "en",
            expires: "Sun, 01 Nov 2026 00:00:00 GMT",
          },
        });
      return original(input, options);
    };
    f.fetcher.mockClear();
    await migrateStorage({ ...f.options, mode: "copy" }, f.deps);
    expect(
      f.fetcher.mock.calls.some(([input]) => input instanceof Request && input.method === "PUT"),
    ).toBe(true);
  });
});

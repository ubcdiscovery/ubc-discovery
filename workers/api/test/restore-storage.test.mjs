import { afterEach, describe, expect, it } from "vite-plus/test";
import { readFile, writeFile, stat } from "node:fs/promises";
import { restoreStorage } from "../scripts/restore-storage.mjs";
import {
  awsAccount,
  key,
  bytes,
  removeTemporaryDirectories,
  fixture,
  puts,
} from "./restore-storage-fixture.mjs";

afterEach(removeTemporaryDirectories);

describe("paused R2 to S3 rollback copy", () => {
  it("verifies bytes/metadata with a private fresh gate, skips folders and never deletes extra S3 objects", async () => {
    const f = await fixture();
    f.targetObjects.set("unreferenced-old-image.webp", f.targetObjects.get(key));
    const report = await restoreStorage(f.options, f.deps);
    expect(report).toMatchObject({
      direction: "r2-to-s3",
      imageCount: 1,
      sourceCount: 2,
      sourceStable: true,
      targetStable: true,
      allVerified: true,
    });
    expect(report.verifiedAt).toMatch(/^202[0-9]-/);
    expect(report.ignoredFolderMarkers).toEqual(["folder/"]);
    expect((await stat(f.manifest)).mode & 0o777).toBe(0o600);
    expect(puts(f)).toHaveLength(0);
    expect(JSON.stringify(report) + JSON.stringify(f.log.mock.calls)).not.toContain(
      "mock-private-token",
    );
    expect(f.execute.mock.calls.some(([, args]) => args.some((arg) => /delete/i.test(arg)))).toBe(
      false,
    );
  });
  it.each([
    ["missing", { missing: true }],
    ["overwritten", { targetBytes: Buffer.from([9, 8, 7]) }],
  ])("copies %s images from current R2 instead of an old snapshot", async (_, override) => {
    const f = await fixture(override),
      copy = await restoreStorage({ ...f.options, mode: "copy" }, f.deps);
    expect(puts(f)).toHaveLength(1);
    expect(f.targetObjects.get(key).bytes).toEqual(bytes);
    expect(copy.verifiedAt).toBeNull();
    expect(copy.allVerified).toBe(true);
    expect(puts(f)[0][1]).toEqual(
      expect.arrayContaining([
        "--expires",
        "Sun, 01 Nov 2026 00:00:00 GMT",
        "--content-type",
        "image/webp",
      ]),
    );
    expect((await restoreStorage(f.options, f.deps)).verifiedAt).not.toBeNull();
  });
  it("rechecks targets on resume and repairs subsequent corruption", async () => {
    const f = await fixture();
    await restoreStorage({ ...f.options, mode: "copy" }, f.deps);
    f.targetObjects.get(key).bytes = Buffer.from([7, 8, 9]);
    await restoreStorage({ ...f.options, mode: "copy" }, f.deps);
    expect(puts(f)).toHaveLength(1);
    expect(f.targetObjects.get(key).bytes).toEqual(bytes);
  });
  it("always rereads both providers on final verify without writes", async () => {
    const f = await fixture();
    await restoreStorage({ ...f.options, mode: "copy" }, f.deps);
    f.execute.mockClear();
    f.fetcher.mockClear();
    await restoreStorage(f.options, f.deps);
    expect(f.execute.mock.calls.filter(([, args]) => args[1] === "get-object")).toHaveLength(1);
    expect(f.fetcher.mock.calls.filter(([url]) => url instanceof Request)).toHaveLength(1);
    expect(puts(f)).toHaveLength(0);
  });
  it.each(["ContentType", "CacheControl", "ContentDisposition", "ContentLanguage", "Expires"])(
    "rejects S3 %s mismatch with identical bytes",
    async (property) => {
      const f = await fixture({
        targetHeaders: { [property]: property === "Expires" ? "2026-11-02T00:00:00Z" : "wrong" },
      });
      await expect(restoreStorage(f.options, f.deps)).rejects.toThrow(
        "bytes or HTTP metadata mismatch",
      );
      expect(JSON.parse(await readFile(f.manifest, "utf8")).allVerified).toBe(false);
    },
  );
  it.each([
    { custom_metadata: { origin: "private" } },
    { ssec: true },
    { http_metadata: { contentType: "image/webp", contentEncoding: "gzip" } },
    { size: 5242881 },
  ])("rejects unsupported sources before writes: %j", async (source) => {
    const f = await fixture({ source });
    await expect(restoreStorage({ ...f.options, mode: "copy" }, f.deps)).rejects.toThrow();
    expect(puts(f)).toHaveLength(0);
  });
  it("detects metadata-only R2 changes with unchanged ETag/bytes/timestamp", async () => {
    const f = await fixture({
      finalSource: { http_metadata: { contentType: "image/webp", cacheControl: "changed" } },
    });
    await expect(restoreStorage(f.options, f.deps)).rejects.toThrow("Source/target changed");
    expect(JSON.parse(await readFile(f.manifest, "utf8")).verifiedAt).toBeNull();
  });
  it("detects S3 modifications after object verification", async () => {
    const f = await fixture({ finalTarget: { LastModified: "2026-10-12T00:01:00Z" } });
    await expect(restoreStorage(f.options, f.deps)).rejects.toThrow("Source/target changed");
  });
  it.each([{ cfAccount: "b".repeat(32) }, { awsAccount: "999999999999" }, { ownerFailure: true }])(
    "checks provider/owner identity before writes: %j",
    async (override) => {
      const f = await fixture(override);
      await expect(restoreStorage({ ...f.options, mode: "copy" }, f.deps)).rejects.toThrow();
      expect(puts(f)).toHaveLength(0);
    },
  );
  it("rejects cross-account manifests before authentication", async () => {
    const f = await fixture();
    await writeFile(
      f.manifest,
      JSON.stringify({
        ...f.options,
        direction: "r2-to-s3",
        cfAccount: "b".repeat(32),
        awsAccount,
        awsRegion: "us-west-2",
      }),
    );
    await expect(restoreStorage(f.options, f.deps)).rejects.toThrow("different direction");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("revokes old gates on authentication failure without leaking CLI credentials", async () => {
    const f = await fixture();
    await restoreStorage(f.options, f.deps);
    f.execute.mockImplementation(() => {
      throw new Error("captured mock-private-token");
    });
    await expect(restoreStorage(f.options, f.deps)).rejects.toThrow(
      "Cannot retrieve Wrangler bearer token",
    );
    const report = JSON.parse(await readFile(f.manifest, "utf8"));
    expect(report.allVerified).toBe(false);
    expect(report.verifiedAt).toBeNull();
  });
  it("rejects changed source headers before writes and corruption after put", async () => {
    const source = await fixture({ sourceHeaders: { etag: '"changed"' } });
    await expect(restoreStorage({ ...source.options, mode: "copy" }, source.deps)).rejects.toThrow(
      "R2 source changed",
    );
    expect(puts(source)).toHaveLength(0);
    const target = await fixture({ missing: true, corruptPut: true });
    await expect(restoreStorage({ ...target.options, mode: "copy" }, target.deps)).rejects.toThrow(
      "bytes or HTTP metadata mismatch",
    );
  });
  it.each(["declared", "streamed"])("bounds %s R2 bodies before S3 writes", async (kind) => {
    const f = await fixture({
      response: () =>
        new Response(kind === "streamed" ? Buffer.alloc(5242881) : bytes, {
          headers: {
            etag: '"r2-etag"',
            "last-modified": "Mon, 12 Oct 2026 00:00:00 GMT",
            "content-type": "image/webp",
            "cache-control": "max-age=60",
            "content-disposition": "inline",
            "content-language": "en",
            expires: "Sun, 01 Nov 2026 00:00:00 GMT",
            ...(kind === "declared" ? { "content-length": "5242881" } : {}),
          },
        }),
    });
    await expect(restoreStorage({ ...f.options, mode: "copy" }, f.deps)).rejects.toThrow(
      "exceeds supported size",
    );
    expect(puts(f)).toHaveLength(0);
  });
  it("rejects missing/repeated pagination cursors instead of truncating rollback", async () => {
    for (const cursor of [undefined, "repeated"]) {
      const f = await fixture({
        listResponse: () =>
          Response.json({ success: true, result: [], result_info: { is_truncated: true, cursor } }),
      });
      await expect(restoreStorage(f.options, f.deps)).rejects.toThrow("pagination cursor");
      expect(puts(f)).toHaveLength(0);
    }
  });
  it("never treats inspect as a verification gate or writes objects", async () => {
    const f = await fixture(),
      report = await restoreStorage({ ...f.options, mode: "inspect" }, f.deps);
    expect(report.allVerified).toBe(false);
    expect(report.verifiedAt).toBeNull();
    expect(puts(f)).toHaveLength(0);
  });
  it("walks all cursor pages before considering the source inventory stable", async () => {
    const f = await fixture({
      listResponse: (_, url) =>
        Response.json({
          success: true,
          result: url.searchParams.has("cursor") ? [] : [f.source],
          result_info: { is_truncated: !url.searchParams.has("cursor"), cursor: "next-page" },
        }),
    });
    const report = await restoreStorage(f.options, f.deps);
    expect(report.allVerified).toBe(true);
    expect(
      f.fetcher.mock.calls.filter(
        ([input]) => typeof input === "string" && input.includes("cursor=next-page"),
      ),
    ).toHaveLength(2);
  });
  it("fails missing pagination information and duplicate source keys", async () => {
    for (const duplicate of [false, true]) {
      const f = await fixture();
      const fetcher = f.fetcher;
      f.deps.fetcher = async (input, options) => {
        if (typeof input === "string" && new URL(input).pathname.endsWith("/objects"))
          return Response.json({
            success: true,
            result: duplicate ? [f.source, f.source] : [],
            ...(duplicate ? { result_info: { is_truncated: false } } : {}),
          });
        return fetcher(input, options);
      };
      await expect(restoreStorage(f.options, f.deps)).rejects.toThrow(
        duplicate ? "Duplicate" : "Invalid R2 object listing",
      );
      expect(puts(f)).toHaveLength(0);
    }
  });
  it("rejects source custom metadata exposed by S3 even when a listing omits it", async () => {
    const f = await fixture({ sourceHeaders: { "x-amz-meta-private": "unexpected" } });
    await expect(restoreStorage({ ...f.options, mode: "copy" }, f.deps)).rejects.toThrow(
      "R2 source changed",
    );
    expect(puts(f)).toHaveLength(0);
  });
  it("sanitizes R2 signed-request and AWS object-read failures and leaves no valid gate", async () => {
    const f = await fixture({ getFailure: true });
    await expect(restoreStorage(f.options, f.deps)).rejects.toThrow("AWS command failed");
    expect(JSON.parse(await readFile(f.manifest, "utf8")).allVerified).toBe(false);
    const g = await fixture();
    const fetcher = g.fetcher;
    g.deps.fetcher = async (...args) => {
      if (args[0] instanceof Request) throw new Error("captured r2-test-secret");
      return fetcher(...args);
    };
    await expect(restoreStorage(g.options, g.deps)).rejects.toThrow(
      "R2 S3 request failed; check credentials and connectivity",
    );
  });
  it("detects recreated source buckets and rejects missing explicit identities before provider calls", async () => {
    const f = await fixture();
    await restoreStorage(f.options, f.deps);
    const report = JSON.parse(await readFile(f.manifest, "utf8"));
    report.sourceCreatedAt = "2026-01-01T00:00:00Z";
    await writeFile(f.manifest, JSON.stringify(report));
    await expect(restoreStorage(f.options, f.deps)).rejects.toThrow("recreated");
    for (const property of ["cf-account", "aws-account", "aws-region"]) {
      const g = await fixture();
      await expect(restoreStorage({ ...g.options, [property]: undefined }, g.deps)).rejects.toThrow(
        "Usage:",
      );
      expect(g.execute).not.toHaveBeenCalled();
    }
  });
});

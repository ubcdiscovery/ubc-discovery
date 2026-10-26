// Shared provider doubles for the storage rollback tests.
import { expect, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const account = "a".repeat(32),
  awsAccount = "123456789012";
export const key = "candidates/a +?#%/00.webp";
export const bytes = Buffer.from([1, 2, 3]),
  modified = "2026-10-12T00:00:00Z";
export const temporary = [];
export async function removeTemporaryDirectories() {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}
export async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "restore-test-"));
  temporary.push(directory);
  const manifest = join(directory, "manifest.json");
  const source = {
    key,
    size: 3,
    etag: "r2-etag",
    last_modified: modified,
    http_metadata: {
      contentType: "image/webp",
      cacheControl: "max-age=60",
      contentDisposition: "inline",
      contentLanguage: "en",
      cacheExpiry: "2026-11-01T00:00:00Z",
    },
    custom_metadata: {},
    ...overrides.source,
  };
  const folder = { key: "folder/", size: 0, etag: "empty-etag", last_modified: modified };
  const targetObjects = new Map();
  function targetObject(body, metadata = {}) {
    return {
      bytes: Buffer.from(body),
      headers: {
        ETag: '"s3-etag"',
        ContentLength: body.length,
        LastModified: modified,
        ContentType: "image/webp",
        CacheControl: "max-age=60",
        ContentDisposition: "inline",
        ContentLanguage: "en",
        Expires: "2026-11-01T00:00:00Z",
        Metadata: {},
        ...metadata,
      },
    };
  }
  if (!overrides.missing)
    targetObjects.set(key, targetObject(overrides.targetBytes ?? bytes, overrides.targetHeaders));
  let lists = 0;
  const execute = vi.fn((program, args) => {
    if (program !== "aws") return JSON.stringify({ type: "oauth", token: "mock-private-token" });
    expect(args[args.indexOf("--region") + 1]).toBe("us-west-2");
    if (args[0] === "sts") {
      expect(args[args.indexOf("--endpoint-url") + 1]).toBe("https://sts.us-west-2.amazonaws.com");
      return JSON.stringify({ Account: overrides.awsAccount ?? awsAccount });
    }
    expect(args[args.indexOf("--expected-bucket-owner") + 1]).toBe(awsAccount);
    expect(args[args.indexOf("--bucket") + 1]).toBe("target-bucket");
    expect(args[args.indexOf("--endpoint-url") + 1]).toBe("https://s3.us-west-2.amazonaws.com");
    if (args[1] === "head-bucket") {
      if (overrides.ownerFailure) throw new Error("secret in AWS stderr");
      return "";
    }
    if (args[1] === "list-objects-v2") {
      const Contents = [...targetObjects].map(([Key, object]) => ({
        Key,
        Size: object.headers.ContentLength,
        ETag: object.headers.ETag,
        LastModified: object.headers.LastModified,
      }));
      return JSON.stringify({
        Contents:
          lists++ && overrides.finalTarget
            ? Contents.map((item) => ({ ...item, ...overrides.finalTarget }))
            : Contents,
      });
    }
    const requestedKey = args[args.indexOf("--key") + 1];
    if (args[1] === "put-object") {
      const uploaded = readFileSync(args[args.indexOf("--body") + 1]),
        headers = { ETag: '"written-etag"' };
      for (const [flag, name] of [
        ["--content-type", "ContentType"],
        ["--cache-control", "CacheControl"],
        ["--content-disposition", "ContentDisposition"],
        ["--content-language", "ContentLanguage"],
        ["--expires", "Expires"],
      ]) {
        if (args.includes(flag)) headers[name] = args[args.indexOf(flag) + 1];
      }
      targetObjects.set(
        requestedKey,
        targetObject(overrides.corruptPut ? Buffer.from([4, 5, 6]) : uploaded, headers),
      );
      return JSON.stringify({ ETag: '"written-etag"' });
    }
    if (args[1] === "get-object") {
      if (overrides.getFailure) throw new Error("secret in AWS stderr");
      const object = targetObjects.get(requestedKey);
      expect(args[args.indexOf("--if-match") + 1]).toBe(object.headers.ETag);
      expect(args[args.indexOf("--range") + 1]).toBe("bytes=0-5242880");
      writeFileSync(args[args.indexOf("--region") - 1], object.bytes);
      return JSON.stringify(object.headers);
    }
    throw new Error("Unexpected mocked AWS operation");
  });
  let sourceLists = 0;
  const fetcher = vi.fn(async (url, options) => {
    expect(options.redirect).toBe("error");
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    if (!(url instanceof Request))
      expect(options.headers.Authorization).toBe("Bearer mock-private-token");
    else {
      expect(url.url).toBe(
        `https://${account}.r2.cloudflarestorage.com/source-bucket/candidates/a%20%2B%3F%23%25/00.webp`,
      );
      expect(url.headers.get("authorization")).toContain("Credential=r2-test-access/");
      expect(url.headers.get("if-match")).toBe('"r2-etag"');
    }
    if (path === `/client/v4/accounts/${account}`)
      return Response.json({ success: true, result: { id: overrides.cfAccount ?? account } });
    if (path.endsWith("/buckets/source-bucket"))
      return Response.json({
        success: true,
        result: { name: "source-bucket", creation_date: overrides.createdAt ?? modified },
      });
    if (path.endsWith("/objects")) {
      const final = sourceLists++ > 0;
      return (
        overrides.listResponse?.(sourceLists, new URL(url)) ??
        Response.json({
          success: true,
          result: [final ? { ...source, ...overrides.finalSource } : source, folder],
          result_info: { is_truncated: false },
        })
      );
    }
    expect(url).toBeInstanceOf(Request);
    return (
      overrides.response?.() ??
      new Response(overrides.sourceBytes ?? bytes, {
        headers: {
          etag: '"r2-etag"',
          "last-modified": "Mon, 12 Oct 2026 00:00:00 GMT",
          "content-type": "image/webp",
          "cache-control": "max-age=60",
          "content-disposition": "inline",
          "content-language": "en",
          expires: "Sun, 01 Nov 2026 00:00:00 GMT",
          ...overrides.sourceHeaders,
        },
      })
    );
  });
  const log = vi.fn();
  return {
    manifest,
    source,
    execute,
    fetcher,
    log,
    targetObjects,
    options: {
      source: "source-bucket",
      target: "target-bucket",
      manifest,
      mode: "verify",
      "cf-account": account,
      "aws-account": awsAccount,
      "aws-region": "us-west-2",
    },
    deps: {
      execute,
      fetcher,
      log,
      environment: {
        AWS_ENDPOINT_URL: "https://wrong.example",
        CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
        R2_ACCESS_KEY_ID: "r2-test-access",
        R2_SECRET_ACCESS_KEY: "r2-test-secret",
      },
    },
  };
}
export const puts = (f) => f.execute.mock.calls.filter(([, args]) => args[1] === "put-object");

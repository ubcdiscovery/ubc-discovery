// Shared provider doubles for the storage migration tests.
import { expect, vi } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const account = "a".repeat(32);
export const bytes = Buffer.from([1, 2, 3]);
export const key = "event-pictures/a +?#%.webp";
export const modified = "2026-10-12T00:00:00+00:00";
export const temporary = [];
export async function removeTemporaryDirectories() {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}
export async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "migration-test-"));
  temporary.push(directory);
  const manifest = join(directory, "manifest.json");
  const item = { Key: key, Size: bytes.length, ETag: '"s3-etag"', LastModified: modified };
  const metadata = {
    ETag: item.ETag,
    ContentLength: item.Size,
    LastModified: modified,
    ContentType: "image/webp",
    CacheControl: "public, max-age=60",
    ContentDisposition: "inline",
    ContentLanguage: "en",
    Expires: "2026-11-01T00:00:00+00:00",
    ...overrides.metadata,
  };
  let lists = 0;
  const execute = vi.fn((program, args, options) => {
    if (program === "aws") {
      if (args[0] === "sts") return JSON.stringify({ Account: "123456789012" });
      expect(args[args.indexOf("--expected-bucket-owner") + 1]).toBe("123456789012");
      if (args[1] === "head-bucket") return "{}";
      if (args[1] === "list-objects-v2")
        return JSON.stringify({
          Contents: [
            lists++ ? { ...item, ...overrides.finalItem } : item,
            { Key: "folder/", Size: 0 },
          ],
        });
      if (args[1] === "get-object") {
        expect(args[args.indexOf("--if-match") + 1]).toBe(item.ETag);
        writeFileSync(args[args.indexOf("--output") - 1], bytes);
        return JSON.stringify(metadata);
      }
      throw new Error("Unexpected AWS mock call");
    }
    if (args.includes("auth")) return JSON.stringify({ type: "oauth", token: "mock-secret-token" });
    expect(args).toContain("put");
    expect(args).toContain("--remote");
    expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(account);
    expect(options.env.CLOUDFLARE_API_TOKEN).toBe("mock-secret-token");
    return "";
  });
  const headers = {
    "content-type": metadata.ContentType,
    "cache-control": metadata.CacheControl,
    "content-disposition": metadata.ContentDisposition,
    "content-language": metadata.ContentLanguage,
    expires: "Sun, 01 Nov 2026 00:00:00 GMT",
    ...overrides.headers,
  };
  const fetcher = vi.fn(async (input, options) => {
    if (input instanceof Request) {
      expect(input.url).toBe(
        `https://${account}.r2.cloudflarestorage.com/target-bucket/event-pictures/a%20%2B%3F%23%25.webp`,
      );
      expect(input.headers.get("authorization")).toContain("Credential=r2-test-access/");
      expect(input.headers.get("authorization")).not.toContain("mock-secret-token");
      expect(options.redirect).toBe("error");
      if (input.method === "PUT") return new Response(null);
      return (
        overrides.response?.() ??
        new Response(overrides.bytes ?? bytes, { status: overrides.status ?? 200, headers })
      );
    }
    expect(options.headers.Authorization).toBe("Bearer mock-secret-token");
    expect(options.redirect).toBe("error");
    if (input === `https://api.cloudflare.com/client/v4/accounts/${account}`) {
      return Response.json({ success: true, result: { id: overrides.accountId ?? account } });
    }
    expect(input).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/target-bucket`,
    );
    return Response.json({ success: true, result: { name: "target-bucket" } });
  });
  const log = vi.fn();
  return {
    manifest,
    item,
    metadata,
    execute,
    fetcher,
    log,
    options: {
      source: "source-bucket",
      target: "target-bucket",
      manifest,
      mode: "verify",
      "cf-account": account,
    },
    deps: {
      execute,
      fetcher,
      log,
      environment: {
        CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
        R2_ACCESS_KEY_ID: "r2-test-access",
        R2_SECRET_ACCESS_KEY: "r2-test-secret",
      },
    },
  };
}

export async function concurrentFixture(count, control) {
  const f = await fixture();
  const items = Array.from({ length: count }, (_, index) => ({
    Key: `event-pictures/${index}.webp`,
    Size: 3,
    ETag: `"source-${index}"`,
    LastModified: modified,
  }));
  const originalExecute = f.execute;
  const sourceFiles = new Map();
  f.deps.execute = vi.fn((program, args, options) => {
    if (program === "aws" && args[1] === "list-objects-v2")
      return JSON.stringify({ Contents: items });
    if (program === "aws" && args[1] === "get-object") {
      const index = Number(args[args.indexOf("--key") + 1].match(/\/(\d+)\.webp$/)[1]);
      const path = args[args.indexOf("--output") - 1];
      sourceFiles.set(index, path);
      expect(args[args.indexOf("--range") + 1]).toBe("bytes=0-5242880");
      writeFileSync(path, Buffer.from([index, 2, 3]));
      return JSON.stringify({ ...f.metadata, ETag: items[index].ETag });
    }
    return originalExecute(program, args, options);
  });
  const originalFetch = f.fetcher;
  let active = 0,
    peak = 0;
  const started = [];
  f.deps.fetcher = async (input, options) => {
    if (!(input instanceof Request)) return originalFetch(input, options);
    const index = Number(new URL(input.url).pathname.match(/\/(\d+)\.webp$/)[1]);
    if (input.method === "PUT") return new Response(null);
    started.push(index);
    active++;
    peak = Math.max(peak, active);
    try {
      if (control) await control(index);
      else await new Promise((resolve) => setTimeout(resolve, 8 - (index % 5)));
      // The concurrent task's source file must remain intact until its own
      // request completes, even when another object finishes first.
      expect(await readFile(sourceFiles.get(index))).toEqual(Buffer.from([index, 2, 3]));
      return new Response(Buffer.from([index, 2, 3]), {
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=60",
          "content-disposition": "inline",
          "content-language": "en",
          expires: "Sun, 01 Nov 2026 00:00:00 GMT",
        },
      });
    } finally {
      active--;
    }
  };
  return { ...f, items, sourceFiles, started, peak: () => peak };
}

export async function asyncSourceFixture(count, control) {
  const f = await concurrentFixture(count);
  const synchronousExecute = f.deps.execute;
  const started = [],
    files = new Map();
  let active = 0,
    peak = 0;
  f.deps.executeAsync = vi.fn(async (program, args, options) => {
    expect(program).toBe("aws");
    expect(args.slice(0, 2)).toEqual(["s3api", "get-object"]);
    expect(args[args.indexOf("--expected-bucket-owner") + 1]).toBe("123456789012");
    expect(args[args.indexOf("--range") + 1]).toBe("bytes=0-5242880");
    expect(options).toEqual({ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const index = Number(args[args.indexOf("--key") + 1].match(/\/(\d+)\.webp$/)[1]);
    expect(args[args.indexOf("--if-match") + 1]).toBe(f.items[index].ETag);
    const path = args[args.indexOf("--output") - 1];
    files.set(index, path);
    started.push(index);
    active++;
    peak = Math.max(peak, active);
    try {
      // Emulate a subprocess creating its output before it has completed.
      await writeFile(path, Buffer.from([index]));
      if (control) await control(index);
      else await new Promise((resolve) => setTimeout(resolve, 8 - (index % 5)));
      expect(await readFile(path)).toEqual(Buffer.from([index]));
      return { stdout: synchronousExecute(program, args, options), stderr: "" };
    } finally {
      active--;
    }
  });
  return { ...f, sourceStarted: started, asyncFiles: files, sourcePeak: () => peak };
}

import { afterEach, describe, expect, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { migrateStorage } from "../scripts/migrate-storage.mjs";
import {
  removeTemporaryDirectories,
  fixture,
  concurrentFixture,
  asyncSourceFixture,
} from "./migrate-storage-fixture.mjs";

afterEach(removeTemporaryDirectories);

describe("bounded migration concurrency", () => {
  it.each([0, 5, 1.5, "invalid"])(
    "rejects unsafe concurrency %s before any provider calls",
    async (concurrency) => {
      const f = await fixture();
      await expect(migrateStorage({ ...f.options, concurrency }, f.deps)).rejects.toThrow(
        "--concurrency",
      );
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("preserves sequential behavior by default", async () => {
    const f = await concurrentFixture(5);
    const report = await migrateStorage(f.options, f.deps);
    expect(f.peak()).toBe(1);
    expect(report.concurrency).toBe(1);
    expect(Object.keys(report.objects)).toHaveLength(5);
  });
  it("limits the pool to four with distinct temp files and complete atomic checkpoints despite out-of-order completion", async () => {
    const f = await concurrentFixture(11);
    const report = await migrateStorage({ ...f.options, concurrency: "4" }, f.deps);
    expect(f.peak()).toBe(4);
    expect(new Set(f.sourceFiles.values()).size).toBe(11);
    expect(Object.keys(report.objects)).toHaveLength(11);
    const persisted = JSON.parse(await readFile(f.manifest, "utf8"));
    expect(persisted).toEqual(report);
    expect(persisted.allVerified).toBe(true);
    expect(persisted.verifiedAt).not.toBeNull();
    for (const item of f.items)
      expect(persisted.objects[item.Key]).toMatchObject({ verified: true, etag: item.ETag });
  });
  it("stops assigning on failure and waits for every in-flight task before cleanup or rejecting", async () => {
    const controls = new Map();
    let waveReady;
    const ready = new Promise((resolve) => {
      waveReady = resolve;
    });
    const f = await concurrentFixture(
      8,
      (index) =>
        new Promise((resolve, reject) => {
          controls.set(index, { resolve, reject });
          if (controls.size === 2) waveReady();
        }),
    );
    const fetcher = f.deps.fetcher;
    f.deps.fetcher = async (input, options) => {
      const response = await fetcher(input, options);
      if (input instanceof Request && new URL(input.url).pathname.endsWith("/0.webp"))
        return new Response(null, { status: 403 });
      return response;
    };
    let settled = false;
    const completion = migrateStorage({ ...f.options, concurrency: 2 }, f.deps).then(
      (report) => {
        settled = true;
        return { report };
      },
      (error) => {
        settled = true;
        return { error };
      },
    );
    await ready;
    controls.get(0).resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect([...f.started].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(await readFile(f.sourceFiles.get(1))).toEqual(Buffer.from([1, 2, 3]));
    controls.get(1).resolve();
    const result = await completion;
    expect(result.error.message).toBe(
      "R2 S3 request failed (HTTP 403); check object and permissions",
    );
    expect([...f.started].sort((a, b) => a - b)).toEqual([0, 1]);
    await expect(readFile(f.sourceFiles.get(1))).rejects.toMatchObject({ code: "ENOENT" });
    const manifest = JSON.parse(await readFile(f.manifest, "utf8"));
    expect(manifest.allVerified).toBe(false);
    expect(manifest.verifiedAt).toBeNull();
    expect(manifest.objects[f.items[1].Key].verified).toBe(true);
    expect(
      f.deps.execute.mock.calls.filter(([, args]) => args[1] === "list-objects-v2"),
    ).toHaveLength(1);
  });
});

describe("asynchronous source subprocesses", () => {
  it.each([1, 4])(
    "bounds concurrent AWS downloads to %s and retains complete verification",
    async (concurrency) => {
      const f = await asyncSourceFixture(9);
      const report = await migrateStorage({ ...f.options, concurrency }, f.deps);
      expect(f.sourcePeak()).toBe(concurrency);
      expect(f.sourceStarted).toHaveLength(9);
      expect(new Set(f.asyncFiles.values()).size).toBe(9);
      expect(f.deps.executeAsync).toHaveBeenCalledTimes(9);
      expect(report).toMatchObject({ mode: "verify", sourceStable: true, allVerified: true });
      expect(report.verifiedAt).not.toBeNull();
      expect(JSON.parse(await readFile(f.manifest, "utf8"))).toEqual(report);
      for (const path of f.asyncFiles.values())
        await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("stops assignments on AWS failure and drains source subprocesses before removing files or rejecting", async () => {
    const controls = new Map();
    let waveReady;
    const ready = new Promise((resolve) => {
      waveReady = resolve;
    });
    const f = await asyncSourceFixture(
      8,
      (index) =>
        new Promise((resolve, reject) => {
          controls.set(index, { resolve, reject });
          if (controls.size === 2) waveReady();
        }),
    );
    let settled = false;
    const completion = migrateStorage({ ...f.options, concurrency: 2 }, f.deps).then(
      (report) => {
        settled = true;
        return { report };
      },
      (error) => {
        settled = true;
        return { error };
      },
    );
    await ready;
    controls.get(0).reject(new Error("private credentials captured in AWS stderr"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(f.sourceStarted).toEqual([0, 1]);
    expect(await readFile(f.asyncFiles.get(1))).toEqual(Buffer.from([1]));
    controls.get(1).resolve();
    const result = await completion;
    expect(result.error.message).toBe("AWS command failed; check authentication and permissions");
    expect(f.sourceStarted).toEqual([0, 1]);
    expect(f.started).toEqual([1]);
    for (const path of f.asyncFiles.values())
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    const manifest = JSON.parse(await readFile(f.manifest, "utf8"));
    expect(manifest).toMatchObject({ allVerified: false, sourceStable: false, verifiedAt: null });
    expect(manifest.objects[f.items[1].Key].verified).toBe(true);
    expect(JSON.stringify(manifest) + JSON.stringify(f.log.mock.calls)).not.toContain(
      "private credentials",
    );
    expect(
      f.deps.execute.mock.calls.filter(([, args]) => args[1] === "list-objects-v2"),
    ).toHaveLength(1);
  });
});

import { describe, expect, it, vi } from "vite-plus/test";
import { reembedEvents } from "../scripts/reembed-events.mjs";
import { EMBEDDING_MODEL_ID } from "../src/services/embeddings.ts";

const account = "a".repeat(32);
const vector = (first) => [first, ...Array(1023).fill(0)];
const event = (id) => ({
  id,
  title: `Event ${id}`,
  description: "",
  club_name: null,
  location_name: "Nest",
});

function fakeDb(pending, { edited = [] } = {}) {
  const updates = [];
  const statements = [];
  return {
    updates,
    statements,
    async query(query, values) {
      const text = typeof query === "string" ? query : query.text;
      statements.push(text.trim().split(/\s/)[0]);
      if (text.includes("GROUP BY")) return { rows: [{ model: "(none)", events: pending.length }] };
      if (text.startsWith("SELECT")) {
        const [afterId] = query.values;
        return { rows: pending.filter((row) => row.id > afterId).slice(0, 32) };
      }
      if (text.trim().startsWith("UPDATE")) {
        updates.push(values);
        return { rowCount: edited.includes(values[0]) ? 0 : 1 };
      }
      return {};
    },
  };
}

const workersAi = (count) =>
  vi.fn(async (_url, init) => {
    const { documents } = JSON.parse(init.body);
    return Response.json({
      success: true,
      result: { shape: [documents.length, 1024], data: documents.map((_, i) => vector(count + i)) },
    });
  });

describe("re-embed events", () => {
  it("embeds pending events as documents in batches and records the model", async () => {
    const pending = Array.from({ length: 40 }, (_, i) => event(String(i).padStart(2, "0")));
    const db = fakeDb(pending);
    const fetcher = workersAi(0);
    const result = await reembedEvents(
      { "cf-account": account },
      { db, fetcher, getToken: () => "token", log: () => {} },
    );
    expect(result).toEqual({ embedded: 40, skipped: 0, failed: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${EMBEDDING_MODEL_ID}`,
    );
    expect(JSON.parse(init.body).documents[0]).toBe("Event 00. Location: Nest");
    expect(db.updates[0].slice(0, 3)).toEqual([
      "00",
      JSON.stringify(vector(0)),
      EMBEDDING_MODEL_ID,
    ]);
  });

  it("skips events edited since they were read and leaves failed batches for a rerun", async () => {
    const db = fakeDb([event("01"), event("02")], { edited: ["02"] });
    expect(
      await reembedEvents(
        { "cf-account": account },
        { db, fetcher: workersAi(0), getToken: () => "token", log: () => {} },
      ),
    ).toEqual({ embedded: 1, skipped: 1, failed: 0 });

    const failing = fakeDb([event("01")]);
    const fetcher = vi.fn(async () => Response.json({ success: true, result: { data: [[1, 2]] } }));
    expect(
      await reembedEvents(
        { "cf-account": account },
        { db: failing, fetcher, getToken: () => "token", log: () => {} },
      ),
    ).toEqual({ embedded: 0, skipped: 0, failed: 1 });
    expect(failing.updates).toEqual([]);
  });

  it("only counts in a dry run and validates the account", async () => {
    const db = fakeDb([event("01")]);
    const getToken = vi.fn();
    await reembedEvents(
      { "cf-account": account, "dry-run": true },
      { db, getToken, log: () => {} },
    );
    expect(getToken).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
    await expect(
      reembedEvents({ "cf-account": "nope" }, { db, getToken, log: () => {} }),
    ).rejects.toThrow("--cf-account");
  });
});

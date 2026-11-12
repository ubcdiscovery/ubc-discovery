import { describe, expect, it, vi } from "vite-plus/test";
import type { ApiEnv } from "../src/env";
import {
  EMBEDDING_MODEL_ID,
  embedText,
  generateEventText,
  isValidEmbedding,
} from "../src/services/embeddings";

function envWith(run: (model: string, inputs: unknown) => Promise<unknown>) {
  return { AI: { run: vi.fn(run) } } as unknown as ApiEnv & {
    AI: { run: ReturnType<typeof vi.fn> };
  };
}

describe("Workers AI embeddings", () => {
  it("preserves event text ordering and skips empty description/organizer", () => {
    expect(
      generateEventText({
        title: "Concert",
        description: "Music",
        club_name: "AMS",
        location_name: "Nest",
      }),
    ).toBe("Concert. Music. Hosted by AMS. Location: Nest");
    expect(
      generateEventText({
        title: "Concert",
        description: "",
        club_name: null,
        location_name: "Nest",
      }),
    ).toBe("Concert. Location: Nest");
  });
  it("embeds event text as a document with the configured model", async () => {
    const embedding = Array.from({ length: 1024 }, (_, index) => index / 1024);
    const env = envWith(async () => ({ shape: [1, 1024], data: [embedding] }));
    expect(await embedText(env, "Example event")).toEqual(embedding);
    expect(env.AI.run).toHaveBeenCalledWith(EMBEDDING_MODEL_ID, { documents: ["Example event"] });
  });
  it("rejects wrong dimensions, booleans, non-finite values, and malformed model responses", async () => {
    expect(isValidEmbedding(Array(1023).fill(0))).toBe(false);
    expect(isValidEmbedding([...Array(1023).fill(0), true])).toBe(false);
    expect(isValidEmbedding([...Array(1023).fill(0), Infinity])).toBe(false);
    expect(
      await embedText(
        envWith(async () => ({ data: [[]] })),
        "text",
      ),
    ).toBeNull();
    expect(
      await embedText(
        envWith(async () => ({ data: [] })),
        "text",
      ),
    ).toBeNull();
    expect(
      await embedText(
        envWith(async () => "invalid"),
        "text",
      ),
    ).toBeNull();
  });
  it("keeps failures best-effort and does not retry an invocation", async () => {
    const env = envWith(async () => {
      throw new Error("network failure");
    });
    expect(await embedText(env, "text")).toBeNull();
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    expect(await embedText({} as ApiEnv, "text")).toBeNull();
  });
});

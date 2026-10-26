import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { ApiEnv } from "../src/env";
import { withDatabase } from "../src/db";
import { eventRatings, events, users } from "../src/db/schema";
import { ApiError, errorResponse } from "../src/http/errors";
import { createEventRoutes } from "../src/routes/events";
import type { RequestServices } from "../src/services";

interface Body {
  events: { id: string; [key: string]: unknown }[];
  scores: number[];
  source: string;
  event_id: string;
}

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(testUrl).hostname))
  throw new Error("Disposable localhost database required");
const schemaName = `discovery_${crypto.randomUUID().replaceAll("-", "")}`;
const url = new URL(testUrl ?? "postgres://localhost/unused");
url.searchParams.set("options", `-c search_path=${schemaName},public`);
const env = { DATABASE_URL: url.toString() } as ApiEnv;
const services = {
  now: () => new Date("2030-01-01T00:00:00Z"),
  storage: { publicUrl: (key: string) => `https://images.example/${key}` },
} as RequestServices;
const app = new Elysia({ adapter: CloudflareAdapter })
  .onError(({ code, error }) => {
    if (code === "VALIDATION") return errorResponse(new ApiError(422, "Invalid request"));
    return errorResponse(error);
  })
  .use(createEventRoutes(env, () => services))
  .compile();
const request = async (path: string) => app.handle(new Request(`http://localhost${path}`));

describe.skipIf(!testUrl)("public event API against PostgreSQL", () => {
  beforeAll(async () => {
    await withDatabase({ DATABASE_URL: testUrl } as ApiEnv, async (db) => {
      await db.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`);
      for (const table of ["users", "events", "event_ratings"]) {
        await db.execute(
          sql`CREATE TABLE ${sql.identifier(schemaName)}.${sql.identifier(table)} (LIKE public.${sql.identifier(table)} INCLUDING ALL)`,
        );
      }
    });
    await withDatabase(env, async (db) => {
      const [member] = await db
        .insert(users)
        .values({
          firebaseUid: schemaName,
          email: `${schemaName}@example.test`,
          preferredName: "Fixture",
        })
        .returning();
      await db.insert(events).values([
        {
          id: "soon0001",
          title: "Earlier event",
          source: "manual",
          locationName: "UBC",
          eventDate: new Date("2030-02-01Z"),
        },
        {
          id: "soon0002",
          title: "Later event",
          description: "Search Needle",
          source: "manual",
          locationName: "UBC",
          eventDate: new Date("2030-03-01Z"),
        },
        {
          id: "past0001",
          title: "Past event",
          source: "manual",
          locationName: "UBC",
          eventDate: new Date("2029-01-01Z"),
        },
        {
          id: "hide0001",
          title: "Search Needle",
          source: "manual",
          locationName: "UBC",
          eventDate: new Date("2030-04-01Z"),
          isArchived: true,
        },
      ]);
      await db.insert(eventRatings).values({ userId: member!.id, eventId: "past0001", stars: 4.5 });
    });
  });
  afterAll(async () => {
    await withDatabase({ DATABASE_URL: testUrl } as ApiEnv, (db) =>
      db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`),
    );
  });

  it("preserves reverse-date discovery ordering, pagination and public snake_case fields", async () => {
    const response = await request("/events?limit=1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(["soon0002"]);
    expect(body.events[0]).toMatchObject({
      source_label: "campus_community",
      event_picture_url: "https://images.example/event-pictures/soon0002.webp",
      event_date: "2030-03-01T00:00:00.000Z",
    });
    expect(body.events[0]).not.toHaveProperty("embedding_vector");
    expect(body.events[0]).not.toHaveProperty("is_archived");
    expect(
      ((await (await request("/events?skip=1")).json()) as Body).events.map(
        (event: { id: string }) => event.id,
      ),
    ).toEqual(["soon0001"]);
  });

  it("aggregates past ratings and excludes archived rows", async () => {
    expect(((await (await request("/events/past")).json()) as Body).events).toEqual([
      expect.objectContaining({ id: "past0001", average_rating: 4.5, rating_count: 1 }),
    ]);
  });

  it("searches descriptions case-insensitively and keeps its forward date ordering", async () => {
    expect(
      ((await (await request("/events/search?q=needle")).json()) as Body).events.map(
        (event: { id: string }) => event.id,
      ),
    ).toEqual(["soon0002"]);
    expect(((await (await request("/events/search?q=%20x%20")).json()) as Body).events).toEqual([]);
    expect(
      ((await (await request("/events/search?q=event")).json()) as Body).events.map(
        (event: { id: string }) => event.id,
      ),
    ).toEqual(["soon0001", "soon0002"]);
  });

  it("does not reveal archived details and validates pagination before querying", async () => {
    for (const path of ["/events/hide0001", "/events/missing"]) {
      const response = await request(path);
      expect(response.status).toBe(404);
      expect((await response.json()) as Body).toEqual({ detail: "Event not found" });
    }
    for (const query of ["skip=-1", "limit=101", "skip=1.5", "limit=bad"])
      expect((await request(`/events?${query}`)).status).toBe(422);
    expect(((await (await request("/events?limit=0")).json()) as Body).events).toEqual([]);
    expect((await request("/events?limit=-1")).status).toBe(500);
  });
});

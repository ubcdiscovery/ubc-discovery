import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { withDatabase } from "../src/db";
import { eventRatings, savedEvents } from "../src/db/schema";
import {
  MemberTestJson,
  testUrl,
  env,
  fixedNow,
  serviceMocks,
  app,
  request,
  member,
  event,
  cleanupMemberFixtures,
} from "./member-fixture";

afterEach(cleanupMemberFixtures);

describe.skipIf(!testUrl)("saved events and ratings visibility contracts", () => {
  it("accepts browser JSON headers on empty-body save/unsave requests while validating JSON-required mutations", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const headers = { uid: existing.identity.uid, jsonHeader: true };
    const saved = await api.handle(
      request(`/saved-events/${target.id}`, { ...headers, method: "PUT" }),
    );
    expect(saved.status).toBe(201);
    expect(saved.headers.get("location")).toBe(`/saved-events/${target.id}`);
    expect(
      (await api.handle(request(`/saved-events/${target.id}`, { ...headers, method: "PUT" })))
        .status,
    ).toBe(200);
    const removed = await api.handle(
      request(`/saved-events/${target.id}`, { ...headers, method: "DELETE" }),
    );
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");
    expect(
      (await api.handle(request(`/ratings/mine/${target.id}`, { ...headers, method: "POST" })))
        .status,
    ).toBe(422);
    expect((await api.handle(request("/users/me", { ...headers, method: "PUT" }))).status).toBe(
      422,
    );
    await withDatabase(env, async (db) =>
      expect(
        await db.select().from(savedEvents).where(eq(savedEvents.eventId, target.id)),
      ).toHaveLength(0),
    );
  });

  it("saves idempotently with correct status/location and removes idempotently", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const created = await api.handle(
      request(`/saved-events/${target.id}`, { method: "PUT", uid: existing.identity.uid }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(`/saved-events/${target.id}`);
    const first = await created.json<MemberTestJson>();
    const again = await api.handle(
      request(`/saved-events/${target.id}`, { method: "PUT", uid: existing.identity.uid }),
    );
    expect(again.status).toBe(200);
    expect(await again.json<MemberTestJson>()).toEqual(first);
    const list = await api.handle(
      request("/saved-events?limit=20&skip=0", { uid: existing.identity.uid }),
    );
    const value = await list.json<MemberTestJson>();
    expect(value.total).toBe(1);
    expect(value.saved_events[0]).toMatchObject({
      event: {
        id: target.id,
        event_picture_url: `https://media.example.com/event-pictures/${target.id}.webp`,
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const removed = await api.handle(
        request(`/saved-events/${target.id}`, { method: "DELETE", uid: existing.identity.uid }),
      );
      expect(removed.status).toBe(204);
      expect(await removed.text()).toBe("");
    }
  });

  it("hides archived saved events and ratings and scopes private lists to the member", async () => {
    const existing = await member();
    const other = await member();
    const target = await event({ isArchived: true });
    await withDatabase(env, async (db) => {
      await db.insert(savedEvents).values({ userId: existing.row.id, eventId: target.id });
      await db
        .insert(eventRatings)
        .values({ userId: existing.row.id, eventId: target.id, stars: 5 });
    });
    const api = app(serviceMocks().factory);
    const saved = await api.handle(request("/saved-events", { uid: existing.identity.uid }));
    expect(await saved.json<MemberTestJson>()).toEqual({ saved_events: [], total: 0 });
    const ratings = await api.handle(request("/ratings", { uid: existing.identity.uid }));
    expect(await ratings.json<MemberTestJson>()).toEqual({ ratings: [], total: 0 });
    expect(
      (
        await api.handle(
          request(`/saved-events/${target.id}`, { method: "PUT", uid: other.identity.uid }),
        )
      ).status,
    ).toBe(404);
    expect((await api.handle(request(`/ratings/${target.id}`))).status).toBe(404);
  });

  it("prevents rating unfinished events and preserves missing-event errors", async () => {
    const existing = await member();
    const target = await event({ eventEndDate: new Date(fixedNow.getTime() + 3600_000) });
    const api = app(serviceMocks().factory);
    const future = await api.handle(
      request(`/ratings/mine/${target.id}`, {
        method: "POST",
        uid: existing.identity.uid,
        body: { stars: 5 },
      }),
    );
    expect(future.status).toBe(400);
    expect(await future.json<MemberTestJson>()).toEqual({
      detail: "Event can not be rated at this time",
    });
    const missing = await api.handle(request("/ratings/nonexist"));
    expect(missing.status).toBe(404);
    expect(await missing.json<MemberTestJson>()).toEqual({
      detail: "Event with give id NOT found",
    });
  });

  it("atomically upserts ratings and exposes public reviews without authentication", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const created = await api.handle(
      request(`/ratings/mine/${target.id}`, {
        method: "POST",
        uid: existing.identity.uid,
        body: { stars: 5, strong_vibes: ["social"], note: "Nice event" },
      }),
    );
    expect(created.status).toBe(200);
    const first = await created.json<MemberTestJson>();
    expect(first).toMatchObject({
      user_id: existing.row.id,
      user_name: "Fixture Member",
      event_id: target.id,
      stars: 5,
      strong_vibes: ["social"],
      note: "Nice event",
    });
    const updated = await api.handle(
      request(`/ratings/mine/${target.id}`, {
        method: "POST",
        uid: existing.identity.uid,
        body: { stars: 3 },
      }),
    );
    expect(await updated.json<MemberTestJson>()).toMatchObject({
      id: first.id,
      stars: 3,
      strong_vibes: [],
      note: null,
      created_at: first.created_at,
    });
    const mine = await api.handle(
      request(`/ratings/mine/${target.id}`, { uid: existing.identity.uid }),
    );
    expect((await mine.json<MemberTestJson>()).stars).toBe(3);
    const publicReviews = await api.handle(request(`/ratings/${target.id}`));
    expect(publicReviews.status).toBe(200);
    expect(await publicReviews.json<MemberTestJson>()).toHaveLength(1);
    const privateList = await api.handle(request("/ratings", { uid: existing.identity.uid }));
    expect((await privateList.json<MemberTestJson>()).total).toBe(1);
    const other = await member();
    expect(
      (await api.handle(request(`/ratings/mine/${target.id}`, { uid: other.identity.uid }))).status,
    ).toBe(404);
    expect(
      (
        await (
          await api.handle(request("/ratings", { uid: other.identity.uid }))
        ).json<MemberTestJson>()
      ).total,
    ).toBe(0);
  });

  it("keeps concurrent saves and ratings unique and isolates a different member", async () => {
    const existing = await member();
    const other = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    const saves = await Promise.all(
      Array.from({ length: 2 }, () =>
        api.handle(
          request(`/saved-events/${target.id}`, { method: "PUT", uid: existing.identity.uid }),
        ),
      ),
    );
    expect(saves.map((response) => response.status).sort()).toEqual([200, 201]);
    const ratings = await Promise.all(
      [3, 5].map((stars) =>
        api.handle(
          request(`/ratings/mine/${target.id}`, {
            method: "POST",
            uid: existing.identity.uid,
            body: { stars },
          }),
        ),
      ),
    );
    expect(ratings.every((response) => response.status === 200)).toBe(true);
    await withDatabase(env, async (db) => {
      expect(
        await db.select().from(savedEvents).where(eq(savedEvents.eventId, target.id)),
      ).toHaveLength(1);
      expect(
        await db.select().from(eventRatings).where(eq(eventRatings.eventId, target.id)),
      ).toHaveLength(1);
    });
    const otherSaved = await api.handle(request("/saved-events", { uid: other.identity.uid }));
    expect(await otherSaved.json()).toEqual({ saved_events: [], total: 0 });
    const unsave = await api.handle(
      request(`/saved-events/${target.id}`, { method: "DELETE", uid: other.identity.uid }),
    );
    expect(unsave.status).toBe(204);
    const ownSaved = await api.handle(request("/saved-events", { uid: existing.identity.uid }));
    expect((await ownSaved.json<MemberTestJson>()).total).toBe(1);
  });

  it("rejects invalid stars and out-of-range pagination", async () => {
    const existing = await member();
    const target = await event();
    const api = app(serviceMocks().factory);
    for (const stars of [0, 6, 2.5]) {
      expect(
        (
          await api.handle(
            request(`/ratings/mine/${target.id}`, {
              method: "POST",
              uid: existing.identity.uid,
              body: { stars },
            }),
          )
        ).status,
      ).toBe(422);
    }
    expect(
      (await api.handle(request("/saved-events?skip=-1", { uid: existing.identity.uid }))).status,
    ).toBe(422);
    expect(
      (await api.handle(request("/ratings?limit=101", { uid: existing.identity.uid }))).status,
    ).toBe(422);
    expect(
      (await api.handle(request("/saved-events?limit=0", { uid: existing.identity.uid }))).status,
    ).toBe(200);
  });
});

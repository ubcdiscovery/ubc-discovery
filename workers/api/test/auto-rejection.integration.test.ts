import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { similarTitles } from "../src/services/candidate-publication";
import { extractionFixture, extraction, json, testUrl } from "./extraction-fixture";
const fixture = extractionFixture();

describe("reminder titles", () => {
  it("matches reminders of the same event but not other events", () => {
    expect(similarTitles("LOOP: AI & Automation Hackathon", "LOOP Hackathon")).toBe(true);
    expect(similarTitles("Pupil Party", "Pupil Party! Meet the Doctors")).toBe(true);
    expect(similarTitles("SHE KILLS MONSTERS", "She Kills Monsters")).toBe(true);
    expect(similarTitles("Girls Home Cafe & Bedazzling Event", "Men's Night")).toBe(false);
    expect(similarTitles("UBC Improv Show", "What's In The Box!")).toBe(false);
    expect(similarTitles("Event batch001", "Event batch002")).toBe(false);
    expect(similarTitles("!!!", "Pupil Party")).toBe(false);
  });
});

describe.skipIf(!testUrl)("automatic Candidate rejection", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.teardown);
  it("rejects captures that extraction finds are not events", async () => {
    await fixture.seedCandidate("notevent", { captureReadyAt: fixture.services.now() }, [
      "hiringclub",
    ]);
    const response = await fixture.request("/extraction/results", "POST", {
      model: "test-model",
      results: [
        {
          candidate_id: "notevent",
          generation: 1,
          extraction: { ...extraction("notevent"), is_event: false },
        },
      ],
    });
    expect(await json(response)).toEqual({
      results: [{ candidate_id: "notevent", status: "completed" }],
    });
    const candidate = await fixture.candidate("notevent");
    expect(candidate.status).toBe("rejected");
    expect(candidate.processingCompletedAt).not.toBeNull();
  });
  it("rejects reminders for a Host's live event but keeps other same-day events in review", async () => {
    for (const id of ["remind01", "remind02", "remind03"])
      await fixture.seedCandidate(id, { captureReadyAt: fixture.services.now() }, ["remindclub"]);
    const send = (id: string, title: string, eventDate: string) =>
      fixture.request("/extraction/results", "POST", {
        model: "test-model",
        results: [
          {
            candidate_id: id,
            generation: 1,
            extraction: { ...extraction(id), title, event_date: eventDate },
          },
        ],
      });
    await send("remind01", "Pupil Party", "2030-03-01T18:30:00-08:00");
    expect((await fixture.candidate("remind01")).status).toBe("approved");
    await send("remind02", "Pupil Party! Meet the Doctors", "2030-03-01T19:00:00-08:00");
    expect((await fixture.candidate("remind02")).status).toBe("rejected");
    await send("remind03", "Study Night", "2030-03-01T18:30:00-08:00");
    expect((await fixture.candidate("remind03")).status).toBe("pending");
  });
});

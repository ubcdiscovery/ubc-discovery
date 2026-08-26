import { expect, test } from "@playwright/test";
import { adminProfile, existingProfile, mockApi, setAuthenticatedUser } from "./support/auth";
import { mockCandidate, mockExtractedCandidate } from "./support/candidates";

test("administrator filters and inspects an Event Listing Candidate", async ({ page }) => {
  const candidateQueries: Array<{ q: string; status: string; sourceType: string }> = [];
  await mockApi(page, {
    profile: adminProfile,
    adminCandidates: [mockCandidate],
    onCandidateList: (filters) => candidateQueries.push(filters),
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });

  await page.goto("/admin/candidates");

  const statusFilter = page.getByRole("combobox", { name: "Filter candidate status" });

  // The queue opens on pending review by default.
  await expect(statusFilter).toHaveValue("pending");
  await expect(page.getByRole("table", { name: "Event Listing Candidates" })).toBeVisible();
  await expect(page.getByRole("link", { name: mockCandidate.source_account })).toBeVisible();
  expect(candidateQueries.at(-1)).toMatchObject({ status: "pending" });

  // The chosen status sticks across visits.
  await statusFilter.selectOption("approved");
  await expect(page).toHaveURL(/status=approved/);
  expect(candidateQueries.at(-1)).toMatchObject({ status: "approved" });

  await statusFilter.selectOption({ label: "All statuses" });
  await expect(page).not.toHaveURL(/status=/);
  expect(candidateQueries.at(-1)).toMatchObject({ status: "" });
  await page.reload();
  await expect(statusFilter).toHaveValue("");
  expect(candidateQueries.at(-1)).toMatchObject({ status: "" });

  await page.getByRole("link", { name: mockCandidate.source_account }).click();

  await expect(page).toHaveURL(`/admin/candidates/${mockCandidate.id}`);
  await expect(page.getByRole("heading", { name: mockCandidate.source_account })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source text" })).toBeVisible();
  await expect(page.getByText(mockCandidate.description, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source images" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: `Source image 1 for ${mockCandidate.source_account}` }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Classification" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Extracted original" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Current draft" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Extraction metadata" })).toHaveCount(0);
  await expect(page.getByText("created", { exact: true })).toBeVisible();
  await expect(page.getByText("Campus importer", { exact: true })).toBeVisible();
});

test("administrator quick-reviews a pending Candidate from the queue", async ({ page }) => {
  let decision = "";
  await mockApi(page, {
    profile: adminProfile,
    adminCandidates: [mockExtractedCandidate],
    onCandidateDecision: (action) => {
      decision = action;
    },
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto("/admin/candidates");

  // A stray click can be backed out without changing anything.
  await page
    .getByRole("button", { name: `Reject ${mockExtractedCandidate.source_account}` })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Reject this Candidate?");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(decision).toBe("");

  await page
    .getByRole("button", { name: `Approve ${mockExtractedCandidate.source_account}` })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Approve this Candidate?");
  await page.getByRole("button", { name: "Confirm approve" }).click();
  await expect.poll(() => decision).toBe("approve");
  await expect(page.getByText("No matching Candidates.")).toBeVisible();
});

test("administrator inspects extracted Candidate draft fields", async ({ page }) => {
  await mockApi(page, {
    profile: adminProfile,
    adminCandidates: [mockExtractedCandidate],
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });

  await page.goto("/admin/candidates");
  await expect(page.getByText("event", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: mockExtractedCandidate.source_account }).click();

  await expect(page.getByRole("heading", { name: "Classification" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Extracted original" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current draft" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Extraction metadata" })).toBeVisible();
  await expect(page.getByText("Club Night", { exact: true })).toBeVisible();
  await expect(page.getByText("gpt-5.6-luna", { exact: true })).toBeVisible();
});

test("administrator saves a correction and confirms Candidate approval", async ({ page }) => {
  let correctedTitle = "";
  let decision = "";
  await mockApi(page, {
    profile: adminProfile,
    adminCandidates: [mockExtractedCandidate],
    onCandidateCorrect: (body) => {
      correctedTitle = String(body.title);
    },
    onCandidateDecision: (action) => {
      decision = action;
    },
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto(`/admin/candidates/${mockExtractedCandidate.id}`);
  await page.getByLabel("Title").fill("Corrected club night");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => correctedTitle).toBe("Corrected club night");
  await page.getByRole("button", { name: "Approve Candidate" }).click();
  await expect(page.getByText("Confirm approval?", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Confirm approve" }).click();
  await expect.poll(() => decision).toBe("approve");
  await expect(page).toHaveURL(`/admin/events/${mockExtractedCandidate.id}`);
});

test("administrator rejects then returns a Candidate to review", async ({ page }) => {
  await mockApi(page, {
    profile: adminProfile,
    adminCandidates: [{ ...mockExtractedCandidate, status: "pending" }],
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto(`/admin/candidates/${mockExtractedCandidate.id}`);
  await page.getByRole("button", { name: "Reject Candidate" }).click();
  await page.getByRole("button", { name: "Confirm reject" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "rejected" })).toBeVisible();
  await page.getByRole("button", { name: "Return to review" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "pending" })).toBeVisible();
});

test("administrator can follow Candidate hold links and keeps a failed draft", async ({ page }) => {
  const heldCandidate = {
    ...mockExtractedCandidate,
    same_club_same_day_matches: [
      { kind: "event" as const, id: "event-held", title: "Held Event", event_date: "2026-09-04T20:00:00Z" },
      { kind: "candidate" as const, id: "candidate-held", title: "Held Candidate", event_date: "2026-09-04T21:00:00Z" },
    ],
  };
  await mockApi(page, {
    profile: adminProfile,
    adminCandidates: [heldCandidate],
    candidateMutationError: { status: 409, detail: "Candidate changed" },
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto(`/admin/candidates/${heldCandidate.id}`);
  await expect(page.getByRole("link", { name: "Held Event" })).toHaveAttribute(
    "href",
    "/admin/events/event-held",
  );
  await expect(page.getByRole("link", { name: "Held Candidate" })).toHaveAttribute(
    "href",
    "/admin/candidates/candidate-held",
  );
  await page.getByLabel("Title").fill("Unsaved correction");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Candidate changed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Unsaved correction");
});

test("ordinary Members cannot open the Candidate review area", async ({ page }) => {
  await mockApi(page, { profile: existingProfile, adminCandidates: [mockExtractedCandidate] });
  await setAuthenticatedUser(page, { uid: "member-uid", email: existingProfile.email });
  await page.goto(`/admin/candidates/${mockExtractedCandidate.id}`);
  await expect(page.getByRole("heading", { name: "Administrator access required." })).toBeVisible();
});

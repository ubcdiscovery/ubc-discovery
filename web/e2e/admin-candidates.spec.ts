import { expect, test } from "@playwright/test";
import { adminProfile, mockApi, setAuthenticatedUser } from "./support/auth";
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

  await expect(page.getByRole("heading", { name: "Candidates" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Event Listing Candidates" })).toBeVisible();
  await expect(page.getByRole("link", { name: mockCandidate.source_account })).toBeVisible();

  await page.getByRole("combobox", { name: "Filter candidate status" }).selectOption("pending");
  await expect(page).toHaveURL(/status=pending/);
  expect(candidateQueries.at(-1)).toMatchObject({ status: "pending" });

  await page.getByRole("link", { name: mockCandidate.source_account }).click();

  await expect(page).toHaveURL(`/admin/candidates/${mockCandidate.id}`);
  await expect(page.getByRole("heading", { name: mockCandidate.source_account })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source text" })).toBeVisible();
  await expect(page.getByText(mockCandidate.description, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source images" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: `Source image 1 for ${mockCandidate.source_account}` })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Classification" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Extracted original" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Current draft" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Extraction metadata" })).toHaveCount(0);
  await expect(page.getByText("created", { exact: true })).toBeVisible();
  await expect(page.getByText("Campus importer", { exact: true })).toBeVisible();
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

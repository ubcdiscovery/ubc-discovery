import { expect, test } from "@playwright/test";
import { adminProfile, mockApi, setAuthenticatedUser } from "./support/auth";
import { mockApiCredential } from "./support/api-keys";

test("administrator generates and copies an API key once", async ({ page }) => {
  let created: Record<string, unknown> | undefined;
  await mockApi(page, {
    profile: adminProfile,
    adminApiKeys: [mockApiCredential],
    onApiKeyCreate: (body) => {
      created = body;
    },
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });

  await page.goto("/admin/api-keys");
  await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Managed API credentials" })).toBeVisible();
  await expect(page.getByText(mockApiCredential.label)).toBeVisible();

  await page.getByLabel("Name").fill("Nightly importer");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("generated-api-token")).toHaveText(
    "ubc_live_22222222-2222-2222-2222-222222222222.generated-secret"
  );
  expect(created).toMatchObject({ label: "Nightly importer", expires_at: null });

  await page.reload();
  await expect(page.getByTestId("generated-api-token")).toHaveCount(0);
  await expect(page.getByText("Nightly importer")).toBeVisible();
});

test("administrator revokes a listed credential", async ({ page }) => {
  let revoked: string | undefined;
  await mockApi(page, {
    profile: adminProfile,
    adminApiKeys: [mockApiCredential],
    onApiKeyRevoke: (id) => {
      revoked = id;
    },
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });

  await page.goto("/admin/api-keys");
  await page.getByRole("button", { name: "Revoke" }).click();
  expect(revoked).toBe(mockApiCredential.id);
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
});

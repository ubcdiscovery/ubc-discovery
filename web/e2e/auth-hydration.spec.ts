import { expect, test, type Page } from "@playwright/test";
import { existingProfile, mockApi } from "./support/auth";

function profileRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/users/me")) {
      requests.push(request.url());
    }
  });
  return requests;
}

async function failFirstProfileRequest(page: Page) {
  let shouldFail = true;
  await page.route("http://api.test/users/me", async (route) => {
    if (route.request().method() !== "GET" || !shouldFail) {
      await route.fallback();
      return;
    }
    shouldFail = false;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Profile service unavailable." }),
    });
  });
}

test("hydrates the member profile once after Google sign-in", async ({ page }) => {
  const requests = profileRequests(page);
  await mockApi(page, { profile: existingProfile });
  await page.goto("/sign-in");

  await page.getByRole("button", { name: /continue with google/i }).click();

  await expect(page).toHaveURL("/");
  expect(requests).toHaveLength(1);
});

test("hydrates the member profile once after OTP sign-in", async ({ page }) => {
  const requests = profileRequests(page);
  await mockApi(page, { profile: existingProfile });
  await page.goto("/sign-in");

  await page.locator("[data-auth-email]:visible").fill(existingProfile.email);
  await page.locator("[data-auth-email]:visible").press("Enter");
  await page.locator("[data-auth-code]:visible").fill("123456");
  await page.locator("[data-auth-code]:visible").press("Enter");

  await expect(page).toHaveURL("/");
  expect(requests).toHaveLength(1);
});

test("retries Google profile hydration for the same signed-in account", async ({ page }) => {
  await mockApi(page, { profile: existingProfile });
  await failFirstProfileRequest(page);
  await page.goto("/sign-in");

  const googleButton = page.getByRole("button", { name: /continue with google/i });
  await googleButton.click();
  await expect(googleButton).toBeEnabled();

  await googleButton.click();

  await expect(page).toHaveURL("/", { timeout: 2_000 });
});

test("retries OTP profile hydration for the same signed-in account", async ({ page }) => {
  await mockApi(page, { profile: existingProfile });
  await failFirstProfileRequest(page);
  await page.goto("/sign-in");

  await page.locator("[data-auth-email]:visible").fill(existingProfile.email);
  await page.locator("[data-auth-email]:visible").press("Enter");
  const codeInput = page.locator("[data-auth-code]:visible");
  await codeInput.fill("123456");
  await codeInput.press("Enter");
  const verifyButton = page.getByRole("button", { name: /^verify/i });
  await expect(verifyButton).toBeEnabled();

  await verifyButton.click();

  await expect(page).toHaveURL("/", { timeout: 2_000 });
});

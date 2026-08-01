import { expect, test, type Page } from "@playwright/test";
import { existingProfile, mockApi, setAuthenticatedUser, type MockProfile } from "./support/auth";

function profileRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/users/me")) {
      requests.push(request.headers().authorization ?? "");
    }
  });
  return requests;
}

async function changeTestIdentity(page: Page, user: { uid: string; email: string } | null) {
  await page.evaluate((nextUser) => {
    if (nextUser) {
      window.sessionStorage.setItem("ubc-discovery-test-firebase-user", JSON.stringify(nextUser));
    } else {
      window.sessionStorage.removeItem("ubc-discovery-test-firebase-user");
    }
    window.dispatchEvent(new CustomEvent("ubc-test-auth-changed"));
  }, user);
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

test("retries Google profile hydration when Firebase keeps the same uid", async ({ page }) => {
  await mockApi(page, { profile: existingProfile });
  await failFirstProfileRequest(page);
  await page.goto("/sign-in");

  const googleButton = page.getByRole("button", { name: /continue with google/i });
  await googleButton.click();
  await expect(googleButton).toBeEnabled();

  await googleButton.click();

  await expect(page).toHaveURL("/", { timeout: 2_000 });
});

test("retries OTP profile hydration when Firebase keeps the same uid", async ({ page }) => {
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

test("ignores a stale profile response after the Firebase identity changes", async ({ page }) => {
  let releaseOldProfile: () => void = () => {};
  const oldProfilePending = new Promise<void>((resolve) => {
    releaseOldProfile = resolve;
  });
  let oldRequestStarted = false;
  let oldResponseCompleted = false;
  const newProfile: MockProfile = {
    ...existingProfile,
    id: "member-2",
    email: "new@example.com",
    preferred_name: "Jordan",
  };
  page.on("response", (response) => {
    if (
      response.url().endsWith("/users/me") &&
      response.request().headers().authorization?.includes("mock-token:old-user:")
    ) {
      oldResponseCompleted = true;
    }
  });
  await mockApi(page, {
    profilesByUid: {
      "old-user": existingProfile,
      "new-user": newProfile,
    },
    onProfileRequest: async (uid) => {
      if (uid !== "old-user") return;
      oldRequestStarted = true;
      await oldProfilePending;
    },
  });
  await setAuthenticatedUser(page, {
    uid: "old-user",
    email: existingProfile.email,
  });
  await page.goto("/profile");
  await expect.poll(() => oldRequestStarted).toBe(true);

  await changeTestIdentity(page, {
    uid: "new-user",
    email: newProfile.email,
  });
  await expect(page.getByText("Jordan", { exact: true })).toHaveCount(1);

  releaseOldProfile();
  await expect.poll(() => oldResponseCompleted).toBe(true);
  await expect(page.getByText("Jordan", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Taylor", { exact: true })).toHaveCount(0);
});

test("ignores a stale profile response after sign-out", async ({ page }) => {
  let releaseProfile: () => void = () => {};
  const profilePending = new Promise<void>((resolve) => {
    releaseProfile = resolve;
  });
  let requestStarted = false;
  let responseCompleted = false;
  page.on("response", (response) => {
    if (response.url().endsWith("/users/me")) {
      responseCompleted = true;
    }
  });
  await mockApi(page, {
    profile: existingProfile,
    onProfileRequest: async () => {
      requestStarted = true;
      await profilePending;
    },
  });
  await setAuthenticatedUser(page);
  await page.goto("/profile");
  await expect.poll(() => requestStarted).toBe(true);

  await changeTestIdentity(page, null);
  const profileSignIn = page.getByRole("main").getByRole("link", { name: /sign in/i });
  await expect(profileSignIn).toBeVisible();

  releaseProfile();
  await expect.poll(() => responseCompleted).toBe(true);
  await expect(profileSignIn).toBeVisible();
  await expect(page.getByText("Taylor", { exact: true })).toHaveCount(0);
});

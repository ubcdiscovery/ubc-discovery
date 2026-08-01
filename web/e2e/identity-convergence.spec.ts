import { expect, test } from "@playwright/test";
import { existingProfile, mockApi } from "./support/auth";

async function signOutInTest(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    window.sessionStorage.removeItem("ubc-discovery-test-firebase-user");
    window.dispatchEvent(new CustomEvent("ubc-test-auth-changed"));
  });
}

test("Google first then OTP resolves to the same identity and member", async ({ page }) => {
  const profileTokens: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/users/me")) {
      profileTokens.push(request.headers().authorization ?? "");
    }
  });
  await mockApi(page, {
    profile: existingProfile,
    otpUid: "google-user",
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect(page).toHaveURL("/");

  await signOutInTest(page);
  await page.goto("/sign-in");
  await page.locator("[data-auth-email]:visible").fill(existingProfile.email);
  await page.locator("[data-auth-email]:visible").press("Enter");
  await page.locator("[data-auth-code]:visible").fill("123456");
  await page.locator("[data-auth-code]:visible").press("Enter");

  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          window.sessionStorage.getItem(
            "ubc-discovery-test-firebase-user"
          ) ?? "null"
        )
      )
    )
    .toEqual({ uid: "google-user", email: existingProfile.email });
  expect(
    profileTokens.filter((token) =>
      token.includes(`mock-token:google-user:${existingProfile.email}`)
    ).length
  ).toBe(2);
});

test("OTP first links a colliding Google credential to the same email identity", async ({
  page,
}) => {
  await mockApi(page, {
    profile: existingProfile,
    otpUid: "otp-first-uid",
  });
  await page.goto("/sign-in");
  await page.locator("[data-auth-email]:visible").fill(existingProfile.email);
  await page.locator("[data-auth-email]:visible").press("Enter");
  await page.locator("[data-auth-code]:visible").fill("123456");
  await page.locator("[data-auth-code]:visible").press("Enter");
  await expect(page).toHaveURL("/");

  await signOutInTest(page);
  await page.evaluate((email) => {
    window.sessionStorage.setItem(
      "ubc-discovery-test-google-collision-email",
      email
    );
  }, existingProfile.email);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect(page.getByText(/verify this email to connect google/i).filter({ visible: true })).toBeVisible();
  await page.locator("[data-auth-code]:visible").fill("123456");
  await page.locator("[data-auth-code]:visible").press("Enter");

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem("ubc-discovery-test-google-linked")
      )
    )
    .toBe("true");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          window.sessionStorage.getItem(
            "ubc-discovery-test-firebase-user"
          ) ?? "null"
        )?.uid
      )
    )
    .toBe("otp-first-uid");
  await page.goto("/profile");
  await expect(page.getByText("Taylor", { exact: true })).toHaveCount(1);

  await signOutInTest(page);
  await page.evaluate(() => {
    window.sessionStorage.removeItem(
      "ubc-discovery-test-google-collision-email"
    );
    window.sessionStorage.setItem(
      "ubc-discovery-test-google-user",
      JSON.stringify({
        uid: "otp-first-uid",
        email: "member@example.com",
      })
    );
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          window.sessionStorage.getItem(
            "ubc-discovery-test-firebase-user"
          ) ?? "null"
        )?.uid
      )
    )
    .toBe("otp-first-uid");
});

test("does not link a pending Google credential to a different email", async ({
  page,
}) => {
  await mockApi(page, {
    profile: existingProfile,
    otpUid: "different-email-uid",
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "ubc-discovery-test-google-collision-email",
      "first@example.com"
    );
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await page.locator("button:visible", { hasText: /change email/i }).click();
  await page.locator("[data-auth-email]:visible").fill("second@example.com");
  await page.locator("[data-auth-email]:visible").press("Enter");
  await page.locator("[data-auth-code]:visible").fill("123456");
  await page.locator("[data-auth-code]:visible").press("Enter");

  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem("ubc-discovery-test-google-linked")
      )
    )
    .toBeNull();
});

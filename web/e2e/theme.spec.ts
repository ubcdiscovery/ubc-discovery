import { expect, test } from "@playwright/test";
import { mockApi } from "./support/auth";

const HYDRATION_ERROR = /hydration|Minified React error #418/i;

for (const { name, colorScheme, storedTheme, expectedAttribute, expectedControl } of [
  {
    name: "system dark",
    colorScheme: "dark" as const,
    storedTheme: null,
    expectedAttribute: null,
    expectedControl: "☀",
  },
  {
    name: "saved light under system dark",
    colorScheme: "dark" as const,
    storedTheme: "light",
    expectedAttribute: "light",
    expectedControl: "☾",
  },
  {
    name: "saved dark under system light",
    colorScheme: "light" as const,
    storedTheme: "dark",
    expectedAttribute: "dark",
    expectedControl: "☀",
  },
]) {
  test(`${name} starts without a hydration error`, async ({ page, isMobile }) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript((theme) => {
      if (theme) localStorage.setItem("theme", theme);
      else localStorage.removeItem("theme");
    }, storedTheme);
    await mockApi(page);

    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");

    if (expectedAttribute) {
      await expect(page.locator("html")).toHaveAttribute("data-theme", expectedAttribute);
    } else {
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    }
    if (isMobile) {
      await page.getByRole("button", { name: "Open site menu" }).click();
      await expect(
        page.getByRole("menuitem", {
          name: expectedControl === "☀" ? "Use light mode" : "Use dark mode",
        }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Toggle theme" })).toHaveText(expectedControl);
    }
    expect(errors.filter((error) => HYDRATION_ERROR.test(error))).toEqual([]);
  });
}

test("system preference changes update the theme control", async ({ page, isMobile }) => {
  test.skip(isMobile, "The desktop control exposes the resolved theme.");
  await page.emulateMedia({ colorScheme: "light" });
  await mockApi(page);
  await page.goto("/");

  const control = page.getByRole("button", { name: "Toggle theme" });
  await expect(control).toHaveText("☾");

  await page.emulateMedia({ colorScheme: "dark" });

  await expect(control).toHaveText("☀");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});

test("an explicit preference persists across reloads", async ({ page, isMobile }) => {
  test.skip(isMobile, "The desktop control exposes the resolved theme.");
  await page.emulateMedia({ colorScheme: "light" });
  await mockApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Toggle theme" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Toggle theme" })).toHaveText("☀");
});

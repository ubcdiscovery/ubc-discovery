import { expect, test, type Page } from "@playwright/test";
import { mockApi, mockEvent } from "./support/auth";

const esports = { handle: "ubcea", name: "UBC Esports" };
const kwave = { handle: "ubckwave", name: "UBC K-Wave" };
const collab = {
  ...mockEvent,
  id: "event-1",
  title: "Esports x K-pop Night",
  hosts: [esports, kwave],
};
const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

async function mockHosts(page: Page) {
  await page.route("http://api.test/events/event-1", (route) => route.fulfill(json(collab)));
  await page.route("http://api.test/hosts/ubckwave", (route) =>
    route.fulfill(
      json({
        ...kwave,
        instagram_url: "https://www.instagram.com/ubckwave/",
        upcoming_event_count: 1,
        past_event_count: 3,
      }),
    ),
  );
  await page.route("http://api.test/hosts/ubckwave/events?*", (route) => {
    const past = new URL(route.request().url()).searchParams.get("when") === "past";
    return route.fulfill(json({ events: past ? [] : [collab], total: past ? 0 : 1 }));
  });
}

test("a co-hosted event links each host to its page of events", async ({ page }) => {
  await mockApi(page);
  await mockHosts(page);
  await page.goto("/events/event-1");

  const kwaveLink = page.getByRole("link", { name: "UBC K-Wave" }).filter({ visible: true });
  await expect(
    page.getByRole("link", { name: "UBC Esports" }).filter({ visible: true }).first(),
  ).toBeVisible();
  await kwaveLink.first().click();

  await expect(page).toHaveURL(/\/hosts\/ubckwave$/);
  await expect(page.getByRole("heading", { level: 1, name: "UBC K-Wave" })).toBeVisible();
  await expect(page.getByRole("link", { name: "@ubckwave ↗" })).toHaveAttribute(
    "href",
    "https://www.instagram.com/ubckwave/",
  );
  await expect(page.getByRole("tab", { name: /Coming up/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Esports x K-pop Night" })).toBeVisible();

  await page.getByRole("tab", { name: /Past events/ }).click();
  await expect(page).toHaveURL(/\?tab=past$/);
  await expect(page.getByRole("heading", { name: "No past events yet." })).toBeVisible();
});

test("an unknown host shows a not-found state", async ({ page }) => {
  await mockApi(page);
  await page.route("http://api.test/hosts/nobody*", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Host not found" }),
    }),
  );
  await page.goto("/hosts/nobody");
  await expect(page.getByText("We don't know this host yet.")).toBeVisible();
});

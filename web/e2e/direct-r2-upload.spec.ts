import { expect, test } from "@playwright/test";
import {
  adminProfile,
  existingProfile,
  mockApi,
  mockEvent,
  setAuthenticatedUser,
} from "./support/auth";

const image = {
  name: "poster.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
};

for (const kind of ["profile", "event"] as const) {
  test(`${kind} uploads request the compressed byte size and PUT that exact file directly`, async ({
    page,
  }) => {
    const profile = kind === "profile" ? existingProfile : adminProfile;
    await mockApi(page, { profile, adminEvents: [mockEvent] });
    await setAuthenticatedUser(page, { uid: "test-uid", email: profile.email });
    let requestedSize = 0;
    let uploadedSize = 0;
    const presignedPath =
      kind === "profile"
        ? "/users/me/presigned-upload"
        : `/admin/events/${mockEvent.id}/presigned-upload`;
    await page.route(`http://api.test${presignedPath}?*`, async (route) => {
      requestedSize = Number(new URL(route.request().url()).searchParams.get("file_size_bytes"));
      expect(route.request().method()).toBe(kind === "profile" ? "GET" : "POST");
      expect(requestedSize).toBeGreaterThan(0);
      await route.fulfill({
        json: {
          upload_url: "http://r2.test/signed-upload",
          fields: {},
          file_key: "image.webp",
          max_file_size_bytes: 3 * 1024 * 1024,
          method: "PUT",
          headers: { "content-type": "image/webp" },
        },
      });
    });
    await page.route("http://r2.test/signed-upload", async (route) => {
      const request = route.request();
      expect(request.method()).toBe("PUT");
      expect(request.headers()["content-type"]).toBe("image/webp");
      expect(request.headers().authorization).toBeUndefined();
      const bytes = request.postDataBuffer()!;
      uploadedSize = bytes.length;
      expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
      await route.fulfill({ status: 200 });
    });
    if (kind === "profile") {
      await page.goto("/profile");
      await page.getByRole("button", { name: "Edit profile" }).click();
      await page.locator('input[type="file"]').setInputFiles(image);
    } else {
      await page.goto(`/admin/events/${mockEvent.id}`);
      await page.getByLabel("Choose image").setInputFiles(image);
      await page.getByRole("button", { name: "Upload image" }).click();
      await expect(page.getByRole("status")).toHaveText("Image uploaded.");
    }
    await expect.poll(() => uploadedSize).toBeGreaterThan(0);
    expect(requestedSize).toBe(uploadedSize);
    expect(requestedSize).not.toBe(image.buffer.length);
  });
}

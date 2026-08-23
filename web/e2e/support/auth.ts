import type { Page } from "@playwright/test";
import { createAdminApiMock, type AdminMockEvent } from "./admin";
import { createApiKeysMock, type AdminMockApiCredential } from "./api-keys";

export type MockProfile = {
  id: string;
  email: string;
  preferred_name: string;
  major: string | null;
  year_standing: number | null;
  faculty: string | null;
  interests: string[];
  bio: string | null;
  profile_picture_url: string | null;
  is_admin: boolean;
  ubc_verified: boolean;
  created_at: string;
};

export const existingProfile: MockProfile = {
  id: "member-1",
  email: "member@example.com",
  preferred_name: "Taylor",
  major: "Computer Science",
  year_standing: 3,
  faculty: "Science",
  interests: ["music", "outdoors", "food"],
  bio: null,
  profile_picture_url: null,
  is_admin: false,
  ubc_verified: false,
  created_at: "2026-01-01T00:00:00Z",
};

export const mockEvent = {
  id: "event-1",
  title: "Campus Welcome",
  description: "Meet the UBC community.",
  source: "ubc",
  source_label: "ubc_official",
  source_url: null,
  club_name: null,
  event_picture_url: null,
  vibes: ["social"],
  location_name: "Main Mall",
  event_date: "2026-09-01T18:00:00Z",
  event_end_date: "2026-09-01T20:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  is_archived: false,
  archived_at: null,
  archived_by: null,
};

export const adminProfile: MockProfile = {
  ...existingProfile,
  id: "admin-1",
  email: "admin@example.com",
  preferred_name: "Morgan",
  is_admin: true,
};

export async function mockApi(
  page: Page,
  options: {
    profile?: MockProfile | null;
    otpExpirySeconds?: number;
    sendError?: { status: number; detail: string; code?: string };
    verifyError?: { status: number; detail: string; code?: string };
    saveError?: { status: number; detail: string };
    onSave?: () => void;
    onProfileUpdate?: (body: Record<string, unknown>) => void;
    onProfileRequest?: (uid: string | null) => Promise<void> | void;
    adminEvents?: AdminMockEvent[];
    onAdminList?: (q: string) => void;
    onAdminCreate?: (body: Record<string, unknown>) => void;
    onAdminArchive?: (archived: boolean) => void;
    onAdminUpdate?: (body: Record<string, unknown>) => void;
    onAdminImageUpload?: () => void;
    adminImageUploadError?: { status: number; detail: string };
    adminUpdateError?: { status: number; detail: string };
    adminApiKeys?: AdminMockApiCredential[];
    onApiKeyCreate?: (body: Record<string, unknown>) => void;
    onApiKeyRevoke?: (id: string) => void;
    otpUid?: string;
    profilesByUid?: Record<string, MockProfile | null>;
  } = {}
) {
  let profile = options.profile === undefined ? null : options.profile;
  const handleAdminApi = createAdminApiMock({
    events: options.adminEvents ?? [],
    onList: options.onAdminList,
    onCreate: options.onAdminCreate,
    onArchive: options.onAdminArchive,
    onUpdate: options.onAdminUpdate,
    onImageUpload: options.onAdminImageUpload,
    updateError: options.adminUpdateError,
    imageUploadError: options.adminImageUploadError,
  });
  const handleApiKeys = createApiKeysMock({
    apiKeys: options.adminApiKeys,
    onCreate: options.onApiKeyCreate,
    onRevoke: options.onApiKeyRevoke,
  });

  await page.route("http://api.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/users/me" &&
      route.request().method() === "GET"
    ) {
      const authorization = route.request().headers().authorization ?? "";
      const uid = authorization.match(/^Bearer mock-token:([^:]+):/)?.[1] ?? null;
      await options.onProfileRequest?.(uid);
      const requestedProfile =
        uid &&
        options.profilesByUid &&
        Object.prototype.hasOwnProperty.call(options.profilesByUid, uid)
          ? (options.profilesByUid?.[uid] ?? null)
          : profile;
      await route.fulfill({
        status: requestedProfile ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(
          requestedProfile ?? { detail: "User profile not found." }
        ),
      });
      return;
    }
    if (
      url.pathname === "/users/me" &&
      route.request().method() === "PUT"
    ) {
      const body = route.request().postDataJSON();
      options.onProfileUpdate?.(body);
      profile = profile ? { ...profile, ...body } : profile;
      await route.fulfill({
        status: profile ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(profile ?? { detail: "User profile not found." }),
      });
      return;
    }
    if (
      url.pathname === "/users/onboarding" &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON();
      profile = {
        ...existingProfile,
        id: "new-member-1",
        email: "member@example.com",
        preferred_name: body.preferred_name,
        major: body.major ?? null,
        year_standing: body.year_standing ?? null,
        faculty: body.faculty ?? null,
        interests: body.interests ?? [],
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(profile),
      });
      return;
    }
    if (await handleAdminApi(route, url)) return;
    if (await handleApiKeys(route, url)) return;
    if (url.pathname === "/events/event-1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockEvent),
      });
      return;
    }
    if (url.pathname === "/saved-events" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ saved_events: [], total: 0 }),
      });
      return;
    }
    if (
      url.pathname === "/saved-events/event-1" &&
      route.request().method() === "PUT"
    ) {
      options.onSave?.();
      if (options.saveError) {
        await route.fulfill({
          status: options.saveError.status,
          contentType: "application/json",
          body: JSON.stringify({ detail: options.saveError.detail }),
        });
      } else {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            event_id: "event-1",
            saved_at: "2026-01-01T00:00:00Z",
          }),
        });
      }
      return;
    }
    if (url.pathname === "/auth/otp/send") {
      if (options.sendError) {
        await route.fulfill({
          status: options.sendError.status,
          contentType: "application/json",
          body: JSON.stringify({
            detail: options.sendError.code
              ? {
                  code: options.sendError.code,
                  message: options.sendError.detail,
                }
              : options.sendError.detail,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "sent",
          expires_in_seconds: options.otpExpirySeconds ?? 600,
        }),
      });
      return;
    }
    if (url.pathname === "/auth/otp/verify") {
      if (options.verifyError) {
        await route.fulfill({
          status: options.verifyError.status,
          contentType: "application/json",
          body: JSON.stringify({
            detail: options.verifyError.code
              ? {
                  code: options.verifyError.code,
                  message: options.verifyError.detail,
                }
              : options.verifyError.detail,
          }),
        });
        return;
      }
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          firebase_custom_token: `mock-token:otp-user:${body.email}`,
          ...(options.otpUid
            ? {
                firebase_custom_token: `mock-token:${options.otpUid}:${body.email}`,
              }
            : {}),
          is_new_user: !profile,
          ubc_verified: false,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [], total: 0 }),
    });
  });
}

export async function setAuthenticatedUser(
  page: Page,
  user = { uid: "existing-uid", email: "member@example.com" }
) {
  await page.addInitScript((value) => {
    if (!window.sessionStorage.getItem("ubc-discovery-test-firebase-user")) {
      window.sessionStorage.setItem(
        "ubc-discovery-test-firebase-user",
        JSON.stringify(value)
      );
    }
  }, user);
}

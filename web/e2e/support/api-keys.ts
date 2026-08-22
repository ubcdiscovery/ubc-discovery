import type { Route } from "@playwright/test";

export type AdminMockApiCredential = {
  id: string;
  label: string;
  created_by_user_id: string;
  created_by_name: string;
  created_by_email: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  status: "active" | "expired" | "revoked";
};

export const mockApiCredential: AdminMockApiCredential = {
  id: "11111111-1111-1111-1111-111111111111",
  label: "Calendar importer",
  created_by_user_id: "admin-1",
  created_by_name: "Morgan",
  created_by_email: "admin@example.com",
  created_at: "2026-08-08T12:00:00Z",
  expires_at: null,
  revoked_at: null,
  last_used_at: null,
  status: "active",
};

export function createApiKeysMock(options: {
  apiKeys?: AdminMockApiCredential[];
  onCreate?: (body: Record<string, unknown>) => void;
  onRevoke?: (id: string) => void;
}) {
  let apiKeys = options.apiKeys ?? [];

  return async function handleApiKeys(route: Route, url: URL) {
    if (url.pathname === "/admin/api-keys" && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ credentials: apiKeys }),
      });
      return true;
    }

    if (url.pathname === "/admin/api-keys" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      options.onCreate?.(body);
      const credential = {
        ...mockApiCredential,
        ...body,
        id: "22222222-2222-2222-2222-222222222222",
        created_at: "2026-08-09T12:00:00Z",
      };
      apiKeys = [credential, ...apiKeys];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ...credential,
          raw_token: `ubc_live_${credential.id}.generated-secret`,
        }),
      });
      return true;
    }

    const revokePath = url.pathname.match(/^\/admin\/api-keys\/([^/]+)\/revoke$/);
    if (revokePath && route.request().method() === "POST") {
      const id = decodeURIComponent(revokePath[1]);
      options.onRevoke?.(id);
      apiKeys = apiKeys.map((credential) =>
        credential.id === id
          ? { ...credential, status: "revoked", revoked_at: "2026-08-09T12:00:00Z" }
          : credential
      );
      const credential = apiKeys.find((item) => item.id === id);
      await route.fulfill({
        status: credential ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(credential ?? { detail: "API credential not found" }),
      });
      return true;
    }

    return false;
  };
}

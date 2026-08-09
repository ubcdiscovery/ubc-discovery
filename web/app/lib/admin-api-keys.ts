import { authenticatedApiFetch } from "~/lib/api";

type ApiCredentialStatus = "active" | "expired" | "revoked";

export interface ApiCredential {
  id: string;
  label: string;
  created_by_user_id: string;
  created_by_name: string;
  created_by_email: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  status: ApiCredentialStatus;
}

export interface ApiCredentialCreateResponse extends ApiCredential {
  raw_token: string;
  replaced_credential_id: string | null;
}

export const adminApiKeysApi = {
  list: () =>
    authenticatedApiFetch<{ credentials: ApiCredential[] }>("/admin/api-keys"),
  create: (data: { label: string; expires_at?: string | null }) =>
    authenticatedApiFetch<ApiCredentialCreateResponse>("/admin/api-keys", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  replace: (id: string, data: { label?: string; expires_at?: string | null }) =>
    authenticatedApiFetch<ApiCredentialCreateResponse>(
      `/admin/api-keys/${encodeURIComponent(id)}/replace`,
      { method: "POST", body: JSON.stringify(data) }
    ),
  revoke: (id: string) =>
    authenticatedApiFetch<ApiCredential>(
      `/admin/api-keys/${encodeURIComponent(id)}/revoke`,
      { method: "POST" }
    ),
};

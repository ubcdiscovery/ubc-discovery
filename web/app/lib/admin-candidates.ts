import { authenticatedApiFetch } from "~/lib/api";

export type CandidateStatus = "pending" | "approved" | "rejected";

export interface ApiCandidate {
  id: string;
  description: string;
  source_account: string;
  source_url: string | null;
  source_type: string;
  external_source_id: string;
  image_urls: string[];
  status: CandidateStatus;
  created_at: string;
  updated_at: string;
  posted_at?: string | null;
  is_event?: boolean | null;
  title?: string | null;
  location_name?: string | null;
  event_date?: string | null;
  event_end_date?: string | null;
  club_name?: string | null;
  vibes?: string[];
  source_label?: string | null;
  extracted_original?: Record<string, unknown> | unknown[] | null;
  extraction_model?: string | null;
  extracted_at?: string | null;
}

interface ApiCandidateAudit {
  id: string;
  source_type: string;
  external_source_id: string;
  outcome: "created" | "existing";
  actor_type: "member" | "api_key";
  actor_id: string;
  credential_label: string;
  received_at: string;
}

interface ApiCandidateDetail extends ApiCandidate {
  ingestion_audits: ApiCandidateAudit[];
}

interface AdminCandidateListResponse {
  candidates: ApiCandidate[];
  total: number;
}

export const adminCandidatesApi = {
  list: (
    q = "",
    status = "",
    sourceType = "",
    skip = 0,
    limit = 25
  ) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (sourceType) params.set("source_type", sourceType);
    return authenticatedApiFetch<AdminCandidateListResponse>(
      `/admin/candidates?${params.toString()}`
    );
  },
  get: (id: string) =>
    authenticatedApiFetch<ApiCandidateDetail>(
      `/admin/candidates/${encodeURIComponent(id)}`
  ),
};

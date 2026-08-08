import { authenticatedApiFetch } from "~/lib/api";

export type CandidateStatus = "pending" | "approved" | "rejected";

export interface ApiCandidate {
  id: string;
  title: string;
  description: string;
  club_name: string | null;
  source_url: string | null;
  external_cta_label: string | null;
  vibes: string[];
  location_name: string | null;
  event_date: string | null;
  event_end_date: string | null;
  source_type: string;
  external_source_id: string;
  source_excerpt: string | null;
  image_reference: string | null;
  extraction_confidence: number;
  extraction_metadata: Record<string, unknown>;
  extraction_output: Record<string, unknown>;
  status: CandidateStatus;
  created_at: string;
  updated_at: string;
}

interface ApiCandidateAudit {
  id: string;
  source_type: string;
  external_source_id: string;
  outcome: "created" | "existing";
  credential_name: string;
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

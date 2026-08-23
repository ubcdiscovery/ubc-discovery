import type { Route } from "@playwright/test";

export type AdminMockCandidate = {
  id: string;
  description: string;
  source_account: string;
  source_type: string;
  external_source_id: string;
  image_reference: string | null;
  status: "pending" | "approved" | "rejected";
  ingestion_audits: Array<{
    id: string;
    source_type: string;
    external_source_id: string;
    outcome: "created" | "existing";
    actor_type: "member" | "api_key";
    actor_id: string;
    credential_label: string;
    received_at: string;
  }>;
  [key: string]: unknown;
};

export const mockCandidate: AdminMockCandidate = {
  id: "candidate-1",
  description: "A workshop found in the source channel.",
  source_account: "ubcams",
  source_url: "https://example.com/workshop",
  source_type: "instagram",
  external_source_id: "post-123",
  image_reference: "instagram://media/post-123",
  status: "pending",
  created_at: "2026-08-08T12:00:00Z",
  updated_at: "2026-08-08T12:00:00Z",
  ingestion_audits: [
    {
      id: "receipt-1",
      source_type: "instagram",
      external_source_id: "post-123",
      outcome: "created",
      actor_type: "api_key",
      actor_id: "11111111-1111-1111-1111-111111111111",
      credential_label: "Campus importer",
      received_at: "2026-08-08T12:00:00Z",
    },
  ],
};

export function createCandidatesMock(options: {
  candidates?: AdminMockCandidate[];
  onList?: (filters: { q: string; status: string; sourceType: string }) => void;
}) {
  const candidates = options.candidates ?? [];

  return async function handleCandidates(route: Route, url: URL) {
    if (url.pathname === "/admin/candidates" && route.request().method() === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const candidateStatus = url.searchParams.get("status") ?? "";
      const sourceType = url.searchParams.get("source_type") ?? "";
      options.onList?.({ q: query, status: candidateStatus, sourceType });
      const normalized = query.toLowerCase();
      const matches = candidates.filter((candidate) => {
        const matchesQuery =
          !normalized ||
          [
            candidate.description,
            candidate.source_account,
            candidate.source_type,
            candidate.external_source_id,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalized));
        const matchesStatus = !candidateStatus || candidate.status === candidateStatus;
        const matchesSource = !sourceType || candidate.source_type === sourceType;
        return matchesQuery && matchesStatus && matchesSource;
      });
      const requestedSkip = Number.parseInt(url.searchParams.get("skip") ?? "0", 10);
      const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
      const skip = Number.isFinite(requestedSkip) && requestedSkip >= 0 ? requestedSkip : 0;
      const limit =
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? requestedLimit
          : matches.length;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: matches.slice(skip, skip + limit),
          total: matches.length,
        }),
      });
      return true;
    }

    if (url.pathname.startsWith("/admin/candidates/") && route.request().method() === "GET") {
      const candidateId = decodeURIComponent(
        url.pathname.slice("/admin/candidates/".length)
      );
      const candidate = candidates.find((item) => item.id === candidateId);
      await route.fulfill({
        status: candidate ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(candidate ?? { detail: "Candidate not found" }),
      });
      return true;
    }

    return false;
  };
}

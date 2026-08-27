import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  CandidateDecisionDialog,
  type CandidateDecision,
} from "~/components/admin/CandidateDecisionDialog";
import { CandidateTable } from "~/components/admin/CandidateTable";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { Select } from "~/components/ui/Select";
import { adminCandidatesApi, type CandidateStatus } from "~/lib/admin-candidates";

const PAGE_SIZE = 25;

const STATUS_FILTER_STORAGE_KEY = "ubc-discovery:admin-candidates:status";
const STATUS_FILTER_VALUES: CandidateStatus[] = ["pending", "approved", "rejected"];
const DEFAULT_STATUS_FILTER = "pending";

export function meta() {
  return [{ title: "Candidates — UBC Discovery Admin" }];
}

function readStoredStatusFilter() {
  if (typeof window === "undefined") return DEFAULT_STATUS_FILTER;
  try {
    const stored = window.localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    return stored !== null &&
      (stored === "" || STATUS_FILTER_VALUES.includes(stored as CandidateStatus))
      ? stored
      : DEFAULT_STATUS_FILTER;
  } catch {
    return DEFAULT_STATUS_FILTER;
  }
}

function persistStatusFilter(status: string) {
  try {
    window.localStorage.setItem(STATUS_FILTER_STORAGE_KEY, status);
  } catch {
    // Storage can be unavailable (private mode); the filter still applies to this visit.
  }
}

export default function AdminCandidates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const query = searchParams.get("q")?.trim() ?? "";
  const [storedStatus, setStoredStatus] = useState(readStoredStatusFilter);
  const status = searchParams.has("status") ? searchParams.get("status") ?? "" : storedStatus;
  const sourceType = searchParams.get("source_type")?.trim() ?? "";
  const pageValue = Number.parseInt(searchParams.get("page") ?? "0", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 0;
  const [searchDraft, setSearchDraft] = useState(query);
  const [sourceDraft, setSourceDraft] = useState(sourceType);
  const [decision, setDecision] = useState<CandidateDecision | null>(null);
  const candidatesQuery = useQuery({
    queryKey: ["admin-candidates", query, status, sourceType, page],
    queryFn: () => adminCandidatesApi.list(query, status, sourceType, page * PAGE_SIZE, PAGE_SIZE),
    retry: false,
  });
  const decisionMutation = useMutation({
    mutationFn: ({ candidate, action }: CandidateDecision) =>
      action === "approve"
        ? adminCandidatesApi.approve(candidate.id)
        : adminCandidatesApi.reject(candidate.id),
    onSuccess: async (_updated, variables) => {
      setDecision(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-candidates"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-candidate", variables.candidate.id] });
    },
  });
  const decisionError = decisionMutation.error instanceof Error
    ? decisionMutation.error.message
    : null;

  useEffect(() => setSearchDraft(query), [query]);
  useEffect(() => setSourceDraft(sourceType), [sourceType]);

  function requestDecision(next: CandidateDecision) {
    decisionMutation.reset();
    setDecision(next);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const nextQuery = searchDraft.trim();
    const nextSource = sourceDraft.trim();
    if (nextQuery) next.q = nextQuery;
    if (status) next.status = status;
    if (nextSource) next.source_type = nextSource;
    setSearchParams(next);
  }

  function setStatus(nextStatus: string) {
    setStoredStatus(nextStatus);
    persistStatusFilter(nextStatus);
    const next: Record<string, string> = {};
    if (query) next.q = query;
    if (nextStatus) next.status = nextStatus;
    if (sourceType) next.source_type = sourceType;
    setSearchParams(next);
  }

  function goToPage(nextPage: number) {
    const next: Record<string, string> = {};
    if (query) next.q = query;
    if (status) next.status = status;
    if (sourceType) next.source_type = sourceType;
    if (nextPage > 0) next.page = String(nextPage);
    setSearchParams(next);
  }

  const total = candidatesQuery.data?.total ?? 0;
  const firstRecord = total ? page * PAGE_SIZE + 1 : 0;
  const lastRecord = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="px-4.5 py-6 md:px-8 md:py-10">
      <h1 className="sr-only">Candidates</h1>

      <form onSubmit={submitFilters} role="search" className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <label htmlFor="admin-candidate-search" className="sr-only">
          Search Event Listing Candidates
        </label>
        <Input
          id="admin-candidate-search"
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search caption, account, source ID…"
          className="min-w-0 px-4 py-3 font-body"
        />
        <label htmlFor="admin-candidate-source" className="sr-only">
          Filter candidate source type
        </label>
        <Input
          id="admin-candidate-source"
          value={sourceDraft}
          onChange={(event) => setSourceDraft(event.target.value)}
          placeholder="Source type"
          className="px-4 py-3 font-body"
        />
        <Select
          aria-label="Filter candidate status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="min-w-35"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Button type="submit" variant="primary" size="lg">
          Filter queue
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between border-b border-ink pb-2 font-mono text-xs uppercase tracking-wide text-muted">
        <span>{candidatesQuery.isPending ? "Loading candidates…" : `${total} records`}</span>
        {total > 0 && <span>{firstRecord}–{lastRecord}</span>}
      </div>

      {candidatesQuery.isError ? (
        <Alert variant="error" className="mt-5 bg-surface p-5">
          <h2 className="font-display text-xl font-extrabold">Could not load Candidates.</h2>
          <p className="mt-1 text-sm text-ink-soft">Check your connection or administrator access, then try again.</p>
          <Button type="button" className="mt-4" onClick={() => void candidatesQuery.refetch()}>
            Try again
          </Button>
        </Alert>
      ) : candidatesQuery.data?.candidates.length === 0 ? (
        <Card className="mt-5 p-6 text-center md:p-10">
          <h2 className="font-display text-2xl font-extrabold">No matching Candidates.</h2>
          <p className="mt-2 text-sm text-ink-soft">Try another status, source type, or search term.</p>
        </Card>
      ) : (
        <CandidateTable
          candidates={candidatesQuery.data?.candidates ?? []}
          onDecision={requestDecision}
        />
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Candidate pages" className="mt-5 flex justify-end gap-2">
          <Button type="button" size="sm" disabled={page === 0} onClick={() => goToPage(page - 1)}>
            ← Previous
          </Button>
          <Button type="button" size="sm" disabled={lastRecord >= total} onClick={() => goToPage(page + 1)}>
            Next →
          </Button>
        </nav>
      )}

      {decision ? (
        <CandidateDecisionDialog
          decision={decision}
          saving={decisionMutation.isPending}
          error={decisionError}
          onConfirm={() => decisionMutation.mutate(decision)}
          onCancel={() => setDecision(null)}
        />
      ) : null}
    </div>
  );
}

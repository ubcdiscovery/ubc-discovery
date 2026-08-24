import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { Select } from "~/components/ui/Select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/Table";
import { adminCandidatesApi, type ApiCandidate, type CandidateStatus } from "~/lib/admin-candidates";

const PAGE_SIZE = 25;

export function meta() {
  return [{ title: "Candidates — UBC Discovery Admin" }];
}

function formatDate(value: string | null) {
  if (!value) return "TBD";
  return new Date(value).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(status: CandidateStatus) {
  return status.replaceAll("_", " ");
}

function extractionLabel(candidate: ApiCandidate) {
  if (candidate.extracted_at == null) return "awaiting extraction";
  if (candidate.is_event === true) return "event";
  if (candidate.is_event === false) return "not an event";
  return "extracted";
}


function captionPreview(description: string) {
  const line = description.trim().split("\n")[0] ?? "";
  if (!line) return "No caption supplied.";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

function CandidateTable({ candidates }: { candidates: ApiCandidate[] }) {
  return (
    <Table className="mt-4 border border-ink bg-surface text-left">
      <TableCaption className="sr-only">Event Listing Candidates</TableCaption>
      <TableHeader className="bg-accent-soft">
        <TableRow className="hover:bg-accent-soft">
          <TableHead scope="col">Candidate</TableHead>
          <TableHead scope="col">Status</TableHead>
          <TableHead scope="col">Extraction</TableHead>
          <TableHead scope="col">Source</TableHead>
          <TableHead scope="col" className="whitespace-nowrap">
            Received
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidates.map((candidate) => (
          <TableRow key={candidate.id} className="border-ink">
            <TableCell>
              <Link
                to={`/admin/candidates/${encodeURIComponent(candidate.id)}`}
                className="block text-ink no-underline hover:text-accent"
              >
                <span className="font-display text-xl font-extrabold tracking-tight">
                  {candidate.source_account}
                </span>
                <span className="mt-1 block text-sm text-ink-soft">
                  {captionPreview(candidate.description)}
                </span>
                <span className="mt-1 block font-mono text-2xs uppercase tracking-wide text-muted">
                  {candidate.external_source_id}
                </span>
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs font-bold uppercase tracking-wide text-accent">
              {statusLabel(candidate.status)}
            </TableCell>
            <TableCell className="font-mono text-xs font-bold uppercase tracking-wide text-ink-soft">
              {extractionLabel(candidate)}
            </TableCell>
            <TableCell className="font-mono text-xs text-ink-soft">
              {candidate.source_type}
            </TableCell>
            <TableCell className="font-mono text-xs text-ink-soft whitespace-nowrap">
              <time dateTime={candidate.created_at}>{formatDate(candidate.created_at)}</time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AdminCandidates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const status = (searchParams.get("status") ?? "") as CandidateStatus | "";
  const sourceType = searchParams.get("source_type")?.trim() ?? "";
  const pageValue = Number.parseInt(searchParams.get("page") ?? "0", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 0;
  const [searchDraft, setSearchDraft] = useState(query);
  const [sourceDraft, setSourceDraft] = useState(sourceType);
  const candidatesQuery = useQuery({
    queryKey: ["admin-candidates", query, status, sourceType, page],
    queryFn: () => adminCandidatesApi.list(query, status, sourceType, page * PAGE_SIZE, PAGE_SIZE),
    retry: false,
  });

  useEffect(() => setSearchDraft(query), [query]);
  useEffect(() => setSourceDraft(sourceType), [sourceType]);

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
      <div className="border-b-2 border-ink pb-5 md:flex md:items-end md:justify-between md:gap-8">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Review queue
          </p>
          <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tighter md:text-6xl">
            Candidates
          </h1>
        </div>
        <p className="mt-3 max-w-110 text-sm/relaxed text-ink-soft md:mt-0 md:text-right">
          Inspect extracted source evidence before it becomes a canonical Event Listing.
        </p>
      </div>

      <form onSubmit={submitFilters} role="search" className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
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
        <CandidateTable candidates={candidatesQuery.data?.candidates ?? []} />
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
    </div>
  );
}

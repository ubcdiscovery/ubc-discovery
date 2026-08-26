import { Link } from "react-router";
import type { CandidateDecision } from "~/components/admin/CandidateDecisionDialog";
import { Button } from "~/components/ui/Button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/Table";
import type { ApiCandidate, CandidateStatus } from "~/lib/admin-candidates";

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

type CandidateTableProps = {
  candidates: ApiCandidate[];
  onDecision: (decision: CandidateDecision) => void;
};

export function CandidateTable({ candidates, onDecision }: CandidateTableProps) {
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
          <TableHead scope="col">
            <span className="sr-only">Quick review actions</span>
            Review
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
                <span className="mt-1 line-clamp-2 wrap-break-word text-sm text-ink-soft">
                  {candidate.description?.trim() || "No caption supplied."}
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
            <TableCell>
              {candidate.status === "pending" ? (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    aria-label={`Approve ${candidate.source_account}`}
                    title="Approve"
                    onClick={() => onDecision({ candidate, action: "approve" })}
                  >
                    ✓
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Reject ${candidate.source_account}`}
                    title="Reject"
                    onClick={() => onDecision({ candidate, action: "reject" })}
                  >
                    ✕
                  </Button>
                </div>
              ) : (
                <span aria-hidden="true" className="font-mono text-xs text-muted">
                  —
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

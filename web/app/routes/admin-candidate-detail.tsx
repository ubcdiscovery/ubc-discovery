import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Alert } from "~/components/ui/Alert";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/Table";
import { adminCandidatesApi } from "~/lib/admin-candidates";

export function meta() {
  return [{ title: "Inspect Candidate — UBC Discovery Admin" }];
}

function formatDate(value: string | null) {
  if (!value) return "Not extracted";
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

function prettyJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

export default function AdminCandidateDetail() {
  const { id = "" } = useParams();
  const candidateQuery = useQuery({
    queryKey: ["admin-candidate", id],
    queryFn: () => adminCandidatesApi.get(id),
    enabled: Boolean(id),
    retry: false,
  });

  if (candidateQuery.isPending) {
    return <p className="px-4.5 py-8 font-mono text-xs uppercase tracking-wide text-muted md:px-8">Loading candidate…</p>;
  }

  if (candidateQuery.isError || !candidateQuery.data) {
    return (
      <div className="px-4.5 py-6 md:px-8 md:py-10">
        <Alert variant="error" className="mt-6 bg-surface p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-danger">Candidate unavailable</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight">Could not inspect this Candidate.</h1>
          <p className="mt-2 text-sm text-ink-soft">It may have been removed, or your administrator access may have changed.</p>
        </Alert>
      </div>
    );
  }

  const candidate = candidateQuery.data;
  return (
    <div className="px-4.5 py-6 md:px-8 md:py-10">
      <div className="border-b-2 border-ink pb-5">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">Candidate evidence</p>
        <h1 className="mt-1 text-balance font-display text-4xl font-extrabold tracking-tighter md:text-6xl">{candidate.title}</h1>
        <p className="mt-3 font-mono text-xs uppercase tracking-wide text-muted">{candidate.id}</p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="grid gap-5">
          <Card>
            <CardHeader><CardTitle>Normalized fields</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div><dt className="font-mono text-xs uppercase tracking-wide text-muted">Description</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{candidate.description || "Not extracted"}</dd></div>
                <div><dt className="font-mono text-xs uppercase tracking-wide text-muted">Organizer</dt><dd className="mt-1 text-sm text-ink-soft">{candidate.club_name || "Not extracted"}</dd></div>
                <div><dt className="font-mono text-xs uppercase tracking-wide text-muted">Location</dt><dd className="mt-1 text-sm text-ink-soft">{candidate.location_name || "Not extracted"}</dd></div>
                <div><dt className="font-mono text-xs uppercase tracking-wide text-muted">Event date</dt><dd className="mt-1 text-sm text-ink-soft">{formatDate(candidate.event_date)}</dd></div>
                <div><dt className="font-mono text-xs uppercase tracking-wide text-muted">Event ends</dt><dd className="mt-1 text-sm text-ink-soft">{formatDate(candidate.event_end_date)}</dd></div>
                <div><dt className="font-mono text-xs uppercase tracking-wide text-muted">Vibes</dt><dd className="mt-1 text-sm text-ink-soft">{candidate.vibes.length ? candidate.vibes.join(", ") : "Not extracted"}</dd></div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Minimal source evidence</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-muted">Relevant excerpt</p>
                <p className="mt-2 border-l-2 border-accent pl-3 text-sm/relaxed text-ink-soft">{candidate.source_excerpt || "No excerpt supplied."}</p>
              </div>
              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-muted">Image reference</p>
                <p className="mt-1 break-all text-sm text-ink-soft">{candidate.image_reference || "No image reference supplied."}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Extraction output</CardTitle></CardHeader>
            <CardContent>
              <pre className="overflow-x-auto whitespace-pre-wrap border border-rule-soft bg-bg p-4 font-mono text-xs/relaxed text-ink-soft">{prettyJson(candidate.extraction_output)}</pre>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <Card className="border-2">
            <CardHeader><CardTitle>Provenance</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3 font-mono text-xs">
                <div><dt className="uppercase tracking-wide text-muted">Status</dt><dd className="mt-1 font-bold uppercase text-accent">{candidate.status}</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">Source type</dt><dd className="mt-1 font-bold text-ink">{candidate.source_type}</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">External source ID</dt><dd className="mt-1 break-all font-bold text-ink">{candidate.external_source_id}</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">Confidence</dt><dd className="mt-1 font-bold text-ink">{Math.round(candidate.extraction_confidence * 100)}%</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">Received</dt><dd className="mt-1 font-bold text-ink">{formatDate(candidate.created_at)}</dd></div>
              </dl>
              {candidate.source_url && (
                <a href={candidate.source_url} target="_blank" rel="noreferrer" className="mt-5 block break-all text-sm text-accent underline">Open source URL</a>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Extraction metadata</CardTitle></CardHeader>
            <CardContent>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs/relaxed text-ink-soft">{prettyJson(candidate.extraction_metadata)}</pre>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Ingestion receipts</CardTitle></CardHeader>
        <CardContent>
          <Table className="text-left">
            <TableHeader><TableRow><TableHead scope="col">Outcome</TableHead><TableHead scope="col">Credential</TableHead><TableHead scope="col">Received</TableHead><TableHead scope="col">Receipt</TableHead></TableRow></TableHeader>
            <TableBody>
              {candidate.ingestion_audits.map((audit) => (
                <TableRow key={audit.id}>
                  <TableCell className="font-mono text-xs font-bold uppercase text-accent">{audit.outcome}</TableCell>
                  <TableCell className="font-mono text-xs text-ink-soft">
                    <span className="block">{audit.credential_label}</span>
                    <span className="mt-1 block text-muted">
                      {audit.actor_type} · {audit.actor_id}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-soft">{formatDate(audit.received_at)}</TableCell>
                  <TableCell className="break-all font-mono text-xs text-muted">{audit.id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

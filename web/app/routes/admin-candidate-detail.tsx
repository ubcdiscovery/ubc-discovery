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
  if (!value) return "Unknown";
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
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
        <h1 className="mt-1 text-balance font-display text-4xl font-extrabold tracking-tighter md:text-6xl">{candidate.source_account}</h1>
        <p className="mt-3 font-mono text-xs uppercase tracking-wide text-muted">{candidate.id}</p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="grid gap-5">
          <Card>
            <CardHeader><CardTitle>Source text</CardTitle></CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm/relaxed text-ink-soft">{candidate.description || "No caption supplied."}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Source images</CardTitle></CardHeader>
            <CardContent>
              {candidate.image_urls.length === 0 ? (
                <p className="font-mono text-xs uppercase tracking-wide text-muted">No source images supplied.</p>
              ) : (
                <ol className="grid gap-3 sm:grid-cols-2">
                  {candidate.image_urls.map((url, index) => (
                    <li key={`${url}-${index}`} className="grid gap-2">
                      <p className="font-mono text-2xs uppercase tracking-wide text-muted">
                        {String(index + 1).padStart(2, "0")}
                      </p>
                      <div className="flex aspect-square items-center justify-center overflow-hidden border border-rule-soft bg-accent-soft">
                        <img
                          src={url}
                          alt={`Source image ${index + 1} for ${candidate.source_account}`}
                          className="size-full object-contain"
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {candidate.extracted_at ? (
            <>
            <Card>
              <CardHeader><CardTitle>Classification</CardTitle></CardHeader>
              <CardContent>
                <p className="font-mono text-xs font-bold uppercase text-accent">
                  {candidate.is_event ? "event" : "not an event"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Extracted original</CardTitle></CardHeader>
              <CardContent>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-2xs text-ink-soft">
                  {JSON.stringify(candidate.extracted_original, null, 2)}
                </pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Current draft</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-3 font-mono text-xs">
                  <div>
                    <dt className="uppercase tracking-wide text-muted">Title</dt>
                    <dd className="mt-1 font-bold text-ink">{candidate.title || "—"}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide text-muted">Location</dt>
                    <dd className="mt-1 font-bold text-ink">{candidate.location_name || "—"}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide text-muted">Start</dt>
                    <dd className="mt-1 font-bold text-ink">{formatDate(candidate.event_date ?? null)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide text-muted">End</dt>
                    <dd className="mt-1 font-bold text-ink">{formatDate(candidate.event_end_date ?? null)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide text-muted">Organizer</dt>
                    <dd className="mt-1 font-bold text-ink">{candidate.club_name || "—"}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide text-muted">Vibes</dt>
                    <dd className="mt-1 font-bold text-ink">{(candidate.vibes ?? []).join(", ") || "—"}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide text-muted">Source label</dt>
                    <dd className="mt-1 font-bold text-ink">{candidate.source_label || "—"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            </>
          ) : null}
        </div>

        <div className="grid content-start gap-5">
          <Card className="border-2">
            <CardHeader><CardTitle>Provenance</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3 font-mono text-xs">
                <div><dt className="uppercase tracking-wide text-muted">Status</dt><dd className="mt-1 font-bold uppercase text-accent">{candidate.status}</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">Source type</dt><dd className="mt-1 font-bold text-ink">{candidate.source_type}</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">Source account</dt><dd className="mt-1 font-bold text-ink">{candidate.source_account}</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">External source ID</dt><dd className="mt-1 break-all font-bold text-ink">{candidate.external_source_id}</dd></div>
                <div><dt className="uppercase tracking-wide text-muted">Received</dt><dd className="mt-1 font-bold text-ink">{formatDate(candidate.created_at)}</dd></div>
                <div>
                  <dt className="uppercase tracking-wide text-muted">Extraction</dt>
                  <dd className="mt-1 font-bold text-ink">
                    {candidate.extracted_at ? "complete" : "awaiting extraction"}
                  </dd>
                </div>
              </dl>
              {candidate.extracted_at ? (
                <div className="mt-5">
                  <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-accent">Extraction metadata</h2>
                  <p className="mt-2 font-mono text-xs text-ink-soft">{candidate.extraction_model}</p>
                  <p className="mt-1 font-mono text-xs text-ink-soft">{formatDate(candidate.extracted_at)}</p>
                </div>
              ) : null}
              {candidate.source_url && (
                <a href={candidate.source_url} target="_blank" rel="noreferrer" className="mt-5 block break-all text-sm text-accent underline">Open source URL</a>
              )}
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

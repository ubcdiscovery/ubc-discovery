import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/Table";
import type { ApiCandidateDetail } from "~/lib/admin-candidates";

type CandidateIngestionReceiptsProps = {
  audits: ApiCandidateDetail["ingestion_audits"];
  formatDate: (value: string | null | undefined) => string;
};

export function CandidateIngestionReceipts({
  audits,
  formatDate,
}: CandidateIngestionReceiptsProps) {
  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>Ingestion receipts</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Outcome</TableHead>
              <TableHead>Actor / credential</TableHead>
              <TableHead>Source receipt</TableHead>
              <TableHead>Receipt ID</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audits.map((audit) => (
              <TableRow key={audit.id}>
                <TableCell className="font-mono text-xs font-bold uppercase text-accent">
                  {audit.outcome}
                </TableCell>
                <TableCell>
                  <div className="font-mono text-xs text-ink-soft">{audit.credential_label}</div>
                  <div className="mt-1 font-mono text-2xs text-muted">
                    {audit.actor_type} · {audit.actor_id}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-mono text-xs text-ink-soft">{audit.source_type}</div>
                  <div className="mt-1 break-all font-mono text-2xs text-muted">
                    {audit.external_source_id}
                  </div>
                </TableCell>
                <TableCell className="break-all font-mono text-2xs text-muted">
                  {audit.id}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted">
                  {formatDate(audit.received_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

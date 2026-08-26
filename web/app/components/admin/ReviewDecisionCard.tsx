import { Link } from "react-router";
import { Button } from "~/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/Card";
import type { ApiCandidate, ApiCandidateDetail } from "~/lib/admin-candidates";

type ReviewMatch = ApiCandidateDetail["same_club_same_day_matches"][number];

type ReviewDecisionCardProps = {
  candidate: ApiCandidate;
  matches: ReviewMatch[];
  decision: "approve" | "reject" | null;
  saving: boolean;
  onDecisionChange: (decision: "approve" | "reject" | null) => void;
  onMutate: (action: "approve" | "reject" | "return") => void;
  formatDate: (value: string | null | undefined) => string;
};

export function ReviewDecisionCard({
  candidate,
  matches,
  decision,
  saving,
  onDecisionChange,
  onMutate,
  formatDate,
}: ReviewDecisionCardProps) {
  const canEdit = candidate.status === "pending";
  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle>Review decision</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-xs font-bold uppercase text-accent">{candidate.status}</p>
        {matches.length ? (
          <div className="mt-4 border border-rule-soft bg-accent-soft p-3">
            <p className="font-mono text-xs font-bold uppercase text-ink">Same club, same day</p>
            <ul className="mt-2 grid gap-2 text-sm">
              {matches.map((match) => (
                <li key={`${match.kind}-${match.id}`}>
                  <Link
                    className="text-accent underline"
                    to={
                      match.kind === "event"
                        ? `/admin/events/${match.id}`
                        : `/admin/candidates/${match.id}`
                    }
                  >
                    {match.title}
                  </Link>
                  <span className="ml-2 text-muted">{formatDate(match.event_date)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canEdit ? (
          <div className="mt-5 grid gap-2">
            {decision ? (
              <div className="border border-rule-soft p-3">
                <p className="text-sm">
                  Confirm {decision === "approve" ? "approval" : "rejection"}?{" "}
                  {decision === "approve"
                    ? "This creates the public Event Listing."
                    : "The source evidence will be retained."}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant={decision === "approve" ? "primary" : "danger"}
                    onClick={() => onMutate(decision)}
                    disabled={saving}
                  >
                    Confirm {decision}
                  </Button>
                  <Button variant="ghost" onClick={() => onDecisionChange(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button variant="primary" onClick={() => onDecisionChange("approve")}>
                  Approve Candidate
                </Button>
                <Button variant="danger" onClick={() => onDecisionChange("reject")}>
                  Reject Candidate
                </Button>
              </>
            )}
          </div>
        ) : candidate.status === "rejected" ? (
          <Button onClick={() => onMutate("return")} disabled={saving}>
            Return to review
          </Button>
        ) : (
          <p className="mt-4 text-sm text-ink-soft">
            Published as{" "}
            <Link className="text-accent underline" to={`/admin/events/${candidate.id}`}>
              Event Listing {candidate.id}
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}

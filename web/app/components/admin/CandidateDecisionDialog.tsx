import { useEffect } from "react";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import type { ApiCandidate } from "~/lib/admin-candidates";

export type CandidateDecision = {
  candidate: ApiCandidate;
  action: "approve" | "reject";
};

type CandidateDecisionDialogProps = {
  decision: CandidateDecision;
  saving: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CandidateDecisionDialog({
  decision,
  saving,
  error,
  onConfirm,
  onCancel,
}: CandidateDecisionDialogProps) {
  const { candidate, action } = decision;
  const approving = action === "approve";

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [onCancel, saving]);

  return (
    <div
      className="fixed inset-0 z-110 flex items-center justify-center bg-ink/55 p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-decision-title"
        className="w-full max-w-130 border-2 border-ink bg-bg p-6 shadow-hard-lg md:p-8"
      >
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
          {candidate.source_account}
        </p>
        <h2
          id="candidate-decision-title"
          className="mt-2 font-display text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
        >
          {approving ? "Approve this Candidate?" : "Reject this Candidate?"}
        </h2>
        <p className="mt-4 line-clamp-2 wrap-break-word text-sm/relaxed text-ink-soft">
          {candidate.description || "No caption supplied."}
        </p>
        <p className="mt-3 text-sm/relaxed text-ink-soft">
          {approving
            ? "This creates the public Event Listing."
            : "The source evidence will be retained."}
        </p>
        {error ? (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        ) : null}
        <div className="mt-6 flex gap-2">
          <Button
            variant={approving ? "primary" : "danger"}
            onClick={onConfirm}
            disabled={saving}
          >
            Confirm {action}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving} autoFocus>
            Cancel
          </Button>
        </div>
      </section>
    </div>
  );
}

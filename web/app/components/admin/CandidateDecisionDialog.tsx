import { Alert } from "~/components/ui/Alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/AlertDialog";
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

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <AlertDialogContent>
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
          {candidate.source_account}
        </p>
        <AlertDialogTitle className="mt-2">
          {approving ? "Approve this Candidate?" : "Reject this Candidate?"}
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-4">
          <span className="line-clamp-2 wrap-break-word">
            {candidate.description || "No caption supplied."}
          </span>
          <span className="mt-3 block">
            {approving
              ? "This creates the public Event Listing."
              : "The source evidence will be retained."}
          </span>
        </AlertDialogDescription>
        {error ? (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        ) : null}
        <AlertDialogFooter className="mt-6">
          <AlertDialogAction
            variant={approving ? "primary" : "danger"}
            onClick={onConfirm}
            disabled={saving}
          >
            Confirm {action}
          </AlertDialogAction>
          <AlertDialogCancel onClick={onCancel} disabled={saving}>
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

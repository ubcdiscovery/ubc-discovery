import { useState } from "react";
import { useNavigate } from "react-router";
import type { ApiEvent } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { useSavedEventIds, useSavedEventMutations } from "~/lib/saved-events-query";
import { startAuthFlow } from "~/lib/auth-flow";

type SaveEventButtonProps = {
  eventId: string;
  event: ApiEvent;
  variant: "largeIcon" | "cardIcon" | "bar" | "wide";
  className?: string;
};

const variantClasses = {
  largeIcon: "size-11 p-0 text-base",
  // 44px hit target with a hard offset, for the blue band on event cards.
  cardIcon: "size-11 shrink-0 border-2 p-0 text-lg shadow-hard-sm",
  bar: "px-3.5 py-3 text-xs",
  wide: "w-full py-3.5 text-xs",
};

export function SaveEventButton({ eventId, event, variant, className = "" }: SaveEventButtonProps) {
  const navigate = useNavigate();
  const { state } = useAuth();
  const { data: savedEventIds } = useSavedEventIds();
  const { save, unsave, pending } = useSavedEventMutations();
  const [failed, setFailed] = useState(false);
  const saved = savedEventIds.has(eventId);

  async function handleClick(clickEvent: React.MouseEvent<HTMLButtonElement>) {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();

    if (state.status !== "member") {
      const returnTo = `/events/${encodeURIComponent(eventId)}`;
      startAuthFlow({
        returnTo,
        actions: [{ type: "save-event", payload: { eventId } }],
      });
      void navigate(`/sign-in?redirect=${encodeURIComponent(returnTo)}`);
      return;
    }

    setFailed(false);
    try {
      if (saved) {
        await unsave.mutateAsync(eventId);
      } else {
        await save.mutateAsync({ eventId, event });
      }
    } catch {
      setFailed(true);
    }
  }

  const text =
    variant === "largeIcon" || variant === "cardIcon"
      ? saved
        ? "♥"
        : "♡"
      : variant === "bar"
        ? pending
          ? "..."
          : saved
            ? "♥ SAVED"
            : "♡ SAVE"
        : pending
          ? "SAVING..."
          : saved
            ? "♥ SAVED TO SHORTLIST"
            : "♡ SAVE TO SHORTLIST";

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved events" : "Save event"}
      title={failed ? "Save failed. Try again." : saved ? "Remove from saved events" : "Save event"}
      onClick={handleClick}
      disabled={pending}
      className={`inline-flex items-center justify-center border font-mono font-bold tracking-wider uppercase cursor-pointer disabled:opacity-60 ${
        saved
          ? variant === "cardIcon"
            ? "border-ink bg-hi text-on-hi"
            : "border-accent bg-accent text-on-color"
          : "border-ink bg-bg text-ink"
      } ${variantClasses[variant]} ${className}`}
    >
      {text}
    </button>
  );
}

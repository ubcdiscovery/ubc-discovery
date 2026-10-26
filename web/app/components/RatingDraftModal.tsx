import { StarPicker } from "~/components/EventRatings";
import { VIBES } from "~/lib/constants";

export function RatingDraftModal({
  draft,
  submitting,
  onCancel,
  onSubmit,
  onStarsChange,
  onVibesChange,
  onNoteChange,
}: {
  draft: { stars: number; note: string; strong_vibes: string[] };
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  onStarsChange: (stars: number) => void;
  onVibesChange: (vibes: string[]) => void;
  onNoteChange: (note: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-md border-2 border-ink bg-bg p-6">
        <div className="font-mono text-xs text-muted tracking-wider uppercase mb-4">
          Rate this event
        </div>
        <StarPicker className="mb-5" size="2xl" value={draft.stars} onPick={onStarsChange} />
        <div className="mb-4">
          <div className="font-mono text-xs text-muted tracking-wide uppercase mb-2">
            Strong vibes
          </div>
          <div className="flex flex-wrap gap-1.5">
            {VIBES.map((vibe) => {
              const selected = draft.strong_vibes.includes(vibe.id);
              return (
                <button
                  key={vibe.id}
                  onClick={() =>
                    onVibesChange(
                      selected
                        ? draft.strong_vibes.filter((x) => x !== vibe.id)
                        : [...draft.strong_vibes, vibe.id],
                    )
                  }
                  className={`font-mono text-xs px-2 py-0.5 border cursor-pointer ${
                    selected
                      ? "border-ink bg-ink text-bg"
                      : "border-rule-soft text-muted bg-transparent"
                  }`}
                >
                  {vibe.label}
                </button>
              );
            })}
          </div>
        </div>
        <textarea
          value={draft.note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Add a note (optional)"
          rows={3}
          className="w-full border border-rule-soft bg-transparent font-mono text-xs text-ink p-2 resize-none placeholder:text-muted mb-4 focus:outline-none focus:border-ink"
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-ink font-mono text-xs tracking-wider uppercase cursor-pointer bg-transparent text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 border border-accent bg-accent text-on-color font-mono text-xs font-bold tracking-wider uppercase cursor-pointer disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save rating"}
          </button>
        </div>
      </div>
    </div>
  );
}

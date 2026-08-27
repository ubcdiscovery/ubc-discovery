import { useState, useMemo } from "react";
import { Link } from "react-router";
import { type EventRatingResponse } from "~/lib/api";
import { VIBES } from "~/lib/constants";

export function StarPicker({
  value,
  onPick,
  size = "xl",
  className = "",
}: {
  value?: number;
  onPick: (stars: number) => void;
  size?: "xl" | "2xl";
  className?: string;
}) {
  const [hover, setHover] = useState(0);
  const displayed = hover || value || 0;
  return (
    <div className={`flex gap-1 ${className}`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          onMouseEnter={() => setHover(s)}
          className={`text-${size} cursor-pointer bg-transparent border-none p-0 leading-none`}
          style={{ color: "#FFAD00" }}
        >
          {s <= displayed ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

export function Stars({ count, total = 5 }: { count: number; total?: number }) {
  return <span style={{ color: "#FFAD00" }}>{"★".repeat(count)}{"☆".repeat(total - count)}</span>;
}

export function RatingRow({
  rating,
  mine,
  onEdit,
}: {
  rating: EventRatingResponse;
  mine?: boolean;
  onEdit?: () => void;
}) {
  return (
    <div className={`py-3 border-b border-rule-soft ${mine ? "opacity-100" : "opacity-80"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Stars count={rating.stars} />
        {mine && (
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted border border-ink/40 px-1.5 py-0.5 leading-none">
            You
          </span>
        )}
        {mine && onEdit && (
          <button
            onClick={onEdit}
            className="font-mono text-[10px] tracking-widest uppercase border px-1.5 py-0.5 leading-none cursor-pointer transition-colors group/edit"
            style={{ color: "#FFAD00", borderColor: "#FFAD00", backgroundColor: "transparent" }}
            onMouseEnter={(e) => (
              (e.currentTarget.style.backgroundColor = "#FFAD00"),
              (e.currentTarget.style.color = "#0a0a0b")
            )}
            onMouseLeave={(e) => (
              (e.currentTarget.style.backgroundColor = "transparent"),
              (e.currentTarget.style.color = "#FFAD00")
            )}
          >
            Edit
          </button>
        )}
        <span className="font-mono text-[11px] text-ink font-semibold">{rating.user_name}</span>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {new Date(rating.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
      {rating.note && <p className="text-sm/relaxed text-ink-soft mt-0.5">{rating.note}</p>}
      {rating.strong_vibes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rating.strong_vibes
            .map((v) => {
              const meta = VIBES.find((x) => x.id === v);
              return (
                <span key={v} className="font-mono text-[10px] tracking-wide uppercase text-muted">
                  {meta?.label ?? v}
                </span>
              );
            })
            .reduce<React.ReactNode[]>(
              (acc, el, i) =>
                i === 0
                  ? [el]
                  : [...acc, <span key={`sep-${i}`} className="text-muted font-mono text-[10px]">·</span>, el],
              [],
            )}
        </div>
      )}
    </div>
  );
}

type RatingSort = "newest" | "highest" | "lowest";

export function RatingsSection({
  allRatings,
  myRating,
  isSignedIn,
  onStarClick,
  onEdit,
}: {
  allRatings: EventRatingResponse[];
  myRating: EventRatingResponse | null | undefined;
  isSignedIn: boolean;
  onStarClick: (stars: number) => void;
  onEdit: () => void;
}) {
  const [sort, setSort] = useState<RatingSort>("newest");

  const avg =
    allRatings.length > 0
      ? allRatings.reduce((sum, r) => sum + r.stars, 0) / allRatings.length
      : null;

  const others = useMemo(() => {
    const base = myRating
      ? allRatings.filter((r) => r.user_id !== myRating.user_id)
      : allRatings;
    return [...base].sort((a, b) => {
      if (sort === "newest")
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "highest") return b.stars - a.stars;
      return a.stars - b.stars;
    });
  }, [allRatings, myRating, sort]);

  return (
    <div className="mt-7">
      <div className="font-mono text-xs text-muted tracking-widest uppercase mb-3 pb-1.5 border-b border-ink">
        Ratings
      </div>

      {avg !== null ? (
        <>
          <div className="flex items-end gap-3 mb-3">
            <span className="font-display font-extrabold text-6xl leading-none tracking-tight text-ink">
              {avg.toFixed(1)}
            </span>
            <div className="pb-1">
              <Stars count={Math.round(avg)} />
              <div className="font-mono text-xs text-muted mt-0.5">
                {allRatings.length} {allRatings.length === 1 ? "rating" : "ratings"}
              </div>
            </div>
          </div>
          {!isSignedIn && (
            <div className="mb-4 font-mono text-xs text-muted">
              <Link to="/sign-in" className="text-accent underline">
                Sign in
              </Link>{" "}
              to rate this event
            </div>
          )}
          {isSignedIn && myRating === null && (
            <div className="mb-4">
              <div className="font-mono text-xs text-muted mb-2">Rate this event</div>
              <StarPicker onPick={onStarClick} size="2xl" />
            </div>
          )}
        </>
      ) : myRating === null && isSignedIn ? (
        <div className="mb-4">
          <div className="font-mono text-xs text-muted mb-2">Be the first to rate this event</div>
          <StarPicker onPick={onStarClick} size="2xl" />
        </div>
      ) : (
        <div className="mb-4 font-mono text-xs text-muted">
          No ratings yet.{" "}
          <Link to="/sign-in" className="text-accent underline">
            Sign in
          </Link>{" "}
          to be the first.
        </div>
      )}

      <div>
        {others.length > 1 && (
          <div className="flex justify-end gap-3 mb-1">
            {(["newest", "highest", "lowest"] as RatingSort[]).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`font-mono text-[10px] tracking-widest uppercase cursor-pointer bg-transparent border-none p-0 ${sort === s ? "text-ink font-bold" : "text-muted hover:text-ink"}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {myRating && <RatingRow rating={myRating} mine onEdit={onEdit} />}
        {others.map((r) => (
          <RatingRow key={r.id} rating={r} />
        ))}
      </div>
    </div>
  );
}

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
        <StarPicker
          className="mb-5"
          size="2xl"
          value={draft.stars}
          onPick={onStarsChange}
        />
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

import { useState } from "react";
import type { EventSubmissionResponse } from "~/lib/api";
import { VibeTag } from "~/components/VibeTag";
import { fmtDay, fmtTime } from "~/lib/date";
import { SOURCE_DISPLAY } from "~/lib/constants";

type Props = {
  submission: EventSubmissionResponse;
  busy: boolean;
  onApprove: () => void;
  onReject: (note: string | null) => void;
};

export function ReviewCard({ submission, busy, onApprove, onReject }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  const start = new Date(submission.event_date);
  const end = submission.event_end_date
    ? new Date(submission.event_end_date)
    : null;
  const source = SOURCE_DISPLAY[submission.source_label];

  return (
    <article className="border border-ink p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        {source ? (
          <span
            className="px-1.5 py-0.5 font-mono text-2xs font-bold tracking-wider text-on-color uppercase"
            style={{ backgroundColor: source.tone }}
          >
            {source.code}
          </span>
        ) : null}
        <span className="font-mono text-xs tracking-wide text-muted uppercase">
          {submission.club_name}
        </span>
      </div>

      <h2 className="mt-2 font-display text-2xl leading-none font-extrabold tracking-tight text-ink md:text-3xl">
        {submission.title}
      </h2>

      <dl className="mt-4 grid gap-x-8 gap-y-2 font-mono text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3 border-b border-rule-soft pb-1.5">
          <dt className="text-muted uppercase">When</dt>
          <dd className="text-right text-ink">
            {fmtDay(start)} · {fmtTime(start)}
            {end ? `–${fmtTime(end)}` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-rule-soft pb-1.5">
          <dt className="text-muted uppercase">Where</dt>
          <dd className="text-right text-ink">{submission.location_name}</dd>
        </div>
      </dl>

      {submission.description ? (
        <p className="mt-4 max-w-135 text-sm/relaxed text-ink-soft">
          {submission.description}
        </p>
      ) : (
        <p className="mt-4 font-mono text-xs tracking-wide text-muted">
          No description given.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {submission.vibes.map((vibe) => (
          <VibeTag key={vibe} vibe={vibe} />
        ))}
      </div>

      {submission.source_url ? (
        <a
          href={submission.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block font-mono text-xs font-bold tracking-wider text-accent uppercase"
        >
          Open their link ↗
        </a>
      ) : null}

      {rejecting ? (
        <div className="mt-5 border-t border-rule-soft pt-4">
          <label
            htmlFor={`note-${submission.id}`}
            className="font-mono text-xs tracking-wider text-muted uppercase"
          >
            Why? The organizer sees this.
          </label>
          <textarea
            id={`note-${submission.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="We need a room number before this can go live."
            className="mt-1.5 w-full border border-ink bg-surface px-3 py-2.5 font-body text-sm text-ink outline-none focus:border-accent"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={() => onReject(note.trim() || null)}
              disabled={busy}
              className="cursor-pointer border border-danger bg-danger px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-on-color uppercase disabled:opacity-50"
            >
              {busy ? "Declining…" : "Confirm decline"}
            </button>
            <button
              onClick={() => setRejecting(false)}
              disabled={busy}
              className="cursor-pointer border border-ink bg-transparent px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-ink uppercase disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3 border-t border-rule-soft pt-4">
          <button
            onClick={onApprove}
            disabled={busy}
            className="cursor-pointer border border-accent bg-accent px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-on-color uppercase disabled:opacity-50"
          >
            {busy ? "Publishing…" : "Approve · publish"}
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="cursor-pointer border border-ink bg-transparent px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-ink uppercase disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}
    </article>
  );
}

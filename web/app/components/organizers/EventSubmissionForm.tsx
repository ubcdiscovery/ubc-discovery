import { useState } from "react";
import { ApiError, api } from "~/lib/api";
import {
  MAX_SUBMISSION_VIBES,
  SUBMITTABLE_SOURCES,
  VIBES,
  type VibeId,
} from "~/lib/constants";
import { VibeTag } from "~/components/VibeTag";
import { SubmissionSent } from "~/components/organizers/SubmissionSent";
import { CoverImagePicker } from "~/components/organizers/CoverImagePicker";
import { uploadSubmissionPoster } from "~/lib/submission-poster";
import {
  EMPTY_DRAFT,
  validateDraft,
  type Draft,
} from "~/lib/submission-draft";
import {
  FIELD_INPUT,
  FormField,
} from "~/components/organizers/FormField";

export function EventSubmissionForm({
  onSubmitted,
}: {
  onSubmitted: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTitle, setSentTitle] = useState<string | null>(null);
  const [poster, setPoster] = useState<File | null>(null);
  const [stage, setStage] = useState("");

  function update(patch: Partial<Draft>) {
    setError("");
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggleVibe(id: VibeId) {
    setError("");
    setDraft((current) => {
      if (current.vibes.includes(id)) {
        return { ...current, vibes: current.vibes.filter((v) => v !== id) };
      }
      if (current.vibes.length >= MAX_SUBMISSION_VIBES) return current;
      return { ...current, vibes: [...current.vibes, id] };
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }

    setSending(true);
    setError("");
    setStage(poster ? "Sending…" : "");
    try {
      const created = await api.submissions.create({
        title: draft.title.trim(),
        description: draft.description.trim(),
        club_name: draft.clubName.trim(),
        source_label: draft.sourceLabel,
        source_url: draft.sourceUrl.trim() || null,
        external_cta_label: draft.ctaLabel.trim() || null,
        vibes: draft.vibes,
        location_name: draft.locationName.trim(),
        event_date: new Date(draft.startsAt).toISOString(),
        event_end_date: draft.endsAt
          ? new Date(draft.endsAt).toISOString()
          : null,
      });
      if (poster) {
        setStage("Uploading your poster…");
        // The listing is already safely in the queue; a failed image should not
        // read as a failed submission.
        try {
          await uploadSubmissionPoster(created.id, poster);
        } catch {
          setError(
            "Your event was submitted, but the cover image didn't upload. " +
              "A reviewer can still see the listing."
          );
        }
      }
      setSentTitle(draft.title.trim());
      setDraft(EMPTY_DRAFT);
      setPoster(null);
      onSubmitted();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not send the submission. Check your connection and try again."
      );
    } finally {
      setSending(false);
      setStage("");
    }
  }

  if (sentTitle) {
    return (
      <SubmissionSent
        title={sentTitle}
        onSubmitAnother={() => setSentTitle(null)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <FormField label="Event name">
        <input
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Sunrise Hike at Quarry Rock"
          maxLength={500}
          className={FIELD_INPUT}
        />
      </FormField>

      <FormField label="Who is hosting">
        <input
          value={draft.clubName}
          onChange={(e) => update({ clubName: e.target.value })}
          placeholder="UBC Outdoor Club"
          maxLength={255}
          className={FIELD_INPUT}
        />
      </FormField>

      <FormField label="What kind of organizer">
        <div className="flex flex-wrap gap-2">
          {SUBMITTABLE_SOURCES.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => update({ sourceLabel: source.id })}
              className={`cursor-pointer border px-3 py-2 font-mono text-xs font-semibold tracking-wide uppercase ${
                draft.sourceLabel === source.id
                  ? "border-accent bg-accent text-on-color"
                  : "border-ink bg-transparent text-ink"
              }`}
            >
              {source.label}
            </button>
          ))}
        </div>
      </FormField>

      <FormField label="Description" hint="Optional">
        <textarea
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Meet at the bus loop at 5:30am. Moderate 3.8km round trip."
          rows={4}
          maxLength={4000}
          className={`${FIELD_INPUT} resize-y`}
        />
      </FormField>

      <CoverImagePicker file={poster} onChange={setPoster} disabled={sending} />

      <FormField label="Location">
        <input
          value={draft.locationName}
          onChange={(e) => update({ locationName: e.target.value })}
          placeholder="AMS Nest, Level 2"
          maxLength={255}
          className={FIELD_INPUT}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Starts">
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(e) => update({ startsAt: e.target.value })}
            className={`${FIELD_INPUT} font-mono text-sm`}
          />
        </FormField>
        <FormField label="Ends" hint="Optional">
          <input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(e) => update({ endsAt: e.target.value })}
            className={`${FIELD_INPUT} font-mono text-sm`}
          />
        </FormField>
      </div>

      <FormField label="Vibe" hint={`Pick up to ${MAX_SUBMISSION_VIBES}`}>
        <div className="flex flex-wrap gap-1.5">
          {VIBES.map((vibe) => {
            const active = draft.vibes.includes(vibe.id);
            const full =
              draft.vibes.length >= MAX_SUBMISSION_VIBES && !active;
            return (
              <button
                key={vibe.id}
                type="button"
                onClick={() => toggleVibe(vibe.id)}
                disabled={full}
                className={`border-none bg-transparent p-0 ${
                  full ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                }`}
              >
                <VibeTag vibe={vibe.id} active={active} />
              </button>
            );
          })}
        </div>
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Link" hint="Optional">
          <input
            value={draft.sourceUrl}
            onChange={(e) => update({ sourceUrl: e.target.value })}
            placeholder="https://…"
            maxLength={1024}
            className={`${FIELD_INPUT} font-mono text-sm`}
          />
        </FormField>
        <FormField label="Link button says" hint="Optional">
          <input
            value={draft.ctaLabel}
            onChange={(e) => update({ ctaLabel: e.target.value })}
            placeholder="RSVP"
            maxLength={80}
            className={FIELD_INPUT}
          />
        </FormField>
      </div>

      {error ? (
        <p
          role="alert"
          className="border border-danger px-3.5 py-3 font-mono text-xs tracking-wide text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={sending}
          className="cursor-pointer border border-accent bg-accent px-5 py-3.5 font-mono text-xs font-bold tracking-wider text-on-color uppercase disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? stage || "Sending…" : "Send for review →"}
        </button>
        <span className="font-mono text-xs tracking-wide text-muted">
          Reviewed before it goes live
        </span>
      </div>
    </form>
  );
}

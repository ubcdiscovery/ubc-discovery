import { useState, type FormEvent, type ReactNode } from "react";
import {
  draftFromEvent,
  updateInputFromDraft,
  validateAdminEventDraft,
  type AdminEventDraft,
} from "~/lib/admin-events";
import type { ApiEvent, UpdateEventInput } from "~/lib/api";
import { SOURCES, VIBES } from "~/lib/constants";

type AdminEventFormProps = {
  event: ApiEvent;
  onSave: (input: UpdateEventInput) => Promise<ApiEvent>;
};

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block font-mono text-xs font-bold uppercase tracking-wide text-muted">
        {label}
      </label>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const INPUT_CLASS =
  "w-full border border-ink bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function AdminEventForm({ event, onSave }: AdminEventFormProps) {
  const [draft, setDraft] = useState(() => draftFromEvent(event));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function updateDraft(update: Partial<AdminEventDraft>) {
    setDraft((current) => ({ ...current, ...update }));
    setError("");
    setSaved(false);
  }

  function toggleVibe(vibe: string) {
    updateDraft({
      vibes: draft.vibes.includes(vibe)
        ? draft.vibes.filter((value) => value !== vibe)
        : [...draft.vibes, vibe],
    });
  }

  function resetDraft() {
    setDraft(draftFromEvent(event));
    setError("");
    setSaved(false);
  }

  async function submit(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    const validationError = validateAdminEventDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await onSave(updateInputFromDraft(draft));
      setDraft(draftFromEvent(updated));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save Event Listing changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid gap-6">
        <section className="border border-ink bg-surface p-4.5 md:p-6">
          <h2 className="border-b border-ink pb-2 font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Public details
          </h2>
          <div className="mt-5 grid gap-5">
            <Field label="Title" htmlFor="admin-title">
              <input
                id="admin-title"
                required
                value={draft.title}
                onChange={(change) => updateDraft({ title: change.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Description" htmlFor="admin-description">
              <textarea
                id="admin-description"
                rows={7}
                value={draft.description}
                onChange={(change) => updateDraft({ description: change.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Organizer" htmlFor="admin-organizer">
                <input
                  id="admin-organizer"
                  value={draft.clubName}
                  onChange={(change) => updateDraft({ clubName: change.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Location text" htmlFor="admin-location" hint="The public source of truth for where the event happens.">
                <input
                  id="admin-location"
                  required
                  value={draft.locationName}
                  onChange={(change) => updateDraft({ locationName: change.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="border border-ink bg-surface p-4.5 md:p-6">
          <h2 className="border-b border-ink pb-2 font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Schedule and source
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Field label="Starts" htmlFor="admin-start">
              <input
                id="admin-start"
                type="datetime-local"
                required
                value={draft.eventDate}
                onChange={(change) => updateDraft({ eventDate: change.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Ends" htmlFor="admin-end">
              <input
                id="admin-end"
                type="datetime-local"
                min={draft.eventDate}
                value={draft.eventEndDate}
                onChange={(change) => updateDraft({ eventEndDate: change.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Event Source label" htmlFor="admin-source-label">
              <select
                id="admin-source-label"
                value={draft.sourceLabel}
                onChange={(change) => updateDraft({ sourceLabel: change.target.value })}
                className={INPUT_CLASS}
              >
                {SOURCES.filter((source) => source.id !== "all").map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Original source URL" htmlFor="admin-source-url">
              <input
                id="admin-source-url"
                type="url"
                value={draft.sourceUrl}
                onChange={(change) => updateDraft({ sourceUrl: change.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="External action label" htmlFor="admin-cta-label">
              <input
                id="admin-cta-label"
                value={draft.externalCtaLabel}
                onChange={(change) => updateDraft({ externalCtaLabel: change.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </section>

        <section className="border border-ink bg-surface p-4.5 md:p-6">
          <h2 className="border-b border-ink pb-2 font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Vibes
          </h2>
          <fieldset className="mt-4 flex flex-wrap gap-2">
            <legend className="sr-only">Event Listing Vibes</legend>
            {VIBES.map((vibe) => {
              const selected = draft.vibes.includes(vibe.id);
              return (
                <label
                  key={vibe.id}
                  className={`cursor-pointer border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide ${
                    selected ? "border-accent bg-accent text-on-color" : "border-ink bg-surface text-ink"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleVibe(vibe.id)}
                    className="sr-only"
                  />
                  {vibe.label}
                </label>
              );
            })}
          </fieldset>
        </section>
      </div>

      <aside className="self-start border-2 border-ink bg-surface p-4.5 lg:sticky lg:top-5">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">Canonical record</p>
        <dl className="mt-4 grid gap-3 font-mono text-xs">
          <div className="border-b border-rule-soft pb-2">
            <dt className="uppercase tracking-wide text-muted">Listing ID</dt>
            <dd className="mt-1 font-bold text-ink">{event.id}</dd>
          </div>
          <div className="border-b border-rule-soft pb-2">
            <dt className="uppercase tracking-wide text-muted">Ingestion source</dt>
            <dd className="mt-1 font-bold text-ink">{event.source}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-muted">Created</dt>
            <dd className="mt-1 font-bold text-ink">{new Date(event.created_at).toLocaleString()}</dd>
          </div>
        </dl>

        {(error || saved) && (
          <p
            role={error ? "alert" : "status"}
            className={`mt-4 border p-3 text-sm ${error ? "border-danger text-danger" : "border-accent text-ink"}`}
          >
            {error || "Changes saved."}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-1">
          <button
            type="submit"
            disabled={saving}
            className="cursor-pointer border border-accent bg-accent px-4 py-3 font-mono text-xs font-bold uppercase tracking-wide text-on-color disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={resetDraft}
            disabled={saving}
            className="cursor-pointer border border-ink bg-surface px-4 py-3 font-mono text-xs font-bold uppercase tracking-wide text-ink disabled:opacity-60"
          >
            Reset
          </button>
        </div>
      </aside>
    </form>
  );
}

import { useState, type FormEvent } from "react";
import { AdminEventImage } from "~/components/admin/AdminEventImage";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/Card";
import { Checkbox } from "~/components/ui/Checkbox";
import { Field } from "~/components/ui/Field";
import { Input } from "~/components/ui/Input";
import { Select } from "~/components/ui/Select";
import { Textarea } from "~/components/ui/Textarea";
import {
  draftFromEvent,
  emptyAdminEventDraft,
  createInputFromDraft,
  updateInputFromDraft,
  validateAdminEventDraft,
  type AdminEventDraft,
} from "~/lib/admin-events";
import type { ApiEvent, CreateEventInput, UpdateEventInput } from "~/lib/api";
import { SOURCES, VIBES } from "~/lib/constants";

type AdminEventFormProps = {
  event?: ApiEvent;
  onSave?: (input: UpdateEventInput) => Promise<ApiEvent>;
  onCreate?: (input: CreateEventInput) => Promise<ApiEvent>;
  onUploadImage?: (file: File) => Promise<ApiEvent>;
};

export function AdminEventForm({ event, onSave, onCreate, onUploadImage }: AdminEventFormProps) {
  const [draft, setDraft] = useState(() => (event ? draftFromEvent(event) : emptyAdminEventDraft()));
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
    setDraft(event ? draftFromEvent(event) : emptyAdminEventDraft());
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
      const updated = event
        ? await onSave?.(updateInputFromDraft(draft))
        : await onCreate?.(createInputFromDraft(draft));
      if (!updated) throw new Error("Could not save Event Listing.");
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
        <Card>
          <CardHeader>
            <CardTitle>Public details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Field label="Title" htmlFor="admin-title">
              <Input
                id="admin-title"
                required
                value={draft.title}
                onChange={(change) => updateDraft({ title: change.target.value })}
              />
            </Field>
            <Field label="Description" htmlFor="admin-description">
              <Textarea
                id="admin-description"
                rows={7}
                value={draft.description}
                onChange={(change) => updateDraft({ description: change.target.value })}
              />
            </Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Organizer" htmlFor="admin-organizer">
                <Input
                  id="admin-organizer"
                  value={draft.clubName}
                  onChange={(change) => updateDraft({ clubName: change.target.value })}
                />
              </Field>
              <Field
                label="Location text"
                htmlFor="admin-location"
                description="The public source of truth for where the event happens."
              >
                <Input
                  id="admin-location"
                  required
                  value={draft.locationName}
                  onChange={(change) => updateDraft({ locationName: change.target.value })}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule and source</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <Field label="Starts" htmlFor="admin-start">
              <Input
                id="admin-start"
                type="datetime-local"
                required
                value={draft.eventDate}
                onChange={(change) => updateDraft({ eventDate: change.target.value })}
              />
            </Field>
            <Field label="Ends" htmlFor="admin-end">
              <Input
                id="admin-end"
                type="datetime-local"
                min={draft.eventDate}
                value={draft.eventEndDate}
                onChange={(change) => updateDraft({ eventEndDate: change.target.value })}
              />
            </Field>
            <Field label="Event Source label" htmlFor="admin-source-label">
              <Select
                id="admin-source-label"
                value={draft.sourceLabel}
                onChange={(change) => updateDraft({ sourceLabel: change.target.value })}
              >
                {SOURCES.filter((source) => source.id !== "all").map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Original source URL" htmlFor="admin-source-url">
              <Input
                id="admin-source-url"
                type="url"
                value={draft.sourceUrl}
                onChange={(change) => updateDraft({ sourceUrl: change.target.value })}
              />
            </Field>
            <Field label="External action label" htmlFor="admin-cta-label">
              <Input
                id="admin-cta-label"
                value={draft.externalCtaLabel}
                onChange={(change) => updateDraft({ externalCtaLabel: change.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vibes</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">Event Listing Vibes</legend>
              {VIBES.map((vibe) => {
                const selected = draft.vibes.includes(vibe.id);
                return (
                  <label key={vibe.id} className="flex items-center gap-2 text-sm text-ink">
                    <Checkbox checked={selected} onChange={() => toggleVibe(vibe.id)} />
                    {vibe.label}
                  </label>
                );
              })}
            </fieldset>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 self-start lg:sticky lg:top-5">
        <Card className="border-2">
          <CardHeader>
              <CardTitle>{event ? "Canonical record" : "New Event Listing"}</CardTitle>
          </CardHeader>
          <CardContent>
            {event ? (
              <dl className="grid gap-3 font-mono text-xs">
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
            ) : (
              <p className="text-sm text-ink-soft">
                Save the listing first, then upload an image and manage its lifecycle.
              </p>
            )}

            {(error || saved) && (
              <Alert variant={error ? "error" : "success"} className="mt-4">
                {error || "Changes saved."}
              </Alert>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-1">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : event ? "Save changes" : "Create Event Listing"}
              </Button>
              <Button type="button" onClick={resetDraft} disabled={saving}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {event && onUploadImage && <AdminEventImage event={event} onUpload={onUploadImage} />}
      </div>
    </form>
  );
}

import { Button } from "~/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/Card";
import { Checkbox } from "~/components/ui/Checkbox";
import { Field } from "~/components/ui/Field";
import { Input } from "~/components/ui/Input";
import { Select } from "~/components/ui/Select";
import { SOURCES, VIBES } from "~/lib/constants";
import type { ApiCandidate, CorrectCandidateInput } from "~/lib/admin-candidates";

export type CandidateDraft = {
  is_event: boolean;
  title: string;
  location_name: string;
  event_date: string;
  event_end_date: string;
  club_name: string;
  vibes: string[];
  source_label: string;
};

function localInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function draftFromCandidate(candidate: ApiCandidate): CandidateDraft {
  return {
    is_event: candidate.is_event === true,
    title: candidate.title ?? "",
    location_name: candidate.location_name ?? "",
    event_date: localInput(candidate.event_date),
    event_end_date: localInput(candidate.event_end_date),
    club_name: candidate.club_name ?? "",
    vibes: candidate.vibes ?? [],
    source_label: candidate.source_label ?? "campus_community",
  };
}

export function draftInput(draft: CandidateDraft): CorrectCandidateInput {
  return {
    is_event: draft.is_event,
    title: draft.title,
    location_name: draft.location_name,
    event_date: draft.event_date ? new Date(draft.event_date).toISOString() : null,
    event_end_date: draft.event_end_date ? new Date(draft.event_end_date).toISOString() : null,
    club_name: draft.club_name || null,
    vibes: draft.vibes,
    source_label: draft.source_label,
  };
}

type CandidateDraftFormProps = {
  draft: CandidateDraft;
  saving: boolean;
  onChange: (update: Partial<CandidateDraft>) => void;
  onSave: () => void;
};

export function CandidateDraftForm({ draft, saving, onChange, onSave }: CandidateDraftFormProps) {
  function toggleVibe(vibe: string) {
    onChange({
      vibes: draft.vibes.includes(vibe)
        ? draft.vibes.filter((value) => value !== vibe)
        : [...draft.vibes, vibe],
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current draft</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <Checkbox
            checked={draft.is_event}
            onChange={(event) => onChange({ is_event: event.target.checked })}
          />
          Is an Event Listing
        </label>
        <Field label="Title" htmlFor="candidate-title">
          <Input
            id="candidate-title"
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </Field>
        <Field label="Location" htmlFor="candidate-location">
          <Input
            id="candidate-location"
            value={draft.location_name}
            onChange={(event) => onChange({ location_name: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start" htmlFor="candidate-start">
            <Input
              id="candidate-start"
              type="datetime-local"
              value={draft.event_date}
              onChange={(event) => onChange({ event_date: event.target.value })}
            />
          </Field>
          <Field label="End" htmlFor="candidate-end">
            <Input
              id="candidate-end"
              type="datetime-local"
              min={draft.event_date}
              value={draft.event_end_date}
              onChange={(event) => onChange({ event_end_date: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Club name" htmlFor="candidate-club">
          <Input
            id="candidate-club"
            value={draft.club_name}
            onChange={(event) => onChange({ club_name: event.target.value })}
          />
        </Field>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm text-ink">Vibes</legend>
          {VIBES.map((vibe) => (
            <label key={vibe.id} className="flex items-center gap-2 text-sm text-ink">
              <Checkbox
                checked={draft.vibes.includes(vibe.id)}
                onChange={() => toggleVibe(vibe.id)}
              />
              {vibe.label}
            </label>
          ))}
        </fieldset>
        <Field label="Source label" htmlFor="candidate-source-label">
          <Select
            id="candidate-source-label"
            value={draft.source_label}
            onChange={(event) => onChange({ source_label: event.target.value })}
          >
            {SOURCES.filter((source) => source.id !== "all").map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={onSave} disabled={saving}>
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}

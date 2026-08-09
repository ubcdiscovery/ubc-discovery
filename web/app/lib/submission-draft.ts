import type { SubmittableSourceId, VibeId } from "~/lib/constants";

export type Draft = {
  title: string;
  clubName: string;
  description: string;
  locationName: string;
  startsAt: string;
  endsAt: string;
  vibes: VibeId[];
  sourceLabel: SubmittableSourceId;
  sourceUrl: string;
  ctaLabel: string;
};

export const EMPTY_DRAFT: Draft = {
  title: "",
  clubName: "",
  description: "",
  locationName: "",
  startsAt: "",
  endsAt: "",
  vibes: [],
  sourceLabel: "ams_club",
  sourceUrl: "",
  ctaLabel: "",
};

/** Returns the first problem an organizer needs to fix, or null when valid. */
export function validateDraft(draft: Draft): string | null {
  if (draft.title.trim().length < 3) return "Give the event a name.";
  if (draft.clubName.trim().length < 2) return "Tell us who is hosting.";
  if (draft.locationName.trim().length < 2) return "Add a location.";
  if (!draft.startsAt) return "Add a start date and time.";
  if (new Date(draft.startsAt).getTime() <= Date.now())
    return "The start time has to be in the future.";
  if (draft.endsAt && new Date(draft.endsAt) < new Date(draft.startsAt))
    return "The end time cannot be before the start time.";
  if (draft.vibes.length === 0) return "Pick at least one vibe.";
  if (draft.sourceUrl && !/^https?:\/\//.test(draft.sourceUrl.trim()))
    return "The link has to start with http:// or https://";
  return null;
}

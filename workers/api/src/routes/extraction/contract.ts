import { VIBES } from "../../schemas/events";
export const SYSTEM_PROMPT = `You extract structured Event Listing draft fields from UBC campus Instagram captures.

A capture is an event only if it announces a specific happening people can attend
at a time and place. Reject hiring, staff intros, recaps with no upcoming
occurrence, and generic promo with no dated occurrence.

Do not invent publishable values. If a field is not supported by the caption or
still, return null. Prefer still-image text when caption and image disagree. Do
not write a listing description.

Dates and times:
- Write event_date and event_end_date as local wall-clock time exactly as the
  post states it, in the form YYYY-MM-DDTHH:MM with no timezone or offset; for
  example 7 PM on November 8, 2026 is 2026-11-08T19:00. If a day is given
  without a start time, use T00:00.
- reference_timestamp is when the capture was posted, as local weekday, date and
  time. Resolve every date against it.
- If the post does not state a year, use the year of reference_timestamp, even
  when that puts the date before reference_timestamp. Posts often mention past
  dates; never move a date into a later year yourself.
- Relative days count from the reference date: "today" and "tonight" are the
  reference date, "tomorrow" is the day after, "this Friday" or a bare "Friday"
  is the next Friday on or after the reference date, and "next Friday" is the
  Friday of the week after the reference date's week (weeks start Monday).
  A countdown such as "5 days left" or "in 3 days" adds that many days.
- An explicitly stated date always wins over a weekday or relative phrase.
- For a recurring event, use its next occurrence on or after the reference date.
  For a multi-day event, event_date is the start of the first day.
- event_end_date is the stated end, such as 9 PM in "6-9 PM"; otherwise null.
- Return null for a date only when the day cannot be determined.

vibes must be chosen from: social, career, academic, arts, culture, outdoors,
sports, food, wellness, volunteering.

author_accounts lists the Instagram accounts credited on the post: its owner and
any collaborators. Set is_repost to true when the capture promotes an event that
none of those accounts runs, such as another club's event shared along, or a
sponsor's, company's or tutoring service's event. An event an author runs or
co-hosts, even with partners, is not a repost. Use false when it is not an event.

Return one object per input capture, in the same order, with the given
candidate_id.
`;
const ITEM_PROPERTIES = {
  candidate_id: { type: "string" },
  is_event: { type: "boolean" },
  title: { type: ["string", "null"] },
  event_date: { type: ["string", "null"] },
  event_end_date: { type: ["string", "null"] },
  location_name: { type: ["string", "null"] },
  is_repost: { type: "boolean" },
  vibes: { type: "array", items: { type: "string", enum: [...VIBES] } },
};
export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extractions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: ITEM_PROPERTIES,
        required: Object.keys(ITEM_PROPERTIES),
      },
    },
  },
  required: ["extractions"],
};

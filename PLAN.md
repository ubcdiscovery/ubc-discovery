# Public Launch Implementation Plan

## Phase 1: Public Discover Foundation

Status: Implemented.

Backend:
- Added event discovery fields:
  - `source_label`: `ubc_official | ams_club | campus_community`
  - `vibes`: fixed list of student-facing labels
  - `external_cta_label`: optional label such as `View registration` or `View Instagram`
- Added a startup schema guard for existing `events` tables because migrations are not yet introduced.
- Updated event seed/import code to include source labels, vibes, source URLs, and outbound CTA labels.

Frontend:
- Kept the primary tab as Discover and added `Map | List` modes with Map as default.
- Built List mode with event cards plus date, source, and vibe filters.
- Kept `/events/:id` as the canonical public detail route.
- Added `Open organizer page`, `Share event`, `Report issue`, and `Open in Maps` where coordinates exist.
- Frontend now requires the phase 1 event payload contract.

## Phase 2: Saved Events

Backend:
- Add `saved_events` table:
  - `id`
  - `user_id`
  - `event_id`
  - `created_at`
  - unique `(user_id, event_id)`
- Add endpoints:
  - `GET /users/me/saved-events`
  - `POST /events/{id}/save`
  - `DELETE /events/{id}/save`
- Keep saved events private. Do not expose public saved counts.

Frontend:
- Add save/bookmark action on event cards and event detail.
- Visitors tapping save get a contextual sign-in prompt.
- Members can save and unsave events.
- Populate the Saved tab from backend.
- Show saved state in Discover Map/List cards.

## Phase 3: For You Mode

Backend:
- Add authenticated `GET /events/for-you`.
- Start with deterministic ranking based on overlap between Member Interests and Event Listing Vibes.
- Keep AI ranking as a later enhancement after ingestion-time event enrichment exists.

Frontend:
- Add `All | For You` control inside Discover.
- Visitors tapping For You get a sign-in prompt.
- Members without Interests see an onboarding/profile prompt plus fallback events.
- Make For You affect both Map and List views.

## Phase 3b: Event Visit Signal (future)

A voluntary post-event signal where a Member tells the app they went to an event (e.g., via share-to-app or a post-event prompt). This feeds the For You recommendation engine with actual attendance preferences, not just saved intent. Unlike Saved Events (pre-event interest), this captures "I went and want more like this."

This is NOT an attendance record, RSVP, or proof of attendance: it is a private recommendation signal owned by the Member. It requires its own data model (Member × Event join table with timestamp), not a counter on the User row.

## Phase 4: Event Ingestion and Curation

Backend:
- Formalize source labels:
  - `UBC Official`
  - `AMS Club`
  - `Campus Community`
- Add ingestion/admin path for manual imports.
- Update scraper/importer to classify:
  - source label
  - vibes
  - location text
  - optional coordinates
- Add AI vibe classification from the fixed taxonomy at ingestion time.
- Do not add in-app event submission.

Frontend:
- Display source label on event cards and event detail.
- Show lightweight disclaimer only for Campus Community listings.
- Keep Project Instagram secondary for report/intake.

## Phase 5: Meet Feature Gate

Backend:
- Add generic `feature_access` table:
  - `id`
  - `user_id`
  - `feature_key`
  - `created_at`
- Add `feature_access_requests` table:
  - `id`
  - `user_id`
  - `feature_key`
  - `created_at`
- Add endpoints:
  - `GET /features/me`
  - `POST /features/{feature_key}/request-access`
- Gate Meet APIs server-side.

Frontend:
- Keep Meet tab visible.
- Visitors see `Sign in to request access`.
- Members without access see `Request access`.
- Allowlisted Members see the early Meet UI.

## Phase 6: Meet Areas

Backend:
- Replace coordinate-based Meet/Nearby model with selected Meet Area availability:
  - `meet_area_id`
  - `available_until`
  - no exact lat/lng for Meet
- Add fixed Meet Area list, either config or DB seed.
- Add endpoints:
  - `GET /meet-areas`
  - `PUT /users/me/meet-availability`
  - `GET /meet/people?meet_area_id=...`
- Expire availability after 3 hours.

Frontend:
- Add manual-first Meet Area picker.
- Add optional client-side location suggestion later.
- Send only selected Meet Area ID to server.
- Rank people by relevance, not raw proximity.

## Phase 7: Privacy Cleanup

Backend:
- Decide what to do with existing coordinate fields:
  - keep only if still needed outside Meet
  - otherwise remove or deprecate
- Stop using `/users/me/location` for Meet.
- Review `/connections/locations`; likely remove or gate heavily.
- Update tests to reflect the Meet Area model.

Frontend:
- Remove coordinate-based nearby polling.
- Remove location permission prompts from Meet.
- Keep location permission only for optional on-device Meet Area suggestion and Zone Unlock.

## Recommended Next Slice

Implement Phase 1 and Phase 2 first. That gives the public web product a credible discovery loop: map-first Discover, canonical event pages, shareable URLs, filters, and private Saved Events. Then implement For You. Keep Meet gated until the privacy model is rebuilt around Meet Areas.

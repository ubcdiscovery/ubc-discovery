# UBC Discovery

UBC Discovery is the public product name for an independent, student-built event and campus discovery product for UBC. The name reflects the product's core value of helping anyone in the UBC community discover what is happening on campus, with social connection as a signed-in member layer rather than the primary public promise.

## Language

**Visitor**:
An unauthenticated person using the public experience to explore UBC Discovery life before creating an account. A Visitor can see public discovery content but is not a participant in member-only social features.
_Avoid_: Guest, anonymous user

**Member**:
A signed-in person with a profile who can participate in social discovery and connection features. A Member does not need to use a UBC email address or legal name.
_Avoid_: User, account, student

**Preferred Name**:
The name a Member chooses to show in their profile and social discovery surfaces. Preferred Name is not a legal identity claim.
_Avoid_: Legal name, real name

**Interest**:
A fixed preference label a Member selects during onboarding and can edit later to describe what they want to explore or meet people around. Interests power the Personalized Event Feed and social matching, and are distinct from Vibes even when their labels overlap.
_Avoid_: Free-text hobby, arbitrary tag

**Academic Context**:
A Member's faculty, major, and year standing, collected during onboarding and editable later. Academic Context informs the Personalized Event Feed by filtering or ranking Event Listings by relevance: for example, a third-year student is less likely to see a first-year orientation event. Academic Context is a recommendation signal, distinct from Interests and not used for social matching in Meet.
_Avoid_: Required for membership, social matching signal

**Newcomer**:
A person who is newly arriving at or newly orienting themselves around UBC. Newcomers are an important audience, but they are not the full audience for campus and event discovery.
_Avoid_: All users, all students

**Campus Explorer**:
A UBC community member looking for things to do, places to discover, or people to meet around campus life. Campus Explorers are the broader public launch audience, with Newcomers as the initial wedge.
_Avoid_: Generic social network user

**Meet**:
A secondary member-only social discovery surface based on selected Meet Areas rather than stored coordinates. Meet must not imply live location tracking, precise location sharing, or visibility to Visitors.
_Avoid_: Nearby, live location, tracking, public nearby

**Feature-gated Meet**:
The rollout model for Meet before public launch. Feature-gated Meet is controlled by Feature Access for selected Members in the main deployment; it can appear in navigation for everyone, but Visitors and non-allowlisted Members see no profiles and only a coming-soon or request-access surface.
_Avoid_: Separate beta deployment, public nearby

**Feature Access**:
A server-side, database-backed allowlist granting a Member access to a specific gated feature. Feature Access applies only to Members and should be generic rather than tied only to Meet so future risky or staged features can use the same concept.
_Avoid_: Client-only flag, one-off beta column

**Request Access**:
A signed-in Member signal requesting access to a gated feature such as Meet. Request Access is stored for manual review, gauges demand, does not notify admins by default, and does not grant Feature Access by itself; Visitors should be prompted to sign in before requesting.
_Avoid_: Waitlist approval, beta invite

**Meet Area**:
A named campus area or building-level location where a Member says they are open to meet, such as Around IKB, Around the Nest, or Main Mall. Meet Area selection is manual-first; a client may optionally use on-device location to suggest nearby Meet Areas, but the server should receive only the selected Meet Area rather than exact coordinates. Meet Area availability is temporary and should expire automatically.
_Avoid_: Exact location, live coordinates

**Contextual Social Discovery**:
A member-only social discovery model where people are introduced around shared Interests, Event Listings, Places, or campus context. Meet Area results should be ranked by relevance rather than shown as a raw directory; private Saved Events may inform matching, but exact saved-event overlap should not be revealed to other Members by default.
_Avoid_: Random nearby people, stranger feed

**Available to Meet**:
A temporary Member-controlled status that allows the Member to appear in Nearby for a selected Meet Area. Being Available to Meet does not share an exact location and expires after 3 hours by default if not refreshed.
_Avoid_: Online now, live sharing

**UBC-verified Member**:
A Member who has proven control of a UBC email address and carries a durable trust badge. UBC verification is not required to become a Member, and the badge does not expire in the current product model. Deferred to V3 (Meet/social features): verification builds trust between users, which has no value until users interact with each other.
_Avoid_: Confirmed student, eligible user

**Independent Campus Product**:
A product built independently for the UBC community rather than by UBC, a faculty, or an official university office. Public positioning should make this independence clear.
_Avoid_: Official UBC app, university service

**Project Instagram**:
The official v1 contact, intake, and marketing channel for the Independent Campus Product. Project Instagram can receive outside-app Event Listing submissions, Report Issue messages, and launch traffic, but it should remain visually secondary and not clutter Discover.
_Avoid_: In-app event submission, support ticket system

**Public Discovery Content**:
Campus-oriented content that a Visitor can browse without becoming a Member, including zones, landmarks, public Event Listings, and shareable Event Listing detail pages. Public Discovery Content excludes identifiable Member profiles, live Meet availability, member distance, connection actions, and personalized matching.
_Avoid_: Guest mode, anonymous nearby

**Contextual Sign-up Trigger**:
A prompt to become a Member that appears only when a Visitor tries to use a member-only capability, such as people discovery, meetups, saved progress, personalized recommendations, or connection actions. Contextual Sign-up Triggers replace a global authentication wall for public discovery. The trigger uses two presentation modes depending on available space: an **inline mode** for detail or full-screen views (replaces the action area with a short message and Sign In button, so the Visitor stays on the page and can still browse the content) and a **toast mode** for compact actions like a save icon on a card (a brief non-blocking bar slides up with a tappable Sign In link and auto-dismisses). Both modes share the same component and navigate to the same auth flow.
_Avoid_: Auth wall, forced login, modal popup over content

**Campus Discovery**:
The public-first experience of exploring UBC places, zones, landmarks, and newcomer-relevant happenings before participating socially. Campus Discovery is the primary public web promise.
_Avoid_: Nearby people discovery, social feed

**Student-centered Discovery**:
The product's primary public positioning: helping UBC community members find what is happening around campus in a lightweight, student-oriented way. Student-centered Discovery can include events, places, zones, and context that official or organizer-first calendars may not make easy to browse.
_Avoid_: Official event calendar, generic social network

**Web-first Launch**:
The initial public launch posture prioritizing mobile web and desktop web discovery before native app distribution. Native apps may remain supported, but public acquisition, marketing links, and low-friction discovery should work first-class on the web; SEO is deferred beyond the first public version.
_Avoid_: App-download-first launch

**Discover**:
The primary event-first surface for Student-centered Discovery. Discover centers Event Listings filtered by Vibe, source, and date, with an optional map view for location context. Users choose events by what they are about, not where they are; spatial browsing is secondary to content-based filtering.
_Avoid_: Map-first, campus exploration tracker, separate Events tab

**Zone**:
A broad campus area used for orientation, clustering, and exploration progress. Zones should be visually secondary to Event Listings and Places on Discover, but may still support location-gated unlocks.
_Avoid_: Venue, event, primary marker

**Place**:
A persistent campus landmark or spot worth discovering, such as Wreck Beach, Museum of Anthropology, IKB, Rose Garden, or UBC Farm. Places may have canonical public URLs, but Event Listings do not need to reference Places as venues.
_Avoid_: Event, Zone, venue registry

**Open in Maps**:
A navigation action available for any Place or Event Listing with a map coordinate. Open in Maps helps the user navigate through their device's map app or web maps and does not imply exact event verification.
_Avoid_: Verified location

**Report Issue**:
An outbound contact action for flagging incorrect or inappropriate Event Listing details. Report Issue is visible to Visitors and Members; in the current product model, it sends users to the project's Instagram inbox rather than creating an in-app moderation workflow.
_Avoid_: In-app report queue

**Zone Unlock**:
A Member's exploration-progress action that confirms they were within a Zone before awarding progress. Zone Unlock uses client-side proximity for this low-stakes check and stores only the resulting progress, not exact coordinates; it is not an Event Listing interaction or proof of event attendance.
_Avoid_: Check-in, attendance

**Exploration Progress**:
A secondary Member feature that tracks campus exploration through Zone Unlocks and points. Exploration Progress supports motivation and lightweight sharing, but should not visually dominate Student-centered Discovery.
_Avoid_: Primary product loop, attendance record

**Shareable Achievement**:
A generated social media-friendly summary of a Member's Exploration Progress or campus discovery milestone. Shareable Achievements are secondary growth features behind shareable Event Listings and should not disclose private Saved Events, exact locations, or Meet activity.
_Avoid_: Public activity feed, location history

**Event Listing**:
A public, shareable pointer to an external campus or club event, usually with an organizer name, source link, location text, and optional map coordinate. Event Listing coordinates may be approximate when precise venue information is unavailable; location text is the human-facing source of truth. Event Listing sharing starts with canonical public URL sharing, and each Event Listing detail page should open directly on web without requiring the app or prior in-app state; interactions are outbound-only in the current product model, and an Event Listing is not an RSVP, attendance record, ticket, or organizer-managed registration inside UBC Discovery.
_Avoid_: RSVP, attendance, booking

**Event Source**:
An external origin for an Event Listing. Event Sources should use clear public labels such as UBC Official, AMS Club, and Campus Community; they are source labels only, not verification badges or safety guarantees.
_Avoid_: In-app event submission, unsourced event, other, verified event

**UBC Official**:
An Event Source label for listings from UBC, a faculty, department, or official university unit.
_Avoid_: University-approved for non-official sources

**AMS Club**:
An Event Source label for listings from an AMS-recognized club, student society, or their public organizer channel.
_Avoid_: UBC Official

**Campus Community**:
An Event Source label for unofficial but relevant public campus happenings, including manually reviewed submissions or community-sourced events. Campus Community listings should be public, relevant to UBC students, non-private, not invitation-only, and manually reviewed; the label does not imply UBC, AMS, or organizer endorsement and should carry a lightweight community-sourced disclaimer.
_Avoid_: Other, unofficial event

**Saved Event**:
A Member-only private saved interest in an Event Listing. A Saved Event is an in-app intent and personalization signal, not an RSVP, attendance claim, ticket, message to the event organizer, member-visible attendance disclosure, or public social-proof count in the current product model.
_Avoid_: RSVP, attending, joined event

**Saved**:
A first-class surface for returning to Saved Events. Saved belongs in the primary mobile navigation rather than being buried in Profile; Visitors may see the entry point, but saving and viewing Saved Events require becoming a Member.
_Avoid_: Profile-only saved list

**Profile**:
The Member account surface for profile details, Interests, UBC verification, and settings. Visitors should see a Sign In entry point in the same navigation position rather than a Profile surface.
_Avoid_: Visitor profile

**Vibe**:
A fixed student-facing label describing the feel or intent of an Event Listing, such as social, career, academic, arts, culture, outdoors, sports, food, wellness, or volunteering. Vibes are distinct from Interests even when their labels overlap; AI may suggest Vibes, but it should choose from the fixed taxonomy rather than inventing new labels.
_Avoid_: Free-form category, AI-generated tag

**Event Rating**:
A Member's post-attendance rating of an Event Listing, framed as a recommendation signal ("help us find better events for you") rather than a public review. Event Ratings power the Personalized Event Feed immediately; they will be surfaced as public reviews for recurring events in a future version, but are private in v1.
_Avoid_: Public review (in v1), Yelp-style rating, organizer feedback

**Personalized Event Feed**:
A member-only For You mode inside Discover that ranks Event Listings for a Member using their Interests, Event Listing Vibes, Event Ratings, Saved Events, timing, and other preference signals. For You sits on top of public event discovery and does not replace the general public feed.
_Avoid_: Public feed, all events

## Example Dialogue

Dev: "Can a Visitor browse campus events?"
Domain expert: "Yes, Visitors should be able to explore public discovery content before signing up."

Dev: "Can a Gmail signup become a Member?"
Domain expert: "Yes. Email domain does not determine membership."

Dev: "Does a Member need to use their legal name?"
Domain expert: "No. Members can use a Preferred Name; trust comes from profile context and optional UBC verification."

Dev: "Can Members type any Interest they want?"
Domain expert: "No. Interests should come from a fixed preference vocabulary so discovery and matching stay consistent."

Dev: "Are Interests and Vibes the same thing?"
Domain expert: "No. Interests describe a Member's preferences; Vibes describe an Event Listing's feel or intent."

Dev: "Is every Member a Newcomer?"
Domain expert: "No. Newcomers are a core audience, but campus and event discovery can serve other UBC community members too."

Dev: "Who is the public launch for?"
Domain expert: "Campus Explorers broadly, while making the first version especially useful to Newcomers."

Dev: "Is the public pitch mainly about finding nearby people?"
Domain expert: "No. The public pitch is Student-centered Discovery; meeting people is a signed-in layer around shared events and places."

Dev: "Should event discovery be map-first?"
Domain expert: "No. Users choose events by what they're about, not where they are. Discover is event-list-first with vibe/source/date filtering; a map view is available for location context but is secondary."

Dev: "Should Events be a separate bottom tab?"
Domain expert: "No. Events are the primary content of Discover itself."

Dev: "Should public launch require downloading the native app?"
Domain expert: "No. Launch is web-first so Visitors can discover value before installing anything."

Dev: "Are Zones primary map content?"
Domain expert: "No. Zones are a subtle orientation and clustering layer, though they can still support location-gated unlock progress."

Dev: "Does unlocking a Zone mean a Member attended an event there?"
Domain expert: "No. Zone Unlocks only represent exploration progress for a campus area."

Dev: "Should points be the main product loop?"
Domain expert: "No. Exploration Progress is secondary to Student-centered Discovery, though it can support motivation and sharing."

Dev: "Should nearby discovery only show UBC-verified Members?"
Domain expert: "That should be a filter. Some Members may prefer seeing only UBC-verified Members, but unverified Members are still allowed to participate."

Dev: "Can a Visitor see nearby Members before signing in?"
Domain expert: "No. Identifiable people discovery starts only after sign-in."

Dev: "Does Meet show exact live location?"
Domain expert: "No. Meet uses selected Meet Areas rather than stored coordinates."

Dev: "Should Meet be public at first launch?"
Domain expert: "No. Meet should launch behind an allowlisted feature flag in the main deployment."

Dev: "Can Visitors receive Feature Access?"
Domain expert: "No. Feature Access applies only to Members, though Visitors may request access or see a coming-soon surface."

Dev: "Does a Meet Area stay on a Member profile forever?"
Domain expert: "No. Meet Area availability is temporary and should expire automatically."

Dev: "Should social discovery start from random nearby people?"
Domain expert: "No. Social discovery should be framed around shared events, places, or interests first, with Nearby as a secondary surface."

Dev: "Should Visitors sign in before browsing the map?"
Domain expert: "No. Sign-up should be prompted only when a Visitor reaches for a member-only capability."

Dev: "Can a Member RSVP to an Event Listing?"
Domain expert: "No. UBC Discovery only points people to the external club or organizer page."

Dev: "Can Members submit Event Listings inside the app?"
Domain expert: "No, not in the current product model. Listings can come from external Event Sources or manually reviewed submissions received outside the app."

Dev: "Where should users send event submissions or issue reports?"
Domain expert: "Use Project Instagram as the v1 contact and intake channel."

Dev: "Does manual import mean an Event Listing is official?"
Domain expert: "No. Manual import means the project team reviewed and added it; it does not imply organizer verification."

Dev: "How should an unofficial public event around campus be labeled?"
Domain expert: "Use Campus Community when it is relevant and manually reviewed, without implying UBC or AMS endorsement."

Dev: "Are Event Source labels verification badges?"
Domain expert: "No. They explain source type only; UBC Discovery does not verify or guarantee events."

Dev: "Do all Event Listings need a disclaimer?"
Domain expert: "No. UBC Official and AMS Club listings can rely on source labels and outbound links; Campus Community listings need lightweight clarification."

Dev: "Can a Member save an Event Listing?"
Domain expert: "Yes. Saving marks interest for later and can improve personalization, but it does not register attendance."

Dev: "Where should Members find their Saved Events?"
Domain expert: "Saved should be a primary navigation surface, not only a Profile section."

Dev: "Should Visitors see Profile in the bottom tab?"
Domain expert: "No. Visitors should see Sign In in that navigation position; Members should see Profile."

Dev: "Can other Members see which Event Listings I saved?"
Domain expert: "No. Saved Events are private by default."

Dev: "Can matching use Saved Events?"
Domain expert: "Yes, internally. The app should not reveal exact saved-event overlap to other Members by default."

Dev: "Should Event Listings show how many Members saved them?"
Domain expert: "No, not in the current product model. Saved Events are private and early usage counts may be misleading or identifying."

Dev: "What if an Event Listing does not have an external source link?"
Domain expert: "Show the event details that are known, but do not invent a participation action."

Dev: "How should users report an incorrect Event Listing?"
Domain expert: "For now, Report Issue should send them to the project's Instagram inbox."

Dev: "Can an Event Listing detail depend on the map already being loaded?"
Domain expert: "No. Event Listing detail needs a canonical public URL that opens directly on web."

Dev: "Does every Event Listing need to link to a Place?"
Domain expert: "No. Event Listings can carry their own location text and optional map coordinate."

Dev: "Can AI decide an Event Listing's Vibe?"
Domain expert: "AI can suggest Vibes, but only from the fixed student-facing taxonomy."

Dev: "Do Visitors need a profile to browse events?"
Domain expert: "No. Visitors can browse the public feed; Members can get a Personalized Event Feed."

Dev: "Is For You a separate top-level page?"
Domain expert: "No, not in the current product model. For You is a signed-in mode inside Discover."

Dev: "Can Members review events?"
Domain expert: "Members can rate events, but in v1 ratings are framed as recommendation input, not public reviews. The data is collected for future public display on recurring events."

Dev: "Should V1 include the native mobile app?"
Domain expert: "No. V1 is web-first using React Router 7 with SSR. Native app adds install friction and delays launch."

Dev: "How does event content get onto the platform?"
Domain expert: "Instagram scraping with LLM extraction into structured Event Listings. High-confidence extractions auto-publish; low-confidence ones go to an admin review queue."

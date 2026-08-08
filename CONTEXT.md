# UBC Discovery

UBC Discovery is the public product name for an independent, student-built event discovery product for UBC. The name reflects the product's core value of helping anyone in the UBC community discover what is happening on campus, with personalization as a signed-in member layer rather than the primary public promise.

## Language

**Visitor**:
An unauthenticated person using the public experience to explore UBC Discovery life before creating an account. A Visitor can see public discovery content but is not a participant in member-only social features.
_Avoid_: Guest, anonymous user

**Member**:
A signed-in person with a profile who can use member-only personalization features. A Member does not need to use a UBC email address or legal name.
_Avoid_: User, account, student

**Preferred Name**:
The name a Member chooses to show in their profile. Preferred Name is not a legal identity claim.
_Avoid_: Legal name, real name

**Interest**:
A fixed preference label a Member selects during onboarding and can edit later to describe what they want to explore. Interests power the Personalized Event Feed and are distinct from Vibes even when their labels overlap.
_Avoid_: Free-text hobby, arbitrary tag

**Academic Context**:
A Member's faculty, major, and year standing, collected during onboarding and editable later. Academic Context informs the Personalized Event Feed by filtering or ranking Event Listings by relevance — for example, a third-year student is less likely to see a first-year orientation event. Academic Context is a recommendation signal distinct from Interests.
_Avoid_: Required for membership, social matching signal

**Newcomer**:
A person who is newly arriving at or newly orienting themselves around UBC. Newcomers are an important audience, but they are not the full audience for campus and event discovery.
_Avoid_: All users, all students

**Campus Explorer**:
A UBC community member looking for things to do around campus life. Campus Explorers are the broader public launch audience, with Newcomers as the initial wedge.
_Avoid_: Generic social network user

**UBC-verified Member**:
A Member who has proven control of a UBC email address and carries a durable trust badge. UBC verification is not required to become a Member, and the badge does not expire in the current product model.
_Avoid_: Confirmed student, eligible user

**Independent Campus Product**:
A product built independently for the UBC community rather than by UBC, a faculty, or an official university office. Public positioning should make this independence clear.
_Avoid_: Official UBC app, university service

**Project Instagram**:
The official v1 contact, intake, and marketing channel for the Independent Campus Product. Project Instagram can receive outside-app Event Listing submissions, Report Issue messages, and launch traffic, but it should remain visually secondary and not clutter Discover.
_Avoid_: In-app event submission, support ticket system

**Public Discovery Content**:
Public event content that a Visitor can browse without becoming a Member, including public Event Listings and shareable Event Listing detail pages. Public Discovery Content excludes identifiable Member profiles and personalized matching.
_Avoid_: Guest mode, public member feed

**Contextual Sign-up Trigger**:
A prompt to become a Member that appears only when a Visitor tries to use a member-only capability, such as Saved Events, ratings, personalized recommendations, or profile settings. Contextual Sign-up Triggers replace a global authentication wall for public discovery. The trigger uses two presentation modes depending on available space: an **inline mode** for detail or full-screen views (replaces the action area with a short message and Sign In button, so the Visitor stays on the page and can still browse the content) and a **toast mode** for compact actions like a save icon on a card (a brief non-blocking bar slides up with a tappable Sign In link and auto-dismisses). Both modes share the same component and navigate to the same auth flow.
_Avoid_: Auth wall, forced login, modal popup over content

**Campus Discovery**:
The public-first experience of exploring newcomer-relevant UBC events before using member-only personalization. Campus Discovery is the primary public web promise.
_Avoid_: Social feed, forced sign-in

**Student-centered Discovery**:
The product's primary public positioning: helping UBC community members find what is happening around campus in a lightweight, student-oriented way. Student-centered Discovery focuses on events and campus happenings that official or organizer-first calendars may not make easy to browse.
_Avoid_: Official event calendar, generic social network

**Web-first Launch**:
The initial public launch posture prioritizing mobile web and desktop web discovery before native app distribution. Native apps may remain supported, but public acquisition, marketing links, and low-friction discovery should work first-class on the web; SEO is deferred beyond the first public version.
_Avoid_: App-download-first launch

**Discover**:
The primary event-first surface for Student-centered Discovery. Discover centers Event Listings filtered by Vibe, source, and date. Users choose events by what they are about, not by a separate location-browsing experience.
_Avoid_: Separate Events tab

**Report Issue**:
An outbound contact action for flagging incorrect or inappropriate Event Listing details. Report Issue is visible to Visitors and Members; in the current product model, it sends users to the project's Instagram inbox rather than creating an in-app moderation workflow.
_Avoid_: In-app report queue

**Event Listing**:
A public, shareable pointer to an external campus or club event, usually with an organizer name, source link, and human-readable location text. Location text is the human-facing source of truth; Event Listings are not a location-browsing or attendance system. Event Listing sharing starts with canonical public URL sharing, and each Event Listing detail page should open directly on web without requiring the app or prior in-app state; interactions are outbound-only in the current product model, and an Event Listing is not an RSVP, attendance record, ticket, or organizer-managed registration inside UBC Discovery.
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

Dev: "Should Events be a separate bottom tab?"
Domain expert: "No. Events are the primary content of Discover itself."

Dev: "Should public launch require downloading the native app?"
Domain expert: "No. Launch is web-first so Visitors can discover value before installing anything."

Dev: "Should Visitors sign in before browsing Discover?"
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

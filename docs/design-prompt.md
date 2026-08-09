# Design Prompt for UBC Discovery V1

Paste this into Claude to generate UI designs.

---

## The Prompt

Design the UI for **UBC Discovery**: an independent, student-built event discovery platform for the UBC campus community. This is a fully responsive web app (not a native app) where mobile and desktop are equally important.

### What the product does

UBC Discovery aggregates campus events from club Instagram pages using AI extraction and presents them in a filterable, browsable feed. Students use it to answer: "What's happening on campus this week that I'd actually enjoy?"

### Core screens to design

**1. Discover (Home): Public, no login required**
- Event feed as the primary surface (not a map)
- Filter pills/chips for:
  - **Vibe**: social, career, academic, arts, culture, outdoors, sports, food, wellness, volunteering
  - **Source**: All, UBC Official, AMS Club, Campus Community
  - **Date**: Any date, Upcoming, This week
- Each event card shows: title, date, source label, location name, 1-3 vibe tags, optional thumbnail
- Tapping a card opens the event detail
- No login wall: anyone can browse

**2. Event Detail: Public**
- Full event info: title, description, date/time, location, source label, vibes, optional image
- "Open in Maps" action for navigation
- "Report Issue" link (sends to Instagram DM)
- External link to the original event source
- **Save button**: triggers sign-in prompt for visitors (inline, not a modal blocking content)
- **Rate this event**: only shown to signed-in members who saved it, after the event date passes. Framed as "Help us find better events for you" with a simple 1-5 scale + optional vibe tags for what they liked

**3. Saved: Member only**
- List of saved event listings
- Accessible from primary navigation (bottom tab or top nav)
- Visitors who tap "Saved" see a contextual sign-in prompt

**4. For You: Member only, inside Discover**
- A toggle/tab within Discover that shows personalized event ranking
- Based on: member's interests, saved events, event ratings, vibes
- Same card format as the public feed, just re-ranked

**5. Profile / Sign In**
- Visitors see: "Sign In" in the nav position
- Members see: Profile with preferred name, interests, settings
- Interests selection: fixed vocabulary (not free-text), used for recommendations

**6. Sign-in flow**
- Google Auth and Email sign-in (both supported)
- Any email works: not restricted to UBC email
- Interests onboarding after first sign-up (select from fixed list)

### Design constraints

- **Fully responsive**: mobile and desktop are both first-class. Design for phone browsers AND laptop screens side by side. On mobile: single-column feed, bottom nav. On desktop: wider content area (max-width container), side nav or top nav, potentially 2-column grid for event cards. Not a native app: think responsive web, not iOS HIG.
- **No map as primary view**: events are chosen by what they're about, not where they are. Location is shown in detail view only.
- **Minimal, clean aesthetic**: white background, calm blue accent (#007AFF), Plus Jakarta Sans for headings, DM Sans for body text
- **No gamification**: no points, badges, progress bars, streaks, or exploration tracking in v1
- **No social/people features**: no profiles of other users, no nearby people, no connections in v1
- **Public-first**: the majority of the app is usable without signing in. Sign-in prompts appear only when reaching for member features (save, rate, for you)
- **Contextual sign-up triggers**: never a full-screen auth wall. Use inline prompts (replaces action area) or toast prompts (brief non-blocking bar) depending on context

### Navigation structure

Mobile bottom nav with 3 items:
1. **Discover**: event feed with filters (public default + "For You" member toggle)
2. **Saved**: saved events (member only, sign-in prompt for visitors)
3. **Profile** / **Sign In**: member profile or sign-in entry point

### Tone and brand

- Independent student project, not an official university tool
- Casual, helpful, student-friendly language
- Source labels (UBC Official, AMS Club, Campus Community) provide trust context without implying verification
- The value prop is: "One place to see what's happening on campus, filtered by what you're into"

### Responsive behavior

| Breakpoint | Layout |
|-----------|--------|
| Mobile (<768px) | Single-column feed, bottom nav (3 tabs), full-width cards, filters as horizontal scroll pills |
| Tablet/Desktop (768px+) | Max-width container (~1200px), top nav or side nav, 2-column event card grid, filters as a persistent sidebar or inline row, event detail opens as a wider panel or centered page |

Design both breakpoints explicitly: show mobile and desktop versions of at least the Discover and Event Detail screens.

### What NOT to design

- Admin dashboard / content management
- Instagram scraping pipeline UI
- Map view (deferred, may add as secondary later)
- Meet / nearby people features
- Onboarding carousel or tutorial screens

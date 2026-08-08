# UBC Discovery

UBC Discovery is a student-built campus discovery product for the UBC community. It helps people find events, explore places, and connect around campus life without making sign-up the first step.

This project is a continuation of **UBC-Newcomers**. The original idea focused on helping transfer, international, and first-year students feel less lost when arriving at UBC. That newcomer problem is still the starting wedge, but the product has expanded into a broader public discovery experience for Campus Explorers across the UBC community.

UBC Discovery is independent and is not an official UBC app.

## Core Concepts

### Event Listings

Event Listings are public, shareable pointers to campus or club events. They usually include an organizer, source link, location text, date, vibe, and optional map coordinate. Location text is the source of truth when precise coordinates are unavailable.

Sources use clear labels:

- **UBC Official** for UBC, faculty, department, or official university events.
- **AMS Club** for AMS-recognized club and student society events.
- **Campus Community** for relevant community-sourced or manually reviewed campus happenings.

### Personalized Discovery

Members can select fixed Interests during onboarding and edit them later. Interests power the Personalized Event Feed alongside Event Listing vibes, saved events, ratings, timing, and academic context.

Interests describe what a Member wants to explore. Vibes describe the feel or intent of an Event Listing.

## App Areas

- **Discover**: primary event discovery surface for public browsing and personalized feeds.
- **Event Details**: shareable Event Listing pages that open directly on web.
- **Saved**: member-only saved Event Listings.
- **Profile**: member profile, interests, UBC verification, and settings.

## Tech Stack

- **Backend**: FastAPI, async SQLAlchemy, asyncpg, PostgreSQL
- **Web frontend**: React Router 7, React 19, Tailwind CSS, Vite
- **AI**: AWS titan embedding
- **AWS**: S3, RDS, LightSail container

## Development

See [`backend/README.md`](backend/README.md) for backend setup, AWS credentials, Git hooks, and development commands.

### Web

```bash
cd web
pnpm install
pnpm dev
```

The web app runs at `http://localhost:5173`.

## Testing

```bash
cd backend
uv run pytest tests/ -v
```

import json
import logging
from contextlib import asynccontextmanager

import firebase_admin
from firebase_admin import credentials
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401 - register all model metadata before create_all
from app.config import settings
from app.database import Base, engine
from app.routers import (
    admin,
    auth,
    events,
    ratings,
    recommendations,
    saved_events,
    users,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.firebase_credentials_json:
        val = settings.firebase_credentials_json.strip()
        if val.startswith("{"):
            cred = credentials.Certificate(json.loads(val))
        else:
            cred = credentials.Certificate(val)
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialized")
    else:
        logger.warning("FIREBASE_CREDENTIALS_JSON not set — Firebase auth disabled")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # GIN trigram index for fast ILIKE search — requires pg_trgm extension
        try:
            from sqlalchemy import text

            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_events_search_trgm "
                    "ON events USING gin ("
                    "(coalesce(title,'') || ' ' || coalesce(club_name,'') || ' ' || coalesce(location_name,'')) "
                    "gin_trgm_ops)"
                )
            )
            logger.info("Search trigram index ready")
        except Exception as e:
            logger.warning(
                "Could not create trigram index (search will use seq scan): %s", e
            )
    yield
    await engine.dispose()


app = FastAPI(
    title="UBC Discovery API",
    description="Backend API for public campus event discovery and member personalization",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_origin_regex=settings.cors_allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(events.router)
app.include_router(admin.router)
app.include_router(ratings.router)
app.include_router(saved_events.router)
app.include_router(recommendations.router)


@app.get("/", tags=["Health"])
async def health():
    return {"status": "ok", "app": "UBC Discovery API"}

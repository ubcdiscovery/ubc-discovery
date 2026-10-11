"""Behavioral coverage for vector-backed recommendation endpoints."""

import io
import json
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventVibe
from app.models.saved_event import SavedEvent
from app.models.user import User
from app.services import recommender


def _vector(first: float = 0.0, second: float = 0.0) -> list[float]:
    return [first, second] + [0.0] * 1022


def _score(response, event_id: str) -> float:
    data = response.json()
    return data["scores"][
        next(i for i, event in enumerate(data["events"]) if event["id"] == event_id)
    ]


def _event(
    title: str,
    date: datetime,
    vector: list[float] | None = None,
    vibes: list[EventVibe] | None = None,
) -> Event:
    return Event(
        title=title,
        description="",
        source="manual",
        source_label="campus_community",
        vibes=vibes or [],
        location_name="UBC",
        event_date=date,
        embedding_vector=vector,
    )


class TestEmbeddingValidation:
    def test_validates_dimension_and_finite_components(self):
        assert recommender.is_valid_embedding(_vector(0.1))
        assert not recommender.is_valid_embedding([0.1])
        assert not recommender.is_valid_embedding(_vector(float("nan")))
        assert not recommender.is_valid_embedding(_vector(float("inf")))
        assert not recommender.is_valid_embedding(_vector(True))

    def test_rejects_invalid_generated_embedding(self, monkeypatch):
        class Client:
            def invoke_model(self, **_kwargs):
                return {"body": io.BytesIO(json.dumps({"embedding": [0.1]}).encode())}

        monkeypatch.setattr(recommender, "_bedrock_client", lambda: Client())
        assert recommender.embed_text("example") is None


class TestSimilarEvents:
    async def test_vector_cosine_plus_half_vibe_blend(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
        sample_events: list[Event],
    ):
        source, same_vector, vibe_only = sample_events
        source.embedding_vector = _vector(1)
        same_vector.embedding_vector = _vector(1)
        vibe_only.embedding_vector = _vector(0, 1)
        source.vibes, same_vector.vibes, vibe_only.vibes = (
            [EventVibe.SOCIAL],
            [EventVibe.SOCIAL],
            [EventVibe.CAREER],
        )
        await db_session.flush()

        response = await unauthed_client.get(
            f"/recommendations/events/{source.id}/similar"
        )
        assert response.status_code == 200
        assert _score(response, same_vector.id) == pytest.approx(1.0)
        assert _score(response, vibe_only.id) == pytest.approx(0.0)

        vibe_only.vibes = [EventVibe.SOCIAL]
        await db_session.flush()
        response = await unauthed_client.get(
            f"/recommendations/events/{source.id}/similar"
        )
        assert _score(response, vibe_only.id) == pytest.approx(0.5)

    async def test_vibe_weight_zero_and_one(
        self, unauthed_client, db_session, sample_events
    ):
        source, aligned, matching_vibe = sample_events
        source.embedding_vector = aligned.embedding_vector = _vector(1)
        matching_vibe.embedding_vector = _vector(0, 1)
        source.vibes, aligned.vibes, matching_vibe.vibes = (
            [EventVibe.SOCIAL],
            [EventVibe.CAREER],
            [EventVibe.SOCIAL],
        )
        await db_session.flush()
        base = f"/recommendations/events/{source.id}/similar"

        response = await unauthed_client.get(base, params={"n": 2, "vibe_weight": 0})
        assert response.status_code == 200
        assert _score(response, aligned.id) == pytest.approx(1.0)
        assert _score(response, matching_vibe.id) == pytest.approx(0.0)
        response = await unauthed_client.get(base, params={"n": 2, "vibe_weight": 1})
        assert _score(response, aligned.id) == pytest.approx(0.0)
        assert _score(response, matching_vibe.id) == pytest.approx(1.0)

    async def test_no_source_vector_uses_positive_vibe_fallback(
        self, unauthed_client, db_session, sample_events
    ):
        source, match, no_match = sample_events
        source.embedding_vector = None
        match.embedding_vector = no_match.embedding_vector = None
        source.vibes, match.vibes, no_match.vibes = (
            [EventVibe.SOCIAL],
            [EventVibe.SOCIAL],
            [EventVibe.CAREER],
        )
        await db_session.flush()
        response = await unauthed_client.get(
            f"/recommendations/events/{source.id}/similar"
        )
        assert response.status_code == 200
        assert [e["id"] for e in response.json()["events"]] == [match.id]
        assert response.json()["scores"] == [1.0]

    async def test_zero_vectors_have_zero_cosine(
        self, unauthed_client, db_session, sample_events
    ):
        source, candidate, _ = sample_events
        source.embedding_vector = candidate.embedding_vector = _vector()
        source.vibes, candidate.vibes = [], []
        await db_session.flush()
        response = await unauthed_client.get(
            f"/recommendations/events/{source.id}/similar"
        )
        assert response.status_code == 200
        assert _score(response, candidate.id) == pytest.approx(0.0)

    async def test_not_found_archived_limit_and_validation(
        self, unauthed_client, db_session, sample_events
    ):
        source, candidate, archived = sample_events
        source.embedding_vector = candidate.embedding_vector = (
            archived.embedding_vector
        ) = _vector(0, 1)
        archived.is_archived = True
        await db_session.flush()
        assert (
            await unauthed_client.get("/recommendations/events/nope123/similar")
        ).status_code == 404
        assert (
            await unauthed_client.get(
                f"/recommendations/events/{source.id}/similar", params={"n": 21}
            )
        ).status_code == 422
        response = await unauthed_client.get(
            f"/recommendations/events/{source.id}/similar", params={"n": 1}
        )
        assert len(response.json()["events"]) == 1
        assert archived.id not in {event["id"] for event in response.json()["events"]}

    @pytest.mark.parametrize(("n", "near_count"), [(1, 101), (20, 401)])
    async def test_nearest_candidate_cap_precedes_hybrid_vibe_ranking(
        self, unauthed_client, db_session, sample_events, n, near_count
    ):
        source = sample_events[0]
        source.embedding_vector = _vector(1)
        source.vibes = [EventVibe.SOCIAL]
        for event in sample_events[1:]:
            event.embedding_vector = None
        now = datetime.now(UTC)
        near = [
            _event(f"Near {i}", now + timedelta(days=i), _vector(1), [])
            for i in range(near_count)
        ]
        far_vibe_match = _event(
            "Far vibe match",
            now + timedelta(days=200),
            _vector(0, 1),
            [EventVibe.SOCIAL],
        )
        db_session.add_all([*near, far_vibe_match])
        await db_session.flush()

        response = await unauthed_client.get(
            f"/recommendations/events/{source.id}/similar",
            params={"n": n, "vibe_weight": 1},
        )
        assert response.status_code == 200
        assert far_vibe_match.id not in {
            event["id"] for event in response.json()["events"]
        }


class TestForYou:
    async def test_saved_vector_average_and_saved_vibe_profile(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_events: list[Event],
        test_user: User,
    ):
        saved_a, saved_b, aligned = sample_events
        test_user.interests = {}
        saved_a.embedding_vector = _vector(1)
        saved_b.embedding_vector = _vector(0, 1)
        aligned.embedding_vector = _vector(1, 1)
        saved_a.vibes, saved_b.vibes, aligned.vibes = (
            [EventVibe.SOCIAL],
            [EventVibe.CAREER],
            [EventVibe.SOCIAL, EventVibe.CAREER],
        )
        for event in (saved_a, saved_b):
            db_session.add(SavedEvent(user_id=test_user.id, event_id=event.id))
        await db_session.flush()
        response = await client.get("/recommendations/events/for-you", params={"n": 5})
        assert response.status_code == 200
        assert response.json()["source"] == "saved_events"
        # Mean of the two saved vectors points equally along each component;
        # aligned candidate cosine is 1 and both saved vibes overlap.
        assert _score(response, aligned.id) == pytest.approx(1.0)
        assert saved_a.id not in {e["id"] for e in response.json()["events"]}
        assert saved_b.id not in {e["id"] for e in response.json()["events"]}

    async def test_saved_vibes_and_user_interests_drive_vibe_scores(
        self, client, db_session, sample_events, test_user
    ):
        saved, interest_match, saved_match = sample_events
        saved.embedding_vector = _vector(1)
        interest_match.embedding_vector = saved_match.embedding_vector = _vector(0, 1)
        saved.vibes = [EventVibe.SOCIAL]
        interest_match.vibes = [EventVibe.CAREER]
        saved_match.vibes = [EventVibe.SOCIAL]
        test_user.interests = {"career": True}
        db_session.add(SavedEvent(user_id=test_user.id, event_id=saved.id))
        await db_session.flush()
        response = await client.get("/recommendations/events/for-you", params={"n": 5})
        assert response.json()["source"] == "saved_events"
        assert _score(response, interest_match.id) == pytest.approx(0.25)
        assert _score(response, saved_match.id) == pytest.approx(0.25)

    async def test_recent_fallback_when_saved_events_have_no_vector(
        self, client, db_session, sample_events, test_user
    ):
        saved = sample_events[0]
        saved.embedding_vector = None
        db_session.add(SavedEvent(user_id=test_user.id, event_id=saved.id))
        await db_session.flush()
        response = await client.get("/recommendations/events/for-you", params={"n": 2})
        assert response.status_code == 200
        assert response.json()["source"] == "recent"
        assert response.json()["scores"] == [0.0] * len(response.json()["events"])

    async def test_missing_vector_candidates_are_excluded_with_saved_taste(
        self, client, db_session, sample_events, test_user
    ):
        saved, missing_a, missing_b = sample_events
        saved.embedding_vector = _vector(1)
        missing_a.embedding_vector = missing_b.embedding_vector = None
        db_session.add(SavedEvent(user_id=test_user.id, event_id=saved.id))
        await db_session.flush()

        response = await client.get("/recommendations/events/for-you", params={"n": 5})
        assert response.status_code == 200
        assert response.json()["source"] == "recent"
        assert response.json()["scores"] == [0.0] * len(response.json()["events"])

    async def test_recent_fallback_and_archived_exclusion(
        self, client, db_session, sample_events
    ):
        archived = sample_events[0]
        archived.is_archived = True
        await db_session.flush()
        response = await client.get("/recommendations/events/for-you", params={"n": 5})
        assert response.status_code == 200
        assert response.json()["source"] == "recent"
        assert archived.id not in {e["id"] for e in response.json()["events"]}

    async def test_recent_200_boundary_is_applied_before_missing_vector_filter(
        self, client, db_session, sample_events, test_user
    ):
        saved = sample_events[0]
        saved.embedding_vector = _vector(1)
        db_session.add(SavedEvent(user_id=test_user.id, event_id=saved.id))
        now = datetime.now(UTC)
        recent_missing = [
            _event(f"Recent {i}", now + timedelta(days=400 + i)) for i in range(200)
        ]
        older_with_vector = _event(
            "Older vector candidate", now + timedelta(days=100), _vector(1)
        )
        db_session.add_all([*recent_missing, older_with_vector])
        await db_session.flush()

        response = await client.get("/recommendations/events/for-you", params={"n": 5})
        assert response.status_code == 200
        assert response.json()["source"] == "recent"
        assert older_with_vector.id not in {
            event["id"] for event in response.json()["events"]
        }

    async def test_only_most_recent_100_saves_contribute_vectors(
        self, client, db_session, test_user
    ):
        now = datetime.now(UTC)
        saved_events = [
            _event(f"No vector {i}", now + timedelta(days=i)) for i in range(100)
        ]
        oldest_with_vector = _event("Old vector save", now, _vector(0, 1))
        candidate = _event("Candidate", now - timedelta(days=1), _vector(0, 1))
        db_session.add_all([*saved_events, oldest_with_vector, candidate])
        await db_session.flush()
        db_session.add_all(
            [
                SavedEvent(
                    user_id=test_user.id,
                    event_id=event.id,
                    saved_at=now + timedelta(days=i + 1),
                )
                for i, event in enumerate(saved_events)
            ]
            + [
                SavedEvent(
                    user_id=test_user.id,
                    event_id=oldest_with_vector.id,
                    saved_at=now,
                )
            ]
        )
        await db_session.flush()

        response = await client.get("/recommendations/events/for-you", params={"n": 5})
        assert response.status_code == 200
        assert response.json()["source"] == "recent"
        assert all(score == 0 for score in response.json()["scores"])

    async def test_all_saved_events_means_no_recommendation_candidates(
        self, client, db_session, sample_events, test_user
    ):
        for event in sample_events:
            event.embedding_vector = _vector(1)
            db_session.add(SavedEvent(user_id=test_user.id, event_id=event.id))
        await db_session.flush()
        response = await client.get("/recommendations/events/for-you", params={"n": 5})
        assert response.status_code == 200
        assert response.json()["source"] == "recent"
        assert response.json()["scores"] == [0.0] * len(response.json()["events"])

    async def test_requires_auth(self, unauthed_client):
        assert (
            await unauthed_client.get("/recommendations/events/for-you")
        ).status_code == 401

    async def test_limit(self, client):
        assert (
            await client.get("/recommendations/events/for-you", params={"n": 51})
        ).status_code == 422

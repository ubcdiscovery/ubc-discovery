from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.services import recommender


def _make_embedding_from_title(title: str) -> list[float]:
    h = sum(ord(c) for c in title)
    return [
        (h % 10) / 10.0,
        ((h * 3) % 10) / 10.0,
        ((h * 7) % 10) / 10.0,
        ((h * 11) % 10) / 10.0,
    ]


class TestCosineSimilarity:
    def test_identical(self):
        v = [1.0, 0.0, 0.5]
        assert recommender.cosine_similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal(self):
        assert recommender.cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0

    def test_zero_vector(self):
        assert recommender.cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0

    def test_negative_values(self):
        a = [1.0, -2.0, 3.0]
        b = [-1.0, 2.0, -3.0]
        assert recommender.cosine_similarity(a, b) == pytest.approx(-1.0)

    def test_length_mismatch(self):
        with pytest.raises(ValueError, match="Vector length mismatch"):
            recommender.cosine_similarity([1.0], [1.0, 2.0])


class TestVibeJaccard:
    def test_identical(self):
        assert (
            recommender.vibe_jaccard(["social", "academic"], ["academic", "social"])
            == 1.0
        )

    def test_disjoint(self):
        assert recommender.vibe_jaccard(["social"], ["career"]) == 0.0

    def test_partial(self):
        assert (
            recommender.vibe_jaccard(
                ["social", "academic", "career"], ["social", "academic"]
            )
            == 2.0 / 3.0
        )

    def test_both_empty(self):
        assert recommender.vibe_jaccard([], []) == 0.0

    def test_one_empty(self):
        assert recommender.vibe_jaccard(["social"], []) == 0.0


class TestHybridScore:
    def test_same_event(self):
        emb = [0.5, 0.5, 0.5, 0.5]
        vibes = ["social", "academic"]
        score = recommender.hybrid_score(emb, emb, vibes, vibes)
        assert score == 1.0

    def test_no_overlap(self):
        a = [1.0, 0.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0, 0.0]
        score = recommender.hybrid_score(a, b, ["social"], ["career"])
        assert score == 0.0

    def test_pure_cosine(self):
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        score = recommender.hybrid_score(a, b, ["social"], ["career"], vibe_weight=0.0)
        assert score == 0.0

        c = [1.0, 0.0, 0.0]
        d = [1.0, 0.0, 0.0]
        score2 = recommender.hybrid_score(c, d, ["social"], ["career"], vibe_weight=0.0)
        assert score2 == 1.0

    def test_pure_vibe(self):
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        score = recommender.hybrid_score(
            a, b, ["social", "academic"], ["academic"], vibe_weight=1.0
        )
        assert score == 0.5

    def test_balanced_blend(self):
        a = [1.0, 0.0]
        b = [1.0, 0.0]
        score = recommender.hybrid_score(a, b, ["social"], ["social"], vibe_weight=0.5)
        assert score == 1.0

        score2 = recommender.hybrid_score(a, b, ["social"], ["career"], vibe_weight=0.5)
        assert score2 == 0.5


class TestMeanEmbedding:
    def test_single(self):
        result = recommender.mean_embedding([[1.0, 2.0, 3.0]])
        assert result == [1.0, 2.0, 3.0]

    def test_multiple(self):
        result = recommender.mean_embedding(
            [
                [1.0, 2.0],
                [3.0, 4.0],
                [5.0, 6.0],
            ]
        )
        assert result == [3.0, 4.0]

    def test_empty(self):
        assert recommender.mean_embedding([]) is None


class TestRankEvents:
    def _make_event_stub(self, eid: str, embedding, vibes: list[str]):
        from types import SimpleNamespace

        return SimpleNamespace(id=eid, embedding=embedding, vibes=vibes)

    def test_with_vibe_profile(self):
        taste = [1.0, 0.0]
        candidates = [
            self._make_event_stub("e1", [1.0, 0.0], ["social"]),
            self._make_event_stub("e2", [1.0, 0.0], ["career"]),
            self._make_event_stub("e3", [-1.0, 0.0], ["social"]),
        ]
        vibe_profile = ["social"]

        result = recommender.rank_events(
            taste,
            candidates,
            top_n=3,
            vibe_profile=vibe_profile,
            vibe_weight=0.5,
        )
        assert len(result) == 3
        assert result[0][0].id == "e1"
        assert result[0][1] == 1.0
        assert result[1][0].id == "e2"
        assert result[1][1] == 0.5
        assert result[2][0].id == "e3"
        assert result[2][1] == 0.0

    def test_empty_vibe_profile(self):
        taste = [1.0, 0.0]
        candidates = [
            self._make_event_stub("e1", [1.0, 0.0], ["social"]),
        ]
        result = recommender.rank_events(taste, candidates, top_n=1, vibe_profile=[])
        assert result[0][1] == 0.5

    def test_skips_events_without_embedding(self):
        taste = [1.0, 0.0]
        candidates = [
            self._make_event_stub("e1", None, ["social"]),
        ]
        result = recommender.rank_events(taste, candidates, top_n=5)
        assert result == []

    def test_default_parameters(self):
        taste = [1.0, 0.0]
        candidates = [
            self._make_event_stub("e1", [1.0, 0.0], []),
        ]
        result = recommender.rank_events(taste, candidates, top_n=1)
        assert result[0][1] == 0.5


class TestSimilarEvents:
    async def test_returns_similar(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        with patch.object(recommender, "embed_text") as mock_embed:
            mock_embed.return_value = _make_embedding_from_title("generic")

            event = sample_events[0]
            resp = await unauthed_client.get(
                f"/recommendations/events/{event.id}/similar", params={"n": 2}
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["event_id"] == event.id
        assert len(data["events"]) <= 2
        assert len(data["scores"]) == len(data["events"])
        ids = [e["id"] for e in data["events"]]
        assert event.id not in ids

    async def test_not_found(self, unauthed_client: AsyncClient):
        resp = await unauthed_client.get("/recommendations/events/nope123/similar")
        assert resp.status_code == 404

    async def test_respects_n(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        with patch.object(recommender, "embed_text") as mock_embed:
            mock_embed.return_value = _make_embedding_from_title("generic")
            resp = await unauthed_client.get(
                f"/recommendations/events/{sample_events[0].id}/similar",
                params={"n": 1},
            )

        assert resp.status_code == 200
        assert len(resp.json()["events"]) == 1

    async def test_vibe_weight_param(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        with patch.object(recommender, "embed_text") as mock_embed:
            mock_embed.return_value = _make_embedding_from_title("generic")
            event = sample_events[0]
            resp = await unauthed_client.get(
                f"/recommendations/events/{event.id}/similar",
                params={"n": 2, "vibe_weight": 0.0},
            )
        assert resp.status_code == 200

    async def test_vibe_weight_out_of_range(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        with patch.object(recommender, "embed_text") as mock_embed:
            mock_embed.return_value = _make_embedding_from_title("generic")
            event = sample_events[0]
            resp = await unauthed_client.get(
                f"/recommendations/events/{event.id}/similar",
                params={"vibe_weight": 1.5},
            )
        assert resp.status_code == 422


class TestForYou:
    async def test_falls_back_to_recent_when_no_saved(
        self, client: AsyncClient, sample_events: list[Event]
    ):
        resp = await client.get("/recommendations/events/for-you", params={"n": 5})

        assert resp.status_code == 200
        data = resp.json()
        assert data["source"] == "recent"
        assert len(data["events"]) > 0
        assert all(s == 0.0 for s in data["scores"])

    async def test_archived_event_is_excluded_from_recommendations(
        self, client: AsyncClient, db_session: AsyncSession, sample_events: list[Event]
    ):
        archived = sample_events[0]
        archived.is_archived = True
        await db_session.flush()

        response = await client.get(
            "/recommendations/events/for-you", params={"n": 5}
        )

        assert response.status_code == 200
        assert archived.id not in {item["id"] for item in response.json()["events"]}

    async def test_requires_auth(self, unauthed_client: AsyncClient):
        resp = await unauthed_client.get("/recommendations/events/for-you")
        assert resp.status_code == 401

    # TODO: Investigate this test
    # async def test_personalized_from_saved(
    #     self, client: AsyncClient, db_session: AsyncSession,
    #     sample_events: list[Event], test_user: User
    # ):
    #     event = sample_events[0]
    #     for ev in sample_events:
    #         ev.embedding = _make_embedding_from_title(ev.title)
    #     await db_session.flush()
    #     save_resp = await client.post(f"/saved-events/{event.id}")
    #     assert save_resp.status_code == 200

    #     with patch.object(recommender, "embed_text") as mock_embed:
    #         mock_embed.return_value = _make_embedding_from_title(event.title)
    #         resp = await client.get(
    #             "/recommendations/events/for-you", params={"n": 5}
    #         )

    #     assert resp.status_code == 200
    #     data = resp.json()
    #     assert data["source"] == "saved_events"
    #     assert len(data["events"]) > 0
    #     assert any(s > 0.0 for s in data["scores"])
    #     result_ids = [e["id"] for e in data["events"]]
    #     assert event.id not in result_ids

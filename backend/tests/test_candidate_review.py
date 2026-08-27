"""Integration coverage for the administrator Candidate review workflow."""

import asyncio
import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.dependencies import AdminActor
from app.models.audit_actor import AuditActorType
from app.models.event import Event
from app.models.event_audit import EventAuditAction, EventAuditLog
from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    CandidateStatus,
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
)
from app.routers.admin.candidates import approve_candidate
from tests.conftest import _get_engine


def _candidate(candidate_id: str = "cand0001", **changes) -> EventListingCandidate:
    values = {
        "id": candidate_id,
        "description": "Caption evidence",
        "source_account": "ubcams",
        "source_type": "instagram",
        "external_source_id": f"post-{candidate_id}",
        "is_event": True,
        "title": "Original title",
        "location_name": "The Nest",
        "event_date": datetime(2026, 11, 1, 20, tzinfo=UTC),
        "event_end_date": None,
        "club_name": "UBC AMS",
        "vibes": ["social"],
        "source_label": "ams_club",
        "extracted_original": {"title": "Original title"},
        "extracted_at": datetime(2026, 10, 1, tzinfo=UTC),
    }
    values.update(changes)
    return EventListingCandidate(**values)


async def test_correction_preserves_extracted_original(
    admin_client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_candidate())
    await db_session.flush()
    response = await admin_client.put(
        "/admin/candidates/cand0001",
        json={"title": "Corrected title", "location_name": "The Gallery"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Corrected title"
    assert response.json()["extracted_original"] == {"title": "Original title"}


async def test_approval_uses_exact_id_and_event_create_audit(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    db_session.add(_candidate())
    await db_session.flush()

    async def embedding(_event):
        return [0.1] * 1024

    monkeypatch.setattr("app.services.recommender.generate_event_embedding", embedding)
    response = await admin_client.post("/admin/candidates/cand0001/approve")
    assert response.status_code == 200, response.text
    event = await db_session.get(Event, "cand0001")
    assert event is not None
    assert event.title == "Original title"
    assert event.embedding == [0.1] * 1024
    audit = await db_session.scalar(
        select(EventAuditLog).where(EventAuditLog.event_id == "cand0001")
    )
    assert audit is not None
    assert audit.action == EventAuditAction.CREATE
    candidate = await db_session.get(EventListingCandidate, "cand0001")
    assert candidate is not None
    assert candidate.status == CandidateStatus.APPROVED


async def test_approval_copies_first_candidate_image_to_event_picture(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    candidate_image = "candidates/cand0001/00.jpg"
    db_session.add(_candidate(image_keys=[candidate_image]))
    await db_session.flush()

    async def embedding(_event):
        return [0.1] * 1024

    s3_client = MagicMock()
    s3_client.generate_presigned_url.return_value = "https://s3.example.com/candidate"
    monkeypatch.setattr("app.services.recommender.generate_event_embedding", embedding)
    monkeypatch.setattr("app.services.s3._client", lambda: s3_client)
    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket")

    response = await admin_client.post("/admin/candidates/cand0001/approve")

    assert response.status_code == 200, response.text
    s3_client.copy_object.assert_called_once_with(
        Bucket="test-bucket",
        CopySource={"Bucket": "test-bucket", "Key": candidate_image},
        Key="event-pictures/cand0001.webp",
    )


async def test_image_copy_failure_rolls_back_candidate_approval(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    db_session.add(_candidate(image_keys=["candidates/cand0001/00.webp"]))
    await db_session.commit()

    async def embedding(_event):
        return [0.1] * 1024

    monkeypatch.setattr("app.services.recommender.generate_event_embedding", embedding)
    monkeypatch.setattr(
        "app.services.s3.copy_object",
        MagicMock(side_effect=RuntimeError("copy failed")),
    )

    with pytest.raises(RuntimeError, match="copy failed"):
        await admin_client.post("/admin/candidates/cand0001/approve")

    assert await db_session.get(Event, "cand0001") is None
    candidate = await db_session.get(EventListingCandidate, "cand0001")
    assert candidate is not None
    assert candidate.status == CandidateStatus.PENDING


async def test_repeated_approval_is_idempotent_and_does_not_duplicate_audit(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    db_session.add(_candidate("seq0001"))
    await db_session.flush()

    async def embedding(_event):
        return [0.2] * 1024

    monkeypatch.setattr("app.services.recommender.generate_event_embedding", embedding)
    first = await admin_client.post("/admin/candidates/seq0001/approve")
    second = await admin_client.post("/admin/candidates/seq0001/approve")
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "approved"
    assert (await db_session.scalars(select(Event).where(Event.id == "seq0001"))).all()
    audits = (
        await db_session.scalars(
            select(EventAuditLog).where(EventAuditLog.event_id == "seq0001")
        )
    ).all()
    assert len(audits) == 1
    assert audits[0].action == EventAuditAction.CREATE


async def test_concurrent_approvals_with_separate_sessions_are_idempotent(
    _setup_tables, monkeypatch
):
    candidate_id = f"c{uuid.uuid4().hex[:7]}"
    factory = async_sessionmaker(_get_engine(), expire_on_commit=False)
    async with factory() as setup:
        await setup.execute(
            delete(EventAuditLog).where(EventAuditLog.event_id == candidate_id)
        )
        await setup.execute(delete(Event).where(Event.id == candidate_id))
        await setup.execute(
            delete(EventListingCandidateIngestionAudit).where(
                EventListingCandidateIngestionAudit.candidate_id == candidate_id
            )
        )
        await setup.execute(
            delete(CandidateExtractionJob).where(
                CandidateExtractionJob.candidate_id == candidate_id
            )
        )
        await setup.execute(
            delete(EventListingCandidate).where(
                EventListingCandidate.id == candidate_id
            )
        )
        setup.add(
            _candidate(
                candidate_id,
                external_source_id=f"post-{candidate_id}",
            )
        )
        await setup.commit()

    async def embedding(_event):
        return [0.3] * 1024

    monkeypatch.setattr("app.services.recommender.generate_event_embedding", embedding)
    actor = AdminActor(
        actor_type=AuditActorType.MEMBER,
        actor_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
    )

    async def approve_in_isolated_session():
        async with factory() as session:
            return await approve_candidate(candidate_id, session, actor)

    results = await asyncio.gather(
        approve_in_isolated_session(), approve_in_isolated_session()
    )
    assert [result.status for result in results] == [
        CandidateStatus.APPROVED,
        CandidateStatus.APPROVED,
    ]
    async with factory() as verify:
        assert (
            await verify.scalar(select(Event.id).where(Event.id == candidate_id))
            == candidate_id
        )
        assert (
            len(
                (
                    await verify.scalars(
                        select(EventAuditLog).where(
                            EventAuditLog.event_id == candidate_id
                        )
                    )
                ).all()
            )
            == 1
        )
        await verify.execute(
            delete(EventAuditLog).where(EventAuditLog.event_id == candidate_id)
        )
        await verify.execute(delete(Event).where(Event.id == candidate_id))
        await verify.execute(
            delete(EventListingCandidate).where(
                EventListingCandidate.id == candidate_id
            )
        )
        await verify.commit()


async def test_id_allocation_lock_prevents_cross_table_race(_setup_tables, monkeypatch):
    shared_id = f"sh{uuid.uuid4().hex[:6]}"
    event_id = f"ev{uuid.uuid4().hex[:6]}"
    generated = iter([shared_id, shared_id, event_id])
    monkeypatch.setattr("app.services.ids.generate", lambda size: next(generated))
    from app.services.ids import generate_unique_id

    factory = async_sessionmaker(_get_engine(), expire_on_commit=False)

    async def create_candidate():
        async with factory() as session:
            allocated = await generate_unique_id(session)
            session.add(
                _candidate(
                    allocated,
                    external_source_id=f"post-{allocated}",
                )
            )
            await session.commit()
            return allocated

    async def create_event():
        async with factory() as session:
            allocated = await generate_unique_id(session)
            session.add(
                Event(
                    id=allocated,
                    title="Concurrent event",
                    source="manual",
                    source_label="campus_community",
                    location_name="Nest",
                    event_date=datetime(2026, 11, 1, 20, tzinfo=UTC),
                )
            )
            await session.commit()
            return allocated

    allocated_ids = await asyncio.gather(create_candidate(), create_event())
    assert set(allocated_ids) == {shared_id, event_id}
    async with factory() as cleanup:
        await cleanup.execute(delete(Event).where(Event.id.in_(allocated_ids)))
        await cleanup.execute(
            delete(EventListingCandidate).where(
                EventListingCandidate.id.in_(allocated_ids)
            )
        )
        await cleanup.commit()


async def test_review_mutations_require_admin_authentication(
    unauthed_client: AsyncClient,
    client: AsyncClient,
    db_session: AsyncSession,
):
    db_session.add(_candidate("auth0001"))
    await db_session.flush()
    paths = [
        ("/admin/candidates/auth0001", "PUT", {"title": "Nope"}),
        ("/admin/candidates/auth0001/approve", "POST", None),
    ]
    for path, method, body in paths:
        visitor = await unauthed_client.request(method, path, json=body)
        member = await client.request(
            method,
            path,
            headers={"Authorization": "Bearer test-token"},
            json=body,
        )
        api_key = await unauthed_client.request(
            method,
            path,
            headers={"Authorization": "Api-Key not-a-managed-token"},
            json=body,
        )
        assert visitor.status_code == 401
        assert member.status_code == 403
        assert api_key.status_code == 403


async def test_invalid_review_state_transitions_are_rejected(
    admin_client: AsyncClient, db_session: AsyncSession
):
    db_session.add_all(
        [
            _candidate("rej00001", status=CandidateStatus.REJECTED),
            _candidate("app00001", status=CandidateStatus.APPROVED),
            _candidate("pen00001", status=CandidateStatus.PENDING),
        ]
    )
    await db_session.flush()
    responses = [
        await admin_client.post("/admin/candidates/rej00001/approve"),
        await admin_client.post("/admin/candidates/app00001/reject"),
        await admin_client.post("/admin/candidates/pen00001/return-to-review"),
    ]
    assert [response.status_code for response in responses] == [409, 409, 409]


async def test_reject_then_return_to_review(
    admin_client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_candidate())
    await db_session.flush()
    rejected = await admin_client.post("/admin/candidates/cand0001/reject")
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    returned = await admin_client.post("/admin/candidates/cand0001/return-to-review")
    assert returned.status_code == 200
    assert returned.json()["status"] == "pending"
    assert await db_session.get(Event, "cand0001") is None


async def test_same_club_same_local_day_hold_includes_pending_candidate(
    admin_client: AsyncClient, db_session: AsyncSession
):
    db_session.add_all(
        [
            _candidate("cand0001"),
            _candidate(
                "cand0002",
                external_source_id="post-cand0002",
                title="Another occurrence",
                event_date=datetime(2026, 11, 2, 1, tzinfo=UTC),
            ),
        ]
    )
    await db_session.flush()
    response = await admin_client.get("/admin/candidates/cand0001")
    assert response.status_code == 200
    matches = response.json()["same_club_same_day_matches"]
    assert [(item["kind"], item["id"]) for item in matches] == [
        ("candidate", "cand0002")
    ]


async def test_hold_filters_active_events_and_local_day_boundaries(
    admin_client: AsyncClient, db_session: AsyncSession
):
    # 2026-03-08 is the Vancouver DST transition. The local day is [08:00Z,
    # 07:00Z the next day), so the final minute before midnight is included.
    db_session.add(
        _candidate(
            "cand0001",
            club_name="  UBC AMS ",
            event_date=datetime(2026, 3, 8, 8, 30, tzinfo=UTC),
        )
    )
    db_session.add_all(
        [
            _candidate(
                "cand0002",
                event_date=datetime(2026, 3, 9, 6, 59, tzinfo=UTC),
                club_name="ubc ams",
            ),
            _candidate(
                "cand0003",
                event_date=datetime(2026, 3, 9, 6, 59, tzinfo=UTC),
                club_name="UBC AMS",
                status=CandidateStatus.REJECTED,
            ),
            _candidate(
                "cand0004",
                event_date=datetime(2026, 3, 9, 7, 0, tzinfo=UTC),
                club_name="UBC AMS",
            ),
            _candidate(
                "cand0005",
                event_date=datetime(2026, 3, 8, 8, 45, tzinfo=UTC),
                club_name=None,
            ),
            _candidate(
                "cand0006",
                event_date=datetime(2026, 3, 8, 8, 45, tzinfo=UTC),
                club_name="   ",
            ),
        ]
    )
    db_session.add_all(
        [
            Event(
                id="event001",
                title="Active hold",
                description="",
                source="manual",
                source_label="campus_community",
                club_name="UBC AMS",
                vibes=[],
                location_name="Nest",
                event_date=datetime(2026, 3, 9, 6, 58, tzinfo=UTC),
                is_archived=False,
            ),
            Event(
                id="event002",
                title="Archived hold",
                description="",
                source="manual",
                source_label="campus_community",
                club_name="UBC AMS",
                vibes=[],
                location_name="Nest",
                event_date=datetime(2026, 3, 9, 6, 57, tzinfo=UTC),
                is_archived=True,
            ),
            Event(
                id="cand0001",
                title="Same id event",
                description="",
                source="manual",
                source_label="campus_community",
                club_name="UBC AMS",
                vibes=[],
                location_name="Nest",
                event_date=datetime(2026, 3, 9, 6, 56, tzinfo=UTC),
                is_archived=False,
            ),
        ]
    )
    await db_session.flush()

    response = await admin_client.get("/admin/candidates/cand0001")
    assert response.status_code == 200, response.text
    assert [
        (item["kind"], item["id"])
        for item in response.json()["same_club_same_day_matches"]
    ] == [("event", "event001"), ("candidate", "cand0002")]


async def test_correction_validates_combined_persisted_dates(
    admin_client: AsyncClient, db_session: AsyncSession
):
    db_session.add(
        _candidate(
            event_date=datetime(2026, 11, 1, 20, tzinfo=UTC),
            event_end_date=datetime(2026, 11, 1, 22, tzinfo=UTC),
        )
    )
    await db_session.flush()
    response = await admin_client.put(
        "/admin/candidates/cand0001",
        json={"event_date": "2026-11-02T20:00:00Z"},
    )
    assert response.status_code == 422
    candidate = await db_session.get(EventListingCandidate, "cand0001")
    assert candidate is not None
    assert candidate.event_date == datetime(2026, 11, 1, 20, tzinfo=UTC)


async def test_invalid_approval_returns_safe_validation_detail_and_rolls_back(
    admin_client: AsyncClient, db_session: AsyncSession
):
    db_session.add(
        _candidate(
            title=None,
            location_name=None,
            source_label="ams_club",
        )
    )
    await db_session.flush()
    response = await admin_client.post("/admin/candidates/cand0001/approve")
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail
    assert all(set(error) <= {"type", "loc", "msg"} for error in detail)
    assert await db_session.get(Event, "cand0001") is None
    # The route's rollback must leave no partially-created Event or audit.
    assert (
        await db_session.scalar(
            select(EventAuditLog).where(EventAuditLog.event_id == "cand0001")
        )
        is None
    )


async def test_approval_requires_candidate_source_label(
    admin_client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_candidate(source_label=None, title="Valid event title"))
    await db_session.flush()
    response = await admin_client.post("/admin/candidates/cand0001/approve")
    assert response.status_code == 422
    assert any(
        error["loc"][-1] == "source_label" for error in response.json()["detail"]
    )
    assert await db_session.get(Event, "cand0001") is None

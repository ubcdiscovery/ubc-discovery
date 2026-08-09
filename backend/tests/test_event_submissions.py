from datetime import datetime, timedelta, timezone

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.event_submission import (
    SUBMISSION_APPROVED,
    SUBMISSION_PENDING,
    SUBMISSION_REJECTED,
    EventSubmission,
)
from app.models.user import User
from app.routers.event_submissions import MAX_PENDING_SUBMISSIONS


def _payload(**overrides):
    body = {
        "title": "Sunrise Hike at Quarry Rock",
        "description": "Meet at the bus loop at 5:30am.",
        "club_name": "UBC Outdoor Club",
        "source_label": "ams_club",
        "source_url": "https://example.com/hike",
        "external_cta_label": "RSVP",
        "vibes": ["outdoors", "wellness"],
        "location_name": "UBC Bus Loop",
        "event_date": (
            datetime.now(timezone.utc) + timedelta(days=14)
        ).isoformat(),
    }
    body.update(overrides)
    return body


async def _create_submission(db_session: AsyncSession, user: User, **overrides):
    fields = {
        "title": "Night Market at the Nest",
        "description": "Twenty student vendors.",
        "club_name": "AMS Events",
        "source_label": "campus_community",
        "vibes": ["food", "social"],
        "location_name": "AMS Nest, Level 2",
        "event_date": datetime.now(timezone.utc) + timedelta(days=10),
        "status": SUBMISSION_PENDING,
    }
    fields.update(overrides)

    submission = EventSubmission(submitted_by_id=user.id, **fields)
    db_session.add(submission)
    await db_session.flush()
    return submission


# ---------------------------------------------------------------------------
# Submitting
# ---------------------------------------------------------------------------
async def test_submission_is_created_pending(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    response = await client.post("/event-submissions", json=_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == SUBMISSION_PENDING
    assert body["published_event_id"] is None
    assert body["submitted_by_id"] == str(test_user.id)


async def test_submission_does_not_appear_on_discover(
    client: AsyncClient,
    db_session: AsyncSession,
):
    await client.post("/event-submissions", json=_payload())

    listing = await client.get("/events")

    titles = [event["title"] for event in listing.json()["events"]]
    assert "Sunrise Hike at Quarry Rock" not in titles

    result = await db_session.execute(
        select(func.count())
        .select_from(Event)
        .where(Event.title == "Sunrise Hike at Quarry Rock")
    )
    assert result.scalar_one() == 0


async def test_submission_requires_authentication(unauthed_client: AsyncClient):
    response = await unauthed_client.post("/event-submissions", json=_payload())

    assert response.status_code == 401


async def test_organizers_cannot_claim_official_source_label(client: AsyncClient):
    response = await client.post(
        "/event-submissions", json=_payload(source_label="ubc_official")
    )

    assert response.status_code == 422


async def test_past_event_date_is_rejected(client: AsyncClient):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    response = await client.post("/event-submissions", json=_payload(event_date=past))

    assert response.status_code == 422


async def test_end_before_start_is_rejected(client: AsyncClient):
    start = datetime.now(timezone.utc) + timedelta(days=5)
    response = await client.post(
        "/event-submissions",
        json=_payload(
            event_date=start.isoformat(),
            event_end_date=(start - timedelta(hours=2)).isoformat(),
        ),
    )

    assert response.status_code == 422


async def test_vibes_are_required_and_bounded(client: AsyncClient):
    none_given = await client.post("/event-submissions", json=_payload(vibes=[]))
    too_many = await client.post(
        "/event-submissions",
        json=_payload(vibes=["social", "food", "arts", "career"]),
    )
    off_taxonomy = await client.post(
        "/event-submissions", json=_payload(vibes=["networking"])
    )

    assert none_given.status_code == 422
    assert too_many.status_code == 422
    assert off_taxonomy.status_code == 422


async def test_pending_submissions_are_capped(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    for _ in range(MAX_PENDING_SUBMISSIONS):
        await _create_submission(db_session, test_user)

    response = await client.post("/event-submissions", json=_payload())

    assert response.status_code == 429


# ---------------------------------------------------------------------------
# Reading your own submissions
# ---------------------------------------------------------------------------
async def test_mine_returns_only_the_callers_submissions(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    other_user: User,
):
    await _create_submission(db_session, test_user, title="Mine")
    await _create_submission(db_session, other_user, title="Theirs")

    response = await client.get("/event-submissions/mine")

    titles = [s["title"] for s in response.json()["submissions"]]
    assert titles == ["Mine"]


# ---------------------------------------------------------------------------
# Review queue
# ---------------------------------------------------------------------------
async def test_review_queue_requires_admin(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    await _create_submission(db_session, test_user)

    response = await client.get(
        "/event-submissions", headers={"Authorization": "Api-Key not-the-key"}
    )

    assert response.status_code == 403


async def test_review_queue_defaults_to_pending(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    await _create_submission(db_session, test_user, title="Waiting")
    await _create_submission(
        db_session, test_user, title="Done", status=SUBMISSION_APPROVED
    )

    response = await admin_client.get("/event-submissions")

    body = response.json()
    assert body["total"] == 1
    assert body["submissions"][0]["title"] == "Waiting"


# ---------------------------------------------------------------------------
# Approving
# ---------------------------------------------------------------------------
async def test_approve_publishes_an_event(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    submission = await _create_submission(db_session, test_user)

    response = await admin_client.post(
        f"/event-submissions/{submission.id}/approve"
    )

    assert response.status_code == 200
    event = response.json()
    assert event["title"] == submission.title
    assert event["club_name"] == submission.club_name
    assert event["vibes"] == submission.vibes

    await db_session.refresh(submission)
    assert submission.status == SUBMISSION_APPROVED
    assert submission.published_event_id == event["id"]
    assert submission.reviewed_at is not None


async def test_approved_event_shows_up_on_discover(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    submission = await _create_submission(db_session, test_user)

    await admin_client.post(f"/event-submissions/{submission.id}/approve")
    listing = await admin_client.get("/events")

    titles = [event["title"] for event in listing.json()["events"]]
    assert submission.title in titles


async def test_approve_is_not_repeatable(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    submission = await _create_submission(db_session, test_user)

    first = await admin_client.post(f"/event-submissions/{submission.id}/approve")
    second = await admin_client.post(f"/event-submissions/{submission.id}/approve")

    assert first.status_code == 200
    assert second.status_code == 409

    result = await db_session.execute(
        select(func.count())
        .select_from(Event)
        .where(Event.title == submission.title)
    )
    assert result.scalar_one() == 1


async def test_approve_requires_admin(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    submission = await _create_submission(db_session, test_user)

    response = await client.post(
        f"/event-submissions/{submission.id}/approve",
        headers={"Authorization": "Api-Key not-the-key"},
    )

    assert response.status_code == 403
    await db_session.refresh(submission)
    assert submission.status == SUBMISSION_PENDING


# ---------------------------------------------------------------------------
# Rejecting
# ---------------------------------------------------------------------------
async def test_reject_records_the_note_and_publishes_nothing(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    submission = await _create_submission(db_session, test_user)

    response = await admin_client.post(
        f"/event-submissions/{submission.id}/reject",
        json={"review_note": "Not a campus event."},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == SUBMISSION_REJECTED
    assert body["review_note"] == "Not a campus event."
    assert body["published_event_id"] is None

    result = await db_session.execute(
        select(func.count())
        .select_from(Event)
        .where(Event.title == submission.title)
    )
    assert result.scalar_one() == 0


async def test_rejected_submission_is_visible_to_its_author(
    client: AsyncClient,
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
):
    submission = await _create_submission(db_session, test_user)
    await admin_client.post(
        f"/event-submissions/{submission.id}/reject",
        json={"review_note": "Missing a location."},
    )

    response = await client.get("/event-submissions/mine")

    mine = response.json()["submissions"][0]
    assert mine["status"] == SUBMISSION_REJECTED
    assert mine["review_note"] == "Missing a location."


# ---------------------------------------------------------------------------
# Cover image
# ---------------------------------------------------------------------------
class TestSubmissionCoverImage:
    async def test_upload_url_records_the_key(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        submission = await _create_submission(db_session, test_user)

        response = await client.post(
            f"/event-submissions/{submission.id}/presigned-upload"
        )

        assert response.status_code == 200
        assert response.json()["file_key"] == f"submission-pictures/{submission.id}.webp"
        await db_session.refresh(submission)
        assert submission.event_picture_key == f"submission-pictures/{submission.id}.webp"

    async def test_no_image_means_no_url(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        await _create_submission(db_session, test_user)

        response = await client.get("/event-submissions/mine")

        assert response.json()["submissions"][0]["event_picture_url"] is None

    async def test_cannot_upload_to_someone_elses_submission(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        other_user: User,
    ):
        submission = await _create_submission(db_session, other_user)

        response = await client.post(
            f"/event-submissions/{submission.id}/presigned-upload"
        )

        assert response.status_code == 404

    async def test_cannot_change_the_image_after_review(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        submission = await _create_submission(
            db_session, test_user, status=SUBMISSION_APPROVED
        )

        response = await client.post(
            f"/event-submissions/{submission.id}/presigned-upload"
        )

        assert response.status_code == 409

    async def test_approval_carries_the_poster_to_the_event(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        submission = await _create_submission(
            db_session, test_user, event_picture_key="submission-pictures/abc.webp"
        )

        response = await admin_client.post(
            f"/event-submissions/{submission.id}/approve"
        )

        assert response.status_code == 200
        assert response.json()["event_picture_url"] is not None

        result = await db_session.execute(
            select(Event).where(Event.title == submission.title)
        )
        assert result.scalar_one().event_picture_key == "submission-pictures/abc.webp"

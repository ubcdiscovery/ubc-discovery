from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.dependencies import get_current_user
from app.models.connection_request import ConnectionRequest
from app.models.connection import Connection
from app.models.user import User
from app.schemas.user import ConnectRequest

router = APIRouter(prefix="/connection-requests", tags=["Connection"])


@router.get("/inbound", response_model=list[ConnectRequest])
async def get_inbound_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    other = aliased(User)
    rows = await db.execute(
        select(ConnectionRequest, other)
        .select_from(ConnectionRequest)
        .join(other, ConnectionRequest.sender_id == other.id)
        .where(ConnectionRequest.receiver_id == current_user.id)
    )
    return [
        ConnectRequest(
            id=req.request_id,
            user_uuid=user.id,
            preferred_name=user.preferred_name,
            created_at=req.sent_at,
        )
        for req, user in rows.all()
    ]


@router.get("/outbound", response_model=list[ConnectRequest])
async def get_outbound_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    other = aliased(User)
    rows = await db.execute(
        select(ConnectionRequest, other)
        .select_from(ConnectionRequest)
        .join(other, ConnectionRequest.receiver_id == other.id)
        .where(ConnectionRequest.sender_id == current_user.id)
    )
    return [
        ConnectRequest(
            id=req.request_id,
            user_uuid=user.id,
            preferred_name=user.preferred_name,
            created_at=req.sent_at,
        )
        for req, user in rows.all()
    ]


@router.post("/request/{user_id}", response_model=ConnectRequest)
async def send_connection_request(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot request yourself as a connection")

    result = await db.execute(select(User).where(User.id == user_id))
    receiver = result.scalar_one_or_none()
    if not receiver:
        raise HTTPException(status_code=404, detail="Requested user does not exist")

    existing = await db.execute(
        select(ConnectionRequest).where(
            or_(
                and_(ConnectionRequest.sender_id == user_id, ConnectionRequest.receiver_id == current_user.id),
                and_(ConnectionRequest.sender_id == current_user.id, ConnectionRequest.receiver_id == user_id),
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Connection request already exists between users")

    connection = await db.execute(
            select(Connection).where(
                or_(
                    and_(Connection.user_1_id == user_id, Connection.user_2_id == current_user.id),
                    and_(Connection.user_1_id == current_user.id, Connection.user_2_id == user_id),
                )
            )
        )
    if connection.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Connection already exists between users")

    new_request = ConnectionRequest(sender_id=current_user.id, receiver_id=user_id)
    db.add(new_request)
    await db.commit()
    await db.refresh(new_request)

    return ConnectRequest(
        id=new_request.request_id,
        user_uuid=receiver.id,
        preferred_name=receiver.preferred_name,
        created_at=new_request.sent_at,
    )

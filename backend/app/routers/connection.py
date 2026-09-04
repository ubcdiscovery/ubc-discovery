from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from uuid import UUID

from app.database import get_db
from app.dependencies import get_current_user
from app.models.connection import Connection
from app.models.user import User
from app.schemas.user import ConnectedUser

router = APIRouter(prefix="/connections", tags=["Connection"])

# Connections are created via connection_message handlers. Here just get.

@router.get("", response_model=list[ConnectedUser])
async def get_connections(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    other = aliased(User)
    rows = await db.execute(
        select(other, Connection)
        .select_from(Connection)
        .where(
            or_(
                Connection.user_1_id == current_user.id,
                Connection.user_2_id == current_user.id,
            )
        )
        .join(
            other,
            or_(
                (Connection.user_1_id == other.id) & (Connection.user_2_id == current_user.id),
                (Connection.user_2_id == other.id) & (Connection.user_1_id == current_user.id),
            ),
        )
    )

    results = rows.all()

    return [
        ConnectedUser(
            user_id=user.id,
            preferred_name=user.preferred_name,
            connected_at=connection.created_at,
        )
        for user, connection in results
    ]

@router.delete('/disconnect/{user_id}')
async def disconnect_user(
    user_id : UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user_id == user.id:
        raise HTTPException(status_code=400, detail='Can not disconnect from yourself')

    user_1_id, user_2_id = sorted(
        [user_id, user.id],
        key=str
    )

    result = await db.execute(
        select(Connection).
        where(and_(Connection.user_1_id == user_1_id,
                    Connection.user_2_id == user_2_id))
    )

    connection = result.scalar_one_or_none()
    if connection is None:
        raise HTTPException(status_code=400, detail='You do not have a connection with that user')

    await db.delete(connection)
    await db.commit()
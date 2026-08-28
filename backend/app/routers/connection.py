from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

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

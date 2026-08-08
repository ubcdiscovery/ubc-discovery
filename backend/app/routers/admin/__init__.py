from fastapi import APIRouter, Depends

from app.dependencies import require_admin
from app.routers.admin import candidates, events

router = APIRouter(
    prefix="/admin",
    dependencies=[Depends(require_admin)],
)

router.include_router(events.router)
router.include_router(candidates.router)

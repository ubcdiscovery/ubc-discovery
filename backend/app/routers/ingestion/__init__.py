from fastapi import APIRouter

from app.routers.ingestion import candidates

router = APIRouter(prefix="/ingestion")
router.include_router(candidates.router)

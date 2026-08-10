"""Local stand-in for S3, so image uploads work without AWS in development.

Every endpoint refuses to do anything unless LOCAL_MEDIA_DIR is set and no S3
bucket is configured, so this can never take over in a real environment.
"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.services import s3

router = APIRouter(prefix="/media", tags=["Media"])


def _require_local_mode() -> None:
    if not s3.local_media_enabled():
        raise HTTPException(status_code=404, detail="Not found")


def _path_for(file_key: str):
    try:
        return s3.local_media_path(file_key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file key")


@router.post("/{file_key:path}", status_code=204)
async def upload_media(file_key: str, file: UploadFile = File(...)):
    """Accept the same multipart body the S3 presigned POST would take."""
    _require_local_mode()
    target = _path_for(file_key)

    body = await file.read()
    if len(body) > settings.event_image_max_bytes:
        raise HTTPException(status_code=413, detail="File too large")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)


@router.get("/{file_key:path}")
async def read_media(file_key: str):
    _require_local_mode()
    target = _path_for(file_key)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)

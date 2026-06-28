import os
import uuid
from collections.abc import Awaitable, Callable

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.responses import Response

from ..config import settings
from ..database import get_db
from ..middleware.api_key import require_integration_key
from ..models.asset import (
    Asset,
    AssetType,
    AssetVersion,
    FileType,
    MediaFile,
    ProcessingStatus,
)
from ..models.project import Project
from ..models.share import SharePermission
from ..schemas.integrations import ReviewIngestResponse
from ..schemas.upload import ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, mime_to_asset_type
from ..services.s3_service import upload_fileobj
from .share import create_reviewer_share


class IntegrationKeyRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        original_route_handler = super().get_route_handler()

        async def custom_route_handler(request: Request) -> Response:
            require_integration_key(request.headers.get("x-api-key"))
            return await original_route_handler(request)

        return custom_route_handler


router = APIRouter(
    prefix="/integrations",
    tags=["integrations"],
    route_class=IntegrationKeyRoute,
)


def _trigger_processing(asset_id: uuid.UUID, version_id: uuid.UUID) -> None:
    from ..tasks.celery_app import send_task_safe
    from ..tasks.transcode_tasks import process_asset

    send_task_safe(process_asset, str(asset_id), str(version_id))


@router.post(
    "/review-ingest",
    response_model=ReviewIngestResponse,
    status_code=status.HTTP_201_CREATED,
)
def review_ingest(
    background_tasks: BackgroundTasks,
    project_id: uuid.UUID = Form(...),
    asset_name: str = Form(...),
    mime_type: str = Form(...),
    file: UploadFile = File(...),
    permission: SharePermission = Form(SharePermission.comment),
    allow_download: bool = Form(False),
    db: Session = Depends(get_db),
) -> ReviewIngestResponse:
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {mime_type}",
        )
    file_size = file.size
    if file_size is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size is required",
        )
    if file_size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File exceeds 10GB limit",
        )

    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    created_by = project.created_by
    asset_type = mime_to_asset_type(mime_type)
    asset = Asset(
        project_id=project_id,
        name=asset_name,
        asset_type=asset_type,
        created_by=created_by,
        folder_id=None,
    )
    db.add(asset)
    db.flush()

    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.uploading,
        created_by=created_by,
    )
    db.add(version)
    db.flush()

    original_filename = file.filename or asset_name
    ext = os.path.splitext(original_filename)[1].lower()
    s3_key = f"raw/{project_id}/{asset.id}/{version.id}/original{ext}"
    upload_fileobj(s3_key, file.file, mime_type)

    file_type_map = {
        AssetType.image: FileType.image,
        AssetType.audio: FileType.audio,
        AssetType.video: FileType.video,
        AssetType.image_carousel: FileType.image,
    }
    media_file = MediaFile(
        version_id=version.id,
        file_type=file_type_map.get(asset.asset_type, FileType.video),
        original_filename=original_filename,
        mime_type=mime_type,
        file_size_bytes=file_size,
        s3_key_raw=s3_key,
    )
    db.add(media_file)

    version.processing_status = ProcessingStatus.processing
    db.commit()
    db.refresh(asset)
    db.refresh(version)

    background_tasks.add_task(_trigger_processing, asset.id, version.id)
    share = create_reviewer_share(
        db,
        asset=asset,
        created_by=created_by,
        permission=permission,
        allow_download=allow_download,
    )

    return ReviewIngestResponse(
        asset_id=asset.id,
        version_id=version.id,
        version_number=version.version_number,
        token=share.token,
        url=f"{settings.frontend_url.rstrip('/')}/share/{share.token}",
        expires_at=share.expires_at,
    )

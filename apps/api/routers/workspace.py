import shutil

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.asset import Asset, AssetVersion, MediaFile
from ..models.user import User
from ..schemas.branding import WorkspaceResponse
from ..services.workspace_service import get_workspace_settings

router = APIRouter(tags=["workspace"])


class StorageStatsResponse(BaseModel):
    used_bytes: int
    disk_total_bytes: int | None = None
    disk_free_bytes: int | None = None


@router.get("/workspace", response_model=WorkspaceResponse)
def get_workspace(db: Session = Depends(get_db)):
    return get_workspace_settings(db)


@router.get("/workspace/storage", response_model=StorageStatsResponse)
def get_storage_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """App storage used (sum of media files on live assets) + real disk capacity."""
    used = (
        db.query(func.coalesce(func.sum(MediaFile.file_size_bytes), 0))
        .join(AssetVersion, MediaFile.version_id == AssetVersion.id)
        .join(Asset, AssetVersion.asset_id == Asset.id)
        .filter(Asset.deleted_at.is_(None))
        .scalar()
    ) or 0

    disk_total = disk_free = None
    try:
        usage = shutil.disk_usage(settings.storage_stats_path)
        disk_total, disk_free = usage.total, usage.free
    except OSError:
        pass  # path absent outside the all-in-one image — report used only

    return StorageStatsResponse(
        used_bytes=int(used),
        disk_total_bytes=disk_total,
        disk_free_bytes=disk_free,
    )

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.asset import Asset
from ..models.folder import Folder
from ..models.project import Project, ProjectMember
from ..schemas.asset import AssetResponse
from ..routers.assets import _build_asset_responses_bulk

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/assets", response_model=list[AssetResponse])
def list_my_assets(
    filter: Optional[str] = Query(default=None, description="owned: only assets I uploaded"),
    q: Optional[str] = Query(default=None, description="Search by asset name"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if filter == "owned":
        query = db.query(Asset).filter(
            Asset.created_by == current_user.id,
            Asset.deleted_at.is_(None),
        )
    else:
        # All assets in projects the user is a member of
        project_ids = db.query(ProjectMember.project_id).filter(
            ProjectMember.user_id == current_user.id,
            ProjectMember.deleted_at.is_(None),
        ).subquery()
        query = db.query(Asset).filter(
            Asset.project_id.in_(project_ids),
            Asset.deleted_at.is_(None),
        )

    # Apply search filter
    if q and q.strip():
        query = query.filter(Asset.name.ilike(f"%{q.strip()}%"))

    assets = query.order_by(Asset.created_at.desc()).offset(skip).limit(limit).all()
    return _build_asset_responses_bulk(assets, db)


@router.get("/folders")
def search_my_folders(
    q: Optional[str] = Query(default=None, description="Search by folder name"),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search folders across all projects the user has access to."""
    project_ids = db.query(ProjectMember.project_id).filter(
        ProjectMember.user_id == current_user.id,
        ProjectMember.deleted_at.is_(None),
    ).subquery()

    query = db.query(Folder).filter(
        Folder.project_id.in_(project_ids),
        Folder.deleted_at.is_(None),
    )
    if q and q.strip():
        query = query.filter(Folder.name.ilike(f"%{q.strip()}%"))

    folders = query.order_by(Folder.name).limit(limit).all()

    # Include project name for context
    results = []
    for f in folders:
        project = db.query(Project).filter(Project.id == f.project_id).first()
        results.append({
            "id": str(f.id),
            "name": f.name,
            "project_id": str(f.project_id),
            "project_name": project.name if project else None,
            "item_count": f.item_count if hasattr(f, 'item_count') else 0,
        })
    return results


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
from ..services.approval_service import latest_version_approved

router = APIRouter(prefix="/me", tags=["me"])


def _visible_project_ids(db: Session, user: User):
    """Projects the user can browse: the workspace owner (superadmin) sees every
    project, e.g. editors' Quick Shares; everyone else sees their memberships."""
    if user.is_superadmin:
        return db.query(Project.id).filter(Project.deleted_at.is_(None)).subquery()
    return (
        db.query(ProjectMember.project_id)
        .join(Project, Project.id == ProjectMember.project_id)
        .filter(
            ProjectMember.user_id == user.id,
            ProjectMember.deleted_at.is_(None),
            Project.deleted_at.is_(None),
        )
        .subquery()
    )


@router.get("/assets", response_model=list[AssetResponse])
def list_my_assets(
    filter: Optional[str] = Query(default=None, description="owned: only assets I uploaded; otherwise everything I can see"),
    q: Optional[str] = Query(default=None, description="Search by asset name"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    hide_approved: bool = Query(default=False, description="Leave out assets whose newest version is approved"),
):
    if filter == "owned":
        query = db.query(Asset).filter(
            Asset.created_by == current_user.id,
            Asset.deleted_at.is_(None),
        )
    else:
        query = db.query(Asset).filter(
            Asset.project_id.in_(_visible_project_ids(db, current_user)),
            Asset.deleted_at.is_(None),
        )

    # Apply search filter
    if q and q.strip():
        query = query.filter(Asset.name.ilike(f"%{q.strip()}%"))
    if hide_approved:
        query = query.filter(~latest_version_approved())

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
    project_ids = _visible_project_ids(db, current_user)

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


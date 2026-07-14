from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from sqlalchemy.exc import IntegrityError
import uuid
from datetime import datetime, timezone
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.project import Project, ProjectMember, ProjectRole, ProjectType
from ..models.asset import Asset, AssetVersion, MediaFile
from ..models.folder import Folder
from ..models.share import AssetShare, ShareLink
from ..schemas.project import FolderAccessGrantResponse, FolderAccessResponse, FolderDirectProjectResponse, ProjectAccessResponse, ProjectCreate, ProjectUpdate, ProjectResponse, ProjectMemberResponse, AddProjectMemberRequest, UpdateProjectMemberRequest
from ..tasks.email_tasks import send_project_added_email
from ..tasks.celery_app import send_task_safe
from ..services.s3_service import put_object, generate_presigned_get_url, delete_object
from ..services.workspace_service import get_workspace_name
from ..config import settings
from ..services.folder_access import folder_scope_select, resolve_folder_access
from ..services.permissions import get_asset_scoped_project_assets

router = APIRouter(prefix="/projects", tags=["projects"])

def _get_project(db: Session, project_id: uuid.UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

def _resolve_poster_url(project: Project) -> str | None:
    if project.poster_s3_key:
        return generate_presigned_get_url(project.poster_s3_key)
    return None


def _project_to_response(project: Project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        project_type=project.project_type,
        created_by=project.created_by,
        created_at=project.created_at,
        is_public=project.is_public,
        is_quick_share=project.is_quick_share,
    )

def _require_project_owner(db: Session, project_id: uuid.UUID, user: User) -> ProjectMember:
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user.id,
        ProjectMember.deleted_at.is_(None),
    ).first()
    if not member or member.role != ProjectRole.owner:
        raise HTTPException(status_code=403, detail="Project owner access required")
    return member

def _find_owned_active_quick_share(db: Session, creator_id: uuid.UUID) -> Project | None:
    return db.query(Project).filter(
        Project.is_quick_share.is_(True),
        Project.created_by == creator_id,
        Project.deleted_at.is_(None),
    ).first()

def _get_active_project_for_update(db: Session, project_id: uuid.UUID) -> Project:
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.deleted_at.is_(None),
    ).with_for_update().first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

def _guard_active_owner(
    db: Session,
    project_id: uuid.UUID,
    member: ProjectMember,
    requested_role: ProjectRole | None,
) -> None:
    if member.role != ProjectRole.owner or requested_role == ProjectRole.owner:
        return
    owner_count = db.query(func.count(ProjectMember.id)).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.role == ProjectRole.owner,
        ProjectMember.deleted_at.is_(None),
    ).scalar() or 0
    if owner_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project must have at least one active owner",
        )

@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = Project(
        name=body.name,
        description=body.description,
        project_type=body.project_type,
        created_by=current_user.id,
    )
    db.add(project)
    db.flush()
    member = ProjectMember(project_id=project.id, user_id=current_user.id, role=ProjectRole.owner)
    db.add(member)
    db.commit()
    db.refresh(project)
    return project

@router.post("/quick-share", response_model=ProjectResponse, status_code=status.HTTP_200_OK)
def get_or_create_quick_share_project(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = _find_owned_active_quick_share(db, current_user.id)
    if project is not None:
        return project

    try:
        project = Project(
            name="Quick Shares",
            description=None,
            project_type=ProjectType.personal,
            created_by=current_user.id,
            is_quick_share=True,
        )
        db.add(project)
        db.flush()
        member = ProjectMember(project_id=project.id, user_id=current_user.id, role=ProjectRole.owner)
        db.add(member)
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = _find_owned_active_quick_share(db, current_user.id)
        if winner is None:
            raise
        return winner
    db.refresh(project)
    return project

@router.get("", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from sqlalchemy import or_

    # Get memberships for current user
    memberships = db.query(ProjectMember).filter(
        ProjectMember.user_id == current_user.id,
        ProjectMember.deleted_at.is_(None),
    ).all()
    membership_map = {m.project_id: m.role for m in memberships}
    member_project_ids = list(membership_map.keys())

    # Get projects: user's memberships + all public projects
    projects = db.query(Project).filter(
        Project.deleted_at.is_(None),
        or_(
            Project.id.in_(member_project_ids) if member_project_ids else False,
            Project.is_public == True,
        ),
    ).all()

    all_project_ids = [p.id for p in projects]
    if not all_project_ids:
        return []

    # Batch: asset counts per project
    asset_counts = dict(
        db.query(Asset.project_id, func.count(Asset.id))
        .filter(Asset.project_id.in_(all_project_ids), Asset.deleted_at.is_(None))
        .group_by(Asset.project_id)
        .all()
    )

    # Batch: storage bytes per project (sum of file sizes)
    storage_query = (
        db.query(Asset.project_id, func.coalesce(func.sum(MediaFile.file_size_bytes), 0))
        .join(AssetVersion, AssetVersion.asset_id == Asset.id)
        .join(MediaFile, MediaFile.version_id == AssetVersion.id)
        .filter(Asset.project_id.in_(all_project_ids), Asset.deleted_at.is_(None))
        .group_by(Asset.project_id)
        .all()
    )
    storage_map = {pid: int(size) for pid, size in storage_query}

    # Batch: member counts per project
    member_counts = dict(
        db.query(ProjectMember.project_id, func.count(ProjectMember.id))
        .filter(ProjectMember.project_id.in_(all_project_ids), ProjectMember.deleted_at.is_(None))
        .group_by(ProjectMember.project_id)
        .all()
    )

    result = []
    for p in projects:
        resp = _project_to_response(p)
        resp.poster_url = _resolve_poster_url(p)
        resp.asset_count = asset_counts.get(p.id, 0)
        resp.storage_bytes = storage_map.get(p.id, 0)
        resp.member_count = member_counts.get(p.id, 0)
        resp.role = membership_map.get(p.id)
        result.append(resp)

    return result

@router.get("/{project_id}", response_model=ProjectAccessResponse)
def get_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectAccessResponse:
    project = _get_project(db, project_id)
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == current_user.id,
        ProjectMember.deleted_at.is_(None),
    ).first()
    folder_access = None
    asset_scoped_assets: list[Asset] = []
    if not member and not project.is_public and not current_user.is_superadmin:
        folder_access = resolve_folder_access(db, project_id, current_user.id)
        if folder_access is None:
            asset_scoped_assets = get_asset_scoped_project_assets(
                db,
                project_id,
                current_user,
            )
            if not asset_scoped_assets:
                raise HTTPException(status_code=403, detail="Not a project member")
    if folder_access is not None or asset_scoped_assets:
        asset_scope_filter = (
            Asset.folder_id.in_(
                folder_scope_select(project_id, folder_access.accessible_root_ids)
            )
            if folder_access is not None
            else Asset.id.in_([asset.id for asset in asset_scoped_assets])
        )
        scoped_asset_count, scoped_storage_bytes = (
            db.query(
                func.count(func.distinct(Asset.id)),
                func.coalesce(func.sum(MediaFile.file_size_bytes), 0),
            )
            .outerjoin(
                AssetVersion,
                and_(
                    AssetVersion.asset_id == Asset.id,
                    AssetVersion.deleted_at.is_(None),
                ),
            )
            .outerjoin(MediaFile, MediaFile.version_id == AssetVersion.id)
            .filter(
                Asset.project_id == project_id,
                asset_scope_filter,
                Asset.deleted_at.is_(None),
            )
            .one()
        )
        scoped_folder_access = (
            FolderAccessResponse(
                accessible_root_ids=list(folder_access.accessible_root_ids),
                grants=[
                    FolderAccessGrantResponse(
                        folder_id=grant.folder_id,
                        permission=grant.permission,
                    )
                    for grant in folder_access.grants
                ],
            )
            if folder_access is not None
            else FolderAccessResponse(accessible_root_ids=[], grants=[])
        )
        scoped = FolderDirectProjectResponse(
            id=project.id,
            name=project.name,
            asset_count=int(scoped_asset_count),
            storage_bytes=int(scoped_storage_bytes),
            folder_access=scoped_folder_access,
        )
        return scoped
    resp = _project_to_response(project)
    resp.poster_url = _resolve_poster_url(project)
    if member:
        resp.role = member.role
    elif current_user.is_superadmin:
        resp.role = ProjectRole.owner
    # Calculate storage, asset count, member count
    resp.asset_count = db.query(func.count(Asset.id)).filter(
        Asset.project_id == project_id, Asset.deleted_at.is_(None),
    ).scalar() or 0
    resp.storage_bytes = int(
        db.query(func.coalesce(func.sum(MediaFile.file_size_bytes), 0)).join(
            AssetVersion, MediaFile.version_id == AssetVersion.id
        ).join(Asset, AssetVersion.asset_id == Asset.id).filter(
            Asset.project_id == project_id, Asset.deleted_at.is_(None),
        ).scalar() or 0
    )
    resp.member_count = db.query(func.count(ProjectMember.id)).filter(
        ProjectMember.project_id == project_id, ProjectMember.deleted_at.is_(None),
    ).scalar() or 0
    return resp

@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: uuid.UUID, body: ProjectUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = _get_project(db, project_id)
    _require_project_owner(db, project_id, current_user)
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.is_public is not None:
        project.is_public = body.is_public
    db.commit()
    db.refresh(project)
    resp = _project_to_response(project)
    resp.poster_url = _resolve_poster_url(project)
    return resp

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = _get_project(db, project_id)
    _require_project_owner(db, project_id, current_user)
    now = datetime.now(timezone.utc)
    asset_ids = [
        row[0]
        for row in db.query(Asset.id).filter(
            Asset.project_id == project_id,
            Asset.deleted_at.is_(None),
        ).all()
    ]
    folder_ids = [
        row[0]
        for row in db.query(Folder.id).filter(
            Folder.project_id == project_id,
            Folder.deleted_at.is_(None),
        ).all()
    ]

    project.deleted_at = now
    db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.deleted_at.is_(None),
    ).update({"deleted_at": now}, synchronize_session="fetch")
    db.query(Folder).filter(
        Folder.project_id == project_id,
        Folder.deleted_at.is_(None),
    ).update({"deleted_at": now}, synchronize_session="fetch")
    db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.deleted_at.is_(None),
    ).update({"deleted_at": now}, synchronize_session="fetch")
    if asset_ids:
        db.query(AssetVersion).filter(
            AssetVersion.asset_id.in_(asset_ids),
            AssetVersion.deleted_at.is_(None),
        ).update({"deleted_at": now}, synchronize_session="fetch")
        db.query(AssetShare).filter(
            AssetShare.asset_id.in_(asset_ids),
            AssetShare.deleted_at.is_(None),
        ).update({"deleted_at": now}, synchronize_session="fetch")
        db.query(ShareLink).filter(
            ShareLink.asset_id.in_(asset_ids),
            ShareLink.deleted_at.is_(None),
        ).update({"deleted_at": now}, synchronize_session="fetch")
    if folder_ids:
        db.query(AssetShare).filter(
            AssetShare.folder_id.in_(folder_ids),
            AssetShare.deleted_at.is_(None),
        ).update({"deleted_at": now}, synchronize_session="fetch")
        db.query(ShareLink).filter(
            ShareLink.folder_id.in_(folder_ids),
            ShareLink.deleted_at.is_(None),
        ).update({"deleted_at": now}, synchronize_session="fetch")
    db.query(ShareLink).filter(
        ShareLink.project_id == project_id,
        ShareLink.deleted_at.is_(None),
    ).update({"deleted_at": now}, synchronize_session="fetch")
    db.commit()

@router.get("/{project_id}/members", response_model=list[ProjectMemberResponse])
def list_project_members(project_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_project(db, project_id)
    # Verify user is a member
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == current_user.id,
        ProjectMember.deleted_at.is_(None),
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a project member")
    
    members = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.deleted_at.is_(None),
    ).all()
    return members

@router.post("/{project_id}/members", response_model=ProjectMemberResponse, status_code=status.HTTP_201_CREATED)
def add_project_member(project_id: uuid.UUID, body: AddProjectMemberRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_project(db, project_id)
    _require_project_owner(db, project_id, current_user)
    target_user = db.query(User).filter(
        User.id == body.user_id, User.deleted_at.is_(None)
    ).first()
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == body.user_id).first()
    if existing:
        if existing.deleted_at is None:
            raise HTTPException(status_code=400, detail="User already a project member")
        # Reactivate soft-deleted membership
        existing.deleted_at = None
        existing.role = body.role
        db.commit()
        db.refresh(existing)
        member = existing
    else:
        member = ProjectMember(project_id=project_id, user_id=body.user_id, role=body.role, invited_by=current_user.id)
        db.add(member)
        db.commit()
        db.refresh(member)

    # Send project added email (for both new and reactivated members)
    project = _get_project(db, project_id)
    project_link = f"{settings.frontend_url}/projects/{project_id}"
    send_task_safe(send_project_added_email,
        to_email=target_user.email,
        adder_name=current_user.name,
        project_name=project.name,
        project_link=project_link,
        role=body.role.value if body.role else None,
        workspace_name=get_workspace_name(db),
    )

    return member

@router.patch("/{project_id}/members/{user_id}", response_model=ProjectMemberResponse)
def update_project_member(project_id: uuid.UUID, user_id: uuid.UUID, body: UpdateProjectMemberRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_active_project_for_update(db, project_id)
    _require_project_owner(db, project_id, current_user)
    member = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id, ProjectMember.deleted_at.is_(None)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    _guard_active_owner(db, project_id, member, body.role)
    member.role = body.role
    db.commit()
    db.refresh(member)
    return member

@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_member(project_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_active_project_for_update(db, project_id)
    _require_project_owner(db, project_id, current_user)
    member = db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id, ProjectMember.deleted_at.is_(None)).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    _guard_active_owner(db, project_id, member, None)
    member.deleted_at = datetime.now(timezone.utc)
    db.commit()

ALLOWED_POSTER_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_POSTER_SIZE = 10 * 1024 * 1024  # 10MB

@router.post("/{project_id}/poster", response_model=ProjectResponse)
async def upload_project_poster(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project(db, project_id)
    _require_project_owner(db, project_id, current_user)

    if file.content_type not in ALLOWED_POSTER_TYPES:
        raise HTTPException(status_code=400, detail="File must be JPEG, PNG, WebP, or GIF")

    data = await file.read()
    if len(data) > MAX_POSTER_SIZE:
        raise HTTPException(status_code=400, detail="File must be under 10MB")

    # Delete old poster if exists
    if project.poster_s3_key:
        try:
            delete_object(project.poster_s3_key)
        except Exception:
            pass

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    s3_key = f"posters/{project_id}/poster.{ext}"
    put_object(s3_key, data, content_type=file.content_type, cache_control="max-age=86400")

    project.poster_s3_key = s3_key
    db.commit()
    db.refresh(project)

    resp = _project_to_response(project)
    resp.poster_url = _resolve_poster_url(project)
    return resp

@router.delete("/{project_id}/poster", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_poster(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project(db, project_id)
    _require_project_owner(db, project_id, current_user)

    if project.poster_s3_key:
        try:
            delete_object(project.poster_s3_key)
        except Exception:
            pass
        project.poster_s3_key = None
        db.commit()

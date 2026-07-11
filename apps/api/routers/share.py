import secrets
import uuid
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
import bcrypt

from fastapi import APIRouter, Depends, HTTPException, Query, status
import sqlalchemy
from sqlalchemy import func as sa_func, case
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user, get_optional_user
from ..middleware.rate_limit import rate_limit
from ..models.user import User
from ..models.asset import Asset
from ..models.folder import Folder
from ..models.share import AssetShare, ShareLink, ShareLinkItem, SharePermission, ShareVisibility, ShareLinkActivity, ShareActivityAction
from ..models.activity import ActivityLog, ActivityAction, Notification, NotificationType
from ..models.approval import Approval, ApprovalStatus
from ..models.branding import ProjectBranding
from ..models.asset import AssetVersion, AssetType, MediaFile, ProcessingStatus
from ..models.comment import Comment
from ..schemas.share import (
    DirectShareCreate,
    DirectShareResponse,
    FolderShareAssetItem,
    FolderShareAssetsResponse,
    FolderShareSubfolder,
    MultiShareCreate,
    ReviewerShareCreate,
    ReviewerShareResponse,
    ShareLinkActivityResponse,
    ShareLinkCreate,
    ShareLinkListItem,
    ShareLinkResponse,
    ShareLinkUpdate,
    ShareLinkValidateResponse,
)
from ..schemas.approval import ApprovalCreate, ApprovalResponse
from ..services.approval_service import get_active_version, upsert_approval
from ..services.permissions import (
    get_project_member,
    require_project_role,
    validate_asset_in_share,
    validate_share_link,
    validate_share_link_with_session,
)
from ..services.redis_service import create_share_session, verify_share_session
from ..services.s3_service import generate_presigned_get_url, build_download_filename
from ..services.workspace_service import get_workspace_name
from .hls_proxy import create_hls_token
from ..models.project import Project, ProjectMember, ProjectRole
from ..tasks.email_tasks import send_approval_email, send_share_email
from ..tasks.celery_app import send_task_safe
from ..config import settings

router = APIRouter(tags=["sharing"])
logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ReviewerShareSpec:
    created_by: uuid.UUID
    permission: SharePermission = SharePermission.comment
    allow_download: bool = False
    expires_at: datetime | None = None
    password: str | None = None
    title: str | None = None
    visibility: ShareVisibility = ShareVisibility.public


def _validate_resulting_share_state(
    permission: SharePermission,
    visibility: ShareVisibility,
    allow_download: bool,
    show_watermark: bool,
) -> None:
    if show_watermark and allow_download:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Watermarked shares cannot allow downloads",
        )
    if permission == SharePermission.approve and visibility != ShareVisibility.secure:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Approve permission requires secure visibility",
        )


def _escape_like(s: str) -> str:
    """Escape special LIKE pattern characters to prevent injection."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _get_asset(db: Session, asset_id: uuid.UUID) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _get_folder(db: Session, folder_id: uuid.UUID) -> Folder:
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.deleted_at.is_(None)).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def _lock_active_project(db: Session, project_id: uuid.UUID) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.deleted_at.is_(None))
        .with_for_update()
        .first()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _resolve_active_share_recipient(db: Session, body: DirectShareCreate) -> User:
    filters = [User.deleted_at.is_(None)]
    if body.user_id is not None:
        filters.append(User.id == body.user_id)
    elif body.email is not None:
        filters.append(User.email == body.email)
    else:
        raise HTTPException(status_code=400, detail="user_id or email required")
    recipient = db.query(User).filter(*filters).first()
    if recipient is None:
        raise HTTPException(status_code=404, detail="User not found")
    return recipient


def _apply_direct_share_permission(existing: AssetShare, requested: SharePermission) -> None:
    if existing.deleted_at is not None:
        existing.deleted_at = None
    existing.permission = requested


def _get_project_id_from_link(db: Session, link: ShareLink) -> uuid.UUID:
    if link.project_id:
        return link.project_id
    if link.asset_id:
        asset = _get_asset(db, link.asset_id)
        return asset.project_id
    elif link.folder_id:
        folder = db.query(Folder).filter(Folder.id == link.folder_id, Folder.deleted_at.is_(None)).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Shared folder not found")
        return folder.project_id
    raise HTTPException(status_code=400, detail="Invalid share link")


def _get_manageable_share_link(db: Session, token: str, user: User) -> ShareLink:
    managed_project_ids = (
        sqlalchemy.select(ProjectMember.project_id)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(
            ProjectMember.user_id == user.id,
            ProjectMember.role.in_((ProjectRole.owner, ProjectRole.editor)),
            ProjectMember.deleted_at.is_(None),
            Project.deleted_at.is_(None),
        )
    )
    managed_asset_ids = sqlalchemy.select(Asset.id).where(
        Asset.project_id.in_(managed_project_ids),
        Asset.deleted_at.is_(None),
    )
    managed_folder_ids = sqlalchemy.select(Folder.id).where(
        Folder.project_id.in_(managed_project_ids),
        Folder.deleted_at.is_(None),
    )
    link = db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.deleted_at.is_(None),
        sqlalchemy.or_(
            ShareLink.project_id.in_(managed_project_ids),
            ShareLink.asset_id.in_(managed_asset_ids),
            ShareLink.folder_id.in_(managed_folder_ids),
        ),
    ).first()
    if link is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor permission required")
    return link


def _can_download_from_share(db: Session, link: ShareLink, user: User | None) -> bool:
    if link.allow_download:
        return True
    if user is None:
        return False
    project_id = _get_project_id_from_link(db, link)
    return get_project_member(db, project_id, user.id) is not None


def _log_share_activity(
    db: Session,
    share_link_id: uuid.UUID,
    action: ShareActivityAction,
    actor_email: str,
    actor_name: Optional[str] = None,
    asset_id: Optional[uuid.UUID] = None,
    asset_name: Optional[str] = None,
    dedup_seconds: int = 30,
):
    """Log share activity, skipping duplicates within dedup_seconds window."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=dedup_seconds)
        existing = db.query(ShareLinkActivity).filter(
            ShareLinkActivity.share_link_id == share_link_id,
            ShareLinkActivity.action == action,
            ShareLinkActivity.actor_email == actor_email,
            ShareLinkActivity.asset_id == asset_id,
            ShareLinkActivity.created_at >= cutoff,
        ).first()
        if existing:
            return
        activity = ShareLinkActivity(
            share_link_id=share_link_id,
            action=action,
            actor_email=actor_email,
            actor_name=actor_name,
            asset_id=asset_id,
            asset_name=asset_name,
        )
        db.add(activity)
        db.commit()
    except Exception:
        db.rollback()


def _is_descendant_of(db: Session, folder_id: uuid.UUID, ancestor_id: uuid.UUID) -> bool:
    """Check if folder_id is a descendant of ancestor_id via parent chain traversal."""
    current_id = folder_id
    visited = set()
    while current_id and current_id not in visited:
        if current_id == ancestor_id:
            return True
        visited.add(current_id)
        folder = db.query(Folder.parent_id).filter(Folder.id == current_id).first()
        current_id = folder.parent_id if folder else None
    return False


def _get_latest_media_file(db: Session, asset_id: uuid.UUID) -> Optional[MediaFile]:
    """Get the first media file from the latest ready version of an asset."""
    version = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset_id,
        AssetVersion.deleted_at.is_(None),
        AssetVersion.processing_status == ProcessingStatus.ready,
    ).order_by(AssetVersion.version_number.desc()).first()
    if not version:
        return None
    return db.query(MediaFile).filter(MediaFile.version_id == version.id).first()


def create_reviewer_share(
    db: Session,
    asset: Asset,
    spec: ReviewerShareSpec,
) -> ShareLink:
    _validate_resulting_share_state(
        spec.permission,
        spec.visibility,
        spec.allow_download,
        False,
    )
    token = secrets.token_urlsafe(32)
    if spec.password:
        pwd_bytes = spec.password[:72].encode("utf-8")
        password_hash = bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode("utf-8")
    else:
        password_hash = None

    link = ShareLink(
        asset_id=asset.id,
        folder_id=None,
        project_id=None,
        token=token,
        created_by=spec.created_by,
        title=spec.title if spec.title else asset.name,
        expires_at=spec.expires_at,
        password_hash=password_hash,
        password_encrypted=None,
        permission=spec.permission,
        visibility=spec.visibility,
        allow_download=spec.allow_download,
        show_versions=False,
        show_watermark=False,
    )
    db.add(link)
    db.add(ActivityLog(user_id=spec.created_by, asset_id=asset.id, action=ActivityAction.shared))
    db.flush()
    return link


# ── Share links ───────────────────────────────────────────────────────────────

@router.post("/assets/{asset_id}/share", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_share_link(
    asset_id: uuid.UUID,
    body: ShareLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)

    token = secrets.token_urlsafe(32)
    if body.password:
        pwd_bytes = body.password[:72].encode('utf-8')
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')
    else:
        password_hash = None

    link = ShareLink(
        asset_id=asset_id,
        token=token,
        created_by=current_user.id,
        title=body.title if body.title else asset.name,
        description=body.description,
        expires_at=body.expires_at,
        password_hash=password_hash,
        password_encrypted=None,
        permission=body.permission,
        visibility=body.visibility,
        allow_download=body.allow_download,
        show_versions=body.show_versions,
        show_watermark=body.show_watermark,
        appearance=body.appearance.model_dump(),
    )
    db.add(link)
    db.add(ActivityLog(user_id=current_user.id, asset_id=asset_id, action=ActivityAction.shared))
    db.commit()
    db.refresh(link)
    return _share_link_response(link)


@router.post(
    "/assets/{asset_id}/reviewer-share",
    response_model=ReviewerShareResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reviewer_share_endpoint(
    asset_id: uuid.UUID,
    body: ReviewerShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    link = create_reviewer_share(
        db,
        asset,
        ReviewerShareSpec(
            created_by=current_user.id,
            permission=body.permission,
            allow_download=body.allow_download,
            expires_at=body.expires_at,
            password=body.password,
            title=body.title,
            visibility=(
                ShareVisibility.secure
                if body.permission == SharePermission.approve
                else ShareVisibility.public
            ),
        ),
    )
    db.commit()
    db.refresh(link)
    return ReviewerShareResponse(
        token=link.token,
        asset_id=asset.id,
        permission=link.permission,
        allow_download=link.allow_download,
        url=f"{settings.frontend_url.rstrip('/')}/share/{link.token}",
        expires_at=link.expires_at,
    )


@router.get("/assets/{asset_id}/shares", response_model=list[ShareLinkResponse])
def list_share_links(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    links = db.query(ShareLink).filter(
        ShareLink.asset_id == asset_id,
        ShareLink.deleted_at.is_(None),
    ).all()
    return [_share_link_response(link) for link in links]


@router.get("/share/{token}", response_model=ShareLinkValidateResponse, dependencies=[Depends(rate_limit("share_validate", 30, 60))])
def validate_share_link_endpoint(
    token: str,
    password: Optional[str] = None,
    log_open: bool = False,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public endpoint — optional auth. For secure links, requires authenticated user."""
    link = validate_share_link(db, token)

    # Check secure visibility — requires authenticated user
    if link.visibility == "secure":
        if not current_user:
            return ShareLinkValidateResponse(
                requires_auth=True,
                requires_password=False,
                title=link.title,
                permission=link.permission,
                visibility=link.visibility,
            )

    # Resolve folder name if this is a folder share
    folder_name = None
    project_name = None
    if link.folder_id:
        folder = db.query(Folder).filter(Folder.id == link.folder_id, Folder.deleted_at.is_(None)).first()
        if folder:
            folder_name = folder.name
    if link.project_id:
        project = db.query(Project).filter(Project.id == link.project_id, Project.deleted_at.is_(None)).first()
        if project:
            project_name = project.name

    session_id = None
    if link.password_hash:
        if not password:
            return ShareLinkValidateResponse(
                requires_password=True,
                title=link.title,
                permission=link.permission,
            )
        try:
            plain_bytes = password[:72].encode('utf-8')
            hashed_bytes = link.password_hash.encode('utf-8')
            if not bcrypt.checkpw(plain_bytes, hashed_bytes):
                raise HTTPException(status_code=403, detail="Incorrect password")
        except ValueError:
            raise HTTPException(status_code=403, detail="Incorrect password")
        # Password verified — create a session so subsequent requests skip re-verification
        session_id = secrets.token_urlsafe(32)
        create_share_session(token, session_id)

    if log_open:
        actor_email = current_user.email if current_user else "anonymous"
        actor_name = current_user.name if current_user else None
        _log_share_activity(db, link.id, ShareActivityAction.opened, actor_email=actor_email, actor_name=actor_name)

    # Build asset details for asset shares
    asset_data = None
    branding_data = None
    if link.asset_id:
        asset = _get_asset(db, link.asset_id)
        # Get thumbnail URL
        media_file = _get_latest_media_file(db, asset.id)
        thumbnail_url = None
        if media_file and media_file.s3_key_thumbnail:
            thumbnail_url = generate_presigned_get_url(media_file.s3_key_thumbnail)
        # Get stream URL
        stream_url = None
        if media_file:
            if media_file.s3_key_processed:
                if asset.asset_type == AssetType.video:
                    # Route through /stream/hls so S3 can stay private (#51)
                    hls_token = create_hls_token(
                        media_file.s3_key_processed,
                        asset_id=asset.id,
                        version_id=media_file.version_id,
                        user_id=current_user.id if current_user else None,
                        share_token=token,
                        share_session=session_id,
                    )
                    stream_url = f"/stream/hls/master.m3u8?token={hls_token}"
                else:
                    stream_url = generate_presigned_get_url(media_file.s3_key_processed)
            elif media_file.s3_key_raw:
                stream_url = generate_presigned_get_url(media_file.s3_key_raw)

        asset_data = {
            "id": str(asset.id),
            "name": asset.name,
            "asset_type": asset.asset_type.value if hasattr(asset.asset_type, 'value') else str(asset.asset_type),
            "description": asset.description,
            "thumbnail_url": thumbnail_url,
            "stream_url": stream_url,
        }
        # Get project branding
        branding = db.query(ProjectBranding).filter(
            ProjectBranding.project_id == asset.project_id
        ).first()
        if branding:
            branding_data = {
                "logo_url": branding.logo_s3_key,
                "primary_color": branding.primary_color,
                "custom_title": branding.custom_title,
                "custom_footer": branding.custom_footer,
            }

    # Resolve creator name
    creator = db.query(User).filter(User.id == link.created_by, User.deleted_at.is_(None)).first()
    created_by_name = creator.name if creator else None

    return ShareLinkValidateResponse(
        asset_id=link.asset_id,
        folder_id=link.folder_id,
        project_id=link.project_id,
        folder_name=folder_name,
        project_name=project_name,
        title=link.title,
        description=link.description,
        permission=link.permission,
        visibility=link.visibility,
        allow_download=_can_download_from_share(db, link, current_user),
        show_versions=link.show_versions,
        show_watermark=link.show_watermark,
        appearance=link.appearance,
        requires_password=False,
        created_by_name=created_by_name,
        viewer_name=current_user.name if current_user else None,
        viewer_email=current_user.email if current_user else None,
        asset=asset_data,
        branding=branding_data,
        share_session=session_id,
    )


def _share_link_response(link: ShareLink) -> ShareLinkResponse:
    response = ShareLinkResponse.model_validate(link)
    response.has_password = link.password_hash is not None and link.password_hash != ''
    return response


# ── Authenticated share link details (for settings panel) ────────────────────

@router.get("/share/{token}/details", response_model=ShareLinkResponse)
def get_share_link_details(
    token: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Authenticated endpoint returning full share link details for the settings panel."""
    link = _get_manageable_share_link(db, token, current_user)
    return _share_link_response(link)


# ── PATCH share link ─────────────────────────────────────────────────────────

@router.patch("/share/{token}", response_model=ShareLinkResponse)
def update_share_link(
    token: str,
    body: ShareLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    link = _get_manageable_share_link(db, token, current_user)

    updates = body.model_dump(exclude_unset=True)

    resulting_permission = updates.get("permission", link.permission)
    resulting_visibility = updates.get("visibility", link.visibility)
    resulting_allow_download = updates.get("allow_download", link.allow_download)
    resulting_show_watermark = updates.get("show_watermark", link.show_watermark)
    _validate_resulting_share_state(
        SharePermission(resulting_permission),
        ShareVisibility(resulting_visibility),
        resulting_allow_download,
        resulting_show_watermark,
    )

    if "password" in updates:
        raw_password = updates.pop("password")
        if raw_password:
            pwd_bytes = raw_password[:72].encode('utf-8')
            salt = bcrypt.gensalt()
            link.password_hash = bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')
            link.password_encrypted = None
        else:
            link.password_hash = None
            link.password_encrypted = None

    # Convert appearance Pydantic model to dict
    if "appearance" in updates and updates["appearance"] is not None:
        updates["appearance"] = body.appearance.model_dump()

    for key, value in updates.items():
        setattr(link, key, value)

    db.commit()
    db.refresh(link)
    return _share_link_response(link)


@router.delete("/share/{token}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_share_link(
    token: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    link = _get_manageable_share_link(db, token, current_user)
    link.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ── Folder share links ───────────────────────────────────────────────────────

@router.post("/folders/{folder_id}/share", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_folder_share_link(
    folder_id: uuid.UUID,
    body: ShareLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_folder(db, folder_id)
    require_project_role(db, folder.project_id, current_user, ProjectRole.editor)

    token = secrets.token_urlsafe(32)
    if body.password:
        pwd_bytes = body.password[:72].encode('utf-8')
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')
    else:
        password_hash = None

    link = ShareLink(
        folder_id=folder_id,
        token=token,
        created_by=current_user.id,
        title=body.title if body.title else folder.name,
        description=body.description,
        expires_at=body.expires_at,
        password_hash=password_hash,
        password_encrypted=None,
        permission=body.permission,
        visibility=body.visibility,
        allow_download=body.allow_download,
        show_versions=body.show_versions,
        show_watermark=body.show_watermark,
        appearance=body.appearance.model_dump(),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _share_link_response(link)


@router.post("/projects/{project_id}/share", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_project_share_link(
    project_id: uuid.UUID,
    body: ShareLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a share link for the project root (all root-level folders and assets)."""
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_role(db, project_id, current_user, ProjectRole.editor)

    token = secrets.token_urlsafe(32)
    if body.password:
        pwd_bytes = body.password[:72].encode('utf-8')
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')
    else:
        password_hash = None

    link = ShareLink(
        project_id=project_id,
        token=token,
        created_by=current_user.id,
        title=body.title if body.title else project.name,
        description=body.description,
        expires_at=body.expires_at,
        password_hash=password_hash,
        password_encrypted=None,
        permission=body.permission,
        visibility=body.visibility,
        allow_download=body.allow_download,
        show_versions=body.show_versions,
        show_watermark=body.show_watermark,
        appearance=body.appearance.model_dump(),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _share_link_response(link)


@router.post("/projects/{project_id}/share/user", response_model=DirectShareResponse, status_code=status.HTTP_201_CREATED)
def share_project_with_user(
    project_id: uuid.UUID,
    body: DirectShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _lock_active_project(db, project_id)
    require_project_role(db, project_id, current_user, ProjectRole.owner)
    shared_user = _resolve_active_share_recipient(db, body)

    requested_role = {
        SharePermission.view: ProjectRole.viewer,
        SharePermission.comment: ProjectRole.reviewer,
        SharePermission.approve: ProjectRole.reviewer,
    }[body.permission]
    role_rank = {
        ProjectRole.viewer: 1,
        ProjectRole.reviewer: 2,
        ProjectRole.editor: 3,
        ProjectRole.owner: 4,
    }
    membership = (
        db.query(ProjectMember)
        .filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == shared_user.id,
        )
        .first()
    )
    if membership is None:
        membership = ProjectMember(
            project_id=project_id,
            user_id=shared_user.id,
            role=requested_role,
            invited_by=current_user.id,
        )
        db.add(membership)
    elif membership.deleted_at is not None:
        membership.deleted_at = None
        membership.role = requested_role
        membership.invited_by = current_user.id
        membership.invited_at = datetime.now(timezone.utc)
    elif role_rank[requested_role] > role_rank[membership.role]:
        membership.role = requested_role

    project_link = (
        f"{settings.frontend_url}/share/{body.share_token}"
        if body.share_token
        else f"{settings.frontend_url}/projects/{project_id}"
    )
    workspace_name = get_workspace_name(db)
    db.commit()
    send_task_safe(
        send_share_email,
        to_email=shared_user.email,
        sharer_name=current_user.name or current_user.email,
        asset_name=project.name,
        asset_link=project_link,
        permission=body.permission.value,
        workspace_name=workspace_name,
    )

    return DirectShareResponse(
        id=membership.id,
        project_id=project_id,
        shared_with_user_id=shared_user.id,
        shared_with_team_id=None,
        permission=body.permission,
        created_at=membership.invited_at,
    )


@router.get("/folders/{folder_id}/shares", response_model=list[ShareLinkResponse])
def list_folder_share_links(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_folder(db, folder_id)
    require_project_role(db, folder.project_id, current_user, ProjectRole.editor)
    links = db.query(ShareLink).filter(
        ShareLink.folder_id == folder_id,
        ShareLink.deleted_at.is_(None),
    ).all()
    return [_share_link_response(link) for link in links]


# ── Folder direct user/team sharing ──────────────────────────────────────────

@router.post("/folders/{folder_id}/share/user", response_model=DirectShareResponse, status_code=status.HTTP_201_CREATED)
def share_folder_with_user(
    folder_id: uuid.UUID,
    body: DirectShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_folder(db, folder_id)
    require_project_role(db, folder.project_id, current_user, ProjectRole.editor)
    shared_user = _resolve_active_share_recipient(db, body)
    _lock_active_project(db, folder.project_id)

    existing = db.query(AssetShare).filter(
        AssetShare.folder_id == folder_id,
        AssetShare.shared_with_user_id == shared_user.id,
    ).order_by(AssetShare.deleted_at.asc().nullsfirst()).first()
    if existing:
        _apply_direct_share_permission(existing, body.permission)
        db.commit()
        db.refresh(existing)
        return existing

    folder_link = (
        f"{settings.frontend_url}/share/{body.share_token}"
        if body.share_token
        else f"{settings.frontend_url}/projects/{folder.project_id}?folder={folder_id}"
    )
    workspace_name = get_workspace_name(db)
    direct_share = AssetShare(
        folder_id=folder_id,
        shared_with_user_id=shared_user.id,
        permission=body.permission,
        shared_by=current_user.id,
    )
    db.add(direct_share)
    db.commit()
    db.refresh(direct_share)

    send_task_safe(send_share_email,
        to_email=shared_user.email,
        sharer_name=current_user.name or current_user.email,
        asset_name=folder.name,
        asset_link=folder_link,
        permission=body.permission.value,
        workspace_name=workspace_name,
    )

    return direct_share


@router.post("/folders/{folder_id}/share/team", response_model=DirectShareResponse, status_code=status.HTTP_201_CREATED)
def share_folder_with_team(
    folder_id: uuid.UUID,
    body: DirectShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_folder(db, folder_id)
    require_project_role(db, folder.project_id, current_user, ProjectRole.editor)
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Team sharing is not supported")


# ── Delete folder share ──────────────────────────────────────────────────────

@router.get("/folders/{folder_id}/direct-shares")
def list_folder_direct_shares(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List direct user shares for a folder."""
    folder = _get_folder(db, folder_id)
    require_project_role(db, folder.project_id, current_user, ProjectRole.editor)
    shares = db.query(AssetShare).filter(
        AssetShare.folder_id == folder_id,
        AssetShare.deleted_at.is_(None),
        AssetShare.shared_with_user_id.isnot(None),
    ).all()
    return [{"id": str(s.id), "shared_with_user_id": str(s.shared_with_user_id), "permission": s.permission.value} for s in shares]


@router.get("/assets/{asset_id}/direct-shares")
def list_asset_direct_shares(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List direct user shares for an asset."""
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    shares = db.query(AssetShare).filter(
        AssetShare.asset_id == asset_id,
        AssetShare.deleted_at.is_(None),
        AssetShare.shared_with_user_id.isnot(None),
    ).all()
    return [{"id": str(s.id), "shared_with_user_id": str(s.shared_with_user_id), "permission": s.permission.value} for s in shares]


@router.delete("/folders/{folder_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder_share(
    folder_id: uuid.UUID,
    share_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_folder(db, folder_id)
    require_project_role(db, folder.project_id, current_user, ProjectRole.editor)

    share = db.query(AssetShare).filter(
        AssetShare.id == share_id,
        AssetShare.folder_id == folder_id,
        AssetShare.deleted_at.is_(None),
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")

    duplicates = db.query(AssetShare).filter(
        AssetShare.folder_id == folder_id,
        AssetShare.shared_with_user_id == share.shared_with_user_id,
        AssetShare.shared_with_team_id == share.shared_with_team_id,
        AssetShare.deleted_at.is_(None),
    ).all()
    deleted_at = datetime.now(timezone.utc)
    for duplicate in duplicates:
        duplicate.deleted_at = deleted_at
    db.commit()


# ── Direct user/team sharing (assets) ────────────────────────────────────────

@router.post("/assets/{asset_id}/share/user", response_model=DirectShareResponse, status_code=status.HTTP_201_CREATED)
def share_with_user(
    asset_id: uuid.UUID,
    body: DirectShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    shared_user = _resolve_active_share_recipient(db, body)
    _lock_active_project(db, asset.project_id)

    existing = db.query(AssetShare).filter(
        AssetShare.asset_id == asset_id,
        AssetShare.shared_with_user_id == shared_user.id,
    ).order_by(AssetShare.deleted_at.asc().nullsfirst()).first()
    if existing:
        _apply_direct_share_permission(existing, body.permission)
        db.commit()
        db.refresh(existing)
        return existing

    asset_link = (
        f"{settings.frontend_url}/share/{body.share_token}"
        if body.share_token
        else f"{settings.frontend_url}/projects/{asset.project_id}/assets/{asset_id}"
    )
    workspace_name = get_workspace_name(db)
    direct_share = AssetShare(
        asset_id=asset_id,
        shared_with_user_id=shared_user.id,
        permission=body.permission,
        shared_by=current_user.id,
    )
    db.add(direct_share)
    db.add(ActivityLog(user_id=current_user.id, asset_id=asset_id, action=ActivityAction.shared))
    db.commit()
    db.refresh(direct_share)

    send_task_safe(send_share_email,
        to_email=shared_user.email,
        sharer_name=current_user.name or current_user.email,
        asset_name=asset.name,
        asset_link=asset_link,
        permission=body.permission.value,
        workspace_name=workspace_name,
    )

    return direct_share


@router.post("/assets/{asset_id}/share/team", response_model=DirectShareResponse, status_code=status.HTTP_201_CREATED)
def share_with_team(
    asset_id: uuid.UUID,
    body: DirectShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset(db, asset_id)
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Team sharing is not supported")


# ── Project-level share link listing ──────────────────────────────────────────

@router.get("/projects/{project_id}/share-links", response_model=list[ShareLinkListItem])
def list_project_share_links(
    project_id: uuid.UUID,
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)

    # Subquery for view_count and last_viewed_at
    activity_stats = db.query(
        ShareLinkActivity.share_link_id,
        sa_func.count(case((ShareLinkActivity.action == ShareActivityAction.opened, 1))).label("view_count"),
        sa_func.max(ShareLinkActivity.created_at).label("last_viewed_at"),
    ).group_by(ShareLinkActivity.share_link_id).subquery()

    # Asset share links
    asset_query = (
        db.query(
            ShareLink.id,
            ShareLink.token,
            ShareLink.title,
            ShareLink.description,
            ShareLink.is_enabled,
            ShareLink.permission,
            sqlalchemy.literal("asset").label("share_type"),
            Asset.name.label("target_name"),
            sa_func.coalesce(activity_stats.c.view_count, 0).label("view_count"),
            activity_stats.c.last_viewed_at,
        )
        .join(Asset, ShareLink.asset_id == Asset.id)
        .outerjoin(activity_stats, ShareLink.id == activity_stats.c.share_link_id)
        .filter(
            Asset.project_id == project_id,
            ShareLink.deleted_at.is_(None),
            Asset.deleted_at.is_(None),
        )
    )

    # Folder share links
    folder_query = (
        db.query(
            ShareLink.id,
            ShareLink.token,
            ShareLink.title,
            ShareLink.description,
            ShareLink.is_enabled,
            ShareLink.permission,
            sqlalchemy.literal("folder").label("share_type"),
            Folder.name.label("target_name"),
            sa_func.coalesce(activity_stats.c.view_count, 0).label("view_count"),
            activity_stats.c.last_viewed_at,
        )
        .join(Folder, ShareLink.folder_id == Folder.id)
        .outerjoin(activity_stats, ShareLink.id == activity_stats.c.share_link_id)
        .filter(
            Folder.project_id == project_id,
            ShareLink.deleted_at.is_(None),
            Folder.deleted_at.is_(None),
        )
    )

    # Project root share links
    project_query = (
        db.query(
            ShareLink.id,
            ShareLink.token,
            ShareLink.title,
            ShareLink.description,
            ShareLink.is_enabled,
            ShareLink.permission,
            sqlalchemy.literal("folder").label("share_type"),
            ShareLink.title.label("target_name"),
            sa_func.coalesce(activity_stats.c.view_count, 0).label("view_count"),
            activity_stats.c.last_viewed_at,
        )
        .outerjoin(activity_stats, ShareLink.id == activity_stats.c.share_link_id)
        .filter(
            ShareLink.project_id == project_id,
            ShareLink.deleted_at.is_(None),
        )
    )

    if search:
        escaped = _escape_like(search)
        asset_query = asset_query.filter(ShareLink.title.ilike(f"%{escaped}%"))
        folder_query = folder_query.filter(ShareLink.title.ilike(f"%{escaped}%"))
        project_query = project_query.filter(ShareLink.title.ilike(f"%{escaped}%"))

    results = asset_query.union_all(folder_query).union_all(project_query).all()

    return [
        ShareLinkListItem(
            id=row.id,
            token=row.token,
            title=row.title,
            description=row.description,
            is_enabled=row.is_enabled,
            permission=row.permission,
            share_type=row.share_type,
            target_name=row.target_name,
            view_count=row.view_count,
            last_viewed_at=row.last_viewed_at,
        )
        for row in results
    ]


# ── Share link activity ───────────────────────────────────────────────────────

@router.get("/share/{token}/activity", response_model=list[ShareLinkActivityResponse])
def get_share_link_activity(
    token: str,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    link = _get_manageable_share_link(db, token, current_user)

    offset = (page - 1) * per_page
    activities = db.query(ShareLinkActivity).filter(
        ShareLinkActivity.share_link_id == link.id,
    ).order_by(ShareLinkActivity.created_at.desc()).offset(offset).limit(per_page).all()
    return activities


# ── Add asset to existing share link ──────────────────────────────────────────

@router.post("/share/{token}/add-asset/{asset_id}", status_code=status.HTTP_200_OK)
def add_asset_to_share_link(
    token: str,
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add an asset to an existing share link. Converts single-asset links to project-level."""
    link = _get_manageable_share_link(db, token, current_user)

    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Determine the share link's project
    link_project_id = _get_project_id_from_link(db, link)

    # Ensure the asset belongs to the same project
    if link_project_id and asset.project_id != link_project_id:
        raise HTTPException(status_code=403, detail="Asset does not belong to this share link's project")

    # Check if asset is already the direct target
    if link.asset_id == asset_id:
        return {"detail": "Asset already included in this share link"}

    # Check if asset is already in share_link_items
    existing_item = db.query(ShareLinkItem).filter(
        ShareLinkItem.share_link_id == link.id,
        ShareLinkItem.asset_id == asset_id,
    ).first()
    if existing_item:
        return {"detail": "Asset already included in this share link"}

    # If this is a single-asset share link, migrate to multi-item mode
    if link.asset_id and not link.project_id:
        old_asset_id = link.asset_id
        link.project_id = link_project_id
        link.asset_id = None
        db.flush()
        # Add the original asset as a ShareLinkItem
        db.add(ShareLinkItem(share_link_id=link.id, asset_id=old_asset_id))

    # If this is a folder-only share, migrate to multi-item mode
    if link.folder_id and not link.project_id:
        old_folder_id = link.folder_id
        link.project_id = link_project_id
        link.folder_id = None
        db.flush()
        # Add the original folder as a ShareLinkItem
        db.add(ShareLinkItem(share_link_id=link.id, folder_id=old_folder_id))

    # Set project_id if not yet set
    if not link.project_id:
        link.project_id = link_project_id or asset.project_id
        db.flush()

    # Add the new asset
    db.add(ShareLinkItem(share_link_id=link.id, asset_id=asset_id))
    db.commit()
    return {"detail": "Asset added to share link"}


@router.post("/projects/{project_id}/share/multi", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_multi_share_link(
    project_id: uuid.UUID,
    body: MultiShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a single share link containing multiple selected assets and/or folders."""
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_role(db, project_id, current_user, ProjectRole.editor)

    if not body.asset_ids and not body.folder_ids:
        raise HTTPException(status_code=400, detail="At least one asset or folder is required")

    # Validate all assets belong to this project
    for aid in body.asset_ids:
        asset = db.query(Asset).filter(Asset.id == aid, Asset.deleted_at.is_(None)).first()
        if not asset or asset.project_id != project_id:
            raise HTTPException(status_code=400, detail=f"Asset {aid} not found in this project")

    # Validate all folders belong to this project
    for fid in body.folder_ids:
        folder = db.query(Folder).filter(Folder.id == fid, Folder.deleted_at.is_(None)).first()
        if not folder or folder.project_id != project_id:
            raise HTTPException(status_code=400, detail=f"Folder {fid} not found in this project")

    # Determine title
    title = body.title
    if not title:
        count = len(body.asset_ids) + len(body.folder_ids)
        title = f"{count} items"

    token = secrets.token_urlsafe(32)
    password_hash = None
    if body.password:
        plain_bytes = body.password[:72].encode("utf-8")
        password_hash = bcrypt.hashpw(plain_bytes, bcrypt.gensalt()).decode("utf-8")

    link = ShareLink(
        project_id=project_id,
        token=token,
        title=title,
        description=None,
        is_enabled=True,
        permission=body.permission,
        visibility=body.visibility,
        allow_download=body.allow_download,
        show_versions=body.show_versions,
        show_watermark=body.show_watermark,
        password_hash=password_hash,
        password_encrypted=None,
        expires_at=body.expires_at,
        appearance=body.appearance.model_dump(),
        created_by=current_user.id,
    )
    db.add(link)
    db.flush()

    # Insert share_link_items
    for aid in body.asset_ids:
        db.add(ShareLinkItem(share_link_id=link.id, asset_id=aid))
    for fid in body.folder_ids:
        db.add(ShareLinkItem(share_link_id=link.id, folder_id=fid))

    db.commit()
    db.refresh(link)
    return _share_link_response(link)


def _validate_secure_approval_link(
    db: Session,
    token: str,
    share_session: str | None,
    current_user: User | None,
) -> tuple[ShareLink, User]:
    link = validate_share_link(db, token)
    if current_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    if link.visibility != ShareVisibility.secure or link.permission != SharePermission.approve:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approval link required")
    if link.password_hash and (
        share_session is None or not verify_share_session(token, share_session)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Valid share session required")
    return link, current_user


@router.post(
    "/share/{token}/assets/{asset_id}/approve",
    response_model=ApprovalResponse,
)
def approve_shared_asset(
    token: str,
    asset_id: uuid.UUID,
    body: ApprovalCreate,
    share_session: str | None = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
):
    link, actor = _validate_secure_approval_link(db, token, share_session, current_user)
    asset = _get_asset(db, asset_id)
    validate_asset_in_share(db, link, asset)
    approval = upsert_approval(
        db,
        asset,
        body.version_id,
        actor,
        ApprovalStatus.approved,
        body.note,
    )
    db.add(ActivityLog(user_id=actor.id, asset_id=asset.id, action=ActivityAction.approved))
    creator = None
    if asset.created_by != actor.id:
        db.add(Notification(user_id=asset.created_by, type=NotificationType.approval, asset_id=asset.id))
        creator = db.query(User).filter(User.id == asset.created_by, User.deleted_at.is_(None)).first()
    workspace_name = get_workspace_name(db)
    email_payload = None if creator is None else {
        "to_email": creator.email,
        "reviewer_name": actor.name,
        "asset_name": asset.name,
        "status": "approved",
        "asset_link": f"{settings.frontend_url}/share/{token}",
        "note": body.note,
        "workspace_name": workspace_name,
    }
    db.commit()
    if email_payload is not None:
        try:
            send_task_safe(send_approval_email, **email_payload)
        except RuntimeError:
            logger.warning("Failed to start approval email dispatch")
    return approval


@router.post(
    "/share/{token}/assets/{asset_id}/reject",
    response_model=ApprovalResponse,
)
def reject_shared_asset(
    token: str,
    asset_id: uuid.UUID,
    body: ApprovalCreate,
    share_session: str | None = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
):
    link, actor = _validate_secure_approval_link(db, token, share_session, current_user)
    asset = _get_asset(db, asset_id)
    validate_asset_in_share(db, link, asset)
    approval = upsert_approval(
        db,
        asset,
        body.version_id,
        actor,
        ApprovalStatus.rejected,
        body.note,
    )
    db.add(ActivityLog(user_id=actor.id, asset_id=asset.id, action=ActivityAction.rejected))
    creator = None
    if asset.created_by != actor.id:
        db.add(Notification(user_id=asset.created_by, type=NotificationType.approval, asset_id=asset.id))
        creator = db.query(User).filter(User.id == asset.created_by, User.deleted_at.is_(None)).first()
    workspace_name = get_workspace_name(db)
    email_payload = None if creator is None else {
        "to_email": creator.email,
        "reviewer_name": actor.name,
        "asset_name": asset.name,
        "status": "rejected",
        "asset_link": f"{settings.frontend_url}/share/{token}",
        "note": body.note,
        "workspace_name": workspace_name,
    }
    db.commit()
    if email_payload is not None:
        try:
            send_task_safe(send_approval_email, **email_payload)
        except RuntimeError:
            logger.warning("Failed to start approval email dispatch")
    return approval


@router.get(
    "/share/{token}/assets/{asset_id}/approvals",
    response_model=list[ApprovalResponse],
)
def list_shared_approvals(
    token: str,
    asset_id: uuid.UUID,
    version_id: uuid.UUID,
    share_session: str | None = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
):
    link, _actor = _validate_secure_approval_link(db, token, share_session, current_user)
    asset = _get_asset(db, asset_id)
    validate_asset_in_share(db, link, asset)
    get_active_version(db, asset, version_id)
    return (
        db.query(Approval)
        .filter(
            Approval.asset_id == asset.id,
            Approval.version_id == version_id,
            Approval.deleted_at.is_(None),
        )
        .all()
    )


# ── Folder share public endpoints ─────────────────────────────────────────────

@router.get("/share/{token}/assets", response_model=FolderShareAssetsResponse)
def get_folder_share_assets(
    token: str,
    folder_id: Optional[uuid.UUID] = None,
    page: int = 1,
    per_page: int = 50,
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public endpoint — no auth required. Returns assets and subfolders for a folder or project share link."""
    link = validate_share_link_with_session(
        db,
        token,
        share_session=share_session,
        current_user=current_user,
    )

    is_project_share = link.project_id is not None
    if not link.folder_id and not is_project_share:
        raise HTTPException(status_code=400, detail="This share link is not a folder or project share")

    # Check if this is a multi-share (project_id set with items in share_link_items)
    multi_share_items = db.query(ShareLinkItem).filter(ShareLinkItem.share_link_id == link.id).all() if is_project_share else []
    is_multi_share = len(multi_share_items) > 0

    # For multi-share links at the root level, return only the selected items
    if is_multi_share and not folder_id:
        multi_asset_ids = [item.asset_id for item in multi_share_items if item.asset_id]
        multi_folder_ids = [item.folder_id for item in multi_share_items if item.folder_id]

        # Get shared folders
        subfolder_items = []
        if multi_folder_ids:
            shared_folders = db.query(Folder).filter(
                Folder.id.in_(multi_folder_ids),
                Folder.deleted_at.is_(None),
            ).order_by(Folder.name).all()
            for sf in shared_folders:
                asset_count = db.query(sa_func.count(Asset.id)).filter(
                    Asset.folder_id == sf.id, Asset.deleted_at.is_(None),
                ).scalar() or 0
                child_folder_count = db.query(sa_func.count(Folder.id)).filter(
                    Folder.parent_id == sf.id, Folder.deleted_at.is_(None),
                ).scalar() or 0
                thumb_urls: list[str] = []
                preview_assets = db.query(Asset).filter(
                    Asset.folder_id == sf.id, Asset.deleted_at.is_(None),
                ).order_by(Asset.created_at.desc()).limit(4).all()
                for pa in preview_assets:
                    mf = _get_latest_media_file(db, pa.id)
                    if mf and mf.s3_key_thumbnail:
                        thumb_urls.append(generate_presigned_get_url(mf.s3_key_thumbnail))
                subfolder_items.append(FolderShareSubfolder(
                    id=sf.id, name=sf.name, item_count=asset_count + child_folder_count, thumbnail_urls=thumb_urls,
                ))

        # Get shared assets
        asset_items = []
        if multi_asset_ids:
            total = len(multi_asset_ids)
            offset = (page - 1) * per_page
            shared_assets = db.query(Asset).filter(
                Asset.id.in_(multi_asset_ids), Asset.deleted_at.is_(None),
            ).order_by(Asset.created_at.desc()).offset(offset).limit(per_page).all()
            for a in shared_assets:
                mf = _get_latest_media_file(db, a.id)
                thumbnail_url = generate_presigned_get_url(mf.s3_key_thumbnail) if mf and mf.s3_key_thumbnail else None
                comment_count = db.query(sa_func.count(Comment.id)).filter(
                    Comment.asset_id == a.id, Comment.deleted_at.is_(None),
                ).scalar() or 0
                asset_items.append(FolderShareAssetItem(
                    id=a.id, name=a.name, asset_type=a.asset_type.value if hasattr(a.asset_type, 'value') else str(a.asset_type),
                    thumbnail_url=thumbnail_url, created_at=a.created_at.isoformat() if a.created_at else "",
                    file_size_bytes=mf.file_size_bytes if mf else 0, comment_count=comment_count,
                ))
        else:
            total = 0

        return FolderShareAssetsResponse(
            subfolders=subfolder_items, assets=asset_items, total=total, page=page, per_page=per_page,
        )

    # Determine which folder to list contents from
    # For project shares, target_folder_id=None means project root
    target_folder_id = link.folder_id  # None for project root shares
    if folder_id:
        if is_project_share:
            # Project share: validate folder belongs to this project
            f = db.query(Folder).filter(Folder.id == folder_id, Folder.deleted_at.is_(None)).first()
            if not f or f.project_id != link.project_id:
                raise HTTPException(status_code=403, detail="Folder is not within the shared project")
        elif folder_id != link.folder_id and not _is_descendant_of(db, folder_id, link.folder_id):
            raise HTTPException(status_code=403, detail="Folder is not within the shared folder")
        target_folder_id = folder_id

    # Get subfolders
    if target_folder_id:
        subfolder_filter = Folder.parent_id == target_folder_id
    else:
        # Project root: folders with no parent in this project
        subfolder_filter = sqlalchemy.and_(
            Folder.parent_id.is_(None),
            Folder.project_id == link.project_id,
        )
    subfolders_query = db.query(Folder).filter(
        subfolder_filter,
        Folder.deleted_at.is_(None),
    ).order_by(Folder.name).all()

    subfolder_items = []
    for sf in subfolders_query:
        # Count assets + direct child folders in this subfolder
        asset_count = db.query(sa_func.count(Asset.id)).filter(
            Asset.folder_id == sf.id,
            Asset.deleted_at.is_(None),
        ).scalar() or 0
        child_folder_count = db.query(sa_func.count(Folder.id)).filter(
            Folder.parent_id == sf.id,
            Folder.deleted_at.is_(None),
        ).scalar() or 0

        # Fetch up to 4 thumbnail previews from assets inside this subfolder
        thumb_urls: list[str] = []
        preview_assets = db.query(Asset).filter(
            Asset.folder_id == sf.id,
            Asset.deleted_at.is_(None),
        ).order_by(Asset.created_at.desc()).limit(4).all()
        for pa in preview_assets:
            mf = _get_latest_media_file(db, pa.id)
            if mf and mf.s3_key_thumbnail:
                thumb_urls.append(generate_presigned_get_url(mf.s3_key_thumbnail))
            if len(thumb_urls) >= 4:
                break

        subfolder_items.append(FolderShareSubfolder(
            id=sf.id,
            name=sf.name,
            item_count=asset_count + child_folder_count,
            thumbnail_urls=thumb_urls,
        ))

    # Get assets in this folder (or project root if target_folder_id is None)
    if target_folder_id:
        asset_filter = Asset.folder_id == target_folder_id
    else:
        # Project root: assets with no folder in this project
        asset_filter = sqlalchemy.and_(
            Asset.folder_id.is_(None),
            Asset.project_id == link.project_id,
        )
    total = db.query(sa_func.count(Asset.id)).filter(
        asset_filter,
        Asset.deleted_at.is_(None),
    ).scalar() or 0

    offset = (page - 1) * per_page
    assets = db.query(Asset).filter(
        asset_filter,
        Asset.deleted_at.is_(None),
    ).order_by(Asset.created_at.desc()).offset(offset).limit(per_page).all()

    asset_items = []
    for asset in assets:
        thumbnail_url = None
        file_size = None
        duration_seconds = None
        media_file = _get_latest_media_file(db, asset.id)
        if media_file:
            if media_file.s3_key_thumbnail:
                thumbnail_url = generate_presigned_get_url(media_file.s3_key_thumbnail)
            file_size = media_file.file_size_bytes
            duration_seconds = media_file.duration_seconds

        comment_count = db.query(sa_func.count(Comment.id)).filter(
            Comment.asset_id == asset.id,
            Comment.deleted_at.is_(None),
        ).scalar() or 0

        # Get creator name
        creator = (
            db.query(User)
            .filter(User.id == asset.created_by, User.deleted_at.is_(None))
            .first()
            if asset.created_by
            else None
        )

        asset_items.append(FolderShareAssetItem(
            id=asset.id,
            name=asset.name,
            asset_type=asset.asset_type.value,
            thumbnail_url=thumbnail_url,
            file_size=file_size,
            duration_seconds=duration_seconds,
            comment_count=comment_count,
            created_by_name=creator.name if creator else None,
            created_at=asset.created_at,
        ))

    return FolderShareAssetsResponse(
        assets=asset_items,
        subfolders=subfolder_items,
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/share/{token}/versions/{asset_id}")
def list_share_versions(
    token: str,
    asset_id: uuid.UUID,
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    link = validate_share_link_with_session(
        db,
        token,
        share_session=share_session,
        current_user=current_user,
    )
    asset = _get_asset(db, asset_id)
    validate_asset_in_share(db, link, asset)

    versions = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset.id,
        AssetVersion.deleted_at.is_(None),
        AssetVersion.processing_status == ProcessingStatus.ready,
    ).order_by(AssetVersion.version_number.desc()).all()

    if not link.show_versions:
        versions = versions[:1]

    return [
        {
            "id": str(version.id),
            "asset_id": str(asset.id),
            "version_number": version.version_number,
            "processing_status": (
                version.processing_status.value
                if hasattr(version.processing_status, "value")
                else str(version.processing_status)
            ),
            "created_by": str(version.created_by),
            "created_at": version.created_at.isoformat() if version.created_at else None,
            "deleted_at": version.deleted_at.isoformat() if version.deleted_at else None,
        }
        for version in versions
    ]


@router.get("/share/{token}/stream/{asset_id}")
def get_share_stream_url(
    token: str,
    asset_id: uuid.UUID,
    share_session: Optional[str] = Query(None, alias="share_session"),
    version_id: Optional[uuid.UUID] = Query(None),
    download: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public endpoint — optional auth. Returns presigned stream URL for an asset in a share link."""
    link = validate_share_link_with_session(db, token, share_session=share_session, current_user=current_user)

    if download and not _can_download_from_share(db, link, current_user):
        raise HTTPException(status_code=403, detail="Downloads are not allowed for this share link")

    asset = _get_asset(db, asset_id)

    # Validate asset belongs to this share
    validate_asset_in_share(db, link, asset)

    media_file = None
    if version_id and link.show_versions:
        version = db.query(AssetVersion).filter(
            AssetVersion.id == version_id,
            AssetVersion.asset_id == asset.id,
            AssetVersion.deleted_at.is_(None),
            AssetVersion.processing_status == ProcessingStatus.ready,
        ).first()
        if version:
            media_file = db.query(MediaFile).filter(MediaFile.version_id == version.id).first()

    if not media_file:
        media_file = _get_latest_media_file(db, asset.id)
    if not media_file:
        raise HTTPException(status_code=404, detail="No ready media file found")

    if asset.asset_type == AssetType.video and media_file.s3_key_processed:
        if download:
            s3_key = media_file.s3_key_raw or media_file.s3_key_processed
            filename = build_download_filename(asset.name, media_file.original_filename or s3_key)
            url = generate_presigned_get_url(s3_key, download_filename=filename)
        else:
            # Route through /stream/hls so S3 can stay private (#51)
            hls_token = create_hls_token(
                media_file.s3_key_processed,
                asset_id=asset.id,
                version_id=media_file.version_id,
                user_id=current_user.id if current_user else None,
                share_token=token,
                share_session=share_session,
            )
            url = f"/stream/hls/master.m3u8?token={hls_token}"
    else:
        s3_key = media_file.s3_key_processed or media_file.s3_key_raw
        if download:
            filename = build_download_filename(asset.name, media_file.original_filename or s3_key)
            url = generate_presigned_get_url(s3_key, download_filename=filename)
        else:
            url = generate_presigned_get_url(s3_key)

    # Log activity
    activity_action = ShareActivityAction.downloaded if download else ShareActivityAction.viewed_asset
    _log_share_activity(
        db, link.id, activity_action,
        actor_email=current_user.email if current_user else "anonymous",
        actor_name=current_user.name if current_user else None,
        asset_id=asset.id,
        asset_name=asset.name,
    )

    # Get thumbnail URL
    thumb_url = None
    if media_file.s3_key_thumbnail:
        thumb_url = generate_presigned_get_url(media_file.s3_key_thumbnail)

    return {
        "url": url,
        "asset_type": asset.asset_type.value,
        "name": asset.name,
        "version_id": str(media_file.version_id) if media_file.version_id else None,
        "thumbnail_url": thumb_url,
        "duration_seconds": media_file.duration_seconds,
    }


@router.get("/share/{token}/thumbnail/{asset_id}")
def get_share_thumbnail_url(
    token: str,
    asset_id: uuid.UUID,
    share_session: Optional[str] = Query(None, alias="share_session"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Public endpoint — no auth required. Returns presigned thumbnail URL for an asset in a share link."""
    link = validate_share_link_with_session(db, token, share_session=share_session, current_user=current_user)

    asset = _get_asset(db, asset_id)

    # Validate asset belongs to this share
    validate_asset_in_share(db, link, asset)

    media_file = _get_latest_media_file(db, asset.id)
    if not media_file or not media_file.s3_key_thumbnail:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    url = generate_presigned_get_url(media_file.s3_key_thumbnail)
    return {"url": url}

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models.user import User
from ..models.project import Project, ProjectMember, ProjectRole
from ..models.asset import Asset, AssetVersion, ProcessingStatus
from ..models.folder import Folder
from ..models.share import ShareLink
from ..services.redis_service import verify_share_session


# ── Project-level ──────────────────────────────────────────────────────────────


def get_project(db: Session, project_id: uuid.UUID) -> Project | None:
    return db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()


def _find_project_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember | None:
    return db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id,
        ProjectMember.deleted_at.is_(None),
    ).first()


def get_project_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember | None:
    if get_project(db, project_id) is None:
        return None
    return _find_project_member(db, project_id, user_id)


def require_project_role(
    db: Session,
    project_id: uuid.UUID,
    user: User,
    minimum_role: ProjectRole,
) -> ProjectMember:
    """Require the user to have at least `minimum_role` on the project.

    owner > editor. Editor is the lowest role, so `ProjectRole.editor` means
    "any project member". Superadmins pass as owner.
    """
    ROLE_RANK = {
        ProjectRole.owner: 2,
        ProjectRole.editor: 1,
    }
    member = get_project_member(db, project_id, user.id)
    if user.is_superadmin:
        if member is not None:
            return member
        return ProjectMember(
            project_id=project_id,
            user_id=user.id,
            role=ProjectRole.owner,
        )
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a project member")
    if ROLE_RANK[member.role] < ROLE_RANK[minimum_role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires {minimum_role.value} role or higher",
        )
    return member


# ── Asset-level ────────────────────────────────────────────────────────────────


def can_access_asset(db: Session, asset: Asset, user: User) -> bool:
    """Project members (owner or editor) and superadmins can read, comment on
    and approve every asset in the project; nobody else can."""
    if asset.deleted_at is not None or get_project(db, asset.project_id) is None:
        return False
    return user.is_superadmin or _find_project_member(db, asset.project_id, user.id) is not None


def require_asset_access(db: Session, asset: Asset, user: User) -> None:
    if not can_access_asset(db, asset, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def get_share_link_project_id(db: Session, link: ShareLink) -> uuid.UUID:
    if link.asset_id is not None:
        project_id = db.query(Asset.project_id).filter(Asset.id == link.asset_id, Asset.deleted_at.is_(None)).scalar()
    elif link.folder_id is not None:
        project_id = db.query(Folder.project_id).filter(Folder.id == link.folder_id, Folder.deleted_at.is_(None)).scalar()
    else:
        raise HTTPException(status_code=400, detail="Invalid share link")
    if project_id is None or get_project(db, project_id) is None:
        raise HTTPException(status_code=404, detail="Share target not found")
    return project_id


def _is_descendant_of(db: Session, folder_id: uuid.UUID, ancestor_id: uuid.UUID) -> bool:
    current_id = folder_id
    visited: set[uuid.UUID] = set()
    ancestor_observed = False
    while current_id:
        if current_id in visited:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Folder hierarchy contains a cycle",
            )
        if current_id == ancestor_id:
            ancestor_observed = True
        visited.add(current_id)
        folder = db.query(Folder.parent_id).filter(
            Folder.id == current_id,
            Folder.deleted_at.is_(None),
        ).first()
        current_id = folder.parent_id if folder else None
    return ancestor_observed


def validate_asset_in_share(db: Session, link: ShareLink, asset: Asset) -> None:
    if get_project(db, asset.project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")

    if link.folder_id:
        folder = db.query(Folder).filter(
            Folder.id == link.folder_id,
            Folder.deleted_at.is_(None),
            Folder.project_id == asset.project_id,
        ).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Shared folder not found")
        if asset.folder_id != link.folder_id:
            if not asset.folder_id or not _is_descendant_of(
                db,
                asset.folder_id,
                link.folder_id,
            ):
                raise HTTPException(status_code=403, detail="Asset is not within the shared folder")
    elif link.asset_id:
        if asset.id != link.asset_id:
            raise HTTPException(status_code=403, detail="Asset does not match share link")
    else:
        raise HTTPException(status_code=400, detail="Invalid share link")


def resolve_share_version(
    db: Session,
    link: ShareLink,
    asset: Asset,
    version_id: uuid.UUID | None,
) -> AssetVersion:
    """The version a share viewer may act on: the requested one, else the newest
    ready one. With show_versions off, only the newest ready version is visible."""
    latest = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset.id,
        AssetVersion.deleted_at.is_(None),
        AssetVersion.processing_status == ProcessingStatus.ready,
    ).order_by(AssetVersion.version_number.desc()).first()
    if version_id is None or not link.show_versions:
        if latest is None or (version_id is not None and latest.id != version_id):
            raise HTTPException(status_code=404, detail="Asset version not found")
        return latest
    version = db.query(AssetVersion).filter(
        AssetVersion.id == version_id,
        AssetVersion.asset_id == asset.id,
        AssetVersion.deleted_at.is_(None),
        AssetVersion.processing_status == ProcessingStatus.ready,
    ).first()
    if version is None:
        raise HTTPException(status_code=404, detail="Asset version not found")
    return version


# ── Share link validation ──────────────────────────────────────────────────────

def validate_share_link(db: Session, token: str) -> ShareLink:
    """Validate a share link token and return the link. Raises 404/410 on failure."""
    from datetime import datetime, timezone
    link = db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.deleted_at.is_(None),
    ).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    if not link.is_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Share link is disabled")
    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link has expired")
    if link.folder_id:
        folder = db.query(Folder).filter(
            Folder.id == link.folder_id,
            Folder.deleted_at.is_(None),
        ).first()
        if not folder or get_project(db, folder.project_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    if link.asset_id:
        asset = db.query(Asset).filter(
            Asset.id == link.asset_id,
            Asset.deleted_at.is_(None),
        ).first()
        if not asset or get_project(db, asset.project_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return link


def validate_share_link_with_session(
    db: Session,
    token: str,
    share_session: "str | None" = None,
    current_user: "User | None" = None,
) -> ShareLink:
    """Validate a share link and verify password session if link is password-protected.
    Skips password check if the caller is the authenticated link creator."""
    link = validate_share_link(db, token)
    if link.visibility == "secure" and not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    if link.password_hash:
        # Skip password for the authenticated link creator previewing their own link
        if current_user and link.created_by == current_user.id:
            return link
        if not share_session or not verify_share_session(token, share_session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password required",
            )
    return link

from dataclasses import dataclass
from typing import assert_never
import uuid

from fastapi import HTTPException, status
from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session, aliased

from ..models.user import User
from ..models.project import Project, ProjectMember, ProjectRole
from ..models.asset import Asset
from ..models.folder import Folder
from ..models.share import AssetShare, ShareLink, ShareLinkItem, SharePermission
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

    Role hierarchy (descending): owner > editor > reviewer > viewer
    """
    ROLE_RANK = {
        ProjectRole.owner: 4,
        ProjectRole.editor: 3,
        ProjectRole.reviewer: 2,
        ProjectRole.viewer: 1,
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


@dataclass(frozen=True, slots=True)
class AssetAccess:
    can_read: bool
    can_comment: bool
    can_approve: bool
    is_project_member: bool
    direct_permission: SharePermission | None


def is_public_project(db: Session, project_id: uuid.UUID) -> bool:
    project = get_project(db, project_id)
    return project is not None and project.is_public


def _get_direct_permission(db: Session, asset: Asset, user_id: uuid.UUID) -> SharePermission | None:
    shared_scope = AssetShare.asset_id == asset.id
    if asset.folder_id is not None:
        ancestors = select(Folder.id, Folder.parent_id).where(
            Folder.id == asset.folder_id,
            Folder.project_id == asset.project_id,
            Folder.deleted_at.is_(None),
        ).cte("asset_folder_ancestors", recursive=True)
        parent = aliased(Folder)
        ancestors = ancestors.union(
            select(parent.id, parent.parent_id)
            .join(ancestors, parent.id == ancestors.c.parent_id)
            .where(parent.project_id == asset.project_id, parent.deleted_at.is_(None))
        )
        shared_scope = or_(shared_scope, AssetShare.folder_id.in_(select(ancestors.c.id)))
    share = db.query(AssetShare).filter(
        shared_scope, AssetShare.shared_with_user_id == user_id, AssetShare.deleted_at.is_(None),
    ).order_by(
        case(
            (AssetShare.permission == SharePermission.approve, 3),
            (AssetShare.permission == SharePermission.comment, 2),
            else_=1,
        ).desc()
    ).first()
    return share.permission if share is not None else None


def get_asset_access(db: Session, asset: Asset, user: User) -> AssetAccess:
    if asset.deleted_at is not None:
        return AssetAccess(False, False, False, False, None)
    project = get_project(db, asset.project_id)
    if project is None:
        return AssetAccess(False, False, False, False, None)
    if user.is_superadmin:
        return AssetAccess(
            can_read=True,
            can_comment=True,
            can_approve=True,
            is_project_member=True,
            direct_permission=None,
        )
    member = _find_project_member(db, asset.project_id, user.id)
    direct_permission = _get_direct_permission(db, asset, user.id)
    member_can_comment = False
    member_can_approve = False
    if member is not None:
        match member.role:
            case ProjectRole.owner | ProjectRole.editor | ProjectRole.reviewer:
                member_can_comment = True
                member_can_approve = True
            case ProjectRole.viewer:
                pass
            case unreachable:
                assert_never(unreachable)
    direct_can_comment = False
    direct_can_approve = False
    match direct_permission:
        case SharePermission.approve:
            direct_can_comment = True
            direct_can_approve = True
        case SharePermission.comment:
            direct_can_comment = True
        case SharePermission.view | None:
            pass
        case unreachable:
            assert_never(unreachable)
    is_project_member = member is not None
    is_assignee = asset.assignee_id == user.id
    can_read = is_project_member or direct_permission is not None or project.is_public or is_assignee
    return AssetAccess(
        can_read=can_read,
        can_comment=member_can_comment or direct_can_comment or is_assignee,
        can_approve=member_can_approve or direct_can_approve or is_assignee,
        is_project_member=is_project_member,
        direct_permission=direct_permission,
    )


def can_access_asset(db: Session, asset: Asset, user: User) -> bool:
    return get_asset_access(db, asset, user).can_read


def require_asset_access(db: Session, asset: Asset, user: User) -> None:
    if not get_asset_access(db, asset, user).can_read:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def get_share_link_project_id(db: Session, link: ShareLink) -> uuid.UUID:
    if link.project_id is None and link.asset_id is None and link.folder_id is None:
        raise HTTPException(status_code=400, detail="Invalid share link")
    project_id = link.project_id
    if link.asset_id is not None:
        project_id = db.query(Asset.project_id).filter(Asset.id == link.asset_id, Asset.deleted_at.is_(None)).scalar()
    elif link.folder_id is not None:
        project_id = db.query(Folder.project_id).filter(Folder.id == link.folder_id, Folder.deleted_at.is_(None)).scalar()
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
    elif link.project_id:
        if asset.project_id != link.project_id:
            raise HTTPException(status_code=403, detail="Asset is not within the shared project")
        if get_project(db, link.project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found")
        multi_items = db.query(ShareLinkItem).filter(ShareLinkItem.share_link_id == link.id).all()
        if multi_items:
            multi_asset_ids = {item.asset_id for item in multi_items if item.asset_id}
            multi_folder_ids = {item.folder_id for item in multi_items if item.folder_id}
            if asset.id not in multi_asset_ids:
                in_shared_folder = any(
                    asset.folder_id == folder_id
                    or (
                        asset.folder_id
                        and _is_descendant_of(db, asset.folder_id, folder_id)
                    )
                    for folder_id in multi_folder_ids
                )
                if not in_shared_folder:
                    raise HTTPException(status_code=403, detail="Asset is not in the shared items")
    else:
        raise HTTPException(status_code=400, detail="Invalid share link")


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
    if link.project_id:
        if get_project(db, link.project_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
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
        # Skip password for authenticated link creator (e.g. admin settings preview)
        if current_user and link.created_by == current_user.id:
            return link
        if not share_session or not verify_share_session(token, share_session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password required",
            )
    return link

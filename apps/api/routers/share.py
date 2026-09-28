import secrets
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional
import bcrypt

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
import sqlalchemy
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user, get_optional_user
from ..middleware.rate_limit import rate_limit
from ..models.user import User
from ..models.asset import Asset
from ..models.folder import Folder
from ..models.share import ShareLink, SharePermission, ShareVisibility
from ..models.asset import AssetVersion, AssetType, MediaFile, ProcessingStatus
from ..models.comment import Comment
from ..schemas.share import (
    FolderShareAssetItem,
    FolderShareAssetsResponse,
    FolderShareSubfolder,
    ShareLinkCreate,
    ShareLinkListItem,
    ShareLinkResponse,
    ShareLinkUpdate,
    ShareLinkValidateResponse,
)
from ..services.permissions import (
    _is_descendant_of as _is_active_descendant_of,
    can_access_asset,
    get_project_member,
    get_share_link_project_id,
    require_project_role,
    validate_asset_in_share,
    validate_share_link,
    validate_share_link_with_session,
)
from ..services.redis_service import create_share_session
from ..services.s3_service import generate_presigned_get_url, build_download_filename
from .hls_proxy import create_hls_token
from ..models.project import Project, ProjectMember, ProjectRole

router = APIRouter(tags=["sharing"])
logger = logging.getLogger(__name__)


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


def _get_manageable_share_link(db: Session, token: str, user: User) -> ShareLink:
    managed_project_ids = (
        sqlalchemy.select(ProjectMember.project_id)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(
            ProjectMember.user_id == user.id,
            ProjectMember.deleted_at.is_(None),
            Project.deleted_at.is_(None),
        )
    )
    if user.is_superadmin:
        managed_project_ids = sqlalchemy.select(Project.id).where(Project.deleted_at.is_(None))
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
    project_id = get_share_link_project_id(db, link)
    return get_project_member(db, project_id, user.id) is not None


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


def _latest_media_files_bulk(
    db: Session,
    asset_ids: list[uuid.UUID],
) -> dict[uuid.UUID, MediaFile]:
    """Get each asset's latest ready version's first media file in bulk."""
    if not asset_ids:
        return {}
    latest = (
        db.query(AssetVersion)
        .filter(
            AssetVersion.asset_id.in_(asset_ids),
            AssetVersion.deleted_at.is_(None),
            AssetVersion.processing_status == ProcessingStatus.ready,
        )
        .order_by(AssetVersion.asset_id, AssetVersion.version_number.desc())
        .all()
    )
    latest_by_asset: dict[uuid.UUID, AssetVersion] = {}
    for version in latest:
        latest_by_asset.setdefault(version.asset_id, version)
    version_ids = [version.id for version in latest_by_asset.values()]
    if not version_ids:
        return {}
    files = db.query(MediaFile).filter(MediaFile.version_id.in_(version_ids)).all()
    files_by_version: dict[uuid.UUID, MediaFile] = {}
    for media_file in files:
        files_by_version.setdefault(media_file.version_id, media_file)
    return {
        asset_id: files_by_version[version.id]
        for asset_id, version in latest_by_asset.items()
        if version.id in files_by_version
    }


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


def _internal_url_for_viewer(db: Session, link: ShareLink, user: Optional[User]) -> Optional[str]:
    """Editor-viewport URL when the logged-in viewer already has internal access.

    Never raises — any resolution failure means "no redirect", guest flow wins.
    """
    if user is None:
        return None
    try:
        if link.asset_id is not None:
            asset = db.query(Asset).filter(Asset.id == link.asset_id, Asset.deleted_at.is_(None)).first()
            if asset is not None and can_access_asset(db, asset, user):
                return f"/projects/{asset.project_id}/assets/{asset.id}"
            return None
        project_id = get_share_link_project_id(db, link)
        if user.is_superadmin or get_project_member(db, project_id, user.id) is not None:
            return f"/projects/{project_id}"
    except HTTPException:
        return None
    return None


@router.get("/share/{token}", response_model=ShareLinkValidateResponse, dependencies=[Depends(rate_limit("share_validate", 30, 60))])
def validate_share_link_endpoint(
    token: str,
    # A header, not a query param, so the password stays out of access logs
    password: Optional[str] = Header(None, alias="X-Share-Password"),
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
    if link.folder_id:
        folder = db.query(Folder).filter(Folder.id == link.folder_id, Folder.deleted_at.is_(None)).first()
        if folder:
            folder_name = folder.name

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

    # Build asset details for asset shares
    asset_data = None
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

    # Resolve creator name
    creator = db.query(User).filter(User.id == link.created_by, User.deleted_at.is_(None)).first()
    created_by_name = creator.name if creator else None

    return ShareLinkValidateResponse(
        asset_id=link.asset_id,
        folder_id=link.folder_id,
        folder_name=folder_name,
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
        share_session=session_id,
        internal_url=_internal_url_for_viewer(db, link, current_user),
    )


def _share_link_response(link: ShareLink) -> ShareLinkResponse:
    response = ShareLinkResponse.model_validate(link)
    response.has_password = link.password_hash is not None and link.password_hash != ''
    return response


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
        else:
            link.password_hash = None

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


# ── All share links in a project (asset + folder) ────────────────────────────

@router.get("/projects/{project_id}/share-links", response_model=list[ShareLinkListItem])
def list_project_share_links(
    project_id: uuid.UUID,
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)

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
        )
        .join(Asset, ShareLink.asset_id == Asset.id)
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
        )
        .join(Folder, ShareLink.folder_id == Folder.id)
        .filter(
            Folder.project_id == project_id,
            ShareLink.deleted_at.is_(None),
            Folder.deleted_at.is_(None),
        )
    )

    if search:
        escaped = _escape_like(search)
        asset_query = asset_query.filter(ShareLink.title.ilike(f"%{escaped}%"))
        folder_query = folder_query.filter(ShareLink.title.ilike(f"%{escaped}%"))

    results = asset_query.union_all(folder_query).all()

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
        )
        for row in results
    ]


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
    """Public endpoint — no auth required. Returns assets and subfolders for a folder share link."""
    link = validate_share_link_with_session(
        db,
        token,
        share_session=share_session,
        current_user=current_user,
    )

    if not link.folder_id:
        raise HTTPException(status_code=400, detail="This share link is not a folder share")

    target_folder_id = link.folder_id
    if folder_id:
        if folder_id != link.folder_id and not _is_active_descendant_of(db, folder_id, link.folder_id):
            raise HTTPException(status_code=403, detail="Folder is not within the shared folder")
        target_folder_id = folder_id

    # Get subfolders
    subfolders_query = db.query(Folder).filter(
        Folder.parent_id == target_folder_id,
        Folder.deleted_at.is_(None),
    ).order_by(Folder.name).all()

    sf_ids = [sf.id for sf in subfolders_query]
    subfolder_asset_counts = dict(
        db.query(Asset.folder_id, sa_func.count(Asset.id))
        .filter(
            Asset.folder_id.in_(sf_ids),
            Asset.deleted_at.is_(None),
        )
        .group_by(Asset.folder_id)
        .all()
    ) if sf_ids else {}
    child_folder_counts = dict(
        db.query(Folder.parent_id, sa_func.count(Folder.id))
        .filter(
            Folder.parent_id.in_(sf_ids),
            Folder.deleted_at.is_(None),
        )
        .group_by(Folder.parent_id)
        .all()
    ) if sf_ids else {}
    preview_asset_ids_by_folder: dict[uuid.UUID, list[uuid.UUID]] = {}
    if sf_ids:
        ranked_preview_assets = (
            db.query(
                Asset.id.label("asset_id"),
                Asset.folder_id.label("folder_id"),
                sa_func.row_number().over(
                    partition_by=Asset.folder_id,
                    order_by=Asset.created_at.desc(),
                ).label("preview_rank"),
            )
            .filter(
                Asset.folder_id.in_(sf_ids),
                Asset.deleted_at.is_(None),
            )
            .subquery()
        )
        preview_asset_rows = (
            db.query(
                ranked_preview_assets.c.asset_id,
                ranked_preview_assets.c.folder_id,
            )
            .filter(ranked_preview_assets.c.preview_rank <= 4)
            .order_by(
                ranked_preview_assets.c.folder_id,
                ranked_preview_assets.c.preview_rank,
            )
            .all()
        )
        for preview_asset_id, preview_folder_id in preview_asset_rows:
            preview_asset_ids_by_folder.setdefault(preview_folder_id, []).append(
                preview_asset_id
            )
    preview_asset_ids = [
        preview_asset_id
        for folder_asset_ids in preview_asset_ids_by_folder.values()
        for preview_asset_id in folder_asset_ids
    ]
    preview_media_files = _latest_media_files_bulk(db, preview_asset_ids)

    subfolder_items = []
    for sf in subfolders_query:
        thumb_urls = [
            generate_presigned_get_url(media_file.s3_key_thumbnail)
            for preview_asset_id in preview_asset_ids_by_folder.get(sf.id, [])
            if (media_file := preview_media_files.get(preview_asset_id))
            and media_file.s3_key_thumbnail
        ]

        subfolder_items.append(FolderShareSubfolder(
            id=sf.id,
            name=sf.name,
            item_count=(
                subfolder_asset_counts.get(sf.id, 0)
                + child_folder_counts.get(sf.id, 0)
            ),
            thumbnail_urls=thumb_urls,
        ))

    # Get assets in this folder
    asset_filter = Asset.folder_id == target_folder_id
    total = db.query(sa_func.count(Asset.id)).filter(
        asset_filter,
        Asset.deleted_at.is_(None),
    ).scalar() or 0

    offset = (page - 1) * per_page
    assets = db.query(Asset).filter(
        asset_filter,
        Asset.deleted_at.is_(None),
    ).order_by(Asset.created_at.desc()).offset(offset).limit(per_page).all()

    asset_ids = [asset.id for asset in assets]
    asset_media_files = _latest_media_files_bulk(db, asset_ids)
    comment_counts = dict(
        db.query(Comment.asset_id, sa_func.count(Comment.id))
        .filter(
            Comment.asset_id.in_(asset_ids),
            Comment.deleted_at.is_(None),
        )
        .group_by(Comment.asset_id)
        .all()
    ) if asset_ids else {}
    creator_ids = {asset.created_by for asset in assets if asset.created_by}
    creators = {
        creator.id: creator
        for creator in db.query(User).filter(
            User.id.in_(creator_ids),
            User.deleted_at.is_(None),
        ).all()
    } if creator_ids else {}

    asset_items = []
    for asset in assets:
        thumbnail_url = None
        file_size = None
        duration_seconds = None
        media_file = asset_media_files.get(asset.id)
        if media_file:
            if media_file.s3_key_thumbnail:
                thumbnail_url = generate_presigned_get_url(media_file.s3_key_thumbnail)
            file_size = media_file.file_size_bytes
            duration_seconds = media_file.duration_seconds

        creator = creators.get(asset.created_by)

        asset_items.append(FolderShareAssetItem(
            id=asset.id,
            name=asset.name,
            asset_type=asset.asset_type.value,
            thumbnail_url=thumbnail_url,
            file_size=file_size,
            duration_seconds=duration_seconds,
            comment_count=comment_counts.get(asset.id, 0),
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

    if download:
        # Always the original upload — processed copies are lossy
        s3_key = media_file.s3_key_raw or media_file.s3_key_processed
        filename = build_download_filename(asset.name, media_file.original_filename or s3_key)
        url = generate_presigned_get_url(s3_key, download_filename=filename)
    elif asset.asset_type == AssetType.video and media_file.s3_key_processed:
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
        url = generate_presigned_get_url(media_file.s3_key_processed or media_file.s3_key_raw)

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

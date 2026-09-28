from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
import os
import uuid
from datetime import datetime, timezone
from typing import Optional
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.asset import Asset, AssetVersion, MediaFile, AssetType, FileType, ProcessingStatus
from ..models.project import ProjectRole
from ..schemas.asset import AssetResponse, AssetVersionResponse, AssetUpdate, StreamUrlResponse, MediaFileResponse
from ..services.permissions import require_project_role, require_asset_access
from ..services.s3_service import generate_presigned_get_url, build_download_filename
from .hls_proxy import create_hls_token
from ..schemas.upload import InitiateUploadRequest, InitiateUploadResponse, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, mime_to_asset_type
from ..services.s3_service import create_multipart_upload

router = APIRouter(tags=["assets"])


def _build_asset_response(asset: Asset, db: Session) -> AssetResponse:
    """Build AssetResponse with latest version and its files."""
    return _build_asset_responses_bulk([asset], db)[0]


def _build_asset_responses_bulk(assets: list[Asset], db: Session) -> list[AssetResponse]:
    """Build AssetResponses with bulk-loaded versions and files (no N+1).

    `latest_version` is the newest version (its status drives upload/processing
    UI); the thumbnail comes from the newest READY version, so a card keeps its
    image while a new version uploads or after one fails.
    """
    if not assets:
        return []

    versions = (
        db.query(AssetVersion)
        .filter(AssetVersion.asset_id.in_([a.id for a in assets]), AssetVersion.deleted_at.is_(None))
        .order_by(AssetVersion.asset_id, AssetVersion.version_number.desc())
        .all()
    )
    latest_by_asset: dict = {}
    ready_by_asset: dict = {}
    for v in versions:
        latest_by_asset.setdefault(v.asset_id, v)
        if v.processing_status == ProcessingStatus.ready:
            ready_by_asset.setdefault(v.asset_id, v)

    version_ids = {v.id for v in latest_by_asset.values()} | {v.id for v in ready_by_asset.values()}
    all_files = db.query(MediaFile).filter(MediaFile.version_id.in_(version_ids)).all() if version_ids else []
    files_by_version: dict = {}
    for f in all_files:
        files_by_version.setdefault(f.version_id, []).append(f)

    result = []
    for asset in assets:
        version_response = None
        thumbnail_url = None
        latest = latest_by_asset.get(asset.id)
        if latest:
            version_response = AssetVersionResponse.model_validate(latest)
            version_response.files = [MediaFileResponse.model_validate(f) for f in files_by_version.get(latest.id, [])]
        ready = ready_by_asset.get(asset.id)
        if ready:
            thumb_key = next((f.s3_key_thumbnail for f in files_by_version.get(ready.id, []) if f.s3_key_thumbnail), None)
            if thumb_key:
                thumbnail_url = generate_presigned_get_url(thumb_key)

        asset_resp = AssetResponse.model_validate(asset)
        asset_resp.latest_version = version_response
        asset_resp.thumbnail_url = thumbnail_url
        result.append(asset_resp)
    return result


@router.get("/projects/{project_id}/assets", response_model=list[AssetResponse])
def list_assets(
    project_id: uuid.UUID,
    include_failed: bool = Query(False, description="Include assets whose latest version failed processing"),
    folder_id: Optional[str] = Query(None, description="Filter by folder. 'root' for root level, UUID for specific folder."),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_project_role(db, project_id, current_user, ProjectRole.editor)

    query = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.deleted_at.is_(None),
    )
    if folder_id == "root":
        query = query.filter(Asset.folder_id.is_(None))
    elif folder_id is not None:
        try:
            folder_uuid = uuid.UUID(folder_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid folder_id")
        query = query.filter(Asset.folder_id == folder_uuid)

    assets = query.all()

    if not include_failed:
        # Exclude assets where the only version is failed or still uploading
        asset_ids = [a.id for a in assets]
        if asset_ids:
            # Find assets that have at least one non-failed, non-uploading version
            usable = set(
                row[0] for row in db.query(AssetVersion.asset_id).filter(
                    AssetVersion.asset_id.in_(asset_ids),
                    AssetVersion.deleted_at.is_(None),
                    AssetVersion.processing_status.notin_([ProcessingStatus.failed, ProcessingStatus.uploading]),
                ).distinct().all()
            )
            # Also include assets with no versions yet (just created)
            has_any_version = set(
                row[0] for row in db.query(AssetVersion.asset_id).filter(
                    AssetVersion.asset_id.in_(asset_ids),
                    AssetVersion.deleted_at.is_(None),
                ).distinct().all()
            )
            assets = [a for a in assets if a.id in usable or a.id not in has_any_version]

    return _build_asset_responses_bulk(assets, db)


@router.get("/assets/{asset_id}", response_model=AssetResponse)
def get_asset(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_asset_access(db, asset, current_user)
    return _build_asset_response(asset, db)


@router.patch("/assets/{asset_id}", response_model=AssetResponse)
def update_asset(
    asset_id: uuid.UUID,
    body: AssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    db.commit()
    db.refresh(asset)
    return _build_asset_response(asset, db)


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)
    asset.deleted_at = datetime.now(timezone.utc)
    db.commit()


@router.get("/assets/{asset_id}/versions", response_model=list[AssetVersionResponse])
def list_asset_versions(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_asset_access(db, asset, current_user)

    versions = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset_id,
        AssetVersion.deleted_at.is_(None),
    ).order_by(AssetVersion.version_number.desc()).all()

    result = []
    version_ids = [v.id for v in versions]
    all_files = db.query(MediaFile).filter(MediaFile.version_id.in_(version_ids)).all() if version_ids else []
    files_by_version: dict = {}
    for f in all_files:
        files_by_version.setdefault(f.version_id, []).append(f)

    for v in versions:
        vr = AssetVersionResponse.model_validate(v)
        vr.files = [MediaFileResponse.model_validate(f) for f in files_by_version.get(v.id, [])]
        result.append(vr)
    return result


@router.get("/assets/{asset_id}/stream", response_model=StreamUrlResponse)
def get_stream_url(
    asset_id: uuid.UUID,
    version_id: Optional[uuid.UUID] = Query(default=None),
    download: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.deleted_at.is_(None)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_asset_access(db, asset, current_user)

    # The requested version, else the newest READY one (a newer version may
    # still be uploading/processing)
    if version_id:
        version = db.query(AssetVersion).filter(
            AssetVersion.id == version_id,
            AssetVersion.asset_id == asset_id,
            AssetVersion.deleted_at.is_(None),
        ).first()
    else:
        version = db.query(AssetVersion).filter(
            AssetVersion.asset_id == asset_id,
            AssetVersion.deleted_at.is_(None),
            AssetVersion.processing_status == ProcessingStatus.ready,
        ).order_by(AssetVersion.version_number.desc()).first()

    if not version:
        raise HTTPException(status_code=404, detail="No version found")
    if version.processing_status != ProcessingStatus.ready:
        raise HTTPException(status_code=409, detail="Asset version is not ready yet")

    media_file = db.query(MediaFile).filter(MediaFile.version_id == version.id).first()
    if not media_file:
        raise HTTPException(status_code=404, detail="Media file not found")

    if download:
        # Always the original upload — processed copies are lossy (HLS, WebP,
        # loudness-normalized MP3)
        s3_key = media_file.s3_key_raw or media_file.s3_key_processed
        filename = build_download_filename(asset.name, media_file.original_filename or s3_key)
        url = generate_presigned_get_url(s3_key, download_filename=filename)
    elif asset.asset_type == AssetType.video and media_file.s3_key_processed:
        # Route through the HLS proxy so the master playlist, variant
        # playlists, and .ts segments all get served via short-lived
        # presigned URLs — the S3 bucket can stay fully private. (#51)
        token = create_hls_token(
            media_file.s3_key_processed,
            asset_id=asset.id,
            version_id=version.id,
            user_id=current_user.id,
        )
        url = f"/stream/hls/master.m3u8?token={token}"
    else:
        url = generate_presigned_get_url(media_file.s3_key_processed or media_file.s3_key_raw)

    return StreamUrlResponse(url=url, asset_type=asset.asset_type)


@router.post("/assets/{asset_id}/versions", response_model=InitiateUploadResponse)
def initiate_new_version(
    asset_id: uuid.UUID,
    body: InitiateUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initiate upload of a new version for an existing asset."""
    # Row lock serializes concurrent version uploads so they can't both claim
    # the same version number.
    asset = (
        db.query(Asset)
        .filter(Asset.id == asset_id, Asset.deleted_at.is_(None))
        .with_for_update()
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    require_project_role(db, asset.project_id, current_user, ProjectRole.editor)

    if body.mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    if body.file_size_bytes > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 10GB limit")
    if mime_to_asset_type(body.mime_type) != asset.asset_type:
        raise HTTPException(status_code=400, detail=f"New version must be a {asset.asset_type.value} file")

    last_version = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset_id,
        AssetVersion.deleted_at.is_(None),
    ).order_by(AssetVersion.version_number.desc()).first()
    next_version_number = (last_version.version_number + 1) if last_version else 1

    version = AssetVersion(
        asset_id=asset_id,
        version_number=next_version_number,
        processing_status=ProcessingStatus.uploading,
        created_by=current_user.id,
    )
    db.add(version)
    db.flush()

    ext = os.path.splitext(body.original_filename)[1].lower()
    s3_key = f"raw/{asset.project_id}/{asset_id}/{version.id}/original{ext}"
    upload_id = create_multipart_upload(s3_key, body.mime_type)

    file_type_map = {AssetType.image: FileType.image, AssetType.audio: FileType.audio, AssetType.video: FileType.video}
    media_file = MediaFile(
        version_id=version.id,
        file_type=file_type_map.get(asset.asset_type, FileType.video),
        original_filename=body.original_filename,
        mime_type=body.mime_type,
        file_size_bytes=body.file_size_bytes,
        s3_key_raw=s3_key,
        upload_id=upload_id,
    )
    db.add(media_file)
    db.commit()

    return InitiateUploadResponse(
        upload_id=upload_id,
        s3_key=s3_key,
        asset_id=asset_id,
        version_id=version.id,
    )

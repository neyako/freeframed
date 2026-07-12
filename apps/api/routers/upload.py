import os
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
import uuid
from datetime import datetime, timezone
from typing import Optional
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User, UserStatus
from ..models.asset import Asset, AssetVersion, MediaFile, AssetType, ProcessingStatus, FileType
from ..models.folder import Folder
from ..models.project import Project, ProjectMember, ProjectRole
from ..models.activity import Notification, NotificationType
from ..services.s3_service import (
    create_multipart_upload, presign_upload_part,
    complete_multipart_upload, abort_multipart_upload,
)
from ..services.permissions import get_project_member, require_project_role
from ..schemas.upload import (
    InitiateUploadRequest, InitiateUploadResponse,
    PresignPartRequest, PresignPartResponse,
    CompleteUploadRequest, CompleteUploadResponse, AbortUploadRequest,
    ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, mime_to_asset_type,
)

router = APIRouter(prefix="/upload", tags=["upload"])


def find_quick_share_reviewer_id(
    db: Session,
    project: Project,
    uploader_id: uuid.UUID,
) -> Optional[uuid.UUID]:
    if not project.is_quick_share:
        return None
    base = db.query(ProjectMember).filter(
        ProjectMember.project_id == project.id,
        ProjectMember.user_id != uploader_id,
        ProjectMember.deleted_at.is_(None),
    )
    reviewer = (
        base.filter(ProjectMember.role == ProjectRole.reviewer)
        .order_by(ProjectMember.invited_at.asc())
        .first()
    )
    if reviewer is not None:
        return reviewer.user_id
    if project.created_by != uploader_id:
        return project.created_by
    superadmin = (
        db.query(User)
        .filter(
            User.is_superadmin == True,
            User.id != uploader_id,
            User.deleted_at.is_(None),
            User.status == UserStatus.active,
        )
        .order_by(User.created_at.asc())
        .first()
    )
    return superadmin.id if superadmin is not None else None


def _get_upload_media_file(db: Session, version_id: uuid.UUID) -> MediaFile:
    media_file = db.query(MediaFile).filter(MediaFile.version_id == version_id).first()
    if not media_file or not media_file.upload_id:
        raise HTTPException(status_code=404, detail="Upload not found")
    return media_file

@router.post("/initiate", response_model=InitiateUploadResponse)
def initiate_upload(
    body: InitiateUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate mime type
    if body.mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {body.mime_type}")
    if body.file_size_bytes > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 10GB limit")

    # Verify project access (editor or above)
    project = db.query(Project).filter(Project.id == body.project_id, Project.deleted_at.is_(None)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_role(db, body.project_id, current_user, ProjectRole.editor)

    if body.folder_id:
        folder = db.query(Folder).filter(
            Folder.id == body.folder_id,
            Folder.deleted_at.is_(None),
        ).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        if folder.project_id != body.project_id:
            raise HTTPException(status_code=400, detail="Folder does not belong to the specified project")

    # Get or create asset
    if body.asset_id:
        asset = db.query(Asset).filter(Asset.id == body.asset_id, Asset.deleted_at.is_(None)).first()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")
        if asset.project_id != body.project_id:
            raise HTTPException(status_code=400, detail="Asset does not belong to the specified project")
    else:
        asset_type = mime_to_asset_type(body.mime_type)
        asset = Asset(
            project_id=body.project_id,
            name=body.asset_name,
            asset_type=asset_type,
            created_by=current_user.id,
            folder_id=body.folder_id,
        )
        db.add(asset)
        db.flush()
        reviewer_id = find_quick_share_reviewer_id(db, project, current_user.id)
        if reviewer_id is not None:
            asset.assignee_id = reviewer_id
            notification = Notification(
                user_id=reviewer_id,
                type=NotificationType.assignment,
                asset_id=asset.id,
            )
            db.add(notification)

    # Get next version number
    last_version = db.query(AssetVersion).filter(
        AssetVersion.asset_id == asset.id,
        AssetVersion.deleted_at.is_(None),
    ).order_by(AssetVersion.version_number.desc()).first()
    next_version_number = (last_version.version_number + 1) if last_version else 1

    # Build S3 key: raw/{project_id}/{asset_id}/{version_id}/{filename}
    version = AssetVersion(
        asset_id=asset.id,
        version_number=next_version_number,
        processing_status=ProcessingStatus.uploading,
        created_by=current_user.id,
    )
    db.add(version)
    db.flush()

    ext = os.path.splitext(body.original_filename)[1].lower()
    s3_key = f"raw/{body.project_id}/{asset.id}/{version.id}/original{ext}"

    # Initiate S3 multipart upload
    upload_id = create_multipart_upload(s3_key, body.mime_type)

    # Create MediaFile record
    file_type_map = {AssetType.image: FileType.image, AssetType.audio: FileType.audio, AssetType.video: FileType.video, AssetType.image_carousel: FileType.image}
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
        asset_id=asset.id,
        version_id=version.id,
    )


@router.post("/presign-part", response_model=PresignPartResponse)
def presign_part(
    body: PresignPartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.part_number < 1 or body.part_number > 10000:
        raise HTTPException(status_code=400, detail="Part number must be between 1 and 10000")

    # Verify the s3_key belongs to an upload initiated by this user
    media_file = db.query(MediaFile).filter(MediaFile.s3_key_raw == body.s3_key).first()
    if not media_file:
        raise HTTPException(status_code=404, detail="Upload not found")
    if media_file.upload_id != body.upload_id:
        raise HTTPException(status_code=400, detail="Upload mismatch")
    version = db.query(AssetVersion).filter(AssetVersion.id == media_file.version_id).first()
    if not version or version.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized for this upload")

    url = presign_upload_part(media_file.s3_key_raw, media_file.upload_id, body.part_number)
    return PresignPartResponse(presigned_url=url, part_number=body.part_number)


@router.post("/complete", response_model=CompleteUploadResponse)
def complete_upload(
    body: CompleteUploadRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate DB first
    version = db.query(AssetVersion).filter(
        AssetVersion.id == body.version_id,
        AssetVersion.deleted_at.is_(None),
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized for this upload")
    if version.asset_id != body.asset_id:
        raise HTTPException(status_code=400, detail="Asset does not match upload")

    media_file = _get_upload_media_file(db, version.id)
    if media_file.s3_key_raw != body.s3_key or media_file.upload_id != body.upload_id:
        raise HTTPException(status_code=400, detail="Upload mismatch")

    # Then complete S3 multipart
    complete_multipart_upload(media_file.s3_key_raw, media_file.upload_id, [p.model_dump() for p in body.parts])

    version.processing_status = ProcessingStatus.processing
    db.commit()

    # Trigger transcoding in background (task dispatched in Step 7)
    background_tasks.add_task(_trigger_processing, version.asset_id, version.id)

    return CompleteUploadResponse(status="processing", asset_id=version.asset_id, version_id=version.id)


def _trigger_processing(asset_id: uuid.UUID, version_id: uuid.UUID):
    """Dispatch Celery task to process the uploaded asset."""
    from ..tasks.transcode_tasks import process_asset
    from ..tasks.celery_app import send_task_safe
    send_task_safe(process_asset, str(asset_id), str(version_id))


@router.post("/abort", status_code=status.HTTP_204_NO_CONTENT)
def abort_upload(
    body: AbortUploadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    version = db.query(AssetVersion).filter(
        AssetVersion.id == body.version_id,
        AssetVersion.deleted_at.is_(None),
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized for this upload")

    media_file = _get_upload_media_file(db, version.id)
    if media_file.s3_key_raw != body.s3_key or media_file.upload_id != body.upload_id:
        raise HTTPException(status_code=400, detail="Upload mismatch")

    abort_multipart_upload(media_file.s3_key_raw, media_file.upload_id)
    version.processing_status = ProcessingStatus.failed
    db.commit()

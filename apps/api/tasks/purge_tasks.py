import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists
from sqlalchemy.orm import Session

from .celery_app import celery_app
from ..config import settings
from ..database import SessionLocal
from ..models.approval import Approval
from ..models.asset import Asset, AssetVersion, MediaFile, ProcessingStatus
from ..models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from ..models.folder import Folder
from ..models.share import ShareLink
from ..services import s3_service
from ..services.approval_service import latest_version_approved


def purge_trashed_assets(
    db: Session,
    *,
    project_id: uuid.UUID | None = None,
    older_than: datetime,
    dry_run: bool = False,
) -> dict:
    # Purge intentionally selects soft-deleted rows, bounded by the retention cutoff.
    asset_query = db.query(Asset).filter(
        Asset.deleted_at.isnot(None),
        Asset.deleted_at < older_than,
    )
    folder_query = db.query(Folder).filter(
        Folder.deleted_at.isnot(None),
        Folder.deleted_at < older_than,
    )
    if project_id is not None:
        asset_query = asset_query.filter(Asset.project_id == project_id)
        folder_query = folder_query.filter(Folder.project_id == project_id)

    assets = asset_query.all()
    folders = folder_query.all()
    result = {
        "assets_purged": len(assets),
        "folders_purged": len(folders),
        "objects_deleted": 0,
        "dry_run": dry_run,
    }
    if dry_run:
        return result

    for asset in assets:
        result["objects_deleted"] += s3_service.delete_prefix(
            f"raw/{asset.project_id}/{asset.id}/"
        )
        result["objects_deleted"] += s3_service.delete_prefix(
            f"processed/{asset.project_id}/{asset.id}/"
        )

    asset_ids = [asset.id for asset in assets]
    if asset_ids:
        comment_ids = [
            comment_id
            for (comment_id,) in db.query(Comment.id)
            .filter(Comment.asset_id.in_(asset_ids))
            .all()
        ]
        if comment_ids:
            db.query(CommentReaction).filter(
                CommentReaction.comment_id.in_(comment_ids)
            ).delete(synchronize_session=False)
            db.query(Annotation).filter(Annotation.comment_id.in_(comment_ids)).delete(
                synchronize_session=False
            )
            db.query(CommentAttachment).filter(
                CommentAttachment.comment_id.in_(comment_ids)
            ).delete(synchronize_session=False)
        db.query(Comment).filter(Comment.asset_id.in_(asset_ids)).delete(
            synchronize_session=False
        )

        db.query(Approval).filter(Approval.asset_id.in_(asset_ids)).delete(
            synchronize_session=False
        )
        db.query(ShareLink).filter(ShareLink.asset_id.in_(asset_ids)).delete(
            synchronize_session=False
        )

        version_ids = [
            version_id
            for (version_id,) in db.query(AssetVersion.id)
            .filter(AssetVersion.asset_id.in_(asset_ids))
            .all()
        ]
        if version_ids:
            db.query(MediaFile).filter(MediaFile.version_id.in_(version_ids)).delete(
                synchronize_session=False
            )
        db.query(AssetVersion).filter(AssetVersion.asset_id.in_(asset_ids)).delete(
            synchronize_session=False
        )
        db.query(Asset).filter(Asset.id.in_(asset_ids)).delete(
            synchronize_session=False
        )

    folder_ids = [folder.id for folder in folders]
    if folder_ids:
        db.query(ShareLink).filter(ShareLink.folder_id.in_(folder_ids)).delete(
            synchronize_session=False
        )
        db.query(Folder).filter(Folder.id.in_(folder_ids)).delete(
            synchronize_session=False
        )

    db.commit()
    return result


@celery_app.task(name="purge_expired_trash")
def purge_expired_trash() -> dict:
    if settings.trash_retention_days == 0:
        return {
            "assets_purged": 0,
            "folders_purged": 0,
            "objects_deleted": 0,
            "dry_run": False,
        }

    db = SessionLocal()
    try:
        older_than = datetime.now(timezone.utc) - timedelta(
            days=settings.trash_retention_days
        )
        return purge_trashed_assets(db, older_than=older_than)
    finally:
        db.close()


STALE_VERSION_AGE = timedelta(hours=24)


def fail_stale_versions(db: Session, *, now: datetime | None = None) -> int:
    """Mark versions stuck in uploading/processing for a day as failed.

    Covers a tab closed mid-upload (no /upload/abort is sent) and a transcode
    task that never reached the broker. Their multipart parts are aborted so
    MinIO doesn't keep them. Returns the number of versions failed.
    """
    cutoff = (now or datetime.now(timezone.utc)) - STALE_VERSION_AGE
    stale = db.query(AssetVersion).filter(
        AssetVersion.deleted_at.is_(None),
        AssetVersion.processing_status.in_([ProcessingStatus.uploading, ProcessingStatus.processing]),
        AssetVersion.created_at < cutoff,
    ).all()
    for version in stale:
        if version.processing_status == ProcessingStatus.uploading:
            for media_file in db.query(MediaFile).filter(MediaFile.version_id == version.id).all():
                if media_file.upload_id:
                    try:
                        s3_service.abort_multipart_upload(media_file.s3_key_raw, media_file.upload_id)
                    except Exception:  # noqa: BROAD_EXCEPT_OK - already completed/aborted upload ids are fine.
                        pass
        version.processing_status = ProcessingStatus.failed
    db.commit()
    return len(stale)


@celery_app.task(name="fail_stale_versions")
def fail_stale_versions_task() -> int:
    db = SessionLocal()
    try:
        return fail_stale_versions(db)
    finally:
        db.close()


def trash_approved_assets(db: Session, *, now: datetime | None = None) -> int:
    """Move assets approved and untouched for approved_retention_days to the trash.

    Untouched means no edit to the asset (restoring counts, so a restored asset
    gets another full period) and no new or changed comment or cut on it. The
    trash purge deletes them for good trash_retention_days later, so a
    cleaned-up asset can still be restored in between. Returns the count.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=settings.approved_retention_days)
    # One UPDATE checks and trashes together: an approval withdrawn or a new
    # version committed before it runs is seen, with no select-then-write gap.
    trashed = (
        db.query(Asset)
        .filter(
            Asset.deleted_at.is_(None),
            Asset.updated_at < cutoff,
            latest_version_approved(approved_before=cutoff),
            ~exists().where(
                Comment.asset_id == Asset.id,
                Comment.deleted_at.is_(None),
                Comment.updated_at >= cutoff,
            ).correlate(Asset),
        )
        .update({Asset.deleted_at: now}, synchronize_session=False)
    )
    db.commit()
    return trashed


@celery_app.task(name="trash_approved_assets")
def trash_approved_assets_task() -> int:
    if settings.approved_retention_days == 0:
        return 0
    db = SessionLocal()
    try:
        return trash_approved_assets(db)
    finally:
        db.close()

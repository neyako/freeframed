import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .celery_app import celery_app
from ..config import settings
from ..database import SessionLocal
from ..models.activity import ActivityLog, Mention, Notification
from ..models.approval import Approval
from ..models.asset import Asset, AssetVersion, CarouselItem, MediaFile
from ..models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from ..models.folder import Folder
from ..models.metadata import AssetMetadata
from ..models.share import AssetShare, ShareLink, ShareLinkItem
from ..services import s3_service


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
        result["objects_deleted"] += s3_service.delete_prefix(
            f"watermarked/{asset.id}/"
        )

    now = datetime.now(timezone.utc)
    asset_ids = [asset.id for asset in assets]
    if asset_ids:
        comment_ids = [
            comment_id
            for (comment_id,) in db.query(Comment.id)
            .filter(Comment.asset_id.in_(asset_ids))
            .all()
        ]
        db.query(Notification).filter(
            or_(
                Notification.asset_id.in_(asset_ids),
                Notification.comment_id.in_(comment_ids),
            )
        ).delete(synchronize_session=False)
        if comment_ids:
            db.query(CommentReaction).filter(
                CommentReaction.comment_id.in_(comment_ids)
            ).delete(synchronize_session=False)
            db.query(Mention).filter(Mention.comment_id.in_(comment_ids)).delete(
                synchronize_session=False
            )
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
        db.query(AssetMetadata).filter(AssetMetadata.asset_id.in_(asset_ids)).delete(
            synchronize_session=False
        )

        db.query(ShareLinkItem).filter(ShareLinkItem.asset_id.in_(asset_ids)).delete(
            synchronize_session=False
        )
        db.query(AssetShare).filter(AssetShare.asset_id.in_(asset_ids)).delete(
            synchronize_session=False
        )
        for asset in assets:
            db.query(ShareLink).filter(ShareLink.asset_id == asset.id).update(
                {
                    ShareLink.asset_id: None,
                    ShareLink.project_id: asset.project_id,
                    ShareLink.is_enabled: False,
                    ShareLink.deleted_at: func.coalesce(ShareLink.deleted_at, now),
                },
                synchronize_session=False,
            )

        db.query(ActivityLog).filter(ActivityLog.asset_id.in_(asset_ids)).update(
            {ActivityLog.asset_id: None},
            synchronize_session=False,
        )

        version_ids = [
            version_id
            for (version_id,) in db.query(AssetVersion.id)
            .filter(AssetVersion.asset_id.in_(asset_ids))
            .all()
        ]
        if version_ids:
            media_file_ids = [
                media_file_id
                for (media_file_id,) in db.query(MediaFile.id)
                .filter(MediaFile.version_id.in_(version_ids))
                .all()
            ]
            carousel_filter = CarouselItem.version_id.in_(version_ids)
            if media_file_ids:
                carousel_filter = or_(
                    carousel_filter,
                    CarouselItem.media_file_id.in_(media_file_ids),
                )
            db.query(CarouselItem).filter(carousel_filter).delete(
                synchronize_session=False
            )
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
        db.query(ShareLinkItem).filter(ShareLinkItem.folder_id.in_(folder_ids)).delete(
            synchronize_session=False
        )
        db.query(AssetShare).filter(AssetShare.folder_id.in_(folder_ids)).delete(
            synchronize_session=False
        )
        for folder in folders:
            db.query(ShareLink).filter(ShareLink.folder_id == folder.id).update(
                {
                    ShareLink.folder_id: None,
                    ShareLink.project_id: folder.project_id,
                    ShareLink.is_enabled: False,
                    ShareLink.deleted_at: func.coalesce(ShareLink.deleted_at, now),
                },
                synchronize_session=False,
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

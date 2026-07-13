from datetime import datetime, timedelta, timezone
from typing import Final
from unittest.mock import call, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from apps.api.models.activity import ActivityLog, Mention, Notification, NotificationType
from apps.api.models.approval import Approval, ApprovalStatus
from apps.api.models.asset import Asset, AssetType, AssetVersion, CarouselItem
from apps.api.models.asset import FileType, MediaFile, ProcessingStatus
from apps.api.models.branding import WatermarkSettings
from apps.api.models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from apps.api.models.folder import Folder
from apps.api.models.metadata import AssetMetadata, FieldType, MetadataField
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.share import AssetShare, ShareActivityAction, ShareLink
from apps.api.models.share import ShareLinkActivity, ShareLinkItem, SharePermission
from apps.api.models.user import User
from apps.api.routers import folders
from apps.api.services import s3_service
from apps.api.tasks.purge_tasks import purge_trashed_assets


DELETE_PREFIX_TARGET: Final = "apps.api.tasks.purge_tasks.s3_service.delete_prefix"


def _project_with_owner(db: Session, make_project) -> tuple[Project, User]:
    project, owner = make_project()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role=ProjectRole.owner))
    db.flush()
    return project, owner


def _asset(db: Session, project: Project, owner: User) -> Asset:
    asset = Asset(
        project_id=project.id,
        name="clip.mov",
        asset_type=AssetType.video,
        created_by=owner.id,
    )
    db.add(asset)
    db.flush()
    return asset


def _version_with_media(
    db: Session, asset: Asset, owner: User
) -> tuple[AssetVersion, MediaFile]:
    version = AssetVersion(
        asset_id=asset.id, version_number=1,
        processing_status=ProcessingStatus.ready, created_by=owner.id,
    )
    db.add(version)
    db.flush()
    media = MediaFile(
        version_id=version.id, file_type=FileType.video,
        original_filename="clip.mov", mime_type="video/quicktime", file_size_bytes=1024,
        s3_key_raw=f"raw/{asset.project_id}/{asset.id}/{version.id}/original.mov",
    )
    db.add(media)
    db.flush()
    return version, media


def test_empty_trash_endpoint_purges_only_trashed_assets(db, make_project) -> None:
    project, owner = _project_with_owner(db, make_project)
    deleted = _asset(db, project, owner)
    live = _asset(db, project, owner)
    deleted.deleted_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    deleted_id, live_id = deleted.id, live.id

    with patch(DELETE_PREFIX_TARGET, return_value=1) as delete_prefix:
        result = folders.empty_trash(project.id, db, owner)

    assert result == {"assets_purged": 1, "folders_purged": 0,
                      "objects_deleted": 3, "dry_run": False}
    assert db.query(Asset).filter(Asset.id == deleted_id).one_or_none() is None
    assert db.query(Asset).filter(Asset.id == live_id).one_or_none() is not None
    assert delete_prefix.call_args_list == [call(f"raw/{project.id}/{deleted_id}/"),
        call(f"processed/{project.id}/{deleted_id}/"), call(f"watermarked/{deleted_id}/")]


def test_restore_before_empty_trash_preserves_asset(db, make_project) -> None:
    project, owner = _project_with_owner(db, make_project)
    asset = _asset(db, project, owner)
    asset.deleted_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    asset_id = asset.id
    folders.restore_asset(asset_id, db, owner)

    with patch(DELETE_PREFIX_TARGET, return_value=1) as delete_prefix:
        result = folders.empty_trash(project.id, db, owner)

    stored = db.query(Asset).filter(Asset.id == asset_id).one()
    assert result["assets_purged"] == 0
    assert stored.deleted_at is None
    delete_prefix.assert_not_called()


def test_retention_window_purges_only_expired_asset(db, make_project) -> None:
    project, owner = _project_with_owner(db, make_project)
    old = _asset(db, project, owner)
    recent = _asset(db, project, owner)
    now = datetime.now(timezone.utc)
    old.deleted_at = now - timedelta(days=45)
    recent.deleted_at = now
    db.commit()
    old_id, recent_id = old.id, recent.id

    with patch(DELETE_PREFIX_TARGET, return_value=1) as delete_prefix:
        result = purge_trashed_assets(db, older_than=now - timedelta(days=30))

    assert result["assets_purged"] == 1
    assert db.query(Asset).filter(Asset.id == old_id).one_or_none() is None
    assert db.query(Asset).filter(Asset.id == recent_id).one_or_none() is not None
    assert delete_prefix.call_args_list == [call(f"raw/{project.id}/{old_id}/"),
        call(f"processed/{project.id}/{old_id}/"), call(f"watermarked/{old_id}/")]


def test_empty_trash_requires_owner(db, make_project, make_user) -> None:
    project, _owner = _project_with_owner(db, make_project)
    editor = make_user()
    db.add(ProjectMember(project_id=project.id, user_id=editor.id, role=ProjectRole.editor))
    asset = _asset(db, project, editor)
    asset.deleted_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()

    with patch(DELETE_PREFIX_TARGET, return_value=1) as delete_prefix:
        with pytest.raises(HTTPException) as caught:
            folders.empty_trash(project.id, db, editor)

    assert caught.value.status_code == 403
    delete_prefix.assert_not_called()


def test_dry_run_reports_counts_without_deleting(db, make_project) -> None:
    project, owner = _project_with_owner(db, make_project)
    deleted_at = datetime.now(timezone.utc) - timedelta(days=45)
    folder = Folder(project_id=project.id, name="trash", created_by=owner.id,
                    deleted_at=deleted_at)
    db.add(folder)
    db.flush()
    asset = _asset(db, project, owner)
    asset.folder_id = folder.id
    asset.deleted_at = deleted_at
    db.commit()

    with patch(DELETE_PREFIX_TARGET, return_value=1) as delete_prefix:
        result = purge_trashed_assets(
            db,
            older_than=datetime.now(timezone.utc),
            dry_run=True,
        )

    assert result == {"assets_purged": 1, "folders_purged": 1,
                      "objects_deleted": 0, "dry_run": True}
    assert db.query(Asset).filter(Asset.id == asset.id).one_or_none() is not None
    assert db.query(Folder).filter(Folder.id == folder.id).one_or_none() is not None
    delete_prefix.assert_not_called()


def test_delete_prefix_rejects_broad_prefixes() -> None:
    with pytest.raises(ValueError):
        s3_service.delete_prefix("raw/")
    with pytest.raises(ValueError):
        s3_service.delete_prefix("watermarked")


def test_purge_deletes_full_asset_fk_graph(db, make_project) -> None:
    project, owner = _project_with_owner(db, make_project)
    asset = _asset(db, project, owner)
    asset.deleted_at = datetime.now(timezone.utc) - timedelta(days=45)
    version, media = _version_with_media(db, asset, owner)
    comment = Comment(
        asset_id=asset.id,
        version_id=version.id,
        author_id=owner.id,
        body="review",
    )
    field = MetadataField(project_id=project.id, name="Scene", field_type=FieldType.text)
    link = ShareLink(
        project_id=project.id, token=f"multi-{asset.id}",
        created_by=owner.id, title="Multi-item",
    )
    db.add_all([comment, field, link])
    db.flush()
    rows = [
        Notification(
            user_id=owner.id, type=NotificationType.comment,
            asset_id=asset.id, comment_id=comment.id,
        ),
        CommentReaction(comment_id=comment.id, user_id=owner.id, emoji="ok"),
        Mention(comment_id=comment.id, mentioned_user_id=owner.id),
        Annotation(comment_id=comment.id, drawing_data={"objects": []}),
        CommentAttachment(
            comment_id=comment.id, file_type="image/png",
            s3_key=f"comment-attachments/{comment.id}/note.png",
            original_filename="note.png", file_size_bytes=64,
        ),
        Approval(
            asset_id=asset.id, version_id=version.id,
            user_id=owner.id, status=ApprovalStatus.approved,
        ),
        AssetMetadata(asset_id=asset.id, field_id=field.id, value={"value": "A"}),
        ShareLinkItem(share_link_id=link.id, asset_id=asset.id),
        AssetShare(
            asset_id=asset.id, shared_with_user_id=owner.id,
            permission=SharePermission.view, shared_by=owner.id,
        ),
        CarouselItem(version_id=version.id, media_file_id=media.id, position=0),
    ]
    db.add_all(rows)
    db.commit()
    asset_id, version_id, media_id, link_id = asset.id, version.id, media.id, link.id
    row_ids = [(type(row), row.id) for row in rows]
    comment_id = comment.id

    with patch(DELETE_PREFIX_TARGET, return_value=1):
        purge_trashed_assets(db, older_than=datetime.now(timezone.utc))

    assert db.query(Asset).filter(Asset.id == asset_id).one_or_none() is None
    assert db.query(AssetVersion).filter(AssetVersion.id == version_id).one_or_none() is None
    assert db.query(MediaFile).filter(MediaFile.id == media_id).one_or_none() is None
    assert db.query(Comment).filter(Comment.id == comment_id).one_or_none() is None
    for model, row_id in row_ids:
        assert db.query(model).filter(model.id == row_id).one_or_none() is None
    assert db.query(ShareLink).filter(ShareLink.id == link_id).one_or_none() is not None


def test_purge_preserves_and_detaches_audit_history(db, make_project) -> None:
    project, owner = _project_with_owner(db, make_project)
    asset = _asset(db, project, owner)
    asset.deleted_at = datetime.now(timezone.utc) - timedelta(days=45)
    link = ShareLink(
        asset_id=asset.id, token=f"audit-{asset.id}",
        created_by=owner.id, title="Audit",
    )
    db.add(link)
    db.flush()
    share_activity = ShareLinkActivity(
        share_link_id=link.id, action=ShareActivityAction.viewed_asset,
        actor_email="guest@example.com", asset_id=asset.id, asset_name=asset.name,
    )
    watermark = WatermarkSettings(project_id=project.id, share_link_id=link.id, enabled=True)
    activity_log = ActivityLog(
        project_id=project.id, asset_id=asset.id, user_id=owner.id,
        action="deleted", payload={"asset_id": str(asset.id)},
    )
    db.add_all([share_activity, watermark, activity_log])
    db.commit()
    asset_id = asset.id
    link_id, share_activity_id = link.id, share_activity.id
    watermark_id, activity_log_id = watermark.id, activity_log.id

    with patch(DELETE_PREFIX_TARGET, return_value=1):
        purge_trashed_assets(db, older_than=datetime.now(timezone.utc))

    stored_link = db.query(ShareLink).filter(ShareLink.id == link_id).one()
    stored_share_activity = db.query(ShareLinkActivity).filter(
        ShareLinkActivity.id == share_activity_id).one()
    stored_watermark = db.query(WatermarkSettings).filter(
        WatermarkSettings.id == watermark_id).one()
    stored_activity_log = db.query(ActivityLog).filter(
        ActivityLog.id == activity_log_id).one()
    assert db.query(Asset).filter(Asset.id == asset_id).one_or_none() is None
    assert stored_link.asset_id is None
    assert stored_link.project_id == project.id
    assert stored_link.is_enabled is False
    assert stored_link.deleted_at is not None
    assert stored_share_activity.share_link_id == link_id
    assert stored_share_activity.asset_id == asset_id
    assert stored_watermark.share_link_id == link_id
    assert stored_activity_log.asset_id is None
    assert stored_activity_log.payload == {"asset_id": str(asset_id)}

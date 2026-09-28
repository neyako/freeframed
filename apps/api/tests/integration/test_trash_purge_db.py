from datetime import datetime, timedelta, timezone
from typing import Final
from unittest.mock import call, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from apps.api.models.approval import Approval, ApprovalStatus
from apps.api.models.asset import Asset, AssetType, AssetVersion
from apps.api.models.asset import FileType, MediaFile, ProcessingStatus
from apps.api.models.comment import Annotation, Comment, CommentAttachment, CommentReaction
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.share import ShareLink
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
                      "objects_deleted": 2, "dry_run": False}
    assert db.query(Asset).filter(Asset.id == deleted_id).one_or_none() is None
    assert db.query(Asset).filter(Asset.id == live_id).one_or_none() is not None
    assert delete_prefix.call_args_list == [call(f"raw/{project.id}/{deleted_id}/"),
        call(f"processed/{project.id}/{deleted_id}/")]


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
        call(f"processed/{project.id}/{old_id}/")]


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
        s3_service.delete_prefix("processed")


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
    db.add(comment)
    db.flush()
    rows = [
        CommentReaction(comment_id=comment.id, user_id=owner.id, emoji="ok"),
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
        ShareLink(asset_id=asset.id, token=f"asset-{asset.id}", created_by=owner.id, title="Asset"),
    ]
    db.add_all(rows)
    db.commit()
    asset_id, version_id, media_id = asset.id, version.id, media.id
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


def test_purge_deletes_folder_share_links(db, make_project) -> None:
    project, owner = _project_with_owner(db, make_project)
    folder = Folder(project_id=project.id, name="trash", created_by=owner.id,
                    deleted_at=datetime.now(timezone.utc) - timedelta(days=45))
    db.add(folder)
    db.flush()
    link = ShareLink(folder_id=folder.id, token=f"folder-{folder.id}",
                     created_by=owner.id, title="Folder")
    db.add(link)
    db.commit()
    folder_id, link_id = folder.id, link.id

    with patch(DELETE_PREFIX_TARGET, return_value=1):
        purge_trashed_assets(db, older_than=datetime.now(timezone.utc))

    assert db.query(Folder).filter(Folder.id == folder_id).one_or_none() is None
    assert db.query(ShareLink).filter(ShareLink.id == link_id).one_or_none() is None

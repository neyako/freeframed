import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import event
from sqlalchemy.orm import Session

from apps.api.models.asset import (
    Asset,
    AssetType,
    AssetVersion,
    FileType,
    MediaFile,
    ProcessingStatus,
)
from apps.api.models.comment import Comment
from apps.api.models.folder import Folder
from apps.api.models.share import (
    ShareLink,
    ShareLinkItem,
    SharePermission,
    ShareVisibility,
)
from apps.api.models.user import User
from apps.api.routers import share


@dataclass(frozen=True, slots=True)
class AssetFact:
    asset: Asset
    media_file: MediaFile
    comment_count: int
    creator_name: str


@dataclass(frozen=True, slots=True)
class SubfolderFact:
    folder: Folder
    item_count: int
    thumbnail_urls: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ShareListingWorld:
    link: ShareLink
    multi_link: ShareLink
    assets: tuple[AssetFact, ...]
    subfolders: tuple[SubfolderFact, ...]


def _thumbnail_url(s3_key: str) -> str:
    return f"https://cdn.test/{s3_key}"


def _add_folder(
    db: Session,
    project_id: uuid.UUID,
    creator_id: uuid.UUID,
    name: str,
    parent_id: uuid.UUID | None = None,
) -> Folder:
    folder = Folder(
        project_id=project_id,
        parent_id=parent_id,
        name=name,
        created_by=creator_id,
    )
    db.add(folder)
    db.flush()
    return folder


def _add_asset(
    db: Session,
    project_id: uuid.UUID,
    folder_id: uuid.UUID,
    creator: User,
    name: str,
    created_at: datetime,
    file_size: int,
    comment_count: int = 0,
) -> tuple[Asset, MediaFile]:
    asset = Asset(
        project_id=project_id,
        folder_id=folder_id,
        name=name,
        asset_type=AssetType.video,
        created_by=creator.id,
        created_at=created_at,
    )
    db.add(asset)
    db.flush()
    ready_version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.ready,
        created_by=creator.id,
    )
    db.add(ready_version)
    db.flush()
    media_file = MediaFile(
        version_id=ready_version.id,
        file_type=FileType.video,
        original_filename=name,
        mime_type="video/quicktime",
        file_size_bytes=file_size,
        s3_key_raw=f"raw/{asset.id}.mov",
        s3_key_thumbnail=f"thumbs/{asset.id}.jpg",
        duration_seconds=float(file_size),
    )
    db.add(media_file)
    for index in range(comment_count):
        db.add(
            Comment(
                asset_id=asset.id,
                version_id=ready_version.id,
                author_id=creator.id,
                body=f"Comment {index}",
            )
        )
    db.add(
        Comment(
            asset_id=asset.id,
            version_id=ready_version.id,
            author_id=creator.id,
            body="Deleted comment",
            deleted_at=datetime.now(timezone.utc),
        )
    )
    db.add(
        AssetVersion(
            asset_id=asset.id,
            version_number=2,
            processing_status=ProcessingStatus.processing,
            created_by=creator.id,
        )
    )
    deleted_ready_version = AssetVersion(
        asset_id=asset.id,
        version_number=3,
        processing_status=ProcessingStatus.ready,
        created_by=creator.id,
        deleted_at=datetime.now(timezone.utc),
    )
    db.add(deleted_ready_version)
    db.flush()
    db.add(
        MediaFile(
            version_id=deleted_ready_version.id,
            file_type=FileType.video,
            original_filename=f"deleted-{name}",
            mime_type="video/quicktime",
            file_size_bytes=file_size + 100_000,
            s3_key_raw=f"deleted/{asset.id}.mov",
            s3_key_thumbnail=f"deleted/{asset.id}.jpg",
        )
    )
    db.flush()
    return asset, media_file


def _build_share_listing_world(db, make_project, make_user) -> ShareListingWorld:
    project, owner = make_project()
    owner.name = "Owner Creator"
    second_creator = make_user(name="Second Creator")
    root = _add_folder(db, project.id, owner.id, "Shared root")
    subfolders = tuple(
        _add_folder(db, project.id, owner.id, name, root.id)
        for name in ("A", "B", "C")
    )
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    subfolder_facts: list[SubfolderFact] = []
    for folder_index, folder in enumerate(subfolders):
        preview_count = 5 if folder_index == 0 else 1
        previews: list[MediaFile] = []
        for preview_index in range(preview_count):
            _, media_file = _add_asset(
                db,
                project.id,
                folder.id,
                owner,
                f"preview-{folder.name}-{preview_index}.mov",
                now + timedelta(minutes=preview_index),
                100 + preview_index,
            )
            previews.append(media_file)
        child_count = 0
        if folder_index == 0:
            _add_folder(db, project.id, owner.id, "Active child", folder.id)
            deleted_child = _add_folder(
                db,
                project.id,
                owner.id,
                "Deleted child",
                folder.id,
            )
            deleted_child.deleted_at = datetime.now(timezone.utc)
            deleted_asset, _ = _add_asset(
                db,
                project.id,
                folder.id,
                owner,
                "deleted-preview.mov",
                now + timedelta(hours=1),
                999,
            )
            deleted_asset.deleted_at = datetime.now(timezone.utc)
            child_count = 1
        preview_urls = tuple(
            _thumbnail_url(media_file.s3_key_thumbnail)
            for media_file in reversed(previews[-4:])
        )
        subfolder_facts.append(
            SubfolderFact(
                folder=folder,
                item_count=preview_count + child_count,
                thumbnail_urls=preview_urls,
            )
        )

    asset_facts: list[AssetFact] = []
    for index in range(5):
        creator = owner if index % 2 == 0 else second_creator
        asset, media_file = _add_asset(
            db,
            project.id,
            root.id,
            creator,
            f"root-{index}.mov",
            now + timedelta(hours=index),
            1_000 + index,
            comment_count=index + 1,
        )
        asset_facts.append(
            AssetFact(
                asset=asset,
                media_file=media_file,
                comment_count=index + 1,
                creator_name=creator.name,
            )
        )

    link = ShareLink(
        folder_id=root.id,
        token="folder-listing-batch",
        created_by=owner.id,
        title="Folder listing",
        permission=SharePermission.view,
        visibility=ShareVisibility.public,
        is_enabled=True,
    )
    multi_link = ShareLink(
        project_id=project.id,
        token="multi-listing-batch",
        created_by=owner.id,
        title="Multi listing",
        permission=SharePermission.view,
        visibility=ShareVisibility.public,
        is_enabled=True,
    )
    db.add_all([link, multi_link])
    db.flush()
    db.add_all(
        [
            ShareLinkItem(
                share_link_id=multi_link.id,
                folder_id=subfolder_facts[0].folder.id,
            ),
            ShareLinkItem(
                share_link_id=multi_link.id,
                asset_id=asset_facts[0].asset.id,
            ),
        ]
    )
    db.flush()
    return ShareListingWorld(
        link=link,
        multi_link=multi_link,
        assets=tuple(asset_facts),
        subfolders=tuple(subfolder_facts),
    )


def _get_listing(db: Session, token: str):
    with patch(
        "apps.api.routers.share.generate_presigned_get_url",
        side_effect=_thumbnail_url,
    ):
        return share.get_folder_share_assets(
            token,
            folder_id=None,
            page=1,
            per_page=50,
            share_session=None,
            db=db,
            current_user=None,
        )


def test_share_listing_batching_preserves_response_contract(
    db,
    make_project,
    make_user,
) -> None:
    world = _build_share_listing_world(db, make_project, make_user)

    response = _get_listing(db, world.link.token)

    assert response.total == 5
    actual_assets = {item.id: item for item in response.assets}
    for fact in world.assets:
        item = actual_assets[fact.asset.id]
        assert item.thumbnail_url == _thumbnail_url(fact.media_file.s3_key_thumbnail)
        assert item.file_size == fact.media_file.file_size_bytes
        assert item.duration_seconds == fact.media_file.duration_seconds
        assert item.comment_count == fact.comment_count
        assert item.created_by_name == fact.creator_name
    actual_subfolders = {item.id: item for item in response.subfolders}
    for fact in world.subfolders:
        item = actual_subfolders[fact.folder.id]
        assert item.item_count == fact.item_count
        assert tuple(item.thumbnail_urls) == fact.thumbnail_urls


def test_share_listing_batching_uses_bounded_query_count(
    db,
    migrated_engine,
    make_project,
    make_user,
) -> None:
    world = _build_share_listing_world(db, make_project, make_user)
    statements: list[str] = []

    def count_statement(
        _conn,
        _cursor,
        statement: str,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        statements.append(statement)

    event.listen(migrated_engine, "before_cursor_execute", count_statement)
    try:
        _get_listing(db, world.link.token)
    finally:
        event.remove(migrated_engine, "before_cursor_execute", count_statement)

    assert len(statements) <= 15


def test_share_listing_batching_preserves_multi_share_contract(
    db,
    make_project,
    make_user,
) -> None:
    world = _build_share_listing_world(db, make_project, make_user)
    asset_fact = world.assets[0]
    subfolder_fact = world.subfolders[0]

    response = _get_listing(db, world.multi_link.token)

    assert response.total == 1
    assert [item.id for item in response.assets] == [asset_fact.asset.id]
    assert response.assets[0].thumbnail_url == _thumbnail_url(
        asset_fact.media_file.s3_key_thumbnail
    )
    assert response.assets[0].comment_count == asset_fact.comment_count
    assert response.assets[0].file_size is None
    assert [item.id for item in response.subfolders] == [subfolder_fact.folder.id]
    assert response.subfolders[0].item_count == subfolder_fact.item_count
    assert tuple(response.subfolders[0].thumbnail_urls) == (
        subfolder_fact.thumbnail_urls
    )

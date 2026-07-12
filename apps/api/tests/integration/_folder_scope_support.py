from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator
from unittest.mock import patch

from fastapi.testclient import TestClient

from apps.api.database import get_db
from apps.api.main import app
from apps.api.middleware.auth import get_current_user
from apps.api.models.asset import (
    Asset,
    AssetStatus,
    AssetType,
    AssetVersion,
    FileType,
    MediaFile,
    ProcessingStatus,
)
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.share import AssetShare, SharePermission
from apps.api.models.user import User


@dataclass(frozen=True, slots=True)
class FolderScopeWorld:
    project: Project
    owner: User
    recipient: User
    public_reader: User
    root_asset: Asset
    root_a: Folder
    child_a1: Folder
    grandchild_a2: Folder
    root_b: Folder
    child_b1: Folder
    root_c: Folder
    asset_a: Asset
    asset_a1: Asset
    asset_a2: Asset
    asset_b: Asset
    asset_b1: Asset
    asset_c: Asset
    grants: tuple[AssetShare, ...]


def _folder(db, project: Project, name: str, parent_id=None) -> Folder:
    folder = Folder(
        project_id=project.id,
        parent_id=parent_id,
        name=name,
        created_by=project.created_by,
    )
    db.add(folder)
    db.flush()
    return folder


def _asset(db, project: Project, folder_id, name: str, size: int) -> Asset:
    asset = Asset(
        project_id=project.id,
        folder_id=folder_id,
        name=name,
        asset_type=AssetType.video,
        status=AssetStatus.in_review,
        created_by=project.created_by,
    )
    db.add(asset)
    db.flush()
    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.ready,
        created_by=project.created_by,
    )
    db.add(version)
    db.flush()
    db.add(
        MediaFile(
            version_id=version.id,
            file_type=FileType.video,
            original_filename=f"{name}.mov",
            mime_type="video/quicktime",
            file_size_bytes=size,
            s3_key_raw=f"synthetic/{asset.id}/raw.mov",
            s3_key_processed=f"synthetic/{asset.id}/hls/master.m3u8",
        )
    )
    db.flush()
    return asset


def build_folder_scope_world(db, make_project, make_user) -> FolderScopeWorld:
    project, owner = make_project()
    project.name = "Synthetic scoped project"
    recipient = make_user("scoped-recipient@invalid.test", "Scoped Recipient")
    public_reader = make_user("public-reader@invalid.test", "Public Reader")
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role=ProjectRole.owner))
    root_a = _folder(db, project, "A")
    child_a1 = _folder(db, project, "A1", root_a.id)
    grandchild_a2 = _folder(db, project, "A2", child_a1.id)
    root_b = _folder(db, project, "B")
    child_b1 = _folder(db, project, "B1", root_b.id)
    root_c = _folder(db, project, "C")
    root_asset = _asset(db, project, None, "root", 5)
    asset_a = _asset(db, project, root_a.id, "asset-a", 10)
    asset_a1 = _asset(db, project, child_a1.id, "asset-a1", 20)
    asset_a2 = _asset(db, project, grandchild_a2.id, "asset-a2", 30)
    asset_b = _asset(db, project, root_b.id, "asset-b", 40)
    asset_b1 = _asset(db, project, child_b1.id, "asset-b1", 50)
    asset_c = _asset(db, project, root_c.id, "asset-c", 60)
    grants = (
        AssetShare(
            folder_id=root_a.id,
            shared_with_user_id=recipient.id,
            permission=SharePermission.view,
            shared_by=owner.id,
        ),
        AssetShare(
            folder_id=child_a1.id,
            shared_with_user_id=recipient.id,
            permission=SharePermission.approve,
            shared_by=owner.id,
        ),
        AssetShare(
            folder_id=root_b.id,
            shared_with_user_id=recipient.id,
            permission=SharePermission.comment,
            shared_by=owner.id,
        ),
    )
    db.add_all(grants)
    db.commit()
    return FolderScopeWorld(
        project=project,
        owner=owner,
        recipient=recipient,
        public_reader=public_reader,
        root_asset=root_asset,
        root_a=root_a,
        child_a1=child_a1,
        grandchild_a2=grandchild_a2,
        root_b=root_b,
        child_b1=child_b1,
        root_c=root_c,
        asset_a=asset_a,
        asset_a1=asset_a1,
        asset_a2=asset_a2,
        asset_b=asset_b,
        asset_b1=asset_b1,
        asset_c=asset_c,
        grants=grants,
    )


@contextmanager
def folder_scope_client(db, user: User) -> Iterator[TestClient]:
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with patch("apps.api.main.ensure_bucket_exists"):
            with TestClient(app, raise_server_exceptions=False) as client:
                yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)

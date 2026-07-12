from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.asset import Asset, AssetType
from apps.api.models.folder import Folder
from apps.api.models.share import ShareLink, SharePermission
from apps.api.routers import share
from apps.api.services.permissions import validate_asset_in_share, validate_share_link


def _add_asset(db, project_id, creator_id, folder_id=None) -> Asset:
    asset = Asset(
        project_id=project_id,
        folder_id=folder_id,
        name="clip.mov",
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def _add_share_link(db, creator_id, token: str, asset_id=None, folder_id=None) -> ShareLink:
    link = ShareLink(
        asset_id=asset_id,
        folder_id=folder_id,
        token=token,
        created_by=creator_id,
        title=token,
        permission=SharePermission.view,
    )
    db.add(link)
    db.flush()
    return link


def _add_folder(db, project_id, creator_id, name: str, parent_id=None) -> Folder:
    folder = Folder(
        project_id=project_id,
        parent_id=parent_id,
        name=name,
        created_by=creator_id,
    )
    db.add(folder)
    db.flush()
    return folder


def test_validate_share_link_returns_enabled_link(db, make_project) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    link = _add_share_link(db, owner.id, "happy-token", asset_id=asset.id)

    result = validate_share_link(db, link.token)

    assert result.id == link.id


def test_validate_share_link_rejects_expired_link(db, make_project) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    link = _add_share_link(db, owner.id, "expired-token", asset_id=asset.id)
    link.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        validate_share_link(db, link.token)

    assert exc.value.status_code == 410


def test_validate_share_link_rejects_disabled_link(db, make_project) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    link = _add_share_link(db, owner.id, "disabled-token", asset_id=asset.id)
    link.is_enabled = False
    db.flush()

    with pytest.raises(HTTPException) as exc:
        validate_share_link(db, link.token)

    assert exc.value.status_code == 403


def test_validate_asset_in_share_accepts_grandchild_folder_asset(
    db,
    make_project,
) -> None:
    project, owner = make_project()
    root = _add_folder(db, project.id, owner.id, "root")
    child = _add_folder(db, project.id, owner.id, "child", parent_id=root.id)
    grandchild = _add_folder(db, project.id, owner.id, "grandchild", parent_id=child.id)
    asset = _add_asset(db, project.id, owner.id, folder_id=grandchild.id)
    link = _add_share_link(db, owner.id, "folder-token", folder_id=root.id)

    validate_asset_in_share(db, link, asset)


def test_validate_asset_in_share_rejects_sibling_folder_asset(
    db,
    make_project,
) -> None:
    project, owner = make_project()
    root = _add_folder(db, project.id, owner.id, "root")
    sibling = _add_folder(db, project.id, owner.id, "sibling")
    asset = _add_asset(db, project.id, owner.id, folder_id=sibling.id)
    link = _add_share_link(db, owner.id, "sibling-token", folder_id=root.id)

    with pytest.raises(HTTPException) as exc:
        validate_asset_in_share(db, link, asset)

    assert exc.value.status_code == 403


def test_folder_share_browse_rejects_active_descendant_below_deleted_ancestor(
    db,
    make_project,
) -> None:
    project, owner = make_project()
    root = _add_folder(db, project.id, owner.id, "root")
    deleted_parent = _add_folder(
        db,
        project.id,
        owner.id,
        "deleted-parent",
        parent_id=root.id,
    )
    deleted_parent.deleted_at = datetime.now(timezone.utc)
    leaf = _add_folder(
        db,
        project.id,
        owner.id,
        "leaf",
        parent_id=deleted_parent.id,
    )
    _add_asset(db, project.id, owner.id, folder_id=leaf.id)
    link = _add_share_link(db, owner.id, "deleted-ancestor-token", folder_id=root.id)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        share.get_folder_share_assets(
            link.token,
            folder_id=leaf.id,
            page=1,
            per_page=50,
            share_session=None,
            db=db,
            current_user=None,
        )

    assert exc.value.status_code == 403

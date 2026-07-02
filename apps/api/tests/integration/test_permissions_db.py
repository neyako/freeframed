from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.asset import Asset, AssetType
from apps.api.models.project import ProjectMember, ProjectRole
from apps.api.models.share import AssetShare, SharePermission
from apps.api.services.permissions import can_access_asset, require_project_role


def _add_member(db, project_id, user_id, role: ProjectRole) -> ProjectMember:
    member = ProjectMember(project_id=project_id, user_id=user_id, role=role)
    db.add(member)
    db.flush()
    return member


def _add_asset(db, project_id, creator_id) -> Asset:
    asset = Asset(
        project_id=project_id,
        name="clip.mov",
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def test_require_project_role_allows_owner_for_editor_minimum(
    db,
    make_project,
) -> None:
    project, owner = make_project()
    _add_member(db, project.id, owner.id, ProjectRole.owner)

    member = require_project_role(db, project.id, owner, ProjectRole.editor)

    assert member.role == ProjectRole.owner


def test_require_project_role_rejects_viewer_for_editor_minimum(
    db,
    make_project,
    make_user,
) -> None:
    project, _owner = make_project()
    viewer = make_user()
    _add_member(db, project.id, viewer.id, ProjectRole.viewer)

    with pytest.raises(HTTPException) as exc:
        require_project_role(db, project.id, viewer, ProjectRole.editor)

    assert exc.value.status_code == 403


def test_require_project_role_ignores_soft_deleted_membership(
    db,
    make_project,
    make_user,
) -> None:
    project, _owner = make_project()
    editor = make_user()
    member = _add_member(db, project.id, editor.id, ProjectRole.editor)
    member.deleted_at = datetime.now(timezone.utc)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        require_project_role(db, project.id, editor, ProjectRole.viewer)

    assert exc.value.status_code == 403
    assert exc.value.detail == "Not a project member"


def test_can_access_asset_allows_creator(db, make_project) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)

    assert can_access_asset(db, asset, owner) is True


def test_can_access_asset_rejects_unrelated_user_on_private_project(
    db,
    make_project,
    make_user,
) -> None:
    project, owner = make_project()
    other = make_user()
    asset = _add_asset(db, project.id, owner.id)

    assert can_access_asset(db, asset, other) is False


def test_can_access_asset_allows_direct_share_until_soft_deleted(
    db,
    make_project,
    make_user,
) -> None:
    project, owner = make_project()
    recipient = make_user()
    asset = _add_asset(db, project.id, owner.id)
    share = AssetShare(
        asset_id=asset.id,
        shared_with_user_id=recipient.id,
        permission=SharePermission.view,
        shared_by=owner.id,
    )
    db.add(share)
    db.flush()

    assert can_access_asset(db, asset, recipient) is True

    share.deleted_at = datetime.now(timezone.utc)
    db.flush()

    assert can_access_asset(db, asset, recipient) is False


def test_can_access_asset_allows_authenticated_user_for_public_project(
    db,
    make_project,
    make_user,
) -> None:
    project, owner = make_project(is_public=True)
    other = make_user()
    asset = _add_asset(db, project.id, owner.id)

    assert can_access_asset(db, asset, other) is True

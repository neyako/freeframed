from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.asset import Asset, AssetType
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.share import AssetShare, ShareLink, SharePermission
from apps.api.services import permissions
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


def _add_folder(db, project: Project, parent_id=None) -> Folder:
    folder = Folder(
        project_id=project.id,
        parent_id=parent_id,
        name=f"folder-{uuid.uuid4().hex}",
        created_by=project.created_by,
    )
    db.add(folder)
    db.flush()
    return folder


def _access_values(
    access: permissions.AssetAccess,
) -> tuple[bool, bool, bool, bool, SharePermission | None]:
    return (access.can_read, access.can_comment, access.can_approve, access.is_project_member, access.direct_permission)


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


def test_asset_access_matrix_matches_roles_shares_and_public_reader(db, make_project, make_user) -> None:
    project, owner = make_project(is_public=True)
    asset = _add_asset(db, project.id, owner.id)
    actors = {
        "owner": make_user(),
        "editor": make_user(),
        "reviewer": make_user(),
        "viewer": make_user(),
        "direct_approve": make_user(),
        "direct_comment": make_user(),
        "direct_view": make_user(),
        "public_reader": make_user(),
    }
    _add_member(db, project.id, actors["owner"].id, ProjectRole.owner)
    _add_member(db, project.id, actors["editor"].id, ProjectRole.editor)
    _add_member(db, project.id, actors["reviewer"].id, ProjectRole.reviewer)
    _add_member(db, project.id, actors["viewer"].id, ProjectRole.viewer)
    for name, permission in (
        ("direct_approve", SharePermission.approve),
        ("direct_comment", SharePermission.comment),
        ("direct_view", SharePermission.view),
    ):
        db.add(
            AssetShare(
                asset_id=asset.id,
                shared_with_user_id=actors[name].id,
                permission=permission,
                shared_by=owner.id,
            )
        )
    db.flush()

    actual = {
        name: _access_values(permissions.get_asset_access(db, asset, actor))
        for name, actor in actors.items()
    }

    assert actual == {
        "owner": (True, True, True, True, None),
        "editor": (True, True, True, True, None),
        "reviewer": (True, True, True, True, None),
        "viewer": (True, False, False, True, None),
        "direct_approve": (True, True, True, False, SharePermission.approve),
        "direct_comment": (True, True, False, False, SharePermission.comment),
        "direct_view": (True, False, False, False, SharePermission.view),
        "public_reader": (True, False, False, False, None),
    }


def test_asset_access_denies_unrelated_private_reader(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)

    access = permissions.get_asset_access(db, asset, actor)

    assert _access_values(access) == (False, False, False, False, None)


def test_can_access_asset_allows_folder_share_for_descendant(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    root = _add_folder(db, project)
    child = _add_folder(db, project, root.id)
    asset = _add_asset(db, project.id, owner.id)
    asset.folder_id = child.id
    db.add(
        AssetShare(
            folder_id=root.id,
            shared_with_user_id=actor.id,
            permission=SharePermission.comment,
            shared_by=owner.id,
        )
    )
    db.flush()

    assert can_access_asset(db, asset, actor) is True


def test_asset_access_rejects_folder_share_from_sibling(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    shared_root = _add_folder(db, project)
    sibling = _add_folder(db, project)
    asset = _add_asset(db, project.id, owner.id)
    asset.folder_id = sibling.id
    db.add(
        AssetShare(
            folder_id=shared_root.id,
            shared_with_user_id=actor.id,
            permission=SharePermission.approve,
            shared_by=owner.id,
        )
    )
    db.flush()

    access = permissions.get_asset_access(db, asset, actor)

    assert _access_values(access) == (False, False, False, False, None)


def test_asset_access_ignores_soft_deleted_membership_and_shares(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    member = _add_member(db, project.id, actor.id, ProjectRole.reviewer)
    root = _add_folder(db, project)
    asset = _add_asset(db, project.id, owner.id)
    asset.folder_id = root.id
    direct = AssetShare(
        asset_id=asset.id,
        shared_with_user_id=actor.id,
        permission=SharePermission.comment,
        shared_by=owner.id,
    )
    folder_share = AssetShare(
        folder_id=root.id,
        shared_with_user_id=actor.id,
        permission=SharePermission.approve,
        shared_by=owner.id,
    )
    db.add_all([direct, folder_share])
    db.flush()
    deleted_at = datetime.now(timezone.utc)
    member.deleted_at = deleted_at
    direct.deleted_at = deleted_at
    folder_share.deleted_at = deleted_at
    db.flush()

    access = permissions.get_asset_access(db, asset, actor)

    assert _access_values(access) == (False, False, False, False, None)


def test_get_share_link_project_id_resolves_asset_link(db, make_project) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    link = ShareLink(
        asset_id=asset.id,
        token="synthetic-permission-link",
        created_by=owner.id,
    )
    db.add(link)
    db.flush()

    project_id = permissions.get_share_link_project_id(db, link)

    assert project_id == project.id

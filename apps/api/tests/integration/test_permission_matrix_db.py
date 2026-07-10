from __future__ import annotations

import uuid
from datetime import datetime, timezone

from apps.api.models.asset import Asset, AssetType
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.share import AssetShare, SharePermission
from apps.api.services import permissions


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


def test_asset_access_matrix_uses_private_project_for_roles_and_direct_shares(db, make_project, make_user) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    actors = {
        "owner": make_user(),
        "editor": make_user(),
        "reviewer": make_user(),
        "viewer": make_user(),
        "direct_approve": make_user(),
        "direct_comment": make_user(),
        "direct_view": make_user(),
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
    }


def test_asset_access_public_reader_is_read_only_on_separate_public_project(db, make_project, make_user) -> None:
    project, owner = make_project(is_public=True)
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)

    access = permissions.get_asset_access(db, asset, actor)

    assert _access_values(access) == (True, False, False, False, None)


def test_asset_access_denies_unrelated_private_reader(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    asset = _add_asset(db, project.id, owner.id)

    access = permissions.get_asset_access(db, asset, actor)

    assert _access_values(access) == (False, False, False, False, None)


def test_asset_access_folder_share_inherits_to_descendant(db, make_project, make_user) -> None:
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

    access = permissions.get_asset_access(db, asset, actor)

    assert _access_values(access) == (True, True, False, False, SharePermission.comment)


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


def test_asset_creator_with_viewer_membership_has_viewer_capabilities(db, make_project) -> None:
    project, creator = make_project()
    _add_member(db, project.id, creator.id, ProjectRole.viewer)
    asset = _add_asset(db, project.id, creator.id)

    access = permissions.get_asset_access(db, asset, creator)

    assert _access_values(access) == (True, False, False, True, None)


def test_asset_creator_with_soft_deleted_membership_has_no_access(db, make_project) -> None:
    project, creator = make_project()
    member = _add_member(db, project.id, creator.id, ProjectRole.reviewer)
    asset = _add_asset(db, project.id, creator.id)
    member.deleted_at = datetime.now(timezone.utc)
    db.flush()

    access = permissions.get_asset_access(db, asset, creator)

    assert _access_values(access) == (False, False, False, False, None)


def test_soft_deleted_asset_denies_otherwise_authorized_actor(db, make_project, make_user) -> None:
    project, owner = make_project()
    actor = make_user()
    _add_member(db, project.id, actor.id, ProjectRole.reviewer)
    asset = _add_asset(db, project.id, owner.id)
    asset.deleted_at = datetime.now(timezone.utc)
    db.flush()

    access = permissions.get_asset_access(db, asset, actor)

    assert _access_values(access) == (False, False, False, False, None)
